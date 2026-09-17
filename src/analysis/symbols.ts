/**
 * symbols.ts —— 单次 AST 遍历提取「定义 / 调用 / 导入」
 *
 * 原理：
 *   树遍历一次，按每种语言的节点类型表分派处理：
 *     · 定义节点（函数声明/类/方法/箭头函数赋值）→ 记录名字、行号、签名、是否导出
 *     · 调用节点（call_expression / call）→ 记录被调用名与所在函数
 *     · 导入节点 → 记录模块路径（供跨文件解析与依赖图使用）
 *
 *   为什么要手工遍历而不是用 Query：
 *     Query API 需要为每种语言维护 .scm 查询文件，而这里只需三类节点，
 *     手写类型表更直观、可测、可调试，且不依赖额外资源。
 *
 *   复杂度：O(n)（n = AST 节点数），单次遍历同时产出三种信息。
 */

import type Parser from 'web-tree-sitter';
import type { LangId } from './parser';

export type SymbolKind = 'function' | 'class' | 'method' | 'variable';

export interface SymbolDef {
  name: string;
  kind: SymbolKind;
  /** 1-based 起始行 */
  line: number;
  endLine: number;
  /** 签名文本（截断到 200 字符） */
  signature: string;
  exported: boolean;
}

export interface CallRef {
  /** 调用点所在函数名（顶层调用为 null） */
  from: string | null;
  /** 被调用者名字（成员调用取属性名，如 obj.foo() → foo） */
  to: string;
  line: number;
}

/** 标识符引用点（用于"查找引用"） */
export interface RefSite {
  name: string;
  /** 1-based 行号 */
  line: number;
  /** 1-based 列号（用于同一行多引用的区分） */
  column: number;
  kind: 'call' | 'identifier';
}

export interface FileAnalysis {
  path: string;
  language: LangId;
  definitions: SymbolDef[];
  calls: CallRef[];
  /** 全部标识符引用（含定义名与调用，由 scopeGraph 去重） */
  references: RefSite[];
  imports: string[];
  /** tree-sitter 报告语法错误（容错解析，仍产出部分结果） */
  hasError: boolean;
}

/** JS/TS 相关节点类型集合 */
const JS_DEF_NODES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'class_declaration',
]);
const JS_METHOD_NODES = new Set(['method_definition']);

/** Python 节点类型集合 */
const PY_DEF_NODES = new Set(['function_definition']);
const PY_CLASS_NODES = new Set(['class_definition']);

/**
 * 提取单个文件的符号信息。
 * @param root tree-sitter 根节点
 * @param path 文件路径（用于结果标识）
 * @param language 语言
 */
export function extractFile(root: Parser.SyntaxNode, path: string, language: LangId): FileAnalysis {
  const definitions: SymbolDef[] = [];
  const calls: CallRef[] = [];
  const imports: string[] = [];
  const references: RefSite[] = [];

  const isPython = language === 'python';
  const callNodeType = isPython ? 'call' : 'call_expression';

  /** 记录当前所在函数（用于把调用归到调用方） */
  const stack: string[] = [];

  const text = (node: Parser.SyntaxNode | null | undefined): string =>
    node ? node.text.replace(/\s+/g, ' ').trim() : '';

  const signatureOf = (node: Parser.SyntaxNode): string => {
    // 签名 = 从节点起始到函数体开始（或整行），并压平空白
    const body = node.childForFieldName('body');
    if (body) {
      const raw = node.text.slice(0, body.startIndex - node.startIndex);
      return raw.replace(/\s+/g, ' ').trim().slice(0, 200);
    }
    return text(node).slice(0, 200);
  };

  /** 判断定义是否在导出位置（JS: export 语句内 / Python: 顶层且非 _ 前缀视为公开） */
  const isExported = (node: Parser.SyntaxNode): boolean => {
    if (isPython) {
      return node.parent?.type === 'module' && !nameOf(node)?.startsWith('_');
    }
    let cur: Parser.SyntaxNode | null = node;
    while (cur) {
      if (cur.type === 'export_statement') return true;
      cur = cur.parent;
    }
    return false;
  };

  function nameOf(node: Parser.SyntaxNode): string | null {
    const nameNode = node.childForFieldName('name');
    if (nameNode) return nameNode.text;
    // Python 装饰器包裹：decorated_definition > definition > name
    const inner = node.namedChildren.find((c) => c.childForFieldName('name'));
    return inner?.childForFieldName('name')?.text ?? null;
  }

  /** 祖先链中是否存在 class_definition（用于区分 Python 函数与方法） */
  function hasClassAncestor(node: Parser.SyntaxNode): boolean {
    let cur = node.parent;
    while (cur) {
      if (cur.type === 'class_definition') return true;
      cur = cur.parent;
    }
    return false;
  }

  const visit = (node: Parser.SyntaxNode, inImport = false) => {
    const type = node.type;
    const nowInImport = inImport || type === 'import_statement' || type === 'import_from_statement';

    // ---------- 标识符引用（供"查找引用"使用） ----------
    // 规则：JS/TS 取 identifier，Python 取 identifier；跳过导入语句内部（模块名不是引用）
    if (type === 'identifier' && !nowInImport) {
      // 定义处的名字也计入 references，由 scopeGraph 建索引时与定义位置去重
      references.push({
        name: node.text,
        line: node.startPosition.row + 1,
        column: node.startPosition.column + 1,
        kind: node.parent?.type === 'call_expression' || node.parent?.type === 'call' ? 'call' : 'identifier',
      });
    }

    // ---------- 定义 ----------
    if (JS_DEF_NODES.has(type) || JS_METHOD_NODES.has(type)) {
      const name = nameOf(node);
      if (name) {
        const kind: SymbolKind =
          type === 'class_declaration' ? 'class' : type === 'method_definition' ? 'method' : 'function';
        definitions.push({
          name,
          kind,
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          signature: signatureOf(node),
          exported: isExported(node),
        });
      }
      // JS 箭头/函数表达式赋值：const foo = () => {}
    } else if (!isPython && type === 'variable_declarator') {
      const name = nameOf(node);
      const value = node.childForFieldName('value');
      if (name && value && (value.type === 'arrow_function' || value.type === 'function_expression')) {
        definitions.push({
          name,
          kind: 'function',
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          signature: signatureOf(value),
          exported: isExported(node),
        });
      }
    } else if (isPython && (PY_DEF_NODES.has(type) || PY_CLASS_NODES.has(type))) {
      const name = nameOf(node);
      if (name) {
        // Python 类内定义的函数是方法，与 JS 的 method_definition 语义对齐
        const inClass = hasClassAncestor(node);
        definitions.push({
          name,
          kind: PY_CLASS_NODES.has(type) ? 'class' : inClass ? 'method' : 'function',
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          signature: signatureOf(node),
          exported: isExported(node),
        });
      }
    }

    // ---------- 导入 ----------
    if (!isPython && type === 'import_statement') {
      const src = node.namedChildren.find((c) => c.type === 'string');
      if (src) imports.push(src.text.replace(/['"]/g, ''));
    } else if (isPython && (type === 'import_statement' || type === 'import_from_statement')) {
      const moduleNode = node.childForFieldName('module_name');
      imports.push(moduleNode ? moduleNode.text : text(node).slice(0, 120));
    }

    // ---------- 调用 ----------
    if (type === callNodeType) {
      const fn = node.childForFieldName('function');
      let callee: string | null = null;
      if (fn) {
        if (fn.type === 'identifier') callee = fn.text;
        else if (fn.type === 'member_expression' || fn.type === 'attribute') {
          // obj.foo() / obj.foo.bar() → 取最后一段属性名
          const prop = fn.childForFieldName('property') ?? fn.childForFieldName('attribute');
          callee = prop ? prop.text : null;
        }
      }
      if (callee) {
        calls.push({
          from: stack.length ? stack[stack.length - 1] : null,
          to: callee,
          line: node.startPosition.row + 1,
        });
      }
    }

    // ---------- 递归 ----------
    const entersFunction =
      (JS_DEF_NODES.has(type) && type !== 'class_declaration') ||
      JS_METHOD_NODES.has(type) ||
      (isPython && PY_DEF_NODES.has(type));

    if (entersFunction) {
      stack.push(nameOf(node) ?? '<anonymous>');
      for (const child of node.namedChildren) visit(child, nowInImport);
      stack.pop();
    } else {
      for (const child of node.namedChildren) visit(child, nowInImport);
    }
  };

  visit(root);

  // 同名重载/重复定义去重（保留行号最靠前者）
  const seen = new Set<string>();
  const deduped = definitions.filter((d) => {
    const key = `${d.kind}:${d.name}:${d.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    path,
    language,
    definitions: deduped,
    calls,
    references,
    imports,
    hasError: root.hasError,
  };
}
