/**
 * C 规则（同时导出 C 系共享工具，供 cpp.ts 复用）
 *
 * 关键差异（节点名均由真实语法包实测确认）：
 *   · 没有类：struct / union / enum 视为 class。**要求带 body**，
 *     否则 `struct Point p;` 这种"使用"也会被当成定义
 *   · 函数定义的 declarator 常被 function_declarator / pointer_declarator 层层包裹
 *     （`int *f(void)` 的形状是 pointer_declarator > function_declarator > identifier），
 *     因此需要递归解包才能拿到函数名
 *   · 没有导出关键字：**非 static 视为对外可见**（static 具有内部链接）
 *   · 导入即 #include，路径在 path 字段（system_lib_string 形如 <stdio.h>）
 *   · 只登记带函数体的定义；原型声明（declaration）不计入，避免 .h/.c 重复登记同一函数
 */

import type Parser from 'web-tree-sitter';
import {
  fieldText,
  hasWord,
  modifiersText,
  type LangHandler,
  type SymbolKind,
} from './types';

/** 类型定义节点（带 body 才算定义） */
export const C_TYPE_SPECIFIERS = new Set(['struct_specifier', 'union_specifier', 'enum_specifier']);
/** 存储类修饰符（static / extern / register …） */
const STORAGE_NODES = new Set(['storage_class_specifier']);
/** declarator 解包的终点节点 */
const NAME_NODES = new Set([
  'identifier',
  'field_identifier',
  'type_identifier',
  'qualified_identifier',
  'operator_name',
  'destructor_name',
]);

/**
 * 沿 declarator 字段逐层解包，返回最内层的名字节点。
 * 例：`int *f(void)` → pointer_declarator → function_declarator → identifier(f)
 */
export function unwrapDeclarator(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let cur = node.childForFieldName('declarator');
  let guard = 0;
  while (cur && guard++ < 16) {
    if (NAME_NODES.has(cur.type)) return cur;
    const next =
      cur.childForFieldName('declarator') ??
      cur.namedChildren.find((c) => c.type.endsWith('declarator')) ??
      null;
    if (!next) return null;
    cur = next;
  }
  return null;
}

/** C 系取名：函数走 declarator 解包，类型走 name 字段 */
export function cLikeDefName(node: Parser.SyntaxNode): string | null {
  const decl = unwrapDeclarator(node);
  if (decl) {
    // `void Widget::render()` 这类限定名只取末段，便于与调用点匹配
    if (decl.type === 'qualified_identifier') return fieldText(decl, 'name') ?? decl.text;
    return decl.text;
  }
  return fieldText(node, 'name');
}

/**
 * C 系被调名：`f()` / `obj.f()` / `ns::f()` 三种形态。
 * C 只用得上第一种，但 C++ 三种都要，故放在共享位置。
 */
export function cLikeCalleeName(node: Parser.SyntaxNode): string | null {
  const fn = node.childForFieldName('function');
  if (!fn) return null;
  if (fn.type === 'identifier') return fn.text;
  if (fn.type === 'field_expression') return fieldText(fn, 'field');
  if (fn.type === 'qualified_identifier') return fieldText(fn, 'name') ?? fn.text;
  return null;
}

export const cHandler: LangHandler = {
  id: 'c',
  callNodeTypes: new Set(['call_expression']),
  identifierTypes: new Set(['identifier', 'field_identifier', 'type_identifier']),
  importNodeTypes: new Set(['preproc_include']),

  defKind(node): SymbolKind | null {
    if (node.type === 'function_definition') return 'function';
    if (
      C_TYPE_SPECIFIERS.has(node.type) &&
      node.childForFieldName('name') &&
      node.childForFieldName('body')
    ) {
      return 'class';
    }
    return null;
  },

  defName: cLikeDefName,

  /** C 无可见性关键字：非 static 视为对外可见 */
  isExported(node): boolean {
    return !hasWord(modifiersText(node, STORAGE_NODES), 'static');
  },

  importPaths(node): string[] {
    if (node.type !== 'preproc_include') return [];
    const path = node.childForFieldName('path');
    const raw = path ? path.text : node.text.replace(/^\s*#\s*include\s*/, '');
    return [raw.replace(/^[<"]/, '').replace(/[>"]$/, '').trim()];
  },

  calleeName: cLikeCalleeName,

  entersScope(node): boolean {
    return node.type === 'function_definition';
  },
};
