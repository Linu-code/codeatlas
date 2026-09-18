/**
 * Java 规则
 *
 * 关键差异（节点名均由真实语法包实测确认）：
 *   · 类型定义有五种节点：class / interface / enum / record / @interface，统一映射为 class
 *   · 方法有两种节点：method_declaration 与 constructor_declaration（构造器同样视为 method）
 *   · 调用有三种节点：method_invocation（obj.m() 或 m()）、object_creation_expression（new Foo()）、
 *     explicit_constructor_invocation（super() / this()，无被调名，返回 null）
 *   · 可见性由 modifiers 子节点承载，其文本形如 "public static"
 *   · 接口成员不写修饰符时隐式 public；类成员不写修饰符时是包级私有
 */

import { fieldText, hasAncestor, hasWord, modifiersText, type LangHandler, type SymbolKind } from './types';

/** 类型定义节点（全部映射为 class） */
const CLASS_NODES = new Set([
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
  'annotation_type_declaration',
]);
/** 声明"名字"可跨类使用的容器（成员默认可见性不同） */
const INTERFACE_NODES = new Set(['interface_declaration', 'annotation_type_declaration']);
const METHOD_NODES = new Set(['method_declaration', 'constructor_declaration']);
const MODIFIER_NODES = new Set(['modifiers']);
const SCOPE_NODES = new Set(['method_declaration', 'constructor_declaration', 'lambda_expression']);

export const javaHandler: LangHandler = {
  id: 'java',
  callNodeTypes: new Set([
    'method_invocation',
    'object_creation_expression',
    'explicit_constructor_invocation',
  ]),
  identifierTypes: new Set(['identifier', 'type_identifier']),
  importNodeTypes: new Set(['import_declaration']),

  defKind(node): SymbolKind | null {
    if (CLASS_NODES.has(node.type)) return 'class';
    if (METHOD_NODES.has(node.type)) return 'method';
    return null;
  },

  defName(node): string | null {
    return fieldText(node, 'name');
  },

  /**
   * public → 导出；private / protected → 不导出；
   * 未写修饰符时：接口成员隐式 public，类成员为包级私有。
   */
  isExported(node): boolean {
    const mods = modifiersText(node, MODIFIER_NODES);
    if (hasWord(mods, 'private') || hasWord(mods, 'protected')) return false;
    if (hasWord(mods, 'public')) return true;
    return hasAncestor(node, INTERFACE_NODES);
  },

  /** `import a.b.C;` / `import static a.b.C.d;` / `import a.b.*;` */
  importPaths(node): string[] {
    if (node.type !== 'import_declaration') return [];
    const path = node.text
      .replace(/^\s*import\s+/, '')
      .replace(/^\s*static\s+/, '')
      .replace(/;\s*$/, '')
      .trim();
    return path ? [path] : [];
  },

  calleeName(node): string | null {
    if (node.type === 'method_invocation') return fieldText(node, 'name');
    if (node.type === 'object_creation_expression') {
      const type = node.childForFieldName('type');
      return type ? type.text : null;
    }
    // super() / this() 没有独立被调名
    return null;
  },

  entersScope(node): boolean {
    return SCOPE_NODES.has(node.type);
  },
};
