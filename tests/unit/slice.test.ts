import { describe, expect, it } from 'vitest';
import { formatSlice, resolveAddress, type ResolveContext } from '../../src/analysis/slice';
import type { FileAnalysis } from '../../src/analysis/symbols';

function file(path: string, defs: [string, number, number][]): FileAnalysis {
  return {
    path,
    language: 'typescript',
    definitions: defs.map(([name, line, endLine]) => ({
      name,
      kind: 'function' as const,
      line,
      endLine,
      signature: `function ${name}()`,
      exported: true,
    })),
    calls: [],
    references: [],
    imports: [],
    hasError: false,
  };
}

const ctx: ResolveContext = {
  files: [
    file('src/core.ts', [['compute', 5, 20], ['helper', 30, 34]]),
    file('src/a/util.ts', [['shared', 3, 6]]),
    file('lib/b/util.ts', [['shared', 9, 12]]),
  ],
  paths: ['src/core.ts', 'src/a/util.ts', 'lib/b/util.ts', 'docs/readme.md'],
};

describe('resolveAddress', () => {
  it('解析 路径:行号 与 行段', () => {
    const one = resolveAddress('src/core.ts:42', ctx);
    expect(one).toEqual({ kind: 'ok', target: { path: 'src/core.ts', startLine: 42, endLine: 42, label: 'src/core.ts:42' } });

    const range = resolveAddress('src/core.ts:10-30', ctx);
    expect(range.kind).toBe('ok');
    if (range.kind === 'ok') {
      expect(range.target.startLine).toBe(10);
      expect(range.target.endLine).toBe(30);
    }
  });

  it('解析 路径#符号，取到符号的真实结束行', () => {
    const r = resolveAddress('src/core.ts#compute', ctx);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.target).toMatchObject({ startLine: 5, endLine: 20, label: 'compute' });
    }
  });

  it('只有路径时表示整个文件（结束行不限）', () => {
    const r = resolveAddress('docs/readme.md', ctx);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.target.endLine).toBe(Number.POSITIVE_INFINITY);
  });

  it('路径可只写后缀，唯一时补全', () => {
    const r = resolveAddress('core.ts:7', ctx);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.target.path).toBe('src/core.ts');
  });

  it('后缀匹配到多个文件时返回候选，不猜', () => {
    const r = resolveAddress('util.ts:1', ctx);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates.map((c) => c.path)).toEqual(['src/a/util.ts', 'lib/b/util.ts']);
  });

  it('裸符号名唯一时解析，多义时返回候选', () => {
    const only = resolveAddress('compute', ctx);
    expect(only.kind).toBe('ok');
    if (only.kind === 'ok') expect(only.target).toMatchObject({ path: 'src/core.ts', startLine: 5, endLine: 20 });

    const multi = resolveAddress('shared', ctx);
    expect(multi.kind).toBe('ambiguous');
    if (multi.kind === 'ambiguous') expect(multi.candidates).toHaveLength(2);
  });

  it('容忍复制时带上的反引号与中文标点', () => {
    expect(resolveAddress('`src/core.ts:42`', ctx).kind).toBe('ok');
    expect(resolveAddress('src/core.ts:42，', ctx).kind).toBe('ok');
  });

  it('无法解析时明确返回 invalid', () => {
    expect(resolveAddress('', ctx)).toEqual({ kind: 'invalid', reason: 'empty' });
    expect(resolveAddress('   ', ctx)).toEqual({ kind: 'invalid', reason: 'empty' });
    expect(resolveAddress('src/nope.ts:1', ctx)).toEqual({ kind: 'invalid', reason: 'not-found' });
    expect(resolveAddress('src/core.ts:0', ctx)).toEqual({ kind: 'invalid', reason: 'not-found' });
    expect(resolveAddress('notARealSymbol', ctx)).toEqual({ kind: 'invalid', reason: 'not-found' });
  });
});

describe('formatSlice', () => {
  const source = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');

  it('按行段切出并保留行号', () => {
    const r = formatSlice(source, { path: 'src/core.ts', startLine: 10, endLine: 12, label: 'x' });
    expect(r.text).toContain('// src/core.ts:10-12（3 行，共 100 行）');
    expect(r.text).toContain('10 | line 10');
    expect(r.text).toContain('12 | line 12');
    expect(r.text).not.toContain('13 | line 13');
    expect(r.truncated).toBe(false);
  });

  it('单行地址自动带上下文（否则只有一行没有信息）', () => {
    const r = formatSlice(source, { path: 'a.ts', startLine: 20, endLine: 20, label: 'a.ts:20' }, { contextLines: 3 });
    expect(r.startLine).toBe(20);
    expect(r.endLine).toBe(23);
    expect(r.text).toContain('23 | line 23');
  });

  it('超出 token 预算时从尾部收缩并标注截断', () => {
    const r = formatSlice(source, { path: 'a.ts', startLine: 1, endLine: 100, label: 'a.ts' }, { maxTokens: 60 });
    expect(r.truncated).toBe(true);
    expect(r.endLine).toBeLessThan(100);
    expect(r.text).toContain('已按 token 预算截断');
    expect(r.text).toContain('完整范围 a.ts:1-100');
  });

  it('结束行超过文件长度时自动夹紧', () => {
    const r = formatSlice(source, { path: 'a.ts', startLine: 95, endLine: 200, label: 'a.ts' });
    expect(r.endLine).toBe(100);
    expect(r.totalLines).toBe(100);
  });

  it('整文件（Infinity）取全文，超预算仍会截断', () => {
    const r = formatSlice(source, { path: 'a.ts', startLine: 1, endLine: Number.POSITIVE_INFINITY, label: 'a.ts' });
    expect(r.endLine).toBe(100);
    expect(r.truncated).toBe(false);
  });
});
