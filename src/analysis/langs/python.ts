/**
 * Python 规则
 *
 * 关键差异（相对 JS）：
 *   · 调用节点是 call（JS 为 call_expression）
 *   · 成员调用用 attribute 节点（JS 为 member_expression），属性取 attribute 字段
 *   · 没有导出关键字 —— 顶层且不以 _ 开头视为公开
 *   · 类内定义的函数视为方法
 *   · 装饰器包裹（decorated_definition）不阻碍内层定义的识别
 */

import type Parser from 'web-tree-sitter';
import { fieldText, flatten, hasAncestor, type LangHandler, type SymbolKind } from './types';

const FUNC_NODES = new Set(['function_definition']);
const CLASS_NODES = new Set(['class_definition']);
const IMPORT_NODES = new Set(['import_statement', 'import_from_statement']);

/** 取定义名（含装饰器包裹时的兜底查找） */
function pyName(node: Parser.SyntaxNode): string | null {
  const direct = node.childForFieldName('name');
  if (direct) return direct.text;
  const inner = node.namedChildren.find((c) => c.childForFieldName('name'));
  return inner?.childForFieldName('name')?.text ?? null;
}

export const pythonHandler: LangHandler = {
  id: 'python',
  callNodeType: 'call',
  identifierTypes: new Set(['identifier']),
  importNodeTypes: IMPORT_NODES,

  defKind(node): SymbolKind | null {
    const t = node.type;
    if (CLASS_NODES.has(t)) return 'class';
    if (FUNC_NODES.has(t)) return hasAncestor(node, CLASS_NODES) ? 'method' : 'function';
    return null;
  },

  defName: pyName,

  /** 顶层且不以 _ 开头即视为公开 */
  isExported(node): boolean {
    return node.parent?.type === 'module' && !pyName(node)?.startsWith('_');
  },

  importPaths(node): string[] {
    if (!IMPORT_NODES.has(node.type)) return [];
    const moduleNode = node.childForFieldName('module_name');
    // 取不到 module_name 时退回整行文本
    return [moduleNode ? moduleNode.text : flatten(node.text, 120)];
  },

  calleeName(node): string | null {
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    // obj.foo() → 属性段
    if (fn.type === 'attribute') return fieldText(fn, 'attribute');
    return null;
  },

  entersScope(node): boolean {
    return FUNC_NODES.has(node.type);
  },
};
