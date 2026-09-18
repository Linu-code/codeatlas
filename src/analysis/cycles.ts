/**
 * cycles.ts —— 循环依赖检测（Tarjan 强连通分量）
 *
 * 为什么用强连通分量（SCC）：循环依赖的本质是"有向图里的环"，
 * 而图中所有环的并集恰好等于"大小 > 1 的 SCC"的并集 ——
 * 一次 O(V+E) 的 Tarjan 就能找出**全部**环，不需要逐条路径搜索。
 *
 * 实现细节（都是踩过的坑）：
 *   · 用**迭代版** Tarjan，不用递归：2000 文件的链式依赖会爆栈。
 *   · 节点与邻接表都排序后再遍历 → 结果与输入顺序无关，可复现。
 *   · 每个环做**规范化旋转**（从字典序最小的文件开始），让单测断言稳定。
 *   · 自环（A 引用 A）单独保留，它同样是循环依赖。
 *
 * 复杂度：O(V+E)。
 */

import type { FileEdge } from './importResolver';

export interface CycleReport {
  /** 每个环的文件列表（已规范化旋转，按首元素排序） */
  cycles: string[][];
  /** 把文件折叠到目录后的跨目录环（仅保留涉及 ≥2 个目录的） */
  dirCycles: string[][];
  /** 参与环的文件数 */
  involvedFiles: number;
  /** 参与环的文件集合（供列表标记） */
  involved: Set<string>;
}

/** 目录名（根目录文件为 '(root)'） */
function dirOf(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? '(root)' : path.slice(0, slash);
}

/** 把环旋转到"从字典序最小元素开始"，使表示唯一 */
export function canonicalizeCycle(cycle: string[]): string[] {
  if (cycle.length <= 1) return [...cycle];
  let minIndex = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIndex]) minIndex = i;
  }
  return [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)];
}

/**
 * 找出全部循环依赖。
 * @param nodes 全部文件路径
 * @param edges 有向边（from 依赖 to）
 */
export function findCycles(nodes: string[], edges: FileEdge[]): CycleReport {
  const nodeSet = new Set(nodes);
  const adjacency = new Map<string, string[]>();
  const selfLoops = new Set<string>();
  for (const node of nodes) adjacency.set(node, []);

  for (const edge of edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue;
    if (edge.from === edge.to) {
      selfLoops.add(edge.from);
      continue;
    }
    adjacency.get(edge.from)!.push(edge.to);
  }
  for (const list of adjacency.values()) list.sort();

  const sortedNodes = [...nodes].sort();

  // ---------- 迭代版 Tarjan ----------
  const indexOf = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const rawCycles: string[][] = [];
  let counter = 0;

  for (const root of sortedNodes) {
    if (indexOf.has(root)) continue;

    indexOf.set(root, counter);
    lowLink.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);

    const work: { v: string; i: number }[] = [{ v: root, i: 0 }];

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbors = adjacency.get(frame.v) ?? [];

      if (frame.i < neighbors.length) {
        const w = neighbors[frame.i];
        frame.i++;
        if (!indexOf.has(w)) {
          indexOf.set(w, counter);
          lowLink.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          lowLink.set(frame.v, Math.min(lowLink.get(frame.v)!, indexOf.get(w)!));
        }
        continue;
      }

      // frame.v 处理完毕：回溯并合并 low-link
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].v;
        lowLink.set(parent, Math.min(lowLink.get(parent)!, lowLink.get(frame.v)!));
      }

      if (lowLink.get(frame.v) === indexOf.get(frame.v)) {
        const component: string[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
          if (w === frame.v) break;
        }
        // 大小 > 1 即为环；大小为 1 时只有自环才算
        if (component.length > 1) rawCycles.push(component);
        else if (selfLoops.has(component[0])) rawCycles.push(component);
      }
    }
  }

  /**
   * Tarjan 弹栈得到的是**逆序**（DFS 完成序），这里反转一次，
   * 让环内的顺序与依赖方向一致（a → b → c → a 输出为 [a, b, c]），
   * 面板上读起来才是"链路"而不是倒着念。
   */
  const cycles = rawCycles
    .map((c) => canonicalizeCycle([...c].reverse()))
    .sort((a, b) => a.length - b.length || a[0].localeCompare(b[0]));

  // ---------- 目录级汇总 ----------
  const dirCycleKeys = new Set<string>();
  const dirCycles: string[][] = [];
  for (const cycle of cycles) {
    const dirs: string[] = [];
    for (const file of cycle) {
      const d = dirOf(file);
      if (!dirs.includes(d)) dirs.push(d);
    }
    if (dirs.length < 2) continue;
    const canonical = canonicalizeCycle(dirs);
    const key = canonical.join('\u0000');
    if (dirCycleKeys.has(key)) continue;
    dirCycleKeys.add(key);
    dirCycles.push(canonical);
  }
  dirCycles.sort((a, b) => a.length - b.length || a[0].localeCompare(b[0]));

  const involved = new Set<string>();
  for (const cycle of cycles) for (const f of cycle) involved.add(f);

  return {
    cycles,
    dirCycles,
    involvedFiles: involved.size,
    involved,
  };
}
