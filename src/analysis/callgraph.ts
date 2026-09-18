/**
 * callgraph.ts —— 由符号分析结果构建函数级调用图
 *
 * 关键点：
 *   1. 只有"在本仓库内有定义"的被调用者才会连边 —— 这是去噪的核心，
 *      否则 React 这类仓库里 console.log / useState / fetch 会淹没真图（见提示词的性能要求）。
 *   2. 同名符号优先解析到同文件定义（局部优先），否则解析到全局唯一定义；
 *      多个候选时取行号最靠前者，并在节点上标注 ambiguous，避免误导。
 *   3. 节点数超过 maxNodes 时按「入度 + 出度」排序截断，保证图里留下的是骨架而不是噪声。
 */

import type { FileAnalysis, SymbolDef } from './symbols';

export interface GraphNode {
  /** 稳定 id：`${file}#${name}@${line}` */
  id: string;
  name: string;
  file: string;
  line: number;
  kind: SymbolDef['kind'];
  /** 被调用次数（入度） */
  inDegree: number;
  /** 调用了多少函数（出度） */
  outDegree: number;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface CallGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 参与分析的函数总数（截断前） */
  totalNodes: number;
  /** 是否发生截断 */
  truncated: boolean;
  parsedFiles: number;
  failedFiles: string[];
}

export interface BuildOptions {
  /** 最大节点数（默认 120，超过则截断 Top-K；调用方可传 limits.MAX_GRAPH_NODES） */
  maxNodes?: number;
}

/** 由分析结果构建调用图 */
export function buildCallGraph(files: FileAnalysis[], opts: BuildOptions = {}): CallGraph {
  const maxNodes = opts.maxNodes ?? 120;

  // ---------- 1. 建索引：名字 → 定义列表 ----------
  const defsByName = new Map<string, { id: string; file: string; line: number; kind: SymbolDef['kind'] }[]>();
  const failedFiles: string[] = [];

  for (const f of files) {
    if (f.hasError) failedFiles.push(f.path);
    for (const def of f.definitions) {
      const id = nodeId(f.path, def.name, def.line);
      const list = defsByName.get(def.name) ?? [];
      list.push({ id, file: f.path, line: def.line, kind: def.kind });
      defsByName.set(def.name, list);
    }
  }

  // ---------- 2. 解析调用边 ----------
  const edges = new Set<string>();
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  const meta = new Map<string, { name: string; file: string; line: number; kind: SymbolDef['kind'] }>();

  for (const f of files) {
    // 文件名 → 本文件内的定义索引（局部优先解析）
    const localDefs = new Map<string, string>();
    for (const def of f.definitions) localDefs.set(def.name, nodeId(f.path, def.name, def.line));

    for (const def of f.definitions) {
      const id = nodeId(f.path, def.name, def.line);
      meta.set(id, { name: def.name, file: f.path, line: def.line, kind: def.kind });
    }

    for (const call of f.calls) {
      // 目标解析：同文件定义 > 全局唯一定义 > 全局多个候选取首个
      let targetId: string | null = localDefs.get(call.to) ?? null;
      if (!targetId) {
        const candidates = defsByName.get(call.to);
        if (candidates && candidates.length > 0) {
          targetId = [...candidates].sort((a, b) => a.line - b.line)[0].id;
        }
      }
      if (!targetId) continue; // 仓库外调用（console.log/fetch/React hooks 等）→ 丢弃

      // 调用方：调用点所在函数；顶层调用则以「文件级伪节点」为源
      const fromId = call.from ? localDefs.get(call.from) ?? null : null;
      if (!fromId) continue; // 顶层调用不计入函数级图
      if (fromId === targetId) continue; // 自递归不画，避免噪音

      const key = `${fromId}->${targetId}`;
      if (edges.has(key)) continue;
      edges.add(key);
      outDeg.set(fromId, (outDeg.get(fromId) ?? 0) + 1);
      inDeg.set(targetId, (inDeg.get(targetId) ?? 0) + 1);
    }
  }

  // ---------- 3. 组装节点（仅保留参与边的函数，图更干净） ----------
  const touched = new Set<string>();
  for (const key of edges) {
    const [from, to] = key.split('->');
    touched.add(from);
    touched.add(to);
  }

  let nodes: GraphNode[] = [...touched].map((id) => {
    const m = meta.get(id)!;
    return {
      id,
      name: m.name,
      file: m.file,
      line: m.line,
      kind: m.kind,
      inDegree: inDeg.get(id) ?? 0,
      outDegree: outDeg.get(id) ?? 0,
    };
  });

  const totalNodes = nodes.length;

  // ---------- 4. 截断：按连接度保留骨架 ----------
  let truncated = false;
  if (nodes.length > maxNodes) {
    truncated = true;
    nodes = nodes
      .sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree) || a.file.localeCompare(b.file))
      .slice(0, maxNodes);
  }

  const kept = new Set(nodes.map((n) => n.id));
  const finalEdges: GraphEdge[] = [];
  for (const key of edges) {
    const [from, to] = key.split('->');
    if (kept.has(from) && kept.has(to)) finalEdges.push({ from, to });
  }

  // 稳定排序：便于快照测试与 Mermaid 输出稳定
  nodes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  finalEdges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return {
    nodes,
    edges: finalEdges,
    totalNodes,
    truncated,
    parsedFiles: files.length,
    failedFiles: failedFiles.length ? failedFiles : [],
  };
}

export function nodeId(file: string, name: string, line: number): string {
  return `${file}#${name}@${line}`;
}

/** 图统计（面板展示与测试断言用） */
export function graphStats(graph: CallGraph): { nodes: number; edges: number } {
  return { nodes: graph.nodes.length, edges: graph.edges.length };
}
