/**
 * analysisJobs.ts —— 主线程 ↔ 解析 Worker 的消息契约
 *
 * 单独成文件（只含类型），避免 worker 与客户端互相 import 时把 `self.onmessage`
 * 副作用带进任一方。
 */

import type { FileAnalysis } from './symbols';
import type { FileMetrics } from './metrics';

/** 一个待解析文件（源码文本随任务一起下发，Worker 不再回头读数据源） */
export interface ParseJob {
  path: string;
  code: string;
}

/** 单个文件的解析结果；失败时 `error` 有值 */
export interface AnalyzeBatchResult {
  path: string;
  analysis?: FileAnalysis;
  metrics?: FileMetrics;
  error?: string;
}

/** 主线程 → Worker 的请求 */
export interface AnalysisRequest {
  id: number;
  jobs: ParseJob[];
  /**
   * grammar wasm 的**绝对**目录（以 `/` 结尾）。
   * 必须由主线程算好传进来：构建配置 `base: './'` 下，Worker 内的相对路径会
   * 相对 worker 脚本（assets/xxx.js）解析，导致 `assets/grammars/...` 404。
   */
  grammarsBase: string;
}

/** Worker → 主线程的响应 */
export interface AnalysisResponse {
  id: number;
  results: AnalyzeBatchResult[];
}
