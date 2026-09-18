import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { configureParserEnv, parseCode, type LangId } from '../../src/analysis/parser';
import { extractFile, type FileAnalysis } from '../../src/analysis/symbols';
import {
  buildScopeIndex,
  findReferences,
  findSymbol,
  gotoDefinition,
  indexStats,
  suggestSymbols,
} from '../../src/analysis/scopeGraph';

const require = createRequire(import.meta.url);

beforeAll(() => {
  const wtDir = path.dirname(require.resolve('web-tree-sitter'));
  const grammarDir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
  configureParserEnv({
    runtimeWasm: () => path.join(wtDir, 'tree-sitter.wasm'),
    // 入参是语法包名（grammarFileName 已由 parser 内部换算）
    grammarWasm: (grammar) => path.join(grammarDir, `tree-sitter-${grammar}.wasm`),
  });
});

async function analyze(path: string, code: string, lang: LangId): Promise<FileAnalysis> {
  const parsed = await parseCode(code, lang);
  if (!parsed) throw new Error(`parse failed: ${path}`);
  return extractFile(parsed.rootNode, path, lang);
}

const UTIL = `
export function add(a: number, b: number) { return a + b; }
export function sub(a: number, b: number) { return a - b; }
`;

const MAIN = `
import { add, sub } from './util';

export function total(xs: number[]): number {
  let sum = 0;
  for (const x of xs) sum = add(sum, x);
  return sum;
}

function diff(a: number, b: number) {
  return sub(a, b);
}
`;

describe('buildScopeIndex（跨文件符号索引）', () => {
  it('索引定义与引用，跨文件可定位', async () => {
    const files = [
      await analyze('src/util.ts', UTIL, 'typescript'),
      await analyze('src/main.ts', MAIN, 'typescript'),
    ];
    const index = buildScopeIndex(files);

    const add = findSymbol(index, 'add');
    expect(add).not.toBeNull();
    // 定义在 util.ts
    expect(add!.definitions.map((d) => d.file)).toContain('src/util.ts');
    // 引用出现在 main.ts 的调用点
    expect(add!.references.some((r) => r.file === 'src/main.ts')).toBe(true);
    // 至少跨 2 个文件
    expect(add!.fileCount).toBeGreaterThanOrEqual(2);
  });

  it('定义位置不会重复出现在引用列表里', async () => {
    const files = [await analyze('src/util.ts', UTIL, 'typescript')];
    const index = buildScopeIndex(files);
    const sub = findSymbol(index, 'sub')!;
    for (const def of sub.definitions) {
      const sameLineRefs = sub.references.filter((r) => r.file === def.file && r.line === def.line);
      expect(sameLineRefs).toHaveLength(0);
    }
  });

  it('gotoDefinition 同文件优先', async () => {
    const dup = `
function shared() { return 1; }
function caller() { return shared(); }
`;
    const other = `export function shared() { return 2; }`;
    const files = [
      await analyze('a.ts', dup, 'typescript'),
      await analyze('b.ts', other, 'typescript'),
    ];
    const index = buildScopeIndex(files);
    const fromA = gotoDefinition(index, 'shared', 'a.ts');
    expect(fromA?.file).toBe('a.ts');
    // 无 currentFile 时按文件名字典序取第一个
    const any = gotoDefinition(index, 'shared');
    expect(any?.file).toBe('a.ts');
  });

  it('findReferences 返回稳定排序（文件 → 行 → 列）', async () => {
    const files = [
      await analyze('src/util.ts', UTIL, 'typescript'),
      await analyze('src/main.ts', MAIN, 'typescript'),
    ];
    const index = buildScopeIndex(files);
    const refs = findReferences(index, 'add');
    expect(refs.length).toBeGreaterThan(0);
    const sorted = [...refs].sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
    );
    expect(refs).toEqual(sorted);
    // 每个引用都带合法行列号
    for (const r of refs) {
      expect(r.line).toBeGreaterThan(0);
      expect(r.column).toBeGreaterThan(0);
    }
  });

  it('findReferences 对未知符号返回空数组', async () => {
    const index = buildScopeIndex([await analyze('a.ts', 'export function a() {}', 'typescript')]);
    expect(findReferences(index, 'notExist')).toEqual([]);
    expect(gotoDefinition(index, 'notExist')).toBeNull();
  });

  it('Python 符号同样可索引', async () => {
    const py = `
def helper(x):
    return x + 1

def caller():
    return helper(1)
`;
    const index = buildScopeIndex([await analyze('app.py', py, 'python')]);
    const helper = findSymbol(index, 'helper')!;
    expect(helper.definitions).toHaveLength(1);
    expect(helper.references.some((r) => r.line >= 5)).toBe(true);
  });

  it('语法错误文件计入 failedFiles，不影响索引', async () => {
    const bad = await analyze('broken.ts', 'function ( {', 'typescript');
    const good = await analyze('ok.ts', 'export function fine() {}', 'typescript');
    const index = buildScopeIndex([bad, good]);
    expect(index.failedFiles).toContain('broken.ts');
    expect(findSymbol(index, 'fine')).not.toBeNull();
  });

  it('indexStats 汇总规模', async () => {
    const files = [
      await analyze('src/util.ts', UTIL, 'typescript'),
      await analyze('src/main.ts', MAIN, 'typescript'),
    ];
    const stats = indexStats(buildScopeIndex(files));
    expect(stats.files).toBe(2);
    expect(stats.symbols).toBeGreaterThan(0);
    expect(stats.references).toBeGreaterThan(0);
  });

  it('suggestSymbols 按引用数排序并限制数量', async () => {
    const files = [
      await analyze('src/util.ts', UTIL, 'typescript'),
      await analyze('src/main.ts', MAIN, 'typescript'),
    ];
    const index = buildScopeIndex(files);
    const suggestions = suggestSymbols(index, 'a', 5);
    expect(suggestions.length).toBeLessThanOrEqual(5);
    expect(suggestions.every((s) => s.name.toLowerCase().startsWith('a'))).toBe(true);
    // 引用数多的排前面
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1].references.length).toBeGreaterThanOrEqual(suggestions[i].references.length);
    }
    expect(suggestSymbols(index, '', 5)).toEqual([]);
  });
});
