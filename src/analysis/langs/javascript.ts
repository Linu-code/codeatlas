/**
 * JavaScript / TypeScript / TSX / JSX 规则
 *
 * 四者共用同一套节点类型（tree-sitter-typescript 与 tree-sitter-tsx 的节点命名一致），
 * 差别仅在语法包解析出的树形（如 TSX 允许 JSX 元素），规则无需分叉。
 */

import type Parser from 'web-tree-sitter';
import { fieldText, hasAncestor, type LangHandler, type SymbolKind } from './types';

/** 直接构成"函数/类"定义的节点 */
const DEF_NODES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'class_declaration',
]);

/** 类方法定义 */
const METHOD_NODES = new Set(['method_definition']);

/** 变量声明中，值属于以下节点时视为函数定义（const foo = () => {}） */
const FUNCTION_VALUE_NODES = new Set(['arrow_function', 'function_expression', 'function']);

const EXPORT_SCOPES = new Set(['export_statement']);

export const javascriptHandler: LangHandler = {
  id: 'javascript',
  callNodeTypes: new Set(['call_expression']),
  identifierTypes: new Set(['identifier']),
  importNodeTypes: new Set(['import_statement']),

  defKind(node): SymbolKind | null {
    const t = node.type;
    if (t === 'class_declaration') return 'class';
    if (METHOD_NODES.has(t)) return 'method';
    if (DEF_NODES.has(t)) return 'function';
    if (t === 'variable_declarator') {
      const value = node.childForFieldName('value');
      if (value && FUNCTION_VALUE_NODES.has(value.type)) return 'function';
    }
    return null;
  },

  defName(node): string | null {
    return fieldText(node, 'name');
  },

  /** 祖先链中出现 export 语句即为导出 */
  isExported(node): boolean {
    return hasAncestor(node, EXPORT_SCOPES);
  },

  importPaths(node): string[] {
    if (node.type !== 'import_statement') return [];
    const src = node.namedChildren.find((c) => c.type === 'string');
    return src ? [src.text.replace(/['"]/g, '')] : [];
  },

  calleeName(node): string | null {
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    // foo() → foo
    if (fn.type === 'identifier') return fn.text;
    // obj.foo() / obj.foo.bar() → 末段属性名
    if (fn.type === 'member_expression') return fieldText(fn, 'property');
    return null;
  },

  entersScope(node): boolean {
    const t = node.type;
    if (METHOD_NODES.has(t)) return true;
    // 类声明本身不开启函数作用域（其方法各自开启）
    return DEF_NODES.has(t) && t !== 'class_declaration';
  },

  /** 箭头函数赋值的签名取自 value 节点（const foo = (a) => {} 的签名是 (a) => {}） */
  signatureNode(node): Parser.SyntaxNode {
    if (node.type === 'variable_declarator') {
      const value = node.childForFieldName('value');
      if (value) return value;
    }
    return node;
  },
};
