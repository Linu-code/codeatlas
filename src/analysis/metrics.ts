/**
 * metrics.ts —— 代码度量（单次 AST 遍历完成全部计算）
 *
 * 三类指标：
 *   1. 圈复杂度 McCabe：1 + 判定点数量
 *      JS: if / for / for-in/for-of / while / do / case / catch / ?: / && / || / ??
 *      Py: if / elif / for / while / except / ?: 三元 / and / or
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

// ---------- 节点集合 ----------

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

interface LangRules {
  decision: Set<string>;
  logical: Set<string>;
  comment: Set<string>;
  nesting: Set<string>;
  jump: Set<string>;
  functionNodes: Set<string>;
  isLogicalOperator: (node: Parser.SyntaxNode) => boolean;
}

function rulesFor(language: LangId): LangRules {
  if (language === 'python') {
    return {
      decision: PY_DECISION,
      logical: PY_LOGICAL,
      comment: PY_COMMENT,
      nesting: PY_NESTING,
      jump: PY_JUMP,
      functionNodes: new Set(['function_definition']),
      // Python 里 and/or 是 boolean_operator 的 operator 字段
      isLogicalOperator: (node) => node.type === 'boolean_operator' && PY_LOGICAL.has(node.childForFieldName('operator')?.text ?? ''),
    };
  }
  return {
    decision: JS_DECISION,
    logical: JS_LOGICAL,
    comment: JS_COMMENT,
    nesting: JS_NESTING,
    jump: JS_JUMP,
    functionNodes: new Set(['function_declaration', 'method_definition', 'arrow_function', 'function_expression', 'generator_function_declaration']),
    // JS 中 && / || / ?? 是 binary_expression 的 operator
    isLogicalOperator: (node) =>
      node.type === 'binary_expression' && JS_LOGICAL.has(node.childForFieldName('operator')?.text ?? ''),
  };
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
      } else if (rules.jump.has(node.type)) {
        // 跳转语句使控制流更难跟踪，但不叠加嵌套权重
        cognitive += 1;
      }

      for (const child of node.namedChildren) walk(child, nextDepth);
    };

    // 函数体内部遍历（不含函数节点自身）
    for (const child of fnNode.namedChildren) walk(child, 0);

    const bodyLines = source
      .split('\n')
      .slice(fnNode.startPosition.row, fnNode.endPosition.row + 1)
      .filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#')).length;

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
      const nameNode = node.childForFieldName('name');
      // 匿名箭头函数：向上找变量名（const foo = () => {}）
      const fallback = node.parent?.type === 'variable_declarator' ? node.parent.childForFieldName('name')?.text : undefined;
      measureFunction(node, nameNode?.text ?? fallback ?? '<anonymous>');
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
