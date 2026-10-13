/**
 * useCodeAnalysis —— 代码分析总编排
 *
 * 核心设计：**一次文件读取 + 一次 AST 解析，产出三种分析结果**
 *   · metrics   —— 文件/函数级度量（M6 度量面板）
 *   · index     —— 跨文件符号索引（M5 跳转与查找引用）
 *   · graph     —— 调用图 + Mermaid 文本（M4 调用图面板）
 *   上下文包（M6）直接复用同一批 FileAnalysis。
 *
 * 为什么要合并：分开各跑一遍意味着同一文件被读取和解析 3 次，
 * 中型仓库（数百文件）会明显变慢，且缓存层压力更大。
 *
 * 性能与健壮性：
 *   · 单文件体积上限 256 KB，文件总数上限 400
 *   · 并发读取 8 个文件
 *   · 单个文件解析异常只跳过该文件，不中断整体
 */

import { useCallback, useRef, useState } from 'react';
import { FileNode, RepoFS, RepoError } from '../types/repo';
import { flattenFiles } from '../sources/tree';
import { langOfPath, parseCode } from '../analysis/parser';
import { extractFile, type FileAnalysis } from '../analysis/symbols';
import { buildCallGraph, type CallGraph } from '../analysis/callgraph';
import { toClassMermaid, toModuleMermaid, toMermaid } from '../analysis/mermaid';
import { buildScopeIndex, type ScopeIndex } from '../analysis/scopeGraph';
import { computeMetrics, healthScore, type FileMetrics } from '../analysis/metrics';
import { MAX_ANALYSIS_FILES, MAX_GRAPH_NODES, MAX_SOURCE_BYTES } from '../analysis/limits';
import { buildReadingPath, type ReadingPath } from '../analysis/readingPath';
import { buildModuleGraph, groupByLayer, type LayerGroup, type ModuleGraph } from '../analysis/moduleGraph';
import { findCycles, type CycleReport } from '../analysis/cycles';
import { buildClassGraph, MAX_CLASS_NODES, type ClassGraph } from '../analysis/classGraph';
import { annotateDirectories } from '../analysis/directories';
import { hashText } from '../utils/hash';
import { getCachedAnalysis, putCachedAnalysis } from '../analysis/analysisCache';

const READ_CONCURRENCY = 8;

/** 参与增量统计的标记：N4 用于在状态里暴露「缓存命中 / 重解析」计数 */
export interface IncrementalStats {
  /** 从缓存直接复用（未重新解析）的文件数 */
  cached: number;
  /** 重新解析的文件数 */
  parsed: number;
  /** 读取/解析失败被跳过的文件数 */
  failed: number;
}

/** 模块依赖图超过该节点数就不渲染 Mermaid（图会不可读且渲染变慢），改用表格 */
const MAX_MODULE_DIAGRAM_NODES = 40;

export interface AnalysisState {
  running: boolean;
  /** 已解析 / 待解析文件数 */
  progress: { parsed: number; total: number };
  /** N4：增量分析统计（缓存命中 / 重解析 / 失败） */
  incremental: IncrementalStats;
  files: FileAnalysis[];
  metrics: FileMetrics[];
  health: ReturnType<typeof healthScore> | null;
  index: ScopeIndex | null;
  graph: CallGraph | null;
  mermaid: string;
  // ---------- N2：阅读路线 ----------
  readingPath: ReadingPath | null;
  // ---------- N3：架构视图 ----------
  moduleGraph: ModuleGraph | null;
  cycles: CycleReport | null;
  classGraph: ClassGraph | null;
  layers: LayerGroup[];
  /** 模块依赖图 Mermaid（节点过多时为空串，面板改用表格） */
  moduleMermaid: string;
  /** 类图 Mermaid（无类或超限时为空串） */
  classMermaid: string;
  /** 没有找到可分析的文件（仓库中不存在受支持语言的源文件） */
  empty: boolean;
  error: RepoError | null;
}

const INITIAL: AnalysisState = {
  running: false,
  progress: { parsed: 0, total: 0 },
  incremental: { cached: 0, parsed: 0, failed: 0 },
  files: [],
  metrics: [],
  health: null,
  index: null,
  graph: null,
  mermaid: '',
  readingPath: null,
  moduleGraph: null,
  cycles: null,
  classGraph: null,
  layers: [],
  moduleMermaid: '',
  classMermaid: '',
  empty: false,
  error: null,
};

/**
 * 调用图面板所需的状态子集。
 *
 * 面板只关心「是否在跑 / 进度 / 图 / Mermaid 文本 / 空结果 / 错误」，
 * 不需要 metrics、index 等，因此用 Pick 收窄成最小契约；
 * AnalysisState 天然满足它，App 直接把整个 state 传下去即可。
 */
export type CallGraphState = Pick<
  AnalysisState,
  'running' | 'progress' | 'graph' | 'mermaid' | 'empty' | 'error'
>;

export function useCodeAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL);
  const runIdRef = useRef(0);
  /** 缓存上次分析的输入指纹，避免重复全量分析 */
  const signatureRef = useRef<string | null>(null);
  /**
   * 最新结果镜像（重要）。
   * `analyze()` 是异步的，调用方 await 之后若从闭包里的 `state` 读取，
   * 拿到的仍是**更新前的快照**（React 状态尚未反映到本次渲染的闭包），
   * 会造成"刚分析完却查不到索引"的 bug（E2E 的符号跳转/上下文包用例正是这样暴露的）。
   * 因此每次提交结果时同步写入 ref，并对外提供 getState() 读取权威值。
   */
  const stateRef = useRef<AnalysisState>(INITIAL);

  const commit = useCallback((next: AnalysisState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const getState = useCallback(() => stateRef.current, []);

  const analyze = useCallback(
    async (
      fs: RepoFS,
      tree: FileNode[],
      opts: { force?: boolean } = {},
    ): Promise<AnalysisState> => {
      const signature = `${fs.meta.name}:${flattenFiles(tree).length}`;
      if (!opts.force && signatureRef.current === signature && stateRef.current.index) {
        return stateRef.current; // 同一仓库且已分析过
      }

      const runId = ++runIdRef.current;
      const all = flattenFiles(tree);
      const targets = all.filter((p) => langOfPath(p) !== null).slice(0, MAX_ANALYSIS_FILES);

      if (targets.length === 0) {
        signatureRef.current = signature;
        const empty: AnalysisState = { ...INITIAL, empty: true };
        commit(empty);
        return empty;
      }

      commit({ ...INITIAL, running: true, progress: { parsed: 0, total: targets.length } });

      const results: FileAnalysis[] = [];
      const metricsByPath = new Map<string, FileMetrics>();
      let parsedCount = 0;
      // N4：增量统计
      let cachedCount = 0;
      let failedCount = 0;
      /** 本仓库的分析缓存命名空间（复用 repoKey：owner/repo@branch，本地源用 name） */
      const cacheNs = fs.meta.source === 'github'
        ? `${fs.meta.owner ?? ''}/${fs.meta.repo ?? ''}@${fs.meta.branch ?? 'HEAD'}`
        : fs.meta.name;

      const queue = [...targets];
      const worker = async () => {
        for (;;) {
          const path = queue.shift();
          if (path === undefined) return;
          if (runId !== runIdRef.current) return;
          try {
            const code = await fs.readFile(path);
            if (code.length <= MAX_SOURCE_BYTES) {
              const lang = langOfPath(path);
              if (lang) {
                const hash = hashText(code);
                // ① 缓存命中：直接复用解析结果，跳过 AST 解析（大仓库核心加速）
                if (!opts.force) {
                  const cached = await getCachedAnalysis(cacheNs, hash, path);
                  if (cached) {
                    results.push(cached.analysis);
                    if (cached.metrics) metricsByPath.set(path, cached.metrics);
                    cachedCount++;
                    continue;
                  }
                }
                // ② 未命中：解析 + 度量，写回缓存供下次复用
                const parsed = await parseCode(code, lang);
                if (parsed) {
                  const fa = extractFile(parsed.rootNode, path, lang);
                  results.push(fa);
                  // 度量必须用源码文本（SLOC 依赖行内容），紧随解析进行
                  const fm = computeMetrics(parsed.rootNode, path, lang, code);
                  metricsByPath.set(path, fm);
                  if (!opts.force) void putCachedAnalysis(cacheNs, hash, fa, fm);
                }
              }
            }
          } catch {
            // 读取/解析失败：跳过该文件
            failedCount++;
          } finally {
            parsedCount++;
            if (runId === runIdRef.current) {
              setState((prev) => ({
                ...prev,
                progress: { parsed: parsedCount, total: targets.length },
              }));
            }
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, targets.length) }, worker));
      if (runId !== runIdRef.current) return stateRef.current;

      // ---------- 派生分析结果 ----------
      const graph = buildCallGraph(results, { maxNodes: MAX_GRAPH_NODES });
      const index = buildScopeIndex(results);
      const metrics = [...metricsByPath.values()].sort(
        (a, b) => b.maxFunctionComplexity - a.maxFunctionComplexity || a.path.localeCompare(b.path),
      );
      const health = healthScore(metrics);

      // N2：阅读路线（依赖图 PageRank + 入/出度角色）
      const readingPath = buildReadingPath(results, index);

      // N3：架构视图（模块依赖图 / 循环依赖 / 类图 / 分层）
      // 目录用途标注在此重算一次（纯函数、O(n)），让 AnalysisState 自包含，
      // 面板不必再依赖外部传入的 dirPurposes。
      const dirPurposes = annotateDirectories(tree);
      const moduleGraph = buildModuleGraph(results, dirPurposes);
      const cycles = findCycles(
        results.map((f) => f.path),
        moduleGraph.fileEdges,
      );
      const classGraph = buildClassGraph(results);

      signatureRef.current = signature;
      const next: AnalysisState = {
        running: false,
        progress: { parsed: parsedCount, total: targets.length },
        incremental: { cached: cachedCount, parsed: results.length - cachedCount, failed: failedCount },
        files: results,
        metrics,
        health,
        index,
        graph,
        mermaid: graph.nodes.length > 0 ? toMermaid(graph) : '',
        readingPath,
        moduleGraph,
        cycles,
        classGraph,
        layers: groupByLayer(moduleGraph),
        moduleMermaid:
          moduleGraph.nodes.length > 0 && moduleGraph.nodes.length <= MAX_MODULE_DIAGRAM_NODES
            ? toModuleMermaid(moduleGraph)
            : '',
        classMermaid:
          classGraph.nodes.length > 0 && classGraph.nodes.length <= MAX_CLASS_NODES
            ? toClassMermaid(classGraph)
            : '',
        empty: results.length === 0,
        error: null,
      };
      commit(next);
      return next;
    },
    [commit],
  );

  const reset = useCallback(() => {
    runIdRef.current++;
    signatureRef.current = null;
    stateRef.current = INITIAL;
    setState(INITIAL);
  }, []);

  return { state, analyze, reset, getState };
}
