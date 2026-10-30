import { describe, expect, it } from 'vitest';
import { buildDirectoryDigest, buildFileSymbolIndex, buildModuleMap, normalizeDir } from '../../src/analysis/hierarchy';
import type { FileAnalysis } from '../../src/analysis/symbols';

function file(path: string, defs: [string, number][]): FileAnalysis {
  return {
    path,
    language: 'typescript',
    definitions: defs.map(([name, line]) => ({
      name,
      kind: 'function' as const,
      line,
      endLine: line + 5,
      signature: `function ${name}()`,
      exported: true,
    })),
    calls: [],
    references: [],
    imports: [],
    hasError: false,
  };
}

const files = [
  file('src/core.ts', [['compute', 5], ['helper', 30]]),
  file('src/util.ts', [['add', 3]]),
  file('src/analysis/slice.ts', [['resolveAddress', 12], ['formatSlice', 197]]),
  file('test/core.test.ts', [['t1', 1]]),
  file('index.ts', [['main', 1]]),
];

describe('normalizeDir', () => {
  it('去掉 ./ 与首尾斜杠，根目录为空串', () => {
    expect(normalizeDir('./src/')).toBe('src');
    expect(normalizeDir('/')).toBe('');
    expect(normalizeDir('.')).toBe('');
    expect(normalizeDir('src\\analysis')).toBe('src/analysis');
  });
});

describe('buildDirectoryDigest', () => {
  it('给出子目录、文件与符号数，并带可继续寻址的地址', () => {
    const d = buildDirectoryDigest('src', files);
    expect(d.text).toContain('// 目录 src/ — 3 个文件 / 5 个符号');
    expect(d.text).toContain('## 子目录');
    expect(d.text).toContain('`src/analysis/` 1 文件 / 2 符号');
    expect(d.text).toContain('## 文件');
    expect(d.text).toContain('`src/core.ts` 2 符号');
    // 关键符号带地址，能继续下钻到代码
    expect(d.text).toContain('`src/core.ts:5` compute');
  });

  it('根目录用 ./ 表示，不混入无关目录', () => {
    const d = buildDirectoryDigest('', files);
    expect(d.text).toContain('(仓库根)');
    expect(d.text).toContain('`index.ts`');
    expect(d.fileCount).toBe(5);
  });

  it('超预算时先砍关键符号细节，保住文件清单', () => {
    const d = buildDirectoryDigest('src', files, { maxTokens: 40 });
    expect(d.truncated).toBe(true);
    expect(d.text).toContain('`src/core.ts`');
    expect(d.text).not.toContain(':5` compute');
  });
});

describe('buildFileSymbolIndex', () => {
  it('列出文件内全部符号及地址', () => {
    const r = buildFileSymbolIndex('src/analysis/slice.ts', files);
    expect(r?.symbolCount).toBe(2);
    expect(r?.text).toContain('// 文件 src/analysis/slice.ts — 2 个符号');
    expect(r?.text).toContain('`src/analysis/slice.ts:12` resolveAddress');
    expect(r?.text).toContain('`src/analysis/slice.ts:197` formatSlice');
  });

  it('文件不存在时返回 null', () => {
    expect(buildFileSymbolIndex('src/nope.ts', files)).toBeNull();
  });
});

describe('buildModuleMap', () => {
  const ranked = [
    { name: 't1', file: 'test/core.test.ts', line: 1 },
    { name: 'main', file: 'index.ts', line: 1 },
    { name: 'compute', file: 'src/core.ts', line: 5 },
  ];

  it('按模块聚合，根目录写作 ./', () => {
    const m = buildModuleMap(files, ranked);
    expect(m.text).toContain('`./` 1 符号');
    expect(m.text).toContain('`src/` 3 符号');
    expect(m.text).toContain('`src/analysis/` 2 符号');
    expect(m.moduleCount).toBe(4);
  });

  it('测试模块排在最后（否则 test/ 的符号数会压过实现）', () => {
    const m = buildModuleMap(files, ranked);
    const lines = m.text.split('\n');
    const testAt = lines.findIndex((l) => l.includes('`test/`'));
    const srcAt = lines.findIndex((l) => l.includes('`src/`'));
    expect(testAt).toBeGreaterThan(srcAt);
  });

  it('每个模块最多列 3 个关键符号', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, file: 'src/core.ts', line: i + 1 }));
    const m = buildModuleMap(files, many, { symbolsPerModule: 3 });
    const line = m.text.split('\n').find((l) => l.includes('`src/`'))!;
    expect(line.split('—')[1].split('、')).toHaveLength(3);
  });
});
