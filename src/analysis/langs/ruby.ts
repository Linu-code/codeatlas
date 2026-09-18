/**
 * Ruby 规则
 *
 * 关键差异（节点名均由真实语法包实测确认）：
 *   · 类与模块分别是 `class` / `module` 节点（名字是 constant 字段）
 *   · 方法定义是 `method`；`def self.foo` 是 `singleton_method`（object 字段是 self）
 *   · 调用就是 `call` 节点，被调名在 method 字段（receiver 字段是接收者，可缺省）
 *   · **没有导入语句**：require / require_relative / load / autoload 都是普通方法调用，
 *     因此 importPaths 按"方法名 + 字符串参数"动态识别，识别到的子树由 extractFile 抑制引用
 *   · 没有可见性关键字：private / protected 是"裸调用"，对其后定义的方法生效
 */

import type Parser from 'web-tree-sitter';
import { fieldText, hasAncestor, type LangHandler, type SymbolKind } from './types';

const CLASS_NODES = new Set(['class', 'module']);
const METHOD_NODES = new Set(['method', 'singleton_method']);
const SCOPE_NODES = new Set(['method', 'singleton_method', 'lambda']);
/** 视为"导入"的方法名 */
const REQUIRE_METHODS = new Set(['require', 'require_relative', 'load', 'autoload']);
/** 裸调用形式的可见性标记 */
const VISIBILITY_MARKERS = new Set(['private', 'protected']);

/** 收集参数里的字符串字面量（require 的路径） */
function collectStrings(node: Parser.SyntaxNode, out: string[]): void {
  if (node.type === 'string') {
    out.push(node.text.replace(/^['"]|['"]$/g, ''));
    return;
  }
  for (const child of node.namedChildren) collectStrings(child, out);
}

export const rubyHandler: LangHandler = {
  id: 'ruby',
  callNodeTypes: new Set(['call', 'method_call']),
  identifierTypes: new Set(['identifier', 'constant']),
  // require 走 importPaths 动态识别，故此处为空集
  importNodeTypes: new Set<string>(),

  defKind(node): SymbolKind | null {
    if (CLASS_NODES.has(node.type)) return 'class';
    if (METHOD_NODES.has(node.type)) return hasAncestor(node, CLASS_NODES) ? 'method' : 'function';
    return null;
  },

  defName(node): string | null {
    return fieldText(node, 'name');
  },

  /** singleton_method（def self.foo）始终公开；其余看"之前是否有裸 private / protected" */
  isExported(node): boolean {
    if (node.type === 'singleton_method') return true;
    const parent = node.parent;
    if (!parent) return true;
    for (const sibling of parent.namedChildren) {
      if (sibling.startIndex >= node.startIndex) break;
      if (sibling.type === 'identifier' && VISIBILITY_MARKERS.has(sibling.text)) return false;
    }
    return true;
  },

  importPaths(node): string[] {
    if (node.type !== 'call') return [];
    const method = fieldText(node, 'method');
    if (!method || !REQUIRE_METHODS.has(method)) return [];
    const args = node.childForFieldName('arguments');
    if (!args) return [];
    const out: string[] = [];
    collectStrings(args, out);
    return out;
  },

  calleeName(node): string | null {
    const method = fieldText(node, 'method');
    if (!method) return null;
    // require / load 等属于导入，不算函数调用，避免污染调用图
    return REQUIRE_METHODS.has(method) ? null : method;
  },

  entersScope(node): boolean {
    return SCOPE_NODES.has(node.type);
  },
};
