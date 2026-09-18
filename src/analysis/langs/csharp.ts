/**
 * C# 规则
 *
 * 关键差异（节点名均由真实语法包实测确认）：
 *   · 类型定义：class / interface / struct / record / enum / delegate，统一映射为 class
 *   · 修饰符是**多个 `modifier` 节点**（不是 Java 那样的单个 modifiers 节点）
 *   · 导入用 using_directive；别名形式 `using A = X.Y;` 的具名子节点是
 *     [name_equals, qualified_name]，取最后一个即目标命名空间
 *   · 调用有两种节点：invocation_expression（含 `obj.M()` 的 member_access_expression）
 *     与 object_creation_expression（new Foo()）
 *   · 未写修饰符时：类成员默认 private，接口成员隐式 public
 */

import { fieldText, hasAncestor, hasWord, modifiersText, type LangHandler, type SymbolKind } from './types';

const CLASS_NODES = new Set([
  'class_declaration',
  'interface_declaration',
  'struct_declaration',
  'record_declaration',
  'record_struct_declaration',
  'enum_declaration',
  'delegate_declaration',
]);
const INTERFACE_NODES = new Set(['interface_declaration']);
const METHOD_NODES = new Set([
  'method_declaration',
  'constructor_declaration',
  'destructor_declaration',
  'operator_declaration',
  'conversion_operator_declaration',
]);
/** 局部函数（方法体内的嵌套函数）—— 归类为 function */
const LOCAL_FUNC_NODES = new Set(['local_function_statement']);
const MODIFIER_NODES = new Set(['modifier']);
const SCOPE_NODES = new Set([
  ...METHOD_NODES,
  ...LOCAL_FUNC_NODES,
  'lambda_expression',
  'anonymous_method_expression',
  'accessor_declaration',
]);

export const csharpHandler: LangHandler = {
  id: 'csharp',
  callNodeTypes: new Set(['invocation_expression', 'object_creation_expression']),
  identifierTypes: new Set(['identifier']),
  importNodeTypes: new Set(['using_directive']),

  defKind(node): SymbolKind | null {
    const t = node.type;
    if (CLASS_NODES.has(t)) return 'class';
    if (LOCAL_FUNC_NODES.has(t)) return 'function';
    if (METHOD_NODES.has(t)) return 'method';
    return null;
  },

  defName(node): string | null {
    return fieldText(node, 'name');
  },

  /** public → 导出；private / protected / internal → 不导出；无修饰符时接口成员隐式 public */
  isExported(node): boolean {
    const mods = modifiersText(node, MODIFIER_NODES);
    if (hasWord(mods, 'private') || hasWord(mods, 'protected') || hasWord(mods, 'internal')) {
      return false;
    }
    if (hasWord(mods, 'public')) return true;
    return hasAncestor(node, INTERFACE_NODES);
  },

  importPaths(node): string[] {
    if (node.type !== 'using_directive') return [];
    // 别名写法下最后一个具名子节点才是目标（name_equals 是别名本身）
    const named = node.namedChildren;
    const target = named[named.length - 1];
    return target ? [target.text] : [];
  },

  calleeName(node): string | null {
    if (node.type === 'object_creation_expression') {
      const type = node.childForFieldName('type');
      return type ? type.text : null;
    }
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    if (fn.type === 'member_access_expression') return fieldText(fn, 'name');
    if (fn.type === 'generic_name') return fieldText(fn, 'name') ?? fn.text;
    return null;
  },

  entersScope(node): boolean {
    return SCOPE_NODES.has(node.type);
  },
};
