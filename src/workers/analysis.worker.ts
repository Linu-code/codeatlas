/**
 * analysis.worker.ts —— AST 解析与度量的 Worker 端
 *
 * 为什么放进 Worker：tree-sitter 的 wasm 解析是**同步 CPU 工作**，
 * 数千文件时即使分片 await，主线程仍会被反复占用，滚动/输入会卡顿。
 * 放到 Worker 后主线程只负责读文件、查缓存、汇总结果。
 *
 * 消息协议见 analysisJobs.ts；Worker 内部串行处理（更省内存、避免多 wasm 实例）。
 */

import { configureParserEnv, langOfPath, parseCode } from '../analysis/parser';
import { extractFile } from '../analysis/symbols';
import { computeMetrics } from '../analysis/metrics';
import type { AnalysisRequest, AnalyzeBatchResult } from '../analysis/analysisJobs';

/** 首次请求时注入 grammar 目录（主线程算好的绝对 URL，见 AnalysisRequest 注释） */
let configured = false;
function ensureEnv(grammarsBase: string): void {
  if (configured || !grammarsBase) return;
  configureParserEnv({
    runtimeWasm: () => `${grammarsBase}tree-sitter.wasm`,
    grammarWasm: (name) => `${grammarsBase}tree-sitter-${name}.wasm`,
  });
  configured = true;
}

self.onmessage = async (event: MessageEvent<AnalysisRequest>) => {
  const { id, jobs, grammarsBase } = event.data;
  ensureEnv(grammarsBase);
  const results: AnalyzeBatchResult[] = [];

  for (const job of jobs) {
    const lang = langOfPath(job.path);
    if (!lang) {
      results.push({ path: job.path, error: 'unsupported' });
      continue;
    }
    try {
      const tree = await parseCode(job.code, lang);
      if (!tree) {
        results.push({ path: job.path, error: 'parse-failed' });
        continue;
      }
      results.push({
        path: job.path,
        analysis: extractFile(tree.rootNode, job.path, lang),
        // 度量依赖源码文本（SLOC 按行判定），必须与解析同批完成
        metrics: computeMetrics(tree.rootNode, job.path, lang, job.code),
      });
    } catch (e) {
      results.push({ path: job.path, error: e instanceof Error ? e.message : String(e) });
    }
  }

  (self as unknown as { postMessage: (value: unknown) => void }).postMessage({ id, results });
};
