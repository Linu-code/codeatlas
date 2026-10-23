/**
 * 单测：超大项目的分析目标筛选（targets.ts）
 *
 * 关键不变量：
 *   · 未超上限 → 原样返回（小项目零行为变化）
 *   · 超上限 → 排除第三方/产物目录，核心目录与入口优先，测试降权
 *   · 结果确定（同输入同输出）
 */

import { describe, expect, it } from 'vitest';
import { scorePath, selectAnalysisPaths } from '../../src/analysis/targets';

describe('selectAnalysisPaths（超大项目目标筛选）', () => {
  it('未超上限时原样返回（零行为变化）', () => {
    const all = ['a.ts', 'b.ts'];
    const r = selectAnalysisPaths(all, 10);
    expect(r.paths).toEqual(all);
    expect(r.excluded).toBe(0);
  });

  it('超上限时排除第三方与产物目录', () => {
    const all = [
      ...Array.from({ length: 5 }, (_, i) => `src/m${i}.ts`),
      ...Array.from({ length: 5 }, (_, i) => `third_party/lib${i}/x.ts`),
      ...Array.from({ length: 5 }, (_, i) => `node_modules/p${i}/y.ts`),
    ];
    const r = selectAnalysisPaths(all, 3);
    expect(r.paths).toHaveLength(3);
    for (const p of r.paths) expect(p).not.toMatch(/third_party|node_modules/);
  });

  it('核心目录与入口优先，测试降权', () => {
    const all = [
      'tests/a.test.ts',
      'tests/b.test.ts',
      'tests/c.test.ts',
      'src/core/main.ts',
      'src/lib/util.ts',
      'docs/x.ts',
    ];
    const r = selectAnalysisPaths(all, 2);
    expect(r.paths).toContain('src/core/main.ts');
    expect(r.paths).not.toContain('tests/a.test.ts');
  });

  it('第三方过多时不欠采样：退化为全量池', () => {
    const all = ['third_party/a.ts', 'third_party/b.ts', 'third_party/c.ts', 'src/d.ts'];
    const r = selectAnalysisPaths(all, 3);
    expect(r.paths).toHaveLength(3);
  });

  it('结果确定（同输入同输出）', () => {
    const all = ['z/z.ts', 'a/a.ts', 'b/b.ts'];
    expect(selectAnalysisPaths(all, 2).paths).toEqual(selectAnalysisPaths(all, 2).paths);
  });

  it('scorePath：入口 > 核心 > 测试', () => {
    expect(scorePath('src/main.ts')).toBeGreaterThan(scorePath('src/util.ts'));
    expect(scorePath('src/util.ts')).toBeGreaterThan(scorePath('tests/util.ts'));
  });
});
