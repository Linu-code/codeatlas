/**
 * 会话上下文调度：让"按需展开"的代价**有上限**，并且能算出省了多少。
 *
 * 为什么需要它：展开是逐个来的，每个都很便宜（p50 ~100 token），但会话会累积。
 * 3 轮展开 × 1500 上限 + 一个 8k 的包，足以把 16k 窗口撑爆——而且模型不会告诉你
 * 它已经记不住了。这里做两件事：
 *
 *   1. **淘汰**：片段超过预算时，按「被引用次数 → 新旧」淘汰最不值钱的，
 *      并把"这些内容已移出窗口"如实告知模型（不说 = 它会以为自己还记得）。
 *   2. **账本**：算出这一轮会话实际用了多少，以及"如果没有分级寻址、
 *      直接把涉及的文件整份塞进去"要多少 —— 节省倍数是产品承诺的唯一证据。
 *
 * 纯函数，无 IO，可单测。
 */

export interface SessionSlice {
  /** 地址：`路径:行号` / `index:文件` / `目录/` */
  address: string;
  /** 片段实际 token */
  tokens: number;
  /** 该片段所在文件的完整体积（整份读入的代价）；缺省时按 4× 估算 */
  fileTokens?: number;
  /** 第几轮加入（0 起） */
  round: number;
  /** 被再次引用的次数（重复索取 / 答案中提到的地址） */
  hits: number;
}

export interface EvictionPlan {
  /** 窗口内保留 */
  kept: SessionSlice[];
  /** 已移出窗口 */
  dropped: SessionSlice[];
  keptTokens: number;
  droppedTokens: number;
}

/** 片段地址 → 文件路径（`a/b.ts:12` → `a/b.ts`；`目录/` 保持原样） */
export function fileOfAddress(address: string): string {
  const m = /^(.+?):\d+(?:-\d+)?$/.exec(address);
  if (m) return m[1];
  if (address.startsWith('index:')) return address.slice(6);
  return address;
}

/**
 * 淘汰计划。
 *
 * 打分只看两件事：**用过几次** 与 **多新**。语义清晰、可解释，也不依赖模型行为。
 * 硬规则：最新一条永远保留（丢掉它等于让模型失去刚看过的上下文，比超预算更糟）。
 *
 * @param cap 片段预算（token）；<=0 表示不限制
 */
export function planEviction(slices: SessionSlice[], cap: number): EvictionPlan {
  if (cap <= 0) {
    return {
      kept: [...slices],
      dropped: [],
      keptTokens: slices.reduce((n, s) => n + s.tokens, 0),
      droppedTokens: 0,
    };
  }

  const total = slices.reduce((n, s) => n + s.tokens, 0);
  if (total <= cap) {
    return { kept: [...slices], dropped: [], keptTokens: total, droppedTokens: 0 };
  }

  const newest = slices[slices.length - 1];
  // 分数越高越该留：引用次数优先，其次轮次
  const score = (s: SessionSlice) => s.hits * 1000 + s.round;
  const others = slices.filter((s) => s !== newest).sort((a, b) => score(a) - score(b));

  const dropped: SessionSlice[] = [];
  let keptTokens = total;
  while (keptTokens > cap && others.length > 0) {
    const victim = others.shift()!;
    dropped.push(victim);
    keptTokens -= victim.tokens;
  }

  const droppedSet = new Set(dropped);
  return {
    kept: slices.filter((s) => !droppedSet.has(s)),
    dropped,
    keptTokens,
    droppedTokens: dropped.reduce((n, s) => n + s.tokens, 0),
  };
}

export interface SessionLedger {
  /** 累计展开次数（含已移出窗口的） */
  slices: number;
  kept: number;
  dropped: number;
  /** 包（索引）本身 */
  packTokens: number;
  /** 窗口内片段 */
  sliceTokens: number;
  /** 会话实际占用 = 包 + 窗口内片段 */
  tokens: number;
  /** 若把涉及到的文件整份读入所需 token */
  naiveTokens: number;
  /** 节省倍数（naiveTokens / tokens），1 位小数；无数据时为 0 */
  ratio: number;
}

export function computeLedger(args: {
  packTokens: number;
  slices: SessionSlice[];
  plan: EvictionPlan;
}): SessionLedger {
  const { packTokens, slices, plan } = args;
  const tokens = packTokens + plan.keptTokens;

  // 同样的文件只算一次：多个符号出自同一文件时，"整份读入"只需付一次
  const byFile = new Map<string, number>();
  for (const s of slices) {
    const file = fileOfAddress(s.address);
    // 目录摘要 / 文件清单没有"整文件"概念，跳过
    if (file.endsWith('/') || s.address.startsWith('index:')) continue;
    const cost = s.fileTokens ?? s.tokens * 4;
    byFile.set(file, Math.max(byFile.get(file) ?? 0, cost));
  }
  const naiveTokens = [...byFile.values()].reduce((n, v) => n + v, 0);

  return {
    slices: slices.length,
    kept: plan.kept.length,
    dropped: plan.dropped.length,
    packTokens,
    sliceTokens: plan.keptTokens,
    tokens,
    naiveTokens,
    ratio: naiveTokens > 0 && tokens > 0 ? Math.round((naiveTokens / tokens) * 10) / 10 : 0,
  };
}
