/**
 * moduleGraph —— 模块（目录）依赖图 + 分层（N3）
 */
import { describe, expect, it } from 'vitest';
import { buildModuleGraph, groupByLayer, moduleOf } from '../../src/analysis/moduleGraph';
import type { FileAnalysis } from '../../src/analysis/symbols';
import type { DirPurpose } from '../../src/analysis/directories';

function mkFile(path: string, imports: string[] = []): FileAnalysis {
  return { path, language: 'typescript', definitions: [], calls: [], references: [], imports, hasError: false };
}

describe('moduleOf', () => {
  it('取顶层目录，根目录文件归为 (root)', () => {
    expect(moduleOf('src/utils/a.ts')).toBe('src');
    expect(moduleOf('a.ts')).toBe('(root)');
  });
});

describe('buildModuleGraph', () => {
  const files = [
    mkFile('src/app.ts', ['./components/Button', '../lib/core']),
    mkFile('src/components/Button.tsx', ['../../lib/core']),
    mkFile('lib/core.ts'),
    mkFile('docs/guide.md'),
  ];

  it('把文件折叠到顶层目录并聚合边权', () => {
    const g = buildModuleGraph(files);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['docs', 'lib', 'src']);
    // src → lib 有两条文件级依赖（app 与 Button 各一条）
    expect(g.edges).toContainEqual({ from: 'src', to: 'lib', weight: 2 });
  });

  it('同目录内部依赖不计入模块边', () => {
    const g = buildModuleGraph(files);
    expect(g.edges.some((e) => e.from === 'src' && e.to === 'src')).toBe(false);
  });

  it('保留文件级边供环检测使用', () => {
    const g = buildModuleGraph(files);
    expect(g.fileEdges).toContainEqual({ from: 'src/app.ts', to: 'lib/core.ts' });
    expect(g.parsedFiles).toBe(4);
  });

  it('目录明细可按需下钻', () => {
    const g = buildModuleGraph(files);
    const srcEdges = g.edgesByDir.get('src') ?? [];
    expect(srcEdges).toHaveLength(1);
    expect(srcEdges[0].to).toBe('lib');
    expect(srcEdges[0].files).toHaveLength(2);
  });

  it('节点按层级与名字排序', () => {
    const g = buildModuleGraph([mkFile('a.ts'), mkFile('src/x.ts'), mkFile('lib/y.ts')]);
    expect(g.nodes.map((n) => n.id)).toEqual(['(root)', 'lib', 'src']);
    expect(g.nodes[0].depth).toBe(0);
  });
});

describe('groupByLayer', () => {
  it('按目录用途聚类（来自 annotateDirectories 的标注）', () => {
    const files = [mkFile('src/a.ts'), mkFile('tests/b.ts'), mkFile('docs/c.md')];
    const purposes = new Map<string, DirPurpose>([
      ['src', { key: 'source', confidence: 'rule' }],
      ['tests', { key: 'tests', confidence: 'rule' }],
      ['docs', { key: 'docs', confidence: 'rule' }],
    ]);
    const g = buildModuleGraph(files, purposes);
    const layers = groupByLayer(g);
    expect(layers.map((l) => l.key).sort()).toEqual(['docs', 'source', 'tests']);
    expect(layers.every((l) => l.files === 1)).toBe(true);
  });

  it('未提供标注时退回规则表，再退回 unknown', () => {
    const files = [mkFile('src/a.ts'), mkFile('weird/b.ts')];
    const g = buildModuleGraph(files);
    const keys = g.nodes.map((n) => n.purpose);
    expect(keys).toContain('source'); // src 命中规则表
    expect(keys).toContain('unknown'); // weird 无法识别
    expect(groupByLayer(g).length).toBeGreaterThanOrEqual(2);
  });
});
