/**
 * readingPath.ts —— 建议阅读路线（N2 的核心：把"分析"变成"导航"）
 *
 * 思路（确定性、可复现，不含任何 AI）：
 *   1. 用文件级依赖边（导入 + 调用）建图，跑 PageRank 得到"枢纽度"；
 *   2. 再用入度 / 出度判断文件在依赖图中的**角色**：
 *        entry   —— 没有人依赖它、但它依赖别人 → 站在入口（main / cli / server）
 *        core    —— 被两个以上文件依赖 → 枢纽，读不懂它后面就都读不懂
 *        support —— 中间层
 *        leaf    —— 只被依赖、自己不依赖别人 → 末端工具
 *   3. 按「入口 → 枢纽 → 中间层 → 末端」排序，即得到一条自顶向下的阅读顺序。
 *
 * 为什么用入/出度而不是只看 PageRank：
 *   PageRank 只反映"重要性"，无法区分"入口"和"被大量复用的工具"。
 *   阅读路线的价值恰恰在于先读入口，再读枢纽。
 *
 * 复杂度：O(V+E) 建图 + PageRank 若干轮；对 2000 文件规模是毫秒级。
 */

import type { FileAnalysis } from './symbols';
import type { ScopeIndex } from './scopeGraph';
import { pageRank } from './pagerank';
import { buildCallEdges, buildImportEdges, buildResolveContext, mergeWeightedEdges } from './importResolver';

export type ReadingRole = 'entry' | 'core' | 'support' | 'leaf';

export interface ReadingStep {
  path: string;
  /** 1-based 阅读序号（全部文件都编号，截断只影响展示） */
  order: number;
  role: ReadingRole;
  /** 文件级 PageRank 分数 */
  score: number;
  inDegree: number;
  outDegree: number;
}

export interface ReadingGroup {
  /** 顶层目录（根目录文件为 '(root)'） */
  dir: string;
  /** 该目录下第一个文件在路线中的序号 */
  firstOrder: number;
  files: number;
}

export interface ReadingPath {
  steps: ReadingStep[];
  /** 参与排名的文件总数 */
  totalFiles: number;
  /** 因超过 maxSteps 而未在 steps 中展示的数量 */
  omitted: number;
  groups: ReadingGroup[];
  /** 全部文件的 路径 → 序号（供文件树角标使用） */
  orderByPath: Map<string, number>;
}

export interface ReadingPathOptions {
  /** 展示的最大步数（默认 40；序号仍为全部文件编号） */
  maxSteps?: number;
}

/** 角色优先级：数字越小越先读 */
const ROLE_RANK: Record<ReadingRole, number> = { entry: 0, core: 1, support: 2, leaf: 3 };

/**
 * 判定文件在依赖图中的角色。
 *
 * 判定优先级（有重叠时按此顺序）：
 *   ① 入口：没人依赖它、它依赖别人 —— 阅读起点
 *   ② 枢纽：被 2 个以上文件依赖 —— 重要性优先于"是否依赖别人"
 *   ③ 末端：只被依赖、自己不依赖别人
 *   ④ 其余为中间层
 */
export function classifyRole(inDegree: number, outDegree: number): ReadingRole {
  if (inDegree === 0 && outDegree > 0) return 'entry';
  if (inDegree >= 2) return 'core';
  if (outDegree === 0 && inDegree > 0) return 'leaf';
  return 'support';
}

/**
 * 生成建议阅读路线。
 * @param files 已分析的源文件
 * @param index 符号索引（用于把调用解析到文件，可选；缺失时只用导入关系）
 */
export function buildReadingPath(
  files: FileAnalysis[],
  index?: ScopeIndex | null,
  opts: ReadingPathOptions = {},
): ReadingPath {
  const maxSteps = opts.maxSteps ?? 40;
  const paths = files.map((f) => f.path).sort();

  if (paths.length === 0) {
    return { steps: [], totalFiles: 0, omitted: 0, groups: [], orderByPath: new Map() };
  }

  const ctx = buildResolveContext(paths);
  const importEdges = buildImportEdges(files, ctx);
  const callEdges = index ? buildCallEdges(files, index, importEdges) : [];
  const weighted = mergeWeightedEdges(importEdges, callEdges);

  // PageRank：用加权边（调用权重更高，反映更强耦合）
  const ranks = pageRank(paths, weighted);

  // 入/出度：按"不同邻居数"计，而不是边数 —— 一个文件被调用 100 次仍是同一个依赖方
  const outNeighbors = new Map<string, Set<string>>();
  const inNeighbors = new Map<string, Set<string>>();
  for (const p of paths) {
    outNeighbors.set(p, new Set());
    inNeighbors.set(p, new Set());
  }
  for (const e of weighted) {
    if (e.from === e.to) continue;
    outNeighbors.get(e.from)?.add(e.to);
    inNeighbors.get(e.to)?.add(e.from);
  }

  const steps: ReadingStep[] = paths.map((path) => {
    const outDegree = outNeighbors.get(path)?.size ?? 0;
    const inDegree = inNeighbors.get(path)?.size ?? 0;
    return {
      path,
      order: 0,
      role: classifyRole(inDegree, outDegree),
      score: ranks.get(path) ?? 0,
      inDegree,
      outDegree,
    };
  });

  steps.sort((a, b) => {
    const byRole = ROLE_RANK[a.role] - ROLE_RANK[b.role];
    if (byRole !== 0) return byRole;
    // 入口：依赖别人越多越先读（从入口往下走）
    if (a.role === 'entry') {
      if (b.outDegree !== a.outDegree) return b.outDegree - a.outDegree;
    } else if (a.role === 'core') {
      // 枢纽：被依赖越多越先读
      if (b.inDegree !== a.inDegree) return b.inDegree - a.inDegree;
    }
    if (b.score !== a.score) return b.score - a.score;
    if (b.inDegree !== a.inDegree) return b.inDegree - a.inDegree;
    return a.path.localeCompare(b.path);
  });

  const orderByPath = new Map<string, number>();
  steps.forEach((step, i) => {
    step.order = i + 1;
    orderByPath.set(step.path, i + 1);
  });

  // 目录分组（按路线中的首次出现顺序）
  const groupMap = new Map<string, ReadingGroup>();
  for (const step of steps) {
    const slash = step.path.indexOf('/');
    const dir = slash === -1 ? '(root)' : step.path.slice(0, slash);
    const existing = groupMap.get(dir);
    if (existing) existing.files += 1;
    else groupMap.set(dir, { dir, firstOrder: step.order, files: 1 });
  }
  const groups = [...groupMap.values()].sort((a, b) => a.firstOrder - b.firstOrder);

  return {
    steps: steps.slice(0, maxSteps),
    totalFiles: steps.length,
    omitted: Math.max(0, steps.length - maxSteps),
    groups,
    orderByPath,
  };
}
