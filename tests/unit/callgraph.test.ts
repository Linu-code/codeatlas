import { describe, expect, it } from 'vitest';
import { buildCallGraph, nodeId, graphStats } from '../../src/analysis/callgraph';
import type { FileAnalysis, SymbolDef } from '../../src/analysis/symbols';
import { toMermaid, sanitizeId, escapeLabel } from '../../src/analysis/mermaid';

/** 构造 FileAnalysis 的小工具 */
function mkFile(
  path: string,
  defs: { name: string; kind?: SymbolDef['kind']; line: number }[],
  calls: { from: string | null; to: string; line: number }[],
  imports: string[] = [],
  language: FileAnalysis['language'] = 'typescript',
): FileAnalysis {
  return {
    path,
    language,
    definitions: defs.map((d) => ({
      name: d.name,
      kind: d.kind ?? 'function',
      line: d.line,
      endLine: d.line + 2,
      signature: `${d.name}()`,
      exported: true,
    })),
    calls,
    references: defs.map((d) => ({ name: d.name, line: d.line, column: 1, kind: 'identifier' as const })),
    imports,
    hasError: false,
  };
}

/** 两个文件互相调用的样本仓库 */
const REPO: FileAnalysis[] = [
  mkFile('src/util.ts', [{ name: 'helper', line: 3 }], [], []),
  mkFile(
    'src/main.ts',
    [
      { name: 'main', line: 5 },
      { name: 'run', line: 12 },
    ],
    [
      { from: 'main', to: 'run', line: 6 },      // 文件内调用
      { from: 'run', to: 'helper', line: 13 },   // 跨文件调用
      { from: 'main', to: 'console', line: 7 },  // 仓库外（应丢弃）
      { from: 'main', to: 'fetchnothing', line: 8 }, // 未定义（应丢弃）
    ],
    ['./util'],
  ),
];

describe('buildCallGraph', () => {
  it('只保留仓库内定义的调用边（去噪核心）', () => {
    const g = buildCallGraph(REPO);
    expect(g.nodes).toHaveLength(3); // main, run, helper
    expect(g.edges).toHaveLength(2);
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toContain(nodeId('src/main.ts', 'main', 5));
    expect(ids).toContain(nodeId('src/util.ts', 'helper', 3));
  });

  it('同名函数优先解析到同文件定义（局部优先）', () => {
    const files: FileAnalysis[] = [
      mkFile('a.ts', [{ name: 'shared', line: 1 }], []),
      mkFile('b.ts', [{ name: 'shared', line: 1 }], []),
      mkFile(
        'c.ts',
        [
          { name: 'shared', line: 1 },
          { name: 'caller', line: 10 },
        ],
        [{ from: 'caller', to: 'shared', line: 11 }],
      ),
    ];
    const g = buildCallGraph(files);
    const edges = g.edges;
    expect(edges).toHaveLength(1);
    // 起点和终点都应在 c.ts（本文件内的 shared）
    expect(edges[0].from).toBe(nodeId('c.ts', 'caller', 10));
    expect(edges[0].to).toBe(nodeId('c.ts', 'shared', 1));
  });

  it('顶层调用与自递归不计入（图更干净）', () => {
    const files: FileAnalysis[] = [
      mkFile(
        'a.ts',
        [{ name: 'top', line: 1 }],
        [
          { from: null, to: 'top', line: 2 }, // 顶层调用
          { from: 'top', to: 'top', line: 3 }, // 自递归
        ],
      ),
    ];
    expect(buildCallGraph(files).edges).toHaveLength(0);
  });

  it('重复调用去重为一条边，并统计入度/出度', () => {
    const files: FileAnalysis[] = [
      mkFile('u.ts', [{ name: 'u', line: 1 }], []),
      mkFile(
        'm.ts',
        [
          { name: 'a', line: 1 },
          { name: 'b', line: 5 },
        ],
        [
          { from: 'a', to: 'u', line: 2 },
          { from: 'a', to: 'u', line: 3 }, // 重复
          { from: 'b', to: 'u', line: 6 },
        ],
      ),
    ];
    const g = buildCallGraph(files);
    expect(g.edges).toHaveLength(2);
    const u = g.nodes.find((n) => n.name === 'u')!;
    expect(u.inDegree).toBe(2); // 被 a、b 调用
    expect(u.outDegree).toBe(0);
    const a = g.nodes.find((n) => n.name === 'a')!;
    expect(a.outDegree).toBe(1);
  });

  it('超过 maxNodes 时按连接度截断并标记 truncated', () => {
    // 构造 1 个枢纽函数 + 30 个叶子函数
    const defs = [{ name: 'hub', line: 1 }];
    const calls: { from: string; to: string; line: number }[] = [];
    for (let i = 0; i < 30; i++) {
      defs.push({ name: `leaf${i}`, line: 10 + i });
      calls.push({ from: 'hub', to: `leaf${i}`, line: 10 + i });
    }
    const g = buildCallGraph([mkFile('big.ts', defs, calls)], { maxNodes: 10 });
    expect(g.truncated).toBe(true);
    expect(g.nodes).toHaveLength(10);
    expect(g.totalNodes).toBe(31);
    // 枢纽节点必须保留（连接度最高）
    expect(g.nodes.some((n) => n.name === 'hub')).toBe(true);
    // 所有保留的边两端都必须存在
    const kept = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(kept.has(e.from)).toBe(true);
      expect(kept.has(e.to)).toBe(true);
    }
  });

  it('语法错误的文件被记入 failedFiles（不阻断分析）', () => {
    const bad = mkFile('bad.ts', [{ name: 'x', line: 1 }], []);
    bad.hasError = true;
    const g = buildCallGraph([...REPO, bad]);
    expect(g.failedFiles).toEqual(['bad.ts']);
    expect(graphStats(g).nodes).toBe(3);
  });
});

describe('toMermaid', () => {
  it('输出合法 graph 头、按文件分组、跨文件用加粗边', () => {
    const mermaid = toMermaid(buildCallGraph(REPO));
    expect(mermaid.startsWith('graph LR')).toBe(true);
    expect(mermaid).toContain('subgraph');
    expect(mermaid).toContain('src/main.ts');
    expect(mermaid).toContain('src/util.ts');
    expect(mermaid).toContain('==>'); // 跨文件调用
    expect(mermaid).toContain('-->'); // 文件内调用
  });

  it('id 合法化：不同输入不冲突、同输入稳定', () => {
    const a = sanitizeId('src/a.ts#foo@12');
    const b = sanitizeId('src/a.ts#foo@12');
    const c = sanitizeId('src/b.ts#foo@12');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(/^n[0-9a-z]+$/.test(a)).toBe(true);
  });

  it('标签转义：引号与尖括号不会破坏 Mermaid 语法', () => {
    expect(escapeLabel('foo<T>(x: "a")')).toBe('foo&lt;T&gt;(x: &quot;a&quot;)');
    expect(escapeLabel('arr[0]')).toBe('arr(0)');
    expect(escapeLabel('a|b')).toBe('a/b');
  });

  it('节点数与截断后一致（Mermaid 与图数据同步）', () => {
    const g = buildCallGraph(REPO);
    const mermaid = toMermaid(g);
    const nodeLines = mermaid.split('\n').filter((l) => l.trim().includes('["'));
    // 每行一个节点，数量 = 节点数（subgraph 行也是 nX["..."] 形式，需要扣除文件分组行）
    const subgraphCount = mermaid.split('\n').filter((l) => l.includes('subgraph')).length;
    expect(nodeLines.length).toBe(g.nodes.length + subgraphCount);
  });
});
