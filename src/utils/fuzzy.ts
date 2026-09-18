/**
 * fuzzy.ts —— 轻量模糊匹配（命令面板用）
 *
 * 为什么不用现成库：本项目坚持"零多余依赖"，而模糊匹配的核心只有 30 行。
 *
 * 匹配规则（全部确定性）：
 *   · 查询串的字符必须按顺序出现在目标串中（子序列匹配），大小写不敏感
 *   · 打分：命中字符 +1；连续命中额外 +8；命中词边界额外 +6；越靠前越高
 *   · 词边界 = 串首、`/ _ - . 空格` 之后、或小驼峰的大写字母
 * 这样 "cat" 能匹配 `CodeAtlas`（C-At-las），"fmt" 能匹配 `utils/format.ts`。
 */

export interface FuzzyResult {
  score: number;
  /** 命中字符在目标串中的下标（用于高亮） */
  positions: number[];
}

/** 是否为词边界（前一个字符是分隔符或当前是大写而前一个是小写） */
function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1];
  if (/[\s/_\-.]/.test(prev)) return true;
  return /[a-z0-9]/.test(prev) && /[A-Z]/.test(text[index]);
}

/**
 * 模糊匹配。
 * @returns 命中则返回分数与位置；查询为空返回 {score:0, positions:[]}；不命中返回 null
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  let score = 0;
  let lastHit = -2;
  const positions: number[] = [];
  let cursor = 0;

  for (const ch of q) {
    const found = t.indexOf(ch, cursor);
    if (found === -1) return null;
    positions.push(found);

    score += 1;
    if (found === lastHit + 1) score += 8; // 连续命中
    if (isBoundary(text, found)) score += 6; // 词边界
    score -= Math.min(found - cursor, 4); // 跳过越多扣分越狠（有上限，避免长路径被过度惩罚）

    lastHit = found;
    cursor = found + 1;
  }

  // 命中位置越靠前越好
  score += Math.max(0, 6 - positions[0]);
  // 目标串越短越好（同等命中下更精确）
  score -= Math.min(Math.floor(text.length / 8), 5);
  return { score, positions };
}

export interface RankedItem<T> {
  item: T;
  score: number;
  positions: number[];
}

/**
 * 对列表做模糊排序：先用 label 匹配，label 不中再退回 keywords（如文件完整路径）。
 * 查询为空时保持原顺序（调用方通常已按优先级排好）。
 */
export function rankByFuzzy<T>(
  query: string,
  items: T[],
  pick: (item: T) => { label: string; keywords?: string },
  limit = 50,
): RankedItem<T>[] {
  if (!query.trim()) {
    return items.slice(0, limit).map((item) => ({ item, score: 0, positions: [] }));
  }

  const ranked: RankedItem<T>[] = [];
  for (const item of items) {
    const { label, keywords } = pick(item);
    const direct = fuzzyMatch(query, label);
    if (direct) {
      ranked.push({ item, score: direct.score + 10, positions: direct.positions });
      continue;
    }
    if (keywords) {
      const viaKeywords = fuzzyMatch(query, keywords);
      if (viaKeywords) ranked.push({ item, score: viaKeywords.score, positions: [] });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}
