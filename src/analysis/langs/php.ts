/**
 * PHP 规则
 *
 * 关键差异（节点名均由真实语法包实测确认）：
 *   · 标识符统一叫 `name`（变量是 variable_name，其内部才是 name）
 *   · 类相关节点：class / interface / trait / enum，统一映射为 class
 *   · 调用有四种节点：function_call_expression（f()）、member_call_expression（$o->m()）、
 *     scoped_call_expression（Cls::m()）、object_creation_expression（new Foo()）
 *   · 可见性由 visibility_modifier 承载；**不写修饰符时默认 public**（与 Java/C# 相反）
 *   · 导入用 namespace_use_declaration（类内的 trait `use` 是 use_declaration，不算导入）
 */

import type Parser from 'web-tree-sitter';
import { fieldText, hasWord, modifiersText, type LangHandler, type SymbolKind } from './types';

const CLASS_NODES = new Set([
  'class_declaration',
  'interface_declaration',
  'trait_declaration',
  'enum_declaration',
]);
const METHOD_NODES = new Set(['method_declaration']);
const FUNC_NODES = new Set(['function_definition', 'anonymous_function', 'arrow_function']);
const VISIBILITY_NODES = new Set(['visibility_modifier']);
/**
 * 需要抑制标识符引用的节点：use 语句 + namespace 声明
 * （两者的名字是"模块名"而非代码引用；类内 trait `use` 是 use_declaration，不在其列）
 */
const IMPORT_NODES = new Set(['namespace_use_declaration', 'namespace_definition']);
const OBJECT_NAME_NODES = new Set(['name', 'qualified_name']);

/** 递归收集 use 语句里的完整路径（支持 `use A\B;` 与 `use A\{B, C};`） */
function collectUsePaths(node: Parser.SyntaxNode, out: string[]): void {
  if (node.type === 'qualified_name') {
    out.push(node.text);
    return;
  }
  for (const child of node.namedChildren) collectUsePaths(child, out);
}

export const phpHandler: LangHandler = {
  id: 'php',
  callNodeTypes: new Set([
    'function_call_expression',
    'member_call_expression',
    'scoped_call_expression',
    'nullsafe_member_call_expression',
    'object_creation_expression',
  ]),
  identifierTypes: new Set(['name']),
  importNodeTypes: IMPORT_NODES,

  defKind(node): SymbolKind | null {
    const t = node.type;
    if (CLASS_NODES.has(t)) return 'class';
    if (METHOD_NODES.has(t)) return 'method';
    if (FUNC_NODES.has(t)) return 'function';
    return null;
  },

  defName(node): string | null {
    return fieldText(node, 'name');
  },

  /** PHP 不写修饰符即 public；private / protected 不算对外可见 */
  isExported(node): boolean {
    const vis = modifiersText(node, VISIBILITY_NODES);
    return !hasWord(vis, 'private') && !hasWord(vis, 'protected');
  },

  importPaths(node): string[] {
    if (node.type !== 'namespace_use_declaration') return [];
    const out: string[] = [];
    collectUsePaths(node, out);
    return out;
  },

  calleeName(node): string | null {
    if (node.type === 'object_creation_expression') {
      // 类名是第一个具名子节点（可能是 name 或 qualified_name），没有字段名
      const target = node.namedChildren.find((c) => OBJECT_NAME_NODES.has(c.type));
      return target ? target.text : null;
    }
    // function_call_expression 用 function 字段；member/scoped 调用用 name 字段
    return fieldText(node, 'name') ?? fieldText(node, 'function');
  },

  entersScope(node): boolean {
    return FUNC_NODES.has(node.type) || METHOD_NODES.has(node.type);
  },
};
