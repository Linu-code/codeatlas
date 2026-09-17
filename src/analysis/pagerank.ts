/**
 * pagerank.ts —— 文件依赖图的 PageRank 排序
 *
 * 用途（对应提示词"AI 上下文包"核心算法）：
 *   在有限 token 预算下，优先把"最重要的符号"塞进上下文包。
 *   "重要" = 依赖图上被依赖得越多（incoming）且自身依赖别人（outgoing）越多。
 *
 * 图定义：节点 = 文件；边 = 引用关系（A 调用/导入了 B → A → B），边权可加权。
 * 算法：标准 PageRank（power iteration），
 *   PR(u) = (1-d)/N + d * Σ_{v→u} ( w(v,u) / Σ_w w(v,·) ) * PR(v)
 *   d = 0.85（常用阻尼系数），迭代至 L1 变化 < 1e-6 或达到 100 轮。
 *
 * 复杂度：O(E) / 轮，几千节点的仓库毫秒级完成，无需异步。
 */

export interface DependencyEdge {
  from: string;
  to: string;
  /** 边权（默认 1；可按符号重要性/调用次数加权） */
  weight?: number;
}

export interface PageRankOptions {
  damping?: number;
  iterations?: number;
  tolerance?: number;
}

/** 计算 PageRank，返回 file → 分数（已归一化，总和 ≈ 1） */
export function pageRank(
  nodes: string[],
  edges: DependencyEdge[],
  opts: PageRankOptions = {},
): Map<string, number> {
  const d = opts.damping ?? 0.85;
  const maxIter = opts.iterations ?? 100;
  const tol = opts.tolerance ?? 1e-6;

  const n = nodes.length;
  const ranks = new Map<string, number>();
  if (n === 0) return ranks;

  const init = 1 / n;
  for (const node of nodes) ranks.set(node, init);

  // 出边权重和（用于归一化），并过滤掉指向图外的边
  const nodeSet = new Set(nodes);
  const outWeight = new Map<string, number>();
  const incoming = new Map<string, DependencyEdge[]>();
  for (const node of nodes) incoming.set(node, []);

  for (const edge of edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue;
    if (edge.from === edge.to) continue; // 自环忽略
    const w = edge.weight ?? 1;
    outWeight.set(edge.from, (outWeight.get(edge.from) ?? 0) + w);
    incoming.get(edge.to)!.push(edge);
  }

  const danglingNodes = nodes.filter((node) => (outWeight.get(node) ?? 0) === 0);

  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Map<string, number>();
    // 悬挂节点（无出边）的权重均分给所有节点，避免权重泄漏
    let danglingSum = 0;
    for (const node of danglingNodes) danglingSum += ranks.get(node)!;

    let diff = 0;
    for (const node of nodes) {
      let sum = 0;
      for (const edge of incoming.get(node)!) {
        const w = edge.weight ?? 1;
        const denom = outWeight.get(edge.from)!;
        sum += (w / denom) * ranks.get(edge.from)!;
      }
      const value = (1 - d) / n + d * (sum + danglingSum / n);
      next.set(node, value);
      diff += Math.abs(value - ranks.get(node)!);
    }

    for (const [k, v] of next) ranks.set(k, v);
    if (diff < tol) break;
  }

  // 归一化，保证总和为 1（数值误差修正）
  let total = 0;
  for (const v of ranks.values()) total += v;
  if (total > 0) {
    for (const [k, v] of ranks) ranks.set(k, v / total);
  }
  return ranks;
}

/** 由文件级导入/调用关系构建依赖边（含去重与加权） */
export function buildDependencyEdges(
  files: { path: string; imports: string[]; callsOut: string[] }[],
): DependencyEdge[] {
  const weights = new Map<string, number>();
  const key = (from: string, to: string) => `${from}\u0000${to}`;

  // 1) 导入关系：weight 1
  const resolveImport = (fromFile: string, spec: string): string | null => {
    if (!spec.startsWith('.')) return null; // 外部依赖不计入
    const baseDir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/') + 1) : '';
    const combined = normalizePosix(baseDir + spec);
    // 候选：原样、加常见扩展名、加 /index
    const candidates = [
      combined,
      `${combined}.ts`,
      `${combined}.tsx`,
      `${combined}.js`,
      `${combined}.jsx`,
      `${combined}.py`,
      `${combined}/index.ts`,
      `${combined}/index.tsx`,
      `${combined}/index.js`,
      `${combined}/__init__.py`,
    ];
    const fileSet = new Set(files.map((f) => f.path));
    return candidates.find((c) => fileSet.has(c)) ?? null;
  };

  for (const f of files) {
    for (const spec of f.imports) {
      const target = resolveImport(f.path, spec);
      if (target && target !== f.path) {
        const k = key(f.path, target);
        weights.set(k, (weights.get(k) ?? 0) + 1);
      }
    }
    // 2) 调用关系：weight 2（比导入更强的耦合信号）
    for (const target of f.callsOut) {
      if (target !== f.path) {
        const k = key(f.path, target);
        weights.set(k, (weights.get(k) ?? 0) + 2);
      }
    }
  }

  return [...weights.entries()].map(([k, weight]) => {
    const [from, to] = k.split('\u0000');
    return { from, to, weight };
  });
}

/** POSIX 风格路径规范化（处理 ../ 与 ./） */
export function normalizePosix(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}
