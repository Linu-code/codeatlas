/**
 * C++ 规则（在 C 的基础上扩展，复用 c.ts 的 declarator 解包工具）
 *
 * 相对 C 的差异（节点名均由真实语法包实测确认）：
 *   · 新增 class_specifier / enum_class_specifier 作为类型定义
 *   · 类内成员函数与类外定义（`int Widget::render()`）都视为 method
 *   · 成员可见性由 access_specifier 直接兄弟节点决定（`public:` / `private:` / `protected:`）——
 *     取"本节点之前最近的一个 access_specifier"，与 C++ 的声明顺序语义一致
 *   · 新增 for_range_loop / try-catch / lambda_expression，以及 new_expression 调用
 */

import type Parser from 'web-tree-sitter';
import { hasAncestor, hasWord, modifiersText, type LangHandler, type SymbolKind, firstChildOfType } from './types';
import { cLikeCalleeName, cLikeDefName, unwrapDeclarator } from './c';

const CLASS_NODES = new Set([
  'class_specifier',
  'struct_specifier',
  'union_specifier',
  'enum_specifier',
  'enum_class_specifier',
]);
const STORAGE_NODES = new Set(['storage_class_specifier']);
const ACCESS_NODES = new Set(['access_specifier']);
const SCOPE_NODES = new Set(['function_definition', 'lambda_expression']);
const TYPE_NAME_NODES = new Set(['type_identifier', 'qualified_identifier']);

/** 取"本节点之前最近一个 access_specifier"，即当前成员所处的访问区段 */
function accessOf(node: Parser.SyntaxNode): string {
  const parent = node.parent;
  if (!parent) return '';
  let text = '';
  for (const child of parent.children) {
    if (child.startIndex > node.startIndex) break;
    if (ACCESS_NODES.has(child.type)) text = child.text;
  }
  return text;
}

export const cppHandler: LangHandler = {
  id: 'cpp',
  callNodeTypes: new Set(['call_expression', 'new_expression']),
  identifierTypes: new Set(['identifier', 'field_identifier', 'type_identifier']),
  importNodeTypes: new Set(['preproc_include']),

  defKind(node): SymbolKind | null {
    const t = node.type;
    if (t === 'function_definition') {
      const decl = unwrapDeclarator(node);
      // 类内成员是 field_identifier；类外定义是 qualified_identifier（Widget::render）
      if (decl && (decl.type === 'field_identifier' || decl.type === 'qualified_identifier')) {
        return 'method';
      }
      return hasAncestor(node, CLASS_NODES) ? 'method' : 'function';
    }
    if (CLASS_NODES.has(t) && node.childForFieldName('name') && node.childForFieldName('body')) {
      return 'class';
    }
    return null;
  },

  defName: cLikeDefName,

  /** static 具有内部链接；private / protected 区段的成员不算对外可见 */
  isExported(node): boolean {
    if (hasWord(modifiersText(node, STORAGE_NODES), 'static')) return false;
    const access = accessOf(node);
    if (access) return !hasWord(access, 'private') && !hasWord(access, 'protected');
    return true;
  },

  importPaths(node): string[] {
    if (node.type !== 'preproc_include') return [];
    const path = node.childForFieldName('path');
    const raw = path ? path.text : node.text.replace(/^\s*#\s*include\s*/, '');
    return [raw.replace(/^[<"]/, '').replace(/[>"]$/, '').trim()];
  },

  calleeName(node): string | null {
    if (node.type === 'new_expression') {
      const type = node.childForFieldName('type') ?? firstChildOfType(node, TYPE_NAME_NODES);
      return type ? type.text : null;
    }
    return cLikeCalleeName(node);
  },

  entersScope(node): boolean {
    return SCOPE_NODES.has(node.type);
  },
};
