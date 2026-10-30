import { describe, expect, it } from 'vitest';
import { computeLedger, fileOfAddress, planEviction, type SessionSlice } from '../../src/analysis/session';

const s = (address: string, tokens: number, round: number, hits = 0, fileTokens?: number): SessionSlice => ({
  address,
  tokens,
  round,
  hits,
  fileTokens,
});

describe('fileOfAddress', () => {
  it('从地址里取出文件路径', () => {
    expect(fileOfAddress('src/a.ts:12')).toBe('src/a.ts');
    expect(fileOfAddress('src/a.ts:12-40')).toBe('src/a.ts');
    expect(fileOfAddress('index:src/a.ts')).toBe('src/a.ts');
    expect(fileOfAddress('src/analysis/')).toBe('src/analysis/');
    expect(fileOfAddress('./')).toBe('./');
  });
});

describe('planEviction', () => {
  it('预算内不动', () => {
    const list = [s('a:1', 100, 0), s('b:1', 100, 1)];
    const plan = planEviction(list, 500);
    expect(plan.dropped).toHaveLength(0);
    expect(plan.keptTokens).toBe(200);
  });

  it('超预算时丢最不值钱的（先旧后新、引用多的留）', () => {
    const list = [s('a:1', 100, 0), s('b:1', 100, 1, 2), s('c:1', 100, 2)];
    const plan = planEviction(list, 200);
    // a 最旧且无引用 → 先丢；b 有引用 → 留
    expect(plan.dropped.map((x) => x.address)).toEqual(['a:1']);
    expect(plan.keptTokens).toBe(200);
    expect(plan.droppedTokens).toBe(100);
  });

  it('最新一条永远保留（丢了等于让模型失去刚看过的内容）', () => {
    const list = [s('new:1', 500, 3, 0)];
    const plan = planEviction(list, 100);
    expect(plan.kept.map((x) => x.address)).toEqual(['new:1']);
    expect(plan.dropped).toHaveLength(0);
  });

  it('cap <= 0 表示不限制', () => {
    const list = [s('a:1', 999, 0), s('b:1', 999, 1)];
    expect(planEviction(list, 0).dropped).toHaveLength(0);
  });
});

describe('computeLedger', () => {
  it('同一文件只按整份算一次，倍数 = 整份 / 实际占用', () => {
    // 两个符号同出一个 2000 token 的文件，各取 100
    const list = [s('a.ts:10', 100, 0, 0, 2000), s('a.ts:80', 100, 1, 0, 2000)];
    const plan = planEviction(list, 0);
    const ledger = computeLedger({ packTokens: 800, slices: list, plan });
    expect(ledger.tokens).toBe(1000);
    expect(ledger.naiveTokens).toBe(2000);
    expect(ledger.ratio).toBe(2);
  });

  it('不同文件累加', () => {
    const list = [s('a.ts:10', 100, 0, 0, 600), s('b.ts:20', 100, 1, 0, 400)];
    const plan = planEviction(list, 0);
    const ledger = computeLedger({ packTokens: 0, slices: list, plan });
    expect(ledger.naiveTokens).toBe(1000);
    expect(ledger.ratio).toBe(5);
  });

  it('目录摘要 / 文件清单不计入"整份读入"', () => {
    const list = [s('src/analysis/', 500, 0), s('index:a.ts', 120, 1)];
    const plan = planEviction(list, 0);
    const ledger = computeLedger({ packTokens: 300, slices: list, plan });
    expect(ledger.naiveTokens).toBe(0);
    expect(ledger.ratio).toBe(0);
  });

  it('没有 fileTokens 时按 4× 粗估，仍给出可解释的倍数', () => {
    const list = [s('a.ts:10', 100, 0)];
    const plan = planEviction(list, 0);
    const ledger = computeLedger({ packTokens: 100, slices: list, plan });
    expect(ledger.naiveTokens).toBe(400);
    expect(ledger.ratio).toBe(2);
  });

  it('被淘汰的片段仍计入展开次数，但不计入窗口占用', () => {
    const list = [s('a.ts:1', 100, 0, 0, 5000), s('b.ts:1', 100, 1, 0, 5000), s('c.ts:1', 100, 2, 0, 5000)];
    const plan = planEviction(list, 200);
    const ledger = computeLedger({ packTokens: 0, slices: list, plan });
    expect(ledger.slices).toBe(3);
    expect(ledger.kept).toBe(2);
    expect(ledger.dropped).toBe(1);
    expect(ledger.tokens).toBe(200);
  });
});
