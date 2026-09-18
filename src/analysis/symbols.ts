/**
 * symbols.ts —— 单次 AST 遍历提取「定义 / 调用 / 导入」
 *
 * 职责划分：本文件只做**遍历与结果组装**，不含任何语言特判。
 * 各语言的 AST 差异全部收敛在 `langs/<lang>.ts` 的 LangHandler 实现里
 * （见 langs/types.ts 的契约说明）—— 新增语言无需改动本文件。
 *
 * 复杂度：O(n)（n = AST 节点数），单次遍历同时产出定义、调用、引用、导入四类信息。
 */

import type Parser from 'web-tree-sitter';
import type { LangId } from './parser';
import { handlerFor } from './langs';
import {
  signatureFrom,
  type CallRef,
  type FileAnalysis,
  type RefSite,
  type SymbolDef,
  type SymbolKind,
} from './langs/types';

// 对外 API 保持原样：既有 `import type { SymbolDef } from './symbols'` 继续可用
export type { SymbolDef, CallRef, RefSite, FileAnalysis, SymbolKind };

/**
 * 提取单个文件的符号信息。
 * @param root tree-sitter 根节点
 * @param path 文件路径（用于结果标识）
 * @param language 语言
 */
export function extractFile(root: Parser.SyntaxNode, path: string, language: LangId): FileAnalysis {
  const handler = handlerFor(language);

  const definitions: SymbolDef[] = [];
  const calls: CallRef[] = [];
  const imports: string[] = [];
  const references: RefSite[] = [];

  /** 当前所在函数（用于把调用归属到调用方） */
  const stack: string[] = [];

  const visit = (node: Parser.SyntaxNode, inImport = false) => {
    const type = node.type;
    const nowInImport = inImport || handler.importNodeTypes.has(type);

    // ---------- 标识符引用（供"查找引用"使用） ----------
    if (handler.identifierTypes.has(type) && !nowInImport) {
      // 定义处的名字也计入 references，由 scopeGraph 建索引时与定义位置去重
      references.push({
        name: node.text,
        line: node.startPosition.row + 1,
        column: node.startPosition.column + 1,
        kind: node.parent?.type === handler.callNodeType ? 'call' : 'identifier',
      });
    }

    // ---------- 定义 ----------
    const kind = handler.defKind(node);
    if (kind) {
      const name = handler.defName(node);
      if (name) {
        const sigNode = handler.signatureNode ? handler.signatureNode(node) : node;
        definitions.push({
          name,
          kind,
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          signature: signatureFrom(sigNode),
          exported: handler.isExported(node),
        });
      }
    }

    // ---------- 导入 ----------
    for (const p of handler.importPaths(node)) imports.push(p);

    // ---------- 调用 ----------
    if (type === handler.callNodeType) {
      const callee = handler.calleeName(node);
      if (callee) {
        calls.push({
          from: stack.length ? stack[stack.length - 1] : null,
          to: callee,
          line: node.startPosition.row + 1,
        });
      }
    }

    // ---------- 递归 ----------
    if (handler.entersScope(node)) {
      stack.push(handler.defName(node) ?? '<anonymous>');
      for (const child of node.namedChildren) visit(child, nowInImport);
      stack.pop();
    } else {
      for (const child of node.namedChildren) visit(child, nowInImport);
    }
  };

  visit(root);

  // 同名重载 / 重复定义去重（保留行号最靠前者）
  const seen = new Set<string>();
  const deduped = definitions.filter((d) => {
    const key = `${d.kind}:${d.name}:${d.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    path,
    language,
    definitions: deduped,
    calls,
    references,
    imports,
    hasError: root.hasError,
  };
}
