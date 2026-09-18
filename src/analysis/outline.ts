/**
 * outline.ts —— 当前文件的符号大纲（N2）
 *
 * 把扁平的符号表（`SymbolDef[]`）还原成**嵌套结构**：
 * 类里的方法成为该类的子节点，函数内定义的嵌套函数归到函数下。
 *
 * 判定依据只有行区间包含关系（[line, endLine]）：
 *   若 B 的区间被 A 的区间包含，则 B 是 A 的子节点。
 * 这比依赖语言特定的 AST 结构更稳（12 种语言都能用），也与编辑器的
 * "大纲/结构"视图行为一致。
 *
 * 复杂度：O(n log n)（排序 + 一次栈扫描），n = 符号数。
 */

import type { SymbolDef, SymbolKind } from './langs/types';

export interface OutlineNode {
  name: string;
  kind: SymbolKind;
  line: number;
  endLine: number;
  exported: boolean;
  children: OutlineNode[];
}

/**
 * 由符号定义列表构建大纲树（确定性：同输入必得同输出）。
 */
export function buildOutline(definitions: SymbolDef[]): OutlineNode[] {
  const sorted = [...definitions].sort(
    (a, b) =>
      a.line - b.line ||
      b.endLine - a.endLine ||
      a.name.localeCompare(b.name),
  );

  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const def of sorted) {
    const node: OutlineNode = {
      name: def.name,
      kind: def.kind,
      line: def.line,
      endLine: def.endLine,
      exported: def.exported,
      children: [],
    };

    // 弹出所有"已经结束"的祖先（区间不再包含当前定义）
    while (stack.length > 0 && stack[stack.length - 1].endLine < def.line) stack.pop();

    // 栈顶若完整包含当前定义，则作为其子节点
    const parent = stack[stack.length - 1];
    if (parent && parent.endLine >= def.endLine && parent.line <= def.line) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }

    // 只有"可容纳子节点"的定义才可能成为祖先；变量类定义不参与嵌套
    if (def.kind !== 'variable') stack.push(node);
  }

  return roots;
}

/** 统计大纲节点总数（含嵌套） */
export function outlineCount(nodes: OutlineNode[]): number {
  let total = 0;
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      total++;
      walk(n.children);
    }
  };
  walk(nodes);
  return total;
}
