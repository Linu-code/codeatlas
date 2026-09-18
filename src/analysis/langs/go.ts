/**
 * Go 规则
 *
 * 关键差异：
 *   · 函数与方法分属两种节点：function_declaration（包级函数）/ method_declaration（带接收者）
 *   · 被调方可能是 selector_expression（pkg.Func() / obj.Method()），取 field 段
 *   · 导出规则 = 标识符首字母大写（Go 没有可见性关键字）
 *   · 类型声明需下钻一层：type_declaration > type_spec，
 *     其中 struct_type / interface_type 视为 class，其余（别名、基础类型）忽略
 *   · 一条 import_declaration 可含多个 import_spec（import 块）
 */

import type Parser from 'web-tree-sitter';
import { fieldText, type LangHandler, type SymbolKind } from './types';

const FUNC_NODES = new Set(['function_declaration', 'method_declaration']);
const TYPE_DECL_NODES = new Set(['type_declaration']);
const CLASS_TYPE_NODES = new Set(['struct_type', 'interface_type']);
const SCOPE_NODES = new Set(['function_declaration', 'method_declaration', 'func_literal']);

/** type_declaration → type_spec */
function typeSpecOf(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  return node.namedChildren.find((c) => c.type === 'type_spec') ?? null;
}

/** 取定义名（type_declaration 的名字挂在 type_spec 上） */
function goName(node: Parser.SyntaxNode): string | null {
  if (TYPE_DECL_NODES.has(node.type)) {
    return typeSpecOf(node)?.childForFieldName('name')?.text ?? null;
  }
  return fieldText(node, 'name');
}

/** 递归收集 import_declaration 下的所有 import_spec 路径 */
function collectImportPaths(node: Parser.SyntaxNode, out: string[]): void {
  if (node.type === 'import_spec') {
    const p = node.childForFieldName('path');
    if (p) out.push(p.text.replace(/["`]/g, ''));
    return;
  }
  for (const child of node.namedChildren) collectImportPaths(child, out);
}

export const goHandler: LangHandler = {
  id: 'go',
  callNodeType: 'call_expression',
  identifierTypes: new Set(['identifier', 'field_identifier', 'type_identifier']),
  importNodeTypes: new Set(['import_declaration']),

  defKind(node): SymbolKind | null {
    const t = node.type;
    if (t === 'method_declaration') return 'method';
    if (t === 'function_declaration') return 'function';
    if (TYPE_DECL_NODES.has(t)) {
      const spec = typeSpecOf(node);
      const typeNode = spec?.childForFieldName('type');
      if (typeNode && CLASS_TYPE_NODES.has(typeNode.type)) return 'class';
    }
    return null;
  },

  defName: goName,

  /** 首字母大写即导出 */
  isExported(node): boolean {
    const name = goName(node);
    return !!name && /^[A-Z]/.test(name);
  },

  importPaths(node): string[] {
    if (node.type !== 'import_declaration') return [];
    const out: string[] = [];
    collectImportPaths(node, out);
    return out;
  },

  calleeName(node): string | null {
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    if (fn.type === 'selector_expression') return fieldText(fn, 'field');
    return null;
  },

  entersScope(node): boolean {
    return SCOPE_NODES.has(node.type);
  },
};
