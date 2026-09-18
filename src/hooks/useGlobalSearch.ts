/**
 * useGlobalSearch —— 全局代码搜索（Worker + 10 秒超时保护）
 *
 * 流程：
 *   1. 预取文件内容（并发受限，与解析用的同一套缓存命中，因此通常不产生新网络请求）
 *   2. 启动 Web Worker，把 { path, text } 列表与正则一次性投递
 *   3. 主线程 `setTimeout` 10 秒：未返回则 `worker.terminate()` 并置超时错误
 *   4. 命中结果按文件聚合，供面板展示与点击跳转
 *
 * 说明：提示词推荐 regexp-worker 库；本项目按"零多余依赖"原则自研等价实现
 * （Worker 内 regex + 主线程终止），能力一致：正则搜索 + 超时保护 + 不阻塞 UI。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileNode, RepoFS, RepoError } from '../types/repo';
import { flattenFiles } from '../sources/tree';
import type { SearchMatch, SearchResponse } from '../workers/search.worker';
import { MAX_SEARCH_BYTES, MAX_SEARCH_FILES } from '../analysis/limits';

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 500;
const PREFETCH_CONCURRENCY = 8;

export interface SearchState {
  running: boolean;
  results: SearchMatch[];
  totalMatches: number;
  filesMatched: number;
  truncated: boolean;
  /** 已预取文件数 / 文件总数 */
  progress: { loaded: number; total: number };
  error: RepoError | null;
}

const INITIAL: SearchState = {
  running: false,
  results: [],
  totalMatches: 0,
  filesMatched: 0,
  truncated: false,
  progress: { loaded: 0, total: 0 },
  error: null,
};

export function useGlobalSearch() {
  const [state, setState] = useState<SearchState>(INITIAL);
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);

  /** 清理 Worker 与定时器 */
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const search = useCallback(
    async (fs: RepoFS, tree: FileNode[], pattern: string, flags: string) => {
      if (!pattern.trim()) return;
      const runId = ++runIdRef.current;
      cleanup();

      setState({ ...INITIAL, running: true });

      // ---------- 1. 预取文件内容 ----------
      const targets = flattenFiles(tree)
        .filter((p) => !/\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|woff2?|ttf|wasm|mp4|mp3)$/i.test(p))
        .slice(0, MAX_SEARCH_FILES);
      setState((prev) => ({ ...prev, progress: { loaded: 0, total: targets.length } }));

      const payload: { path: string; text: string }[] = [];
      const queue = [...targets];
      let loaded = 0;

      const reader = async () => {
        for (;;) {
          const path = queue.shift();
          if (path === undefined) return;
          if (runId !== runIdRef.current) return;
          try {
            const text = await fs.readFile(path);
            if (text.length <= MAX_SEARCH_BYTES) payload.push({ path, text });
          } catch {
            // 读取失败的文件跳过（不阻断搜索）
          } finally {
            loaded++;
            if (runId === runIdRef.current && loaded % 10 === 0) {
              setState((prev) => ({ ...prev, progress: { loaded, total: targets.length } }));
            }
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(PREFETCH_CONCURRENCY, targets.length) }, reader),
      );
      if (runId !== runIdRef.current) return;
      setState((prev) => ({ ...prev, progress: { loaded: targets.length, total: targets.length } }));

      // ---------- 2. 启动 Worker ----------
      if (Object.keys(payload).length === 0) {
        setState({ ...INITIAL });
        return;
      }

      const worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<SearchResponse>) => {
        if (runId !== runIdRef.current) return;
        cleanup();
        const data = event.data;
        if (data.type === 'error') {
          setState({
            ...INITIAL,
            error: new RepoError('invalid-input', `bad regex: ${pattern}`),
          });
          return;
        }
        setState({
          running: false,
          results: data.results ?? [],
          totalMatches: data.totalMatches ?? 0,
          filesMatched: data.filesMatched ?? 0,
          truncated: data.truncated ?? false,
          progress: { loaded: targets.length, total: targets.length },
          error: null,
        });
      };

      worker.onerror = () => {
        if (runId !== runIdRef.current) return;
        cleanup();
        setState({ ...INITIAL, error: new RepoError('network', 'search worker failed') });
      };

      // ---------- 3. 超时保护 ----------
      timerRef.current = setTimeout(() => {
        if (runId !== runIdRef.current) return;
        cleanup();
        setState({ ...INITIAL, error: new RepoError('timeout', 'search timeout') });
      }, TIMEOUT_MS);

      worker.postMessage({ files: payload, pattern, flags, maxResults: MAX_RESULTS });
    },
    [cleanup],
  );

  const reset = useCallback(() => {
    runIdRef.current++;
    cleanup();
    setState(INITIAL);
  }, [cleanup]);

  return { state, search, reset };
}
