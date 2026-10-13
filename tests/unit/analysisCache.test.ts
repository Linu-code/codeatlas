/**
 * 分析结果缓存（N4）—— 纯函数与键设计
 *
 * 真实 IndexedDB 读写依赖浏览器环境（E2E 覆盖），这里专注纯逻辑：
 *   · 键设计：repoKey::hash
 *   · 校验语义：版本 / 哈希 / 路径 三重核对，任一不符视为未命中
 *   · payload 组装：版本号 + 指纹 + 分析结果
 *   · Node 环境无 IndexedDB 时安全降级（不抛异常）
 */

import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_FORMAT_VERSION,
  analysisCacheKey,
  analysisKey,
  buildCachedRecord,
  resolveCachedRecord,
  getCachedAnalysis,
} from '../../src/analysis/analysisCache';
import type { FileAnalysis } from '../../src/analysis/langs/types';
import type { FileMetrics } from '../../src/analysis/metrics';

const FA: FileAnalysis = {
  path: 'src/a.ts',
  language: 'typescript',
  definitions: [{ name: 'foo', kind: 'function', line: 1, endLine: 3, signature: 'function foo()', exported: true }],
  calls: [],
  references: [],
  imports: [],
  hasError: false,
};

const FM: FileMetrics = {
  path: 'src/a.ts',
  language: 'typescript',
  cyclomatic: 1,
  cognitive: 1,
  totalLines: 3,
  sloc: 3,
  commentLines: 0,
  functions: [],
  maxFunctionComplexity: 0,
};

describe('analysisCache 键设计', () => {
  it('键为 repoKey::hash 拼接', () => {
    expect(analysisKey('o/r@main', 'aabbccdd')).toBe('o/r@main::aabbccdd');
  });

  it('analysisCacheKey 用内容哈希生成指纹', () => {
    const k = analysisCacheKey('o/r@main', 'const x = 1;');
    expect(k.startsWith('o/r@main::')).toBe(true);
    expect(k.length).toBe('o/r@main::'.length + 8);
  });
});

describe('resolveCachedRecord 三重校验', () => {
  it('全部一致 → 命中', () => {
    const rec = buildCachedRecord('abc12345', FA, FM);
    const hit = resolveCachedRecord(rec, 'abc12345', 'src/a.ts');
    expect(hit).not.toBeNull();
    expect(hit?.analysis.definitions[0].name).toBe('foo');
    expect(hit?.metrics?.sloc).toBe(3);
  });

  it('版本不符 → 未命中（结构升级后旧缓存失效）', () => {
    const rec = { ...buildCachedRecord('abc12345', FA, FM), v: ANALYSIS_FORMAT_VERSION + 1 };
    expect(resolveCachedRecord(rec, 'abc12345', 'src/a.ts')).toBeNull();
  });

  it('哈希不符 → 未命中（内容已变）', () => {
    const rec = buildCachedRecord('abc12345', FA, FM);
    expect(resolveCachedRecord(rec, 'different', 'src/a.ts')).toBeNull();
  });

  it('路径不符 → 未命中（键冲突防御）', () => {
    const rec = buildCachedRecord('abc12345', FA, FM);
    expect(resolveCachedRecord(rec, 'abc12345', 'src/other.ts')).toBeNull();
  });

  it('非对象 / null → 未命中', () => {
    expect(resolveCachedRecord(null, 'abc12345', 'src/a.ts')).toBeNull();
    expect(resolveCachedRecord(undefined, 'abc12345', 'src/a.ts')).toBeNull();
    expect(resolveCachedRecord('oops', 'abc12345', 'src/a.ts')).toBeNull();
  });

  it('metrics 缺失时仍命中（旧数据兼容）', () => {
    const rec = buildCachedRecord('abc12345', FA, null);
    const hit = resolveCachedRecord(rec, 'abc12345', 'src/a.ts');
    expect(hit).not.toBeNull();
    expect(hit?.metrics).toBeNull();
  });
});

describe('buildCachedRecord payload', () => {
  it('携带当前格式版本与哈希', () => {
    const rec = buildCachedRecord('deadbeef', FA, FM);
    expect(rec.v).toBe(ANALYSIS_FORMAT_VERSION);
    expect(rec.hash).toBe('deadbeef');
    expect(rec.analysis.path).toBe('src/a.ts');
    expect(rec.metrics).toEqual(FM);
  });
});

describe('无 IndexedDB 降级', () => {
  it('Node 环境 getCachedAnalysis 安全返回 null，不抛异常', async () => {
    await expect(getCachedAnalysis('o/r@main', 'abc12345', 'src/a.ts')).resolves.toBeNull();
  });
});
