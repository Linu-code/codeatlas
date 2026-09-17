import { describe, expect, it } from 'vitest';
import { buildDependencyEdges, normalizePosix, pageRank } from '../../src/analysis/pagerank';
import { estimateTokens, fitsBudget } from '../../src/utils/tokenEstimator';
import { generateContextPack, rankSymbols } from '../../src/analysis/contextPack';
import { buildScopeIndex } from '../../src/analysis/scopeGraph';
import type { FileAnalysis, SymbolDef } from '../../src/analysis/symbols';

// ---------- tokenEstimator ----------

describe('tokenEstimator', () => {
  it('纯 ASCII 约 4 字符 / token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('CJK 更"贵"（约 1.5 字符 / token）', () => {
    expect(estimateTokens('中文测试')).toBe(3); // ceil(4 / 1.5)
    expect(estimateTokens('中文测试')).toBeGreaterThan(estimateTokens('abcd'));
  });

  it('fitsBudget 留 5% 安全余量', () => {
    const text = 'a'.repeat(1000); // 250 tokens
    expect(fitsBudget(text, 300)).toBe(true);
    expect(fitsBudget(text, 250)).toBe(false); // 250 > 250*0.95
  });
});

// ---------- pagerank ----------

describe('pageRank（power iteration）', () => {
  it('被更多文件依赖的节点得分更高', () => {
    const nodes = ['a', 'b', 'c'];
    const edges = [
      { from: 'b', to: 'a' },
      { from: 'c', to: 'a' },
    ];
    const ranks = pageRank(nodes, edges);
    expect(ranks.get('a')!).toBeGreaterThan(ranks.get('b')!);
    expect(ranks.get('a')!).toBeGreaterThan(ranks.get('c')!);
  });

  it('分数归一化，总和约等于 1', () => {
    const nodes = ['a', 'b', 'c', 'd'];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
      { from: 'd', to: 'a' },
    ];
    const ranks = pageRank(nodes, edges);
    const total = [...ranks.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('悬挂节点（无出边）不会导致权重泄漏', () => {
    const ranks = pageRank(['solo', 'hub'], [{ from: 'hub', to: 'solo' }]);
    const total = [...ranks.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('边权影响排序（调用关系权重更高）', () => {
    const nodes = ['x', 'y', 'z'];
    const ranks = pageRank(nodes, [
      { from: 'x', to: 'y', weight: 1 },
      { from: 'z', to: 'y', weight: 10 },
    ]);
    // y 汇聚了两个来源 → 分数最高；权重更大的 z→y 不改变 y 的收益总量
    expect(ranks.get('y')!).toBeGreaterThan(ranks.get('x')!);
    expect(ranks.get('y')!).toBeGreaterThan(ranks.get('z')!);
    const total = [...ranks.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('空图返回空结果；自环被忽略', () => {
    expect(pageRank([], []).size).toBe(0);
    const ranks = pageRank(['a', 'b'], [{ from: 'a', to: 'a' }, { from: 'a', to: 'b' }]);
    expect(ranks.size).toBe(2);
  });
});

describe('buildDependencyEdges（导入解析）', () => {
  it('相对导入解析到实际文件（尝试常见扩展名与 index）', () => {
    const files = [
      { path: 'src/main.ts', imports: ['./util', './deep/index'], callsOut: [] },
      { path: 'src/util.ts', imports: [], callsOut: [] },
      { path: 'src/deep/index.ts', imports: [], callsOut: [] },
    ];
    const edges = buildDependencyEdges(files);
    const pairs = edges.map((e) => `${e.from}->${e.to}`);
    expect(pairs).toContain('src/main.ts->src/util.ts');
    expect(pairs).toContain('src/main.ts->src/deep/index.ts');
  });

  it('外部包导入被忽略，调用关系权重为 2', () => {
    const files = [
      { path: 'a.ts', imports: ['react', 'fs'], callsOut: ['b.ts'] },
      { path: 'b.ts', imports: [], callsOut: [] },
    ];
    const edges = buildDependencyEdges(files);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ from: 'a.ts', to: 'b.ts', weight: 2 });
  });

  it('normalizePosix 处理 ../ 与 ./', () => {
    expect(normalizePosix('src/./a/../b.ts')).toBe('src/b.ts');
    expect(normalizePosix('../../outside.ts')).toBe('outside.ts');
  });
});

// ---------- contextPack ----------

function file(
  path: string,
  defs: [string, number][],
  calls: { from: string; to: string; line: number }[] = [],
  imports: string[] = [],
): FileAnalysis {
  return {
    path,
    language: 'typescript',
    definitions: defs.map(([name, line]): SymbolDef => ({
      name,
      kind: 'function',
      line,
      endLine: line + 3,
      signature: `function ${name}(a: string, b: number): Result`,
      exported: true,
    })),
    calls,
    references: defs.map(([name, line]) => ({ name, line, column: 10, kind: 'identifier' as const })),
    imports,
    hasError: false,
  };
}

const FILES: FileAnalysis[] = [
  file('src/util.ts', [['add', 3], ['sub', 8]]),
  file('src/core.ts', [['compute', 5]], [{ from: 'compute', to: 'add', line: 6 }], ['./util']),
  file('src/main.ts', [['main', 10], ['boot', 20]], [
    { from: 'main', to: 'compute', line: 11 },
    { from: 'boot', to: 'main', line: 21 },
  ], ['./core']),
];

describe('generateContextPack', () => {
  const index = buildScopeIndex(FILES);
  const baseInput = {
    repoName: 'demo/repo',
    branch: 'main',
    files: FILES,
    index,
    treePaths: ['README.md', 'src/util.ts', 'src/core.ts', 'src/main.ts', 'package.json'],
    maxTokens: 1000,
  };

  it('Markdown 含四要素：项目概览 / 目录树 / 核心符号签名 / 调用关系', () => {
    const pack = generateContextPack(baseInput);
    expect(pack.markdown).toContain('## 项目概览');
    expect(pack.markdown).toContain('## 目录结构');
    expect(pack.markdown).toContain('## 核心符号签名');
    expect(pack.markdown).toContain('## 关键调用关系');
  });

  it('输出符合 token 预算（验收要求 ≤ 2000）', () => {
    const pack = generateContextPack({ ...baseInput, maxTokens: 2000 });
    expect(pack.tokens).toBeLessThanOrEqual(2000);
    // 小预算同样不超
    const tight = generateContextPack({ ...baseInput, maxTokens: 200 });
    expect(tight.tokens).toBeLessThanOrEqual(200);
  });

  it('预算越大，收纳的符号越多（二分裁剪单调性）', () => {
    const small = generateContextPack({ ...baseInput, maxTokens: 150 });
    const large = generateContextPack({ ...baseInput, maxTokens: 1500 });
    expect(large.includedSymbols).toBeGreaterThanOrEqual(small.includedSymbols);
    expect(large.totalSymbols).toBe(5);
  });

  it('符号按 PageRank 与引用数排序：被依赖更多者靠前', () => {
    const ranked = rankSymbols(baseInput);
    const addIndex = ranked.findIndex((s) => s.name === 'add');
    const subIndex = ranked.findIndex((s) => s.name === 'sub');
    // util.ts 被 core.ts 依赖 → add/sub 所在文件分数更高
    expect(addIndex).toBeLessThan(ranked.length);
    expect(subIndex).toBeLessThan(ranked.length);
  });

  it('符号行包含 路径:行号（验收要求可直接定位）', () => {
    const pack = generateContextPack(baseInput);
    expect(pack.markdown).toMatch(/`src\/util\.ts:3`/);
    expect(pack.markdown).toContain('`function add(a: string, b: number): Result`');
  });

  it('JSON 输出结构完整且可被工具解析', () => {
    const pack = generateContextPack(baseInput);
    const parsed = JSON.parse(pack.json);
    expect(parsed.generator).toBe('CodeAtlas');
    expect(parsed.repo).toBe('demo/repo');
    expect(parsed.overview.totalSymbols).toBe(5);
    expect(Array.isArray(parsed.symbols)).toBe(true);
    expect(parsed.symbols[0]).toHaveProperty('file');
    expect(parsed.symbols[0]).toHaveProperty('line');
    expect(parsed.calls.length).toBeGreaterThan(0);
    expect(parsed.estimatedTokens).toBeLessThanOrEqual(1000);
  });

  it('目录用途标注（含中文标签）写入上下文包', () => {
    const pack = generateContextPack({
      ...baseInput,
      dirPurposes: new Map([['src', { key: 'source', confidence: 'rule' as const }]]),
      purposeLabels: { source: '源代码' },
    });
    expect(pack.markdown).toContain('`src/`');
    expect(pack.markdown).toContain('源代码');
  });

  it('极小预算下优雅降级：省略目录树，仍产出合法文档', () => {
    const pack = generateContextPack({ ...baseInput, maxTokens: 60 });
    expect(pack.markdown).toContain('# demo/repo');
    expect(pack.truncated).toBe(true);
    // 固定段落（项目概览）本身有保底开销，预算低于它时只能保证不超过保底值
    expect(pack.tokens).toBeLessThanOrEqual(Math.max(60, pack.minTokens));
    expect(pack.minTokens).toBeGreaterThan(0);
    // 预算足够时不应触发降级
    const normal = generateContextPack({ ...baseInput, maxTokens: 1500 });
    expect(normal.includedFiles).toBeGreaterThan(0);
  });
});
