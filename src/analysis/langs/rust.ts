/**
 * Rust 规则
 *
 * 关键差异：
 *   · 各种定义各有节点类型：function_item / struct_item / enum_item / trait_item / union_item
 *   · 调用形态最多：identifier（foo()）、field_expression（self.foo()）、
 *     scoped_identifier（Type::new()）
 *   · 导出 = 带 pub 可见性修饰符（visibility_modifier）
 *   · 导入用 use_declaration，路径在 argument 字段
 */

import { fieldText, hasAncestor, type LangHandler, type SymbolKind } from './types';

const FUNC_NODES = new Set(['function_item']);
/** 结构体 / 枚举 / 特征 / 联合体统一映射为 class，便于跨语言展示 */
const CLASS_NODES = new Set(['struct_item', 'enum_item', 'trait_item', 'union_item']);
const SCOPE_NODES = new Set(['function_item', 'closure_expression']);
const VISIBILITY = new Set(['visibility_modifier']);
/** impl 块 —— 其中的 fn 视为方法，与 Go 的 method_declaration 语义对齐 */
const IMPL_NODES = new Set(['impl_item']);

export const rustHandler: LangHandler = {
  id: 'rust',
  callNodeTypes: new Set(['call_expression']),
  identifierTypes: new Set(['identifier', 'field_identifier', 'type_identifier']),
  importNodeTypes: new Set(['use_declaration']),

  defKind(node): SymbolKind | null {
    const t = node.type;
    // impl 块内的 fn 视为方法
    if (FUNC_NODES.has(t)) return hasAncestor(node, IMPL_NODES) ? 'method' : 'function';
    if (CLASS_NODES.has(t)) return 'class';
    return null;
  },

  defName(node): string | null {
    return fieldText(node, 'name');
  },

  /** 带 pub（含 pub(crate) 等）即视为对外可见 */
  isExported(node): boolean {
    return node.namedChildren.some(
      (c) => VISIBILITY.has(c.type) && c.text.trim().startsWith('pub'),
    );
  },

  importPaths(node): string[] {
    if (node.type !== 'use_declaration') return [];
    const arg = node.childForFieldName('argument');
    if (arg) return [arg.text];
    // 语法包版本差异兜底：去掉 use 前缀与分号
    return [node.text.replace(/^\s*use\s+/, '').replace(/;\s*$/, '').trim()];
  },

  calleeName(node): string | null {
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    // self.foo() / obj.method()
    if (fn.type === 'field_expression') return fieldText(fn, 'field');
    // Type::new() / module::func()
    if (fn.type === 'scoped_identifier') return fieldText(fn, 'name');
    return null;
  },

  entersScope(node): boolean {
    return SCOPE_NODES.has(node.type);
  },
};
