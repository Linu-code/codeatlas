/**
 * Kotlin 规则
 *
 * 关键差异（节点名均由真实语法包实测确认）：
 *   · 定义名**不是字段**：class_declaration 的名字是第一个裸 type_identifier 子节点，
 *     function_declaration 的名字是第一个裸 simple_identifier 子节点 → 用 firstChildOfType 取
 *   · class / data class / enum class / interface 都是 class_declaration（编译期修饰符不同），
 *     object / companion object 是 object_declaration / companion_object
 *   · 调用只有一种节点 call_expression，被调者是第一个具名子节点：
 *     裸 simple_identifier（f()）或 navigation_expression（a.b()，取最后一个 navigation_suffix）
 *   · 可见性在 modifiers 节点里（private / internal / public / override），默认 public
 *   · 导入是 import_list > import_header
 */

import type Parser from 'web-tree-sitter';
import { firstChildOfType, hasWord, modifiersText, type LangHandler, type SymbolKind } from './types';

const CLASS_NODES = new Set(['class_declaration', 'object_declaration', 'companion_object']);
/** 类体容器 —— 其中的函数视为 method */
const CLASS_BODY_NODES = new Set(['class_body', 'enum_class_body']);
const FUNC_NODES = new Set(['function_declaration']);
const MODIFIER_NODES = new Set(['modifiers']);
const SCOPE_NODES = new Set(['function_declaration', 'secondary_constructor', 'anonymous_function']);
const NAME_NODES = new Set(['simple_identifier']);
const TYPE_NAME_NODES = new Set(['type_identifier']);

/** 从 call_expression 的第一个具名子节点解析被调名 */
function callTargetName(node: Parser.SyntaxNode): string | null {
  const target = node.namedChildren.find(
    (c) => c.type === 'simple_identifier' || c.type === 'navigation_expression',
  );
  if (!target) return null;
  if (target.type === 'simple_identifier') return target.text;
  // a.b() / Helper.upper(x)：取最后一个 navigation_suffix 里的标识符
  const suffixes = target.namedChildren.filter((c) => c.type === 'navigation_suffix');
  const last = suffixes[suffixes.length - 1];
  return last ? (firstChildOfType(last, NAME_NODES)?.text ?? null) : null;
}

export const kotlinHandler: LangHandler = {
  id: 'kotlin',
  callNodeTypes: new Set(['call_expression']),
  identifierTypes: new Set(['simple_identifier', 'type_identifier']),
  importNodeTypes: new Set(['import_list', 'import_header']),

  defKind(node): SymbolKind | null {
    const t = node.type;
    if (CLASS_NODES.has(t)) return firstChildOfType(node, TYPE_NAME_NODES) ? 'class' : null;
    if (FUNC_NODES.has(t)) {
      if (!firstChildOfType(node, NAME_NODES)) return null;
      // 类体内的函数是方法；顶层/文件级是普通函数
      let cur: Parser.SyntaxNode | null = node.parent;
      while (cur) {
        if (CLASS_BODY_NODES.has(cur.type)) return 'method';
        cur = cur.parent;
      }
      return 'function';
    }
    return null;
  },

  defName(node): string | null {
    const names = CLASS_NODES.has(node.type) ? TYPE_NAME_NODES : NAME_NODES;
    return firstChildOfType(node, names)?.text ?? null;
  },

  /**
   * private / protected → 不导出。
   * 注意：Kotlin 的 internal 是"模块内可见"，而本工具的使用者通常就在模块内阅读代码，
   * 因此 internal 与 public 一并视为可见（与 Swift 处理器保持一致）。
   */
  isExported(node): boolean {
    const mods = modifiersText(node, MODIFIER_NODES);
    return !hasWord(mods, 'private') && !hasWord(mods, 'protected');
  },

  importPaths(node): string[] {
    if (node.type !== 'import_header') return [];
    const id = node.namedChildren.find((c) => c.type === 'identifier');
    return [id ? id.text : node.text.replace(/^\s*import\s+/, '').trim()];
  },

  calleeName: callTargetName,

  entersScope(node): boolean {
    return SCOPE_NODES.has(node.type);
  },
};
