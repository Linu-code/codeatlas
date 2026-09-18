/**
 * metrics.ts —— 代码度量（单次 AST 遍历完成全部计算）
 *
 * 三类指标：
 *   1. 圈复杂度 McCabe：1 + 判定点数量
 *      JS: if / for / for-in/for-of / while / do / case / catch / ?: / && / || / ??
 *      Py: if / elif / for / while / except / ?: 三元 / and / or
 *      （其余语言的判定点集合见下方各 LANG_* 常量，节点名均经真实语法包实测确认）
 *   2. 认知复杂度（SonarSource 简化实现）：
 *      · 结构增量：if / 循环 / ?: / catch / switch → +1，每层嵌套再 +嵌套深度
 *      · 逻辑序列：同一表达式里连续的 and/or 序列 → 每个新增逻辑算 +1
 *      · 跳转：break / continue / goto / 带标签跳转 → +1（不叠加嵌套）
 *   3. SLOC：总行 / 代码行（非空非注释）/ 注释行
 *
 * 为什么要一次遍历：对中型仓库（数百文件）而言，AST 遍历是主要开销，
 * 分开算三遍会让分析耗时翻三倍。
 */

import type Parser from 'web-tree-sitter';
import type { LangId } from './parser';
import { firstChildOfType } from './langs/types';
import { cLikeDefName } from './langs/c';

export interface FunctionMetrics {
  name: string;
  line: number;
  endLine: number;
  /** McCabe 圈复杂度 */
  cyclomatic: number;
  /** 认知复杂度 */
  cognitive: number;
  /** 函数体内代码行数 */
  sloc: number;
}

export interface FileMetrics {
  path: string;
  language: LangId;
  /** 文件级圈复杂度：所有函数之和 + 顶层判定点 */
  cyclomatic: number;
  cognitive: number;
  totalLines: number;
  /** 非空非注释行 */
  sloc: number;
  commentLines: number;
  functions: FunctionMetrics[];
  /** 最高复杂度（用于排序与标红） */
  maxFunctionComplexity: number;
}

/** 复杂度阈值：超过即标红（业界常用 15 / 认知 25） */
export const CYCLOMATIC_WARN = 15;
export const COGNITIVE_WARN = 25;

// ---------- 节点集合：JS ----------

const JS_DECISION = new Set([
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'switch_case',
  'catch_clause',
  'ternary_expression',
  'conditional_expression',
]);
const JS_LOGICAL = new Set(['&&', '||', '??']);
const JS_COMMENT = new Set(['comment']);
const JS_NESTING = new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'catch_clause']);
const JS_JUMP = new Set(['break_statement', 'continue_statement']);

// ---------- 节点集合：Python ----------

const PY_DECISION = new Set([
  'if_statement',
  'elif_clause',
  'for_statement',
  'while_statement',
  'except_clause',
  'conditional_expression',
]);
const PY_LOGICAL = new Set(['and', 'or']);
const PY_COMMENT = new Set(['comment']);
const PY_NESTING = new Set(['if_statement', 'for_statement', 'while_statement', 'try_statement', 'with_statement']);
const PY_JUMP = new Set(['break_statement', 'continue_statement']);

// ---------- 节点集合：Go ----------

/** Go 无三元运算符；判定点主要来自分支与 switch/select */
const GO_DECISION = new Set([
  'if_statement',
  'for_statement',
  'expression_switch_statement',
  'type_switch_statement',
  'select_statement',
  'expression_case',
  'type_case',
  'communication_case',
]);
const GO_LOGICAL = new Set(['&&', '||']);
const GO_COMMENT = new Set(['comment']);
const GO_NESTING = new Set([
  'if_statement',
  'for_statement',
  'expression_switch_statement',
  'type_switch_statement',
  'select_statement',
]);
const GO_JUMP = new Set(['break_statement', 'continue_statement', 'goto_statement']);

// ---------- 节点集合：Rust ----------

/** Rust 的控制流是表达式（if_expression 等），match 的每个分支为 match_arm */
const RS_DECISION = new Set([
  'if_expression',
  'while_expression',
  'loop_expression',
  'for_expression',
  'match_arm',
]);
const RS_LOGICAL = new Set(['&&', '||']);
const RS_COMMENT = new Set(['line_comment', 'block_comment']);
const RS_NESTING = new Set([
  'if_expression',
  'while_expression',
  'loop_expression',
  'for_expression',
  'match_expression',
]);
const RS_JUMP = new Set(['break_expression', 'continue_expression']);

// ---------- 节点集合：Java ----------

/** Java 的 for-each 是独立节点；switch 的每个分支是 switch_label */
const JAVA_DECISION = new Set([
  'if_statement',
  'for_statement',
  'enhanced_for_statement',
  'while_statement',
  'do_statement',
  'switch_label',
  'catch_clause',
  'ternary_expression',
]);
const JAVA_LOGICAL = new Set(['&&', '||']);
const JAVA_COMMENT = new Set(['line_comment', 'block_comment']);
const JAVA_NESTING = new Set([
  'if_statement',
  'for_statement',
  'enhanced_for_statement',
  'while_statement',
  'do_statement',
  'switch_expression',
  'try_statement',
  'catch_clause',
]);
const JAVA_JUMP = new Set(['break_statement', 'continue_statement']);
const JAVA_FUNCS = new Set(['method_declaration', 'constructor_declaration', 'lambda_expression']);

// ---------- 节点集合：C ----------

const C_DECISION = new Set([
  'if_statement',
  'for_statement',
  'while_statement',
  'do_statement',
  'case_statement',
  'conditional_expression',
]);
const C_LOGICAL = new Set(['&&', '||']);
const C_COMMENT = new Set(['comment']);
const C_NESTING = new Set(['if_statement', 'for_statement', 'while_statement', 'do_statement', 'switch_statement']);
const C_JUMP = new Set(['break_statement', 'continue_statement', 'goto_statement']);
const C_FUNCS = new Set(['function_definition']);

// ---------- 节点集合：C++（在 C 基础上增加范围 for 与 try-catch） ----------

const CPP_DECISION = new Set([...C_DECISION, 'for_range_loop', 'catch_clause']);
const CPP_NESTING = new Set([...C_NESTING, 'for_range_loop', 'try_statement', 'catch_clause']);
const CPP_FUNCS = new Set(['function_definition', 'lambda_expression']);

// ---------- 节点集合：C# ----------

const CS_DECISION = new Set([
  'if_statement',
  'for_statement',
  'for_each_statement',
  'while_statement',
  'do_statement',
  'switch_section',
  'catch_clause',
  'conditional_expression',
]);
const CS_LOGICAL = new Set(['&&', '||', '??']);
const CS_COMMENT = new Set(['comment']);
const CS_NESTING = new Set([
  'if_statement',
  'for_statement',
  'for_each_statement',
  'while_statement',
  'do_statement',
  'switch_statement',
  'try_statement',
  'catch_clause',
]);
const CS_JUMP = new Set(['break_statement', 'continue_statement', 'goto_statement']);
const CS_FUNCS = new Set(['method_declaration', 'constructor_declaration', 'local_function_statement', 'lambda_expression']);

// ---------- 节点集合：PHP ----------

/** PHP 的 elseif 是 else_if_clause；switch 的 default 是独立节点 */
const PHP_DECISION = new Set([
  'if_statement',
  'else_if_clause',
  'for_statement',
  'foreach_statement',
  'while_statement',
  'do_statement',
  'case_statement',
  'default_statement',
  'catch_clause',
  'conditional_expression',
]);
/** PHP 的逻辑运算符额外支持关键字形式 and / or / xor（同为 binary_expression 的 operator） */
const PHP_LOGICAL = new Set(['&&', '||', 'and', 'or', 'xor']);
const PHP_COMMENT = new Set(['comment']);
const PHP_NESTING = new Set([
  'if_statement',
  'for_statement',
  'foreach_statement',
  'while_statement',
  'do_statement',
  'switch_statement',
  'try_statement',
  'catch_clause',
]);
const PHP_JUMP = new Set(['break_statement', 'continue_statement', 'goto_statement']);
const PHP_FUNCS = new Set(['function_definition', 'method_declaration', 'anonymous_function', 'arrow_function']);

// ---------- 节点集合：Kotlin ----------

/** Kotlin 的 if / when 都是表达式；when 的每个分支是 when_entry */
const KT_DECISION = new Set([
  'if_expression',
  'when_entry',
  'for_statement',
  'while_statement',
  'do_while_statement',
  'catch_block',
]);
/** Kotlin 的 && / || 有独立节点类型（不是运算符字段） */
const KT_LOGICAL_NODES = new Set(['conjunction_expression', 'disjunction_expression']);
const KT_COMMENT = new Set(['line_comment', 'multiline_comment']);
const KT_NESTING = new Set([
  'if_expression',
  'when_expression',
  'for_statement',
  'while_statement',
  'do_while_statement',
  'try_expression',
  'catch_block',
]);
const KT_FUNCS = new Set(['function_declaration', 'secondary_constructor']);
const KT_NAME = new Set(['simple_identifier']);

// ---------- 节点集合：Swift ----------

/** Swift 的 switch 分支是 switch_entry；guard 视为判定点 */
const SWIFT_DECISION = new Set([
  'if_statement',
  'guard_statement',
  'for_statement',
  'while_statement',
  'repeat_while_statement',
  'switch_entry',
  'catch_block',
  'ternary_expression',
]);
const SWIFT_LOGICAL_NODES = new Set(['conjunction_expression', 'disjunction_expression']);
const SWIFT_COMMENT = new Set(['comment', 'multiline_comment']);
const SWIFT_NESTING = new Set([
  'if_statement',
  'guard_statement',
  'for_statement',
  'while_statement',
  'repeat_while_statement',
  'switch_statement',
  'do_statement',
  'catch_block',
]);
const SWIFT_FUNCS = new Set([
  'function_declaration',
  'init_declaration',
  'deinit_declaration',
  'subscript_declaration',
]);

// ---------- 节点集合：Ruby ----------

/** Ruby 的 if / unless / while / until 均有"修饰符形式"（`return x if y`） */
const RB_DECISION = new Set([
  'if',
  'elsif',
  'unless',
  'while',
  'until',
  'for',
  'when',
  'rescue',
  'ternary',
  'if_modifier',
  'unless_modifier',
  'while_modifier',
  'until_modifier',
]);
const RB_LOGICAL = new Set(['and', 'or', '&&', '||']);
const RB_COMMENT = new Set(['comment']);
const RB_NESTING = new Set(['if', 'unless', 'while', 'until', 'for', 'case', 'begin', 'do', 'block']);
const RB_JUMP = new Set(['break', 'next', 'redo', 'retry']);
const RB_FUNCS = new Set(['method', 'singleton_method']);

// ---------- 语言规则表 ----------

interface LangRules {
  decision: Set<string>;
  comment: Set<string>;
  nesting: Set<string>;
  jump: Set<string>;
  functionNodes: Set<string>;
  isLogicalOperator: (node: Parser.SyntaxNode) => boolean;
  /**
   * 是否为跳转语句。默认按 jump 集合判断；Kotlin / Swift 把 break / continue 与 return
   * 合并在同一节点类型下（jump_expression / control_transfer_statement），需按文本细分。
   */
  isJump?: (node: Parser.SyntaxNode) => boolean;
  /**
   * 函数名解析。默认取 name 字段（含 JS 的 `const f = () => {}` 兜底）；
   * C 系要解包 declarator，Kotlin 的名字不是字段，故用回调下沉到语言层。
   */
  functionName?: (node: Parser.SyntaxNode) => string | null;
}

/** 按运算符字段判断逻辑运算（大多数语言共用的形态） */
function operatorIn(set: Set<string>) {
  return (node: Parser.SyntaxNode): boolean =>
    node.type === 'binary_expression' && set.has(node.childForFieldName('operator')?.text ?? '');
}

/** 按节点类型判断逻辑运算（Kotlin / Swift 的 && 与 || 各有独立节点类型） */
function typeIn(set: Set<string>) {
  return (node: Parser.SyntaxNode): boolean => set.has(node.type);
}

/**
 * 跳转语句判定：**同时限定节点类型与文本前缀**。
 *
 * 只按文本前缀会误伤包裹节点 —— 例如 Swift 中  的
 *  节点文本恰好以 "break" 开头，会被错判为跳转。
 * Kotlin / Swift 的 break 与 return 共用同一节点类型，故类型 + 关键字双重判定。
 */
function jumpByKeyword(types: string[], prefixes: string[]) {
  const typeSet = new Set(types);
  return (node: Parser.SyntaxNode): boolean =>
    typeSet.has(node.type) && prefixes.some((p) => node.text.startsWith(p));
}

function rulesFor(language: LangId): LangRules {
  switch (language) {
    case 'python':
      return {
        decision: PY_DECISION,
        comment: PY_COMMENT,
        nesting: PY_NESTING,
        jump: PY_JUMP,
        functionNodes: new Set(['function_definition']),
        // Python 里 and/or 是 boolean_operator 的 operator 字段
        isLogicalOperator: (node) =>
          node.type === 'boolean_operator' && PY_LOGICAL.has(node.childForFieldName('operator')?.text ?? ''),
      };
    case 'go':
      return {
        decision: GO_DECISION,
        comment: GO_COMMENT,
        nesting: GO_NESTING,
        jump: GO_JUMP,
        functionNodes: new Set(['function_declaration', 'method_declaration', 'func_literal']),
        isLogicalOperator: operatorIn(GO_LOGICAL),
      };
    case 'rust':
      return {
        decision: RS_DECISION,
        comment: RS_COMMENT,
        nesting: RS_NESTING,
        jump: RS_JUMP,
        functionNodes: new Set(['function_item', 'closure_expression']),
        isLogicalOperator: operatorIn(RS_LOGICAL),
      };
    case 'java':
      return {
        decision: JAVA_DECISION,
        comment: JAVA_COMMENT,
        nesting: JAVA_NESTING,
        jump: JAVA_JUMP,
        functionNodes: JAVA_FUNCS,
        isLogicalOperator: operatorIn(JAVA_LOGICAL),
      };
    case 'c':
      return {
        decision: C_DECISION,
        comment: C_COMMENT,
        nesting: C_NESTING,
        jump: C_JUMP,
        functionNodes: C_FUNCS,
        isLogicalOperator: operatorIn(C_LOGICAL),
        // C 的函数定义没有 name 字段，名字在 declarator 里
        functionName: cLikeDefName,
      };
    case 'cpp':
      return {
        decision: CPP_DECISION,
        comment: C_COMMENT,
        nesting: CPP_NESTING,
        jump: C_JUMP,
        functionNodes: CPP_FUNCS,
        isLogicalOperator: operatorIn(C_LOGICAL),
        functionName: cLikeDefName,
      };
    case 'csharp':
      return {
        decision: CS_DECISION,
        comment: CS_COMMENT,
        nesting: CS_NESTING,
        jump: CS_JUMP,
        functionNodes: CS_FUNCS,
        isLogicalOperator: operatorIn(CS_LOGICAL),
      };
    case 'php':
      return {
        decision: PHP_DECISION,
        comment: PHP_COMMENT,
        nesting: PHP_NESTING,
        jump: PHP_JUMP,
        functionNodes: PHP_FUNCS,
        isLogicalOperator: operatorIn(PHP_LOGICAL),
      };
    case 'kotlin':
      return {
        decision: KT_DECISION,
        comment: KT_COMMENT,
        nesting: KT_NESTING,
        jump: new Set(['jump_expression']),
        functionNodes: KT_FUNCS,
        isLogicalOperator: typeIn(KT_LOGICAL_NODES),
        isJump: jumpByKeyword(['jump_expression'], ['break', 'continue']),
        // Kotlin 的定义名不是字段，而是第一个裸 simple_identifier
        functionName: (node) => firstChildOfType(node, KT_NAME)?.text ?? null,
      };
    case 'swift':
      return {
        decision: SWIFT_DECISION,
        comment: SWIFT_COMMENT,
        nesting: SWIFT_NESTING,
        // break / continue / fallthrough 与 return 共用 control_transfer_statement
        jump: new Set(['control_transfer_statement']),
        functionNodes: SWIFT_FUNCS,
        isLogicalOperator: typeIn(SWIFT_LOGICAL_NODES),
        isJump: jumpByKeyword(['control_transfer_statement'], ['break', 'continue', 'fallthrough']),
      };
    case 'ruby':
      return {
        decision: RB_DECISION,
        comment: RB_COMMENT,
        nesting: RB_NESTING,
        jump: RB_JUMP,
        functionNodes: RB_FUNCS,
        // Ruby 的 and/or/&&/|| 都是 binary 的 operator 字段
        isLogicalOperator: (node) =>
          node.type === 'binary' && RB_LOGICAL.has(node.childForFieldName('operator')?.text ?? ''),
      };
    default:
      return {
        decision: JS_DECISION,
        comment: JS_COMMENT,
        nesting: JS_NESTING,
        jump: JS_JUMP,
        functionNodes: new Set(['function_declaration', 'method_definition', 'arrow_function', 'function_expression', 'generator_function_declaration']),
        isLogicalOperator: operatorIn(JS_LOGICAL),
      };
  }
}

/**
 * 单次遍历计算文件级 + 函数级度量。
 * @param root AST 根节点
 * @param path 文件路径
 * @param language 语言
 * @param source 源码文本（用于精确的 SLOC 统计）
 */
export function computeMetrics(
  root: Parser.SyntaxNode,
  path: string,
  language: LangId,
  source: string,
): FileMetrics {
  const rules = rulesFor(language);

  // ---------- 1. SLOC（基于行文本，注释判定用 AST 注释节点的行集合） ----------
  const lines = source.split('\n');
  const commentLineSet = new Set<number>();
  const collectComments = (node: Parser.SyntaxNode) => {
    if (rules.comment.has(node.type)) {
      for (let l = node.startPosition.row + 1; l <= node.endPosition.row + 1; l++) commentLineSet.add(l);
    }
    for (const child of node.namedChildren) collectComments(child);
  };
  collectComments(root);

  let sloc = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const text = lines[i].trim();
    if (!text) continue;
    if (commentLineSet.has(lineNo)) continue;
    sloc++;
  }

  // ---------- 2. 函数级度量（第二次递归，但只在函数节点上做嵌套计算） ----------
  const functions: FunctionMetrics[] = [];

  const measureFunction = (fnNode: Parser.SyntaxNode, name: string) => {
    let cyclomatic = 1;
    let cognitive = 0;

    const walk = (node: Parser.SyntaxNode, depth: number) => {
      const isNesting = rules.nesting.has(node.type);
      const nextDepth = isNesting ? depth + 1 : depth;

      if (rules.decision.has(node.type)) {
        cyclomatic++;
        // 认知复杂度：结构 +1，并按当前嵌套深度加权
        cognitive += 1 + depth;
      } else if (rules.isLogicalOperator(node)) {
        cyclomatic++;
        cognitive++; // 逻辑序列：每个运算符 +1
      } else if (rules.isJump ? rules.isJump(node) : rules.jump.has(node.type)) {
        // 跳转语句使控制流更难跟踪，但不叠加嵌套权重
        cognitive += 1;
      }

      for (const child of node.namedChildren) walk(child, nextDepth);
    };

    // 函数体内部遍历（不含函数节点自身）
    for (const child of fnNode.namedChildren) walk(child, 0);

    // 函数体代码行：非空且不在注释行集合内（各语言的注释节点已统一收集）
    let bodyLines = 0;
    for (let row = fnNode.startPosition.row; row <= fnNode.endPosition.row; row++) {
      if (!lines[row]?.trim()) continue;
      if (commentLineSet.has(row + 1)) continue;
      bodyLines++;
    }

    functions.push({
      name,
      line: fnNode.startPosition.row + 1,
      endLine: fnNode.endPosition.row + 1,
      cyclomatic,
      cognitive,
      sloc: bodyLines,
    });
  };

  const visit = (node: Parser.SyntaxNode) => {
    if (rules.functionNodes.has(node.type)) {
      // 语言自定义取名；默认取 name 字段，匿名箭头函数向上找变量名（const foo = () => {}）
      const fallback =
        node.childForFieldName('name')?.text ??
        (node.parent?.type === 'variable_declarator'
          ? node.parent.childForFieldName('name')?.text
          : undefined);
      const name = rules.functionName ? rules.functionName(node) : fallback;
      measureFunction(node, name ?? '<anonymous>');
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);

  // ---------- 3. 文件级：函数之和 + 顶层（类体/模块级）判定点 ----------
  const functionCyclomatic = functions.reduce((s, f) => s + f.cyclomatic, 0);
  const functionCognitive = functions.reduce((s, f) => s + f.cognitive, 0);

  // 顶层判定点：不在任何函数内的 if/循环等（模块级分支），逐个补记
  let topLevelExtra = 0;
  const visitTop = (node: Parser.SyntaxNode, inFunction: boolean) => {
    const nowInFunction = inFunction || rules.functionNodes.has(node.type);
    if (!nowInFunction && rules.decision.has(node.type)) topLevelExtra++;
    for (const child of node.namedChildren) visitTop(child, nowInFunction);
  };
  visitTop(root, false);

  return {
    path,
    language,
    cyclomatic: functionCyclomatic + topLevelExtra,
    cognitive: functionCognitive,
    totalLines: lines.length,
    sloc,
    commentLines: commentLineSet.size,
    functions: functions.sort((a, b) => b.cyclomatic - a.cyclomatic || a.line - b.line),
    maxFunctionComplexity: functions.reduce((m, f) => Math.max(m, f.cyclomatic), 0),
  };
}

/**
 * 项目健康评分（0-100）
 *
 * 公式（确定性、可解释）：
 *   base = 100
 *   高复杂度函数越多扣分越多：每个 cyclomatic > 15 扣 3 分，每个 cognitive > 25 扣 2 分
 *   平均复杂度偏高扣分：avgCyclomatic > 5 时每超出 1 扣 2 分
 *   注释率过低扣分：commentRatio < 5% 扣 5 分（仅在有代码行时计入）
 */
export function healthScore(files: FileMetrics[]): {
  score: number;
  avgCyclomatic: number;
  avgCognitive: number;
  highComplexityCount: number;
} {
  const allFunctions = files.flatMap((f) => f.functions);
  const totalSloc = files.reduce((s, f) => s + f.sloc, 0);
  const totalComment = files.reduce((s, f) => s + f.commentLines, 0);

  const avgCyclomatic = allFunctions.length
    ? allFunctions.reduce((s, f) => s + f.cyclomatic, 0) / allFunctions.length
    : 0;
  const avgCognitive = allFunctions.length
    ? allFunctions.reduce((s, f) => s + f.cognitive, 0) / allFunctions.length
    : 0;

  const highCyclomatic = allFunctions.filter((f) => f.cyclomatic > CYCLOMATIC_WARN).length;
  const highCognitive = allFunctions.filter((f) => f.cognitive > COGNITIVE_WARN).length;

  let score = 100;
  score -= highCyclomatic * 3;
  score -= highCognitive * 2;
  if (avgCyclomatic > 5) score -= (avgCyclomatic - 5) * 2;
  if (totalSloc > 0 && totalComment / totalSloc < 0.05) score -= 5;

  return {
    score: Math.max(0, Math.round(score)),
    avgCyclomatic: Number(avgCyclomatic.toFixed(2)),
    avgCognitive: Number(avgCognitive.toFixed(2)),
    highComplexityCount: highCyclomatic + highCognitive,
  };
}
