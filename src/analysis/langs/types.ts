/**
 * 分析层公共类型 + 语言处理器（LangHandler）契约
 *
 * 目录约定（每种语言一个文件，便于扩展与阅读）：
 *   src/analysis/langs/types.ts        本文件：共享类型 + 处理器接口 + 通用工具
 *   src/analysis/langs/javascript.ts   JS / TS / TSX（同一套节点命名）
 *   src/analysis/langs/python.ts       Python
 *   src/analysis/langs/go.ts           Go
 *   src/analysis/langs/rust.ts         Rust
 *   src/analysis/langs/java.ts         Java
 *   src/analysis/langs/c.ts            C（同时导出 C 系共享工具，供 cpp.ts 复用）
 *   src/analysis/langs/cpp.ts          C++
 *   src/analysis/langs/csharp.ts       C#
 *   src/analysis/langs/php.ts          PHP
 *   src/analysis/langs/kotlin.ts       Kotlin
 *   src/analysis/langs/swift.ts        Swift
 *   src/analysis/langs/ruby.ts         Ruby
 *   src/analysis/langs/index.ts        注册表：LangId → handler
 *
 * 新增一种语言只需四步：
 *   ① parser.ts 的 LangId / EXT_TO_LANG 注册语言与扩展名
 *      （语法包名与 LangId 不同名时，补 GRAMMAR_FILE 映射，如 csharp → c_sharp）
 *   ② 在本目录新增 <lang>.ts 实现 LangHandler
 *   ③ langs/index.ts 注册（漏登记会被 Record<LangId, LangHandler> 拦住）
 *   ④ scripts/copy-grammars.mjs 的 GRAMMARS 加入语法包名
 */

import type Parser from 'web-tree-sitter';
import type { LangId } from '../parser';

// ---------------------------------------------------------------------------
// 分析结果类型（对外 API，symbols.ts 会原样 re-export 以保持既有 import 不变）
// ---------------------------------------------------------------------------

export type SymbolKind = 'function' | 'class' | 'method' | 'variable';

export interface SymbolDef {
  name: string;
  kind: SymbolKind;
  /** 1-based 起始行 */
  line: number;
  endLine: number;
  /** 签名文本（截断到 200 字符） */
  signature: string;
  exported: boolean;
}

export interface CallRef {
  /** 调用点所在函数名（顶层调用为 null） */
  from: string | null;
  /** 被调用者名字（成员调用取属性名，如 obj.foo() → foo） */
  to: string;
  line: number;
}

/** 标识符引用点（用于"查找引用"） */
export interface RefSite {
  name: string;
  /** 1-based 行号 */
  line: number;
  /** 1-based 列号（用于同一行多引用的区分） */
  column: number;
  kind: 'call' | 'identifier';
}

export interface FileAnalysis {
  path: string;
  language: LangId;
  definitions: SymbolDef[];
  calls: CallRef[];
  /** 全部标识符引用（含定义名与调用，由 scopeGraph 去重） */
  references: RefSite[];
  imports: string[];
  /** tree-sitter 报告语法错误（容错解析，仍产出部分结果） */
  hasError: boolean;
}

// ---------------------------------------------------------------------------
// 语言处理器契约
// ---------------------------------------------------------------------------

/**
 * 一种语言的 AST 规则集合。遍历逻辑（extractFile）是共享的，
 * 语言差异全部收敛到本接口的成员函数里。
 */
export interface LangHandler {
  readonly id: LangId;

  /**
   * 调用表达式的节点类型集合。
   * 多数语言只有一种（call_expression / call）；但 Java、C#、PHP 把
   * 「普通调用」与「构造调用」分成不同节点（如 invocation_expression 与
   * object_creation_expression），因此用集合而非单一字符串。
   */
  readonly callNodeTypes: ReadonlySet<string>;

  /** 计入"标识符引用"的节点类型（如 identifier / simple_identifier / name） */
  readonly identifierTypes: ReadonlySet<string>;

  /**
   * 导入语句节点类型 —— 其内部的 identifier 不计入引用（模块名不是引用）。
   * 说明：extractFile 还会把 importPaths() 返回非空路径的子树一并视为导入，
   * 因此像 Ruby 这种「用普通调用表达 require」的语言也能正确抑制。
   */
  readonly importNodeTypes: ReadonlySet<string>;

  /** 该节点是否为符号定义；非定义返回 null */
  defKind(node: Parser.SyntaxNode): SymbolKind | null;

  /** 取定义名；匿名定义返回 null */
  defName(node: Parser.SyntaxNode): string | null;

  /** 是否为导出 / 公开符号 */
  isExported(node: Parser.SyntaxNode): boolean;

  /** 若该节点是导入语句，返回其模块路径列表（Go 的一条 import 可含多个路径）；否则返回空数组 */
  importPaths(node: Parser.SyntaxNode): string[];

  /** 调用表达式节点 → 被调用者名；无法识别时返回 null */
  calleeName(node: Parser.SyntaxNode): string | null;

  /** 该节点是否开启新的函数作用域（用于把调用归属到调用方） */
  entersScope(node: Parser.SyntaxNode): boolean;

  /** 提取签名时使用的节点（默认节点自身；如 JS 箭头函数取其 value） */
  signatureNode?(node: Parser.SyntaxNode): Parser.SyntaxNode;
}

// ---------------------------------------------------------------------------
// 语言处理器可复用的工具
// ---------------------------------------------------------------------------

/** 取子字段节点的文本 */
export function fieldText(node: Parser.SyntaxNode, field: string): string | null {
  const child = node.childForFieldName(field);
  return child ? child.text : null;
}

/** 祖先链中是否存在任一给定节点类型 */
export function hasAncestor(node: Parser.SyntaxNode, types: ReadonlySet<string>): boolean {
  let cur: Parser.SyntaxNode | null = node.parent;
  while (cur) {
    if (types.has(cur.type)) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * 直接子节点中第一个类型命中者。
 * 适用于「名字不是字段」的语法（如 Kotlin 的 class_declaration 只有一个裸 type_identifier）。
 */
export function firstChildOfType(
  node: Parser.SyntaxNode,
  types: ReadonlySet<string>,
): Parser.SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (types.has(child.type)) return child;
  }
  return null;
}

/**
 * 汇总直接子节点中指定类型的文本（空格分隔）。
 * 用于可见性修饰符：Java 是单个 `modifiers` 节点，C# 是多个 `modifier` 节点，
 * 两种形态都能拿到完整文本（如 "public static"）。
 */
export function modifiersText(node: Parser.SyntaxNode, types: ReadonlySet<string>): string {
  const parts: string[] = [];
  for (const child of node.namedChildren) {
    if (types.has(child.type)) parts.push(child.text);
  }
  return parts.join(' ');
}

/** 文本中是否含某个独立词（避免 "private" 命中 "privateThing"） */
export function hasWord(text: string, word: string): boolean {
  return text.split(/\W+/).includes(word);
}

/** 压平空白并截断 */
export function flatten(text: string, max = 200): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * 从节点起始到函数体（body 字段）开始的文本即为签名。
 * 没有 body 字段时退回整个节点文本。
 */
export function signatureFrom(node: Parser.SyntaxNode, max = 200): string {
  const body = node.childForFieldName('body');
  if (body) {
    return flatten(node.text.slice(0, body.startIndex - node.startIndex), max);
  }
  return flatten(node.text, max);
}
