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
  it('src 下钻一层，其余取顶层目录，根目录文件归为 (root)', () => {
    expect(moduleOf('a.ts')).toBe('(root)');
    // src 是几乎所有人的包裹层，只取第一段会把整份代码折叠成一个节点
    expect(moduleOf('src/utils/a.ts')).toBe('src/utils');
    expect(moduleOf('src/components/ui/Button.tsx')).toBe('src/components');
    // src 根下的文件仍归 src（入口层）
    expect(moduleOf('src/index.ts')).toBe('src');
    // 非 src 包裹层保持原样
    expect(moduleOf('lib/router/index.js')).toBe('lib');
    // monorepo：模块边界是包，不是 packages/ 容器
    expect(moduleOf('packages/core/src/a.ts')).toBe('packages/core');
    expect(moduleOf('packages/core/index.ts')).toBe('packages/core');
  });
});

describe('buildModuleGraph', () => {
  const files = [
    mkFile('src/app.ts', ['./components/Button', '../lib/core']),
    mkFile('src/components/Button.tsx', ['../../lib/core']),
    mkFile('lib/core.ts'),
    mkFile('docs/guide.md'),
  ];

  it('把文件折叠到模块并聚合边权', () => {
    const g = buildModuleGraph(files);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['docs', 'lib', 'src', 'src/components']);
    // src/app.ts → lib/core.ts
    expect(g.edges).toContainEqual({ from: 'src', to: 'lib', weight: 1 });
    // src/components/Button.tsx → lib/core.ts
    expect(g.edges).toContainEqual({ from: 'src/components', to: 'lib', weight: 1 });
  });

  it('同模块内部依赖不计入模块边', () => {
    const g = buildModuleGraph([mkFile('src/a.ts', ['./b']), mkFile('src/b.ts')]);
    expect(g.edges).toHaveLength(0);
  });

  it('保留文件级边供环检测使用', () => {
    const g = buildModuleGraph(files);
    expect(g.fileEdges).toContainEqual({ from: 'src/app.ts', to: 'lib/core.ts' });
    expect(g.parsedFiles).toBe(4);
  });

  it('目录明细可按需下钻', () => {
    const g = buildModuleGraph(files);
    const srcEdges = g.edgesByDir.get('src') ?? [];
    expect(srcEdges.map((e) => e.to).sort()).toEqual(['lib', 'src/components']);
    expect(srcEdges.find((e) => e.to === 'lib')?.files).toHaveLength(1);
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
