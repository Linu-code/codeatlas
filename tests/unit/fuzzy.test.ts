/**
 * fuzzy —— 命令面板的模糊匹配（N2）
 */
import { describe, expect, it } from 'vitest';
import { fuzzyMatch, rankByFuzzy } from '../../src/utils/fuzzy';

describe('fuzzyMatch', () => {
  it('子序列命中（大小写不敏感）', () => {
    expect(fuzzyMatch('cat', 'CodeAtlas')).not.toBeNull();
    expect(fuzzyMatch('FMT', 'format')).not.toBeNull();
  });

  it('顺序不对或字符缺失则不命中', () => {
    expect(fuzzyMatch('tac', 'cat')).toBeNull();
    expect(fuzzyMatch('xyz', 'CodeAtlas')).toBeNull();
  });

  it('空查询命中但分数为 0（面板据此保持原顺序）', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });

  it('返回命中位置（供高亮）', () => {
    expect(fuzzyMatch('at', 'cat')!.positions).toEqual([1, 2]);
  });

  it('连续命中比分散命中得分高', () => {
    const consecutive = fuzzyMatch('abc', 'abc_x')!;
    const spread = fuzzyMatch('abc', 'a_b_c')!;
    expect(consecutive.score).toBeGreaterThan(spread.score);
  });

  it('词边界命中比词中命中得分高', () => {
    const boundary = fuzzyMatch('util', 'src/utils/x')!.score;
    const inside = fuzzyMatch('util', 'srxcutilx')!.score;
    expect(boundary).toBeGreaterThan(inside);
  });

  it('同等命中时更短的串得分更高', () => {
    expect(fuzzyMatch('ab', 'ab')!.score).toBeGreaterThan(fuzzyMatch('ab', 'ab_longer_name')!.score);
  });

  it('能在文件路径里按末段匹配', () => {
    expect(fuzzyMatch('format', 'src/utils/format.ts')).not.toBeNull();
  });
});

describe('rankByFuzzy', () => {
  const items = [
    { label: 'Call graph', keywords: 'analysis:callGraph' },
    { label: 'Code metrics', keywords: 'analysis:metrics' },
    { label: 'src/core.ts', keywords: 'src/core.ts' },
  ];
  const pick = (i: (typeof items)[number]) => ({ label: i.label, keywords: i.keywords });

  it('空查询保持原顺序并受 limit 限制', () => {
    const ranked = rankByFuzzy('', items, pick, 2);
    expect(ranked.map((r) => r.item.label)).toEqual(['Call graph', 'Code metrics']);
  });

  it('label 命中优先于仅 keywords 命中', () => {
    const ranked = rankByFuzzy('core', items, pick);
    expect(ranked[0].item.label).toBe('src/core.ts');
    // "metrics" 只在 keywords 里出现，应排在 label 命中之后
    const ranked2 = rankByFuzzy('metrics', items, pick);
    expect(ranked2[0].item.label).toBe('Code metrics');
  });

  it('无命中返回空数组', () => {
    expect(rankByFuzzy('zzzzz', items, pick)).toEqual([]);
  });
});
