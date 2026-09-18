/**
 * Swift 规则
 *
 * 关键差异（节点名均由真实语法包实测确认）：
 *   · class / struct / enum / actor **共用 class_declaration 节点**（区别在 body 与声明关键字），
 *     protocol 是 protocol_declaration
 *   · 方法名与返回类型都叫 name 字段，childForFieldName('name') 返回前者（正确）
 *   · init / deinit / subscript 没有名字，这里补上惯用名，避免它们在符号表里消失
 *   · 调用是 call_expression，被调者可能是裸 simple_identifier（f()）或
 *     navigation_expression（a.b()，suffix 字段里才是方法名）
 *   · 可见性在 modifiers 节点里（private / fileprivate / public / internal）
 */

import { fieldText, firstChildOfType, hasAncestor, hasWord, modifiersText, type LangHandler, type SymbolKind } from './types';

const CLASS_NODES = new Set(['class_declaration', 'protocol_declaration']);
/** 类体容器 —— 其中的函数视为 method */
const CLASS_BODY_NODES = new Set(['class_body', 'protocol_body', 'enum_class_body']);
const FUNC_NODES = new Set([
  'function_declaration',
  'protocol_function_declaration',
  'init_declaration',
  'deinit_declaration',
  'subscript_declaration',
]);
/** 无名字的特殊成员 → 惯用名 */
const ANON_MEMBER_NAMES: Record<string, string> = {
  init_declaration: 'init',
  deinit_declaration: 'deinit',
  subscript_declaration: 'subscript',
};
const MODIFIER_NODES = new Set(['modifiers']);
const SCOPE_NODES = new Set([
  ...FUNC_NODES,
  'closure_expression',
  'lambda_literal',
  'computed_property',
]);
const SIMPLE_IDS = new Set(['simple_identifier']);

export const swiftHandler: LangHandler = {
  id: 'swift',
  callNodeTypes: new Set(['call_expression']),
  identifierTypes: new Set(['simple_identifier', 'type_identifier']),
  importNodeTypes: new Set(['import_declaration']),

  defKind(node): SymbolKind | null {
    const t = node.type;
    if (CLASS_NODES.has(t)) return 'class';
    if (FUNC_NODES.has(t)) return hasAncestor(node, CLASS_BODY_NODES) ? 'method' : 'function';
    return null;
  },

  defName(node): string | null {
    return fieldText(node, 'name') ?? ANON_MEMBER_NAMES[node.type] ?? null;
  },

  /**
   * private / fileprivate → 不导出。
   * 注意：Swift 默认的 internal 是"模块内可见"，而本工具的使用者通常就在模块内阅读代码，
   * 因此 internal 与 public 一并视为可见（否则绝大多数 Swift 符号都会被标成不可见）。
   */
  isExported(node): boolean {
    const mods = modifiersText(node, MODIFIER_NODES);
    return !hasWord(mods, 'private') && !hasWord(mods, 'fileprivate');
  },

  importPaths(node): string[] {
    if (node.type !== 'import_declaration') return [];
    const id = firstChildOfType(node, new Set(['identifier']));
    return [id ? id.text : node.text.replace(/^\s*import\s+/, '').trim()];
  },

  calleeName(node): string | null {
    const target = node.namedChildren.find(
      (c) => c.type === 'simple_identifier' || c.type === 'navigation_expression',
    );
    if (!target) return null;
    if (target.type === 'simple_identifier') return target.text;
    // a.b()：suffix 字段里才是方法名
    const suffix =
      target.childForFieldName('suffix') ??
      target.namedChildren.filter((c) => c.type === 'navigation_suffix').pop() ??
      null;
    if (!suffix) return null;
    return firstChildOfType(suffix, SIMPLE_IDS)?.text ?? fieldText(suffix, 'suffix');
  },

  entersScope(node): boolean {
    return SCOPE_NODES.has(node.type);
  },
};
