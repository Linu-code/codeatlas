/**
 * report.test.ts —— N5② 报告生成器单测
 * 覆盖：buildReportModel 聚合正确性 + renderReportHtml 离线 HTML 输出
 */
import { describe, expect, it } from 'vitest';
import type { AnalysisState } from '../../src/hooks/useCodeAnalysis';
import type { RepoMeta } from '../../src/types/repo';
import { buildReportModel, renderReportHtml } from '../../src/report/buildReport';

function makeState(): AnalysisState {
  return {
    running: false,
    progress: { parsed: 0, total: 0 },
    incremental: { cached: 0, parsed: 0, failed: 0 },
    files: [],
    metrics: [
      {
        path: 'src/main.ts',
        language: 'typescript',
        cyclomatic: 12,
        cognitive: 30,
        totalLines: 200,
        sloc: 150,
        commentLines: 10,
        functions: [
          { name: 'bootstrap', line: 2, endLine: 40, cyclomatic: 20, cognitive: 35, sloc: 38 },
          { name: 'helper', line: 50, endLine: 70, cyclomatic: 5, cognitive: 8, sloc: 20 },
        ],
        maxFunctionComplexity: 20,
      },
      {
        path: 'src/util.ts',
        language: 'typescript',
        cyclomatic: 3,
        cognitive: 4,
        totalLines: 80,
        sloc: 60,
        commentLines: 5,
        functions: [{ name: 'fmt', line: 3, endLine: 9, cyclomatic: 2, cognitive: 2, sloc: 6 }],
        maxFunctionComplexity: 2,
      },
    ],
    health: { score: 78, avgCyclomatic: 9.67, avgCognitive: 15, highComplexityCount: 2 },
    index: null,
    graph: {
      nodes: [{ id: 'src/main.ts#bootstrap@2', name: 'bootstrap', file: 'src/main.ts', line: 2, kind: 'function', inDegree: 3, outDegree: 2 }],
      edges: [{ from: 'src/main.ts#bootstrap@2', to: 'src/util.ts#fmt@3' }],
      totalNodes: 2,
      truncated: false,
      parsedFiles: 2,
      failedFiles: [],
    },
    mermaid: 'graph LR\n  bootstrap --> fmt',
    readingPath: {
      steps: [
        { path: 'src/main.ts', order: 1, role: 'entry', score: 0.9, inDegree: 0, outDegree: 2 },
        { path: 'src/util.ts', order: 2, role: 'leaf', score: 0.2, inDegree: 1, outDegree: 0 },
      ],
      totalFiles: 2,
      omitted: 0,
      groups: [],
      orderByPath: new Map(),
    },
    moduleGraph: {
      nodes: [{ id: 'src', files: 2, purpose: 'source', depth: 1 }],
      edges: [],
      fileEdges: [],
      filesByDir: new Map(),
      edgesByDir: new Map(),
      parsedFiles: 2,
    },
    cycles: { cycles: [['a.ts', 'b.ts', 'a.ts']], dirCycles: [['src', 'lib', 'src']], involvedFiles: 2, involved: new Set(['a.ts', 'b.ts']) },
    classGraph: { nodes: [{ id: 'src/main.ts#App', name: 'App', file: 'src/main.ts', line: 1, external: false }], edges: [], external: [], ambiguous: [], classCount: 1, truncated: false },
    layers: [{ key: 'source', dirs: ['src'], files: 2 }],
    moduleMermaid: 'graph LR\nsrc',
    classMermaid: 'classDiagram\nclass App',
    empty: false,
    error: null,
  };
}

const META: RepoMeta = { name: 'demo', source: 'local', rootPath: '/tmp/demo' };

describe('buildReportModel', () => {
  it('聚合概览字段', () => {
    const m = buildReportModel(META, makeState());
    expect(m.summary.name).toBe('demo');
    expect(m.summary.source).toBe('local');
    expect(m.summary.filesAnalyzed).toBe(2);
    expect(m.summary.totalSloc).toBe(210);
    expect(m.summary.totalFunctions).toBe(3);
    expect(m.summary.healthScore).toBe(78);
    expect(m.summary.highComplexityCount).toBe(2);
  });

  it('热点文件按 peak 复杂度排序', () => {
    const m = buildReportModel(META, makeState());
    expect(m.topFiles[0].path).toBe('src/main.ts');
    expect(m.topFiles[0].maxFn).toBe(20);
  });

  it('最复杂函数按圈复杂度降序', () => {
    const m = buildReportModel(META, makeState());
    expect(m.topFunctions[0]).toMatchObject({ name: 'bootstrap', cyclomatic: 20 });
  });

  it('阅读路线与循环依赖透传', () => {
    const m = buildReportModel(META, makeState());
    expect(m.readingPath).toHaveLength(2);
    expect(m.readingPath[0]).toMatchObject({ order: 1, role: 'entry' });
    expect(m.cycles[0]).toEqual(['a.ts', 'b.ts', 'a.ts']);
    expect(m.dirCycles[0]).toEqual(['src', 'lib', 'src']);
  });

  it('图统计与 mermaid 源保留', () => {
    const m = buildReportModel(META, makeState());
    expect(m.callGraph.nodes).toBe(1);
    expect(m.callGraph.edges).toBe(1);
    expect(m.callGraph.mermaid).toContain('bootstrap');
    expect(m.moduleGraph.mermaid).toContain('src');
    expect(m.classGraph.nodes).toBe(1);
  });
});

describe('renderReportHtml', () => {
  it('产出无外部依赖的单文件 HTML', () => {
    const m = buildReportModel(META, makeState());
    const html = renderReportHtml(m, { call: '<svg>call</svg>', module: '<svg>mod</svg>' });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('demo');
    expect(html).toContain('<svg>call</svg>');
    // 离线：不应引用任何远程资源
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('src="//');
  });

  it('无 SVG 时退化展示 Mermaid 源码', () => {
    const m = buildReportModel(META, makeState());
    const html = renderReportHtml(m);
    expect(html).toContain('Mermaid 源码');
    expect(html).toContain('bootstrap');
    expect(html).toContain('fmt');
  });

  it('HTML 转义文件名中的特殊字符', () => {
    const state = makeState();
    state.metrics[0].path = '<script>alert(1)</script>/a.ts';
    const m = buildReportModel(META, state);
    const html = renderReportHtml(m);
    expect(html).not.toContain('<script>alert(1)');
  });
});
