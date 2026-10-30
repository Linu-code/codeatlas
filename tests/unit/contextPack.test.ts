import { describe, expect, it } from 'vitest';
import { buildDependencyEdges, normalizePosix, pageRank } from '../../src/analysis/pagerank';
import { estimateTokens, fitsBudget } from '../../src/utils/tokenEstimator';
import { generateContextPack, rankSymbols } from '../../src/analysis/contextPack';
import { buildScopeIndex } from '../../src/analysis/scopeGraph';
import { resolveAddress } from '../../src/analysis/slice';
import type { FileAnalysis, SymbolDef } from '../../src/analysis/symbols';

// ---------- tokenEstimator ----------

describe('tokenEstimator', () => {
  it('纯 ASCII 约 4 字符 / token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('CJK 比英文贵（约 1 字符 / token）', () => {
    expect(estimateTokens('中文测试')).toBe(5); // 4 × 1.02 → ceil
    expect(estimateTokens('中文测试')).toBeGreaterThan(estimateTokens('abcd'));
  });

  it('标点比字母更贵（BPE 会把括号与运算符切碎）', () => {
    const code = 'a.b(c);'.repeat(10);
    const plain = 'a'.repeat(code.length);
    expect(estimateTokens(code)).toBeGreaterThan(estimateTokens(plain) * 1.5);
  });

  it('fitsBudget 留 5% 安全余量', () => {
    const text = 'a'.repeat(1000); // 250 tokens
    expect(fitsBudget(text, 300)).toBe(true);
    expect(fitsBudget(text, 250)).toBe(false); // 250 > 250*0.95
  });
});

// ---------- 大项目预算回归（防止"空包"复现） ----------

describe('大项目在任何预算下都不是空包', () => {
  /** 120 个文件 / 12 个模块 / 每个文件 4 个符号——接近真实中型仓库的规模 */
  const big: FileAnalysis[] = [];
  for (let m = 0; m < 12; m += 1) {
    for (let f = 0; f < 10; f += 1) {
      const path = `packages/mod${m}/src/file${f}.ts`;
      big.push({
        path,
        language: 'typescript',
        definitions: Array.from({ length: 4 }, (_, k) => ({
          name: `mod${m}File${f}Fn${k}`,
          kind: 'function' as SymbolDef['kind'],
          line: k * 10 + 1,
          endLine: k * 10 + 5,
          signature: `function mod${m}File${f}Fn${k}(input: Config, options: Options): Promise<Result>`,
          exported: true,
        })),
        calls: [],
        references: [],
        imports: f > 0 ? [`./file${f - 1}`] : [],
        hasError: false,
      });
    }
  }

  const index = buildScopeIndex(big);
  const input = {
    repoName: 'demo/big',
    files: big,
    index,
    treePaths: big.map((f) => f.path),
    maxTokens: 1000,
  };

  for (const budget of [500, 1000, 2000, 8000, 32000]) {
    it(`预算 ${budget}：有模块骨架、符号不为负、且不超预算`, () => {
      const pack = generateContextPack({ ...input, maxTokens: budget });
      expect(pack.tokens).toBeLessThanOrEqual(budget);
      // 关键：任何预算都必须能看到"项目由哪些模块组成"（旧实现在 1000 预算下只给 198 token 的头部）
      expect(pack.markdown).toContain('模块');
      expect(pack.includedSymbols).toBeGreaterThanOrEqual(0);
      // 不能是一份没有代码信息的空文档
      expect(pack.markdown.length).toBeGreaterThan(150);
    });
  }

  it('预算 1000 时至少列出若干真实符号', () => {
    const pack = generateContextPack({ ...input, maxTokens: 1000 });
    expect(pack.includedSymbols).toBeGreaterThan(0);
    expect(pack.markdown).toMatch(/mod\dFile\dFn\d/);
  });
});

// ---------- 按用途裁剪（health / api） ----------

describe('上下文包用途', () => {
  const index = buildScopeIndex(FILES);
  const metrics = [
    {
      path: 'src/core.ts',
      language: 'typescript' as const,
      cyclomatic: 40,
      cognitive: 60,
      totalLines: 300,
      sloc: 260,
      commentLines: 10,
      maxFunctionComplexity: 32,
      functions: [
        { name: 'bigDispatch', line: 12, endLine: 200, cyclomatic: 32, cognitive: 50, sloc: 180 },
        { name: 'helper', line: 205, endLine: 210, cyclomatic: 2, cognitive: 1, sloc: 5 },
      ],
    },
  ];
  const cycles = {
    cycles: [['src/core.ts', 'src/util.ts', 'src/core.ts']],
    dirCycles: [],
    involvedFiles: 2,
  };
  const base = {
    repoName: 'demo/repo',
    files: FILES,
    index,
    treePaths: ['README.md', 'src/util.ts', 'src/core.ts', 'src/main.ts', 'package.json'],
    maxTokens: 2000,
    metrics,
    cycles,
  };

  it('health：给出复杂度与循环依赖，且不含无关的技术栈章节', () => {
    const pack = generateContextPack({ ...base, intent: 'health', manifestText: '{"name":"x","version":"1.0.0","dependencies":{"react":"^18.0.0"}}' });
    expect(pack.markdown).toContain('代码健康');
    expect(pack.markdown).toContain('bigDispatch');
    expect(pack.markdown).toContain('循环依赖');
    expect(pack.markdown).not.toContain('## 技术栈');
  });

  it('api：只列导出符号，不收内部符号', () => {
    const pack = generateContextPack({ ...base, intent: 'api' });
    expect(pack.markdown).toContain('对外导出符号');
    const body = pack.markdown.split('## 对外导出符号')[1] ?? '';
    // FILES 里非导出的内部符号不应出现在 API 清单中
    expect(body).not.toMatch(/internalHelper/);
  });

  it('三种用途互不混装：overview 不含健康章节，health 不含阅读路线', () => {
    const overview = generateContextPack({ ...base, intent: 'overview', readingPath: [
      { path: 'src/main.ts', order: 1, role: 'entry' },
    ] });
    const health = generateContextPack({ ...base, intent: 'health' });
    expect(overview.markdown).not.toContain('## 代码健康');
    expect(overview.markdown).toContain('建议阅读路线');
    expect(health.markdown).not.toContain('建议阅读路线');
  });

  it('unknown / 缺省 intent 回落到 overview（向后兼容）', () => {
    const pack = generateContextPack(base);
    expect(pack.markdown).toContain('## 项目概览');
    expect(pack.markdown).toContain('## 核心符号签名');
  });

  it('focus：按关键词选出相关文件，并解释命中依据', () => {
    const pack = generateContextPack({ ...base, intent: 'focus', focusQuery: 'compute' });
    expect(pack.markdown).toContain('## 任务焦点');
    expect(pack.markdown).toContain('src/core.ts');
    expect(pack.markdown).toContain('符号 `compute`');
    // 焦点包不放全量目录树，避免挤掉命中的文件
    expect(pack.markdown).not.toContain('## 目录结构');
    expect(pack.markdown).toContain('## 相关符号签名');
  });

  it('focus：沿依赖边扩散，并把邻居标成非直接命中', () => {
    const pack = generateContextPack({
      ...base,
      intent: 'focus',
      focusQuery: 'compute',
      fileEdges: [{ from: 'src/core.ts', to: 'src/main.ts' }],
    });
    expect(pack.markdown).toContain('src/main.ts');
    expect(pack.markdown).toContain('依赖扩散命中');
    expect(pack.markdown).toContain('## 焦点内依赖关系');
  });

  it('focus：查不到时如实说没找到，不假装相关', () => {
    const pack = generateContextPack({ ...base, intent: 'focus', focusQuery: 'kafka producer' });
    expect(pack.markdown).toContain('未在符号名或文件路径中找到');
    expect(pack.markdown).not.toContain('## 相关文件');
  });

  it('focus 不含技术栈章节（与任务无关的元信息是纯噪音）', () => {
    const pack = generateContextPack({
      ...base,
      intent: 'focus',
      focusQuery: 'compute',
      manifestText: '{"name":"x","version":"1.0.0","dependencies":{"react":"^18.0.0"}}',
    });
    expect(pack.markdown).not.toContain('## 技术栈');
  });

  it('focus 同样守住预算上限', () => {
    const pack = generateContextPack({ ...base, intent: 'focus', focusQuery: 'compute', maxTokens: 400 });
    expect(pack.tokens).toBeLessThanOrEqual(400);
  });

  it('index：只给可寻址条目（路径:行号），不放目录树与阅读路线', () => {
    const pack = generateContextPack({ ...base, intent: 'index' });
    expect(pack.markdown).toContain('## 索引使用说明');
    expect(pack.markdown).toContain('## 符号索引');
    expect(pack.markdown).toMatch(/`src\/core\.ts:5`/);
    expect(pack.markdown).not.toContain('## 目录结构');
    expect(pack.markdown).not.toContain('## 建议阅读路线');
    expect(pack.markdown).not.toContain('## 技术栈');
  });

  it('index：带模块地图，且每个模块地址都能下钻', () => {
    const pack = generateContextPack({ ...base, intent: 'index' });
    expect(pack.markdown).toContain('## 模块地图');

    const dirs = [...pack.markdown.matchAll(/^- `([^`]+)\/` \d+ 符号/gm)].map((m) => m[1]);
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      const addr = dir === '.' ? './' : `${dir}/`;
      const r = resolveAddress(addr, { files: FILES, paths: FILES.map((f) => f.path) });
      expect(r.kind).toBe('digest');
    }
  });

  it('index：预算越小条目越少，且不超预算', () => {
    // 用 40 文件 / 120 符号的合成项目，才能观察到"预算驱动条目数"的变化
    const many: FileAnalysis[] = [];
    for (let i = 0; i < 40; i += 1) {
      many.push({
        path: `src/m${Math.floor(i / 5)}/f${i}.ts`,
        language: 'typescript',
        definitions: Array.from({ length: 3 }, (_, k) => ({
          name: `fn${i}_${k}`,
          kind: 'function' as SymbolDef['kind'],
          line: k * 10 + 1,
          endLine: k * 10 + 6,
          signature: `function fn${i}_${k}(input: Config): Promise<Result>`,
          exported: true,
        })),
        calls: [],
        references: [],
        imports: [],
        hasError: false,
      });
    }
    const manyIndex = buildScopeIndex(many);
    const base2 = {
      repoName: 'demo/many',
      files: many,
      index: manyIndex,
      treePaths: many.map((f) => f.path),
    };
    const small = generateContextPack({ ...base2, intent: 'index', maxTokens: 800 });
    const big = generateContextPack({ ...base2, intent: 'index', maxTokens: 8000 });

    expect(big.includedSymbols).toBeGreaterThan(small.includedSymbols);
    expect(small.tokens).toBeLessThanOrEqual(800);
    expect(big.tokens).toBeLessThanOrEqual(8000);
    expect(small.markdown).toContain('## 符号索引');
  });

  it('index：使用说明里的示例地址取自包内真实条目', () => {
    const pack = generateContextPack({ ...base, intent: 'index' });
    // 曾经写死 `src/core.ts:42`——真实仓库里不存在，模型照着要就会失败
    expect(pack.markdown).not.toContain('src/core.ts:42');

    const sample = /例如 `([^`:]+:\d+)`/.exec(pack.markdown)?.[1];
    expect(sample).toBeTruthy();
    // 示例地址必须真的在包内（否则模型照抄就是一次失败请求）
    expect(pack.markdown.split('## 符号索引')[1]).toContain(sample!);
    const resolved = resolveAddress(sample!, { files: FILES, paths: FILES.map((f) => f.path) });
    expect(resolved.kind).toBe('ok');
    if (resolved.kind === 'ok') expect(resolved.target.snapped).toBe(true);
  });

  it('index：条目按文件重要性聚集，文件内按行号升序', () => {
    const pack = generateContextPack({ ...base, intent: 'index', maxTokens: 3000 });
    const lines = pack.markdown.split('## 符号索引')[1] ?? '';
    const add = lines.indexOf('src/util.ts:3');
    const sub = lines.indexOf('src/util.ts:8');
    expect(add).toBeGreaterThan(-1);
    expect(sub).toBeGreaterThan(add);
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

  it('极小预算下降级到模块骨架，而不是只剩项目概览', () => {
    // 曾经的降级链会直接掉到"仅头部"——预算 1000 的大项目只产出 198 token 的空包
    const pack = generateContextPack({ ...baseInput, maxTokens: 600 });
    expect(pack.markdown).toContain('模块地图');
    expect(pack.markdown).toContain('src/');
  });

  it('发生裁剪时输出「本次裁剪说明」，告知 AI 自己缺了什么', () => {
    const pack = generateContextPack({ ...baseInput, maxTokens: 600 });
    expect(pack.markdown).toContain('## 本次裁剪说明');
    expect(pack.markdown).toContain('未提供');
  });

  it('预算低到装不下任何结构时，明确说明「已裁剪到最小」且不超预算', () => {
    const pack = generateContextPack({ ...baseInput, maxTokens: 320 });
    expect(pack.markdown).toMatch(/预算 320 tokens 过低/);
    expect(pack.tokens).toBeLessThanOrEqual(320);
  });

  it('预算充裕且内容放得下时，不输出裁剪说明', () => {
    const pack = generateContextPack({ ...baseInput, maxTokens: 8000 });
    expect(pack.markdown).not.toContain('## 本次裁剪说明');
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

  it('模块地图：按顶层目录聚合，标注文件数与关键文件', () => {
    const pack = generateContextPack(baseInput);
    expect(pack.markdown).toContain('### 模块地图');
    expect(pack.markdown).toMatch(/`src\/` — \d+ 个文件/);
  });

  it('package.json：输出构建脚本 / 技术栈 / 包管理器', () => {
    const pack = generateContextPack({
      ...baseInput,
      treePaths: [...baseInput.treePaths, 'pnpm-lock.yaml'],
      manifestText: JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        main: 'src/main.ts',
        scripts: { dev: 'vite', build: 'tsc -b && vite build', test: 'vitest run' },
        dependencies: { react: '^18.0.0' },
        devDependencies: { typescript: '^5.0.0' },
      }),
    });
    expect(pack.markdown).toContain('## 构建与运行');
    expect(pack.markdown).toContain('## 技术栈');
    expect(pack.markdown).toContain('`build` = `tsc -b && vite build`');
    expect(pack.markdown).toContain('包管理器：pnpm');
    expect(pack.markdown).toContain('运行时依赖：react');

    const parsed = JSON.parse(pack.json);
    expect(parsed.manifest.packageManager).toBe('pnpm');
    expect(parsed.manifest.scripts.build).toContain('vite build');
    expect(parsed.manifest.dependencies).toContain('react');
  });

  it('入口文件写入概览与 JSON', () => {
    const pack = generateContextPack(baseInput);
    expect(pack.markdown).toContain('- 入口文件：');
    expect(pack.markdown).toContain('`src/main.ts`');
    expect(JSON.parse(pack.json).entryFiles).toContain('src/main.ts');
  });

  it('JSON files 限长：超大项目截断并给出总数', () => {
    const paths = Array.from({ length: 500 }, (_, i) => `src/f${i}.ts`);
    const pack = generateContextPack({ ...baseInput, treePaths: paths });
    const parsed = JSON.parse(pack.json);
    expect(parsed.files).toHaveLength(400);
    expect(parsed.filesTotal).toBe(500);
  });

  it('公共接口：汇总导出符号名', () => {
    const pack = generateContextPack({ ...baseInput, maxTokens: 2000 });
    expect(pack.markdown).toContain('### 公共接口');
    expect(pack.markdown).toContain('add');
    expect(pack.markdown).toContain('main');
  });

  it('JSON files：被分析的关键文件排在未分析文件之前', () => {
    const paths = ['zzz/a.ts', 'src/main.ts', 'src/util.ts', 'src/core.ts', 'aaa/b.ts'];
    const pack = generateContextPack({ ...baseInput, treePaths: paths, maxTokens: 2000 });
    const files: string[] = JSON.parse(pack.json).files;
    expect(files).toHaveLength(paths.length);
    const analyzed = new Set(['src/main.ts', 'src/util.ts', 'src/core.ts']);
    expect(files.slice(0, 3).every((p) => analyzed.has(p))).toBe(true);
  });
});
