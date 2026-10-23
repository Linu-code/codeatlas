/**
 * analysisWorker.ts —— 解析 Worker 的客户端封装
 *
 * 设计要点：
 *   · 懒启动：第一次分析时才创建 Worker（与"冷启动 <2s"的目标一致）；
 *   · 失败可回退：创建失败 / 运行时报错 / 超时 → 返回 null，调用方在主线程解析，
 *     保证功能永远可用（Worker 只是加速，不是唯一路径）；
 *   · 请求-响应按自增 id 关联，超时 120s 自动放弃，避免 Promise 永久挂起。
 */

import type { AnalyzeBatchResult, AnalysisResponse, ParseJob } from './analysisJobs';

const TIMEOUT_MS = 120_000;

/**
 * grammar 目录的绝对 URL。
 * 构建配置是 `base: './'`，Worker 内相对路径会相对 worker 脚本（assets/）解析，
 * 因此在这里换算成绝对地址再下发。
 */
function grammarsBaseUrl(): string {
  const configured = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const href = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  try {
    return new URL('grammars/', new URL(configured, href)).href;
  } catch {
    return '/grammars/';
  }
}

export class AnalysisWorker {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, (result: AnalyzeBatchResult[] | null) => void>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** 已判定不可用（创建失败 / 运行时报错）：后续请求直接走主线程 */
  private dead = false;

  private spawn(): Worker | null {
    if (this.dead) return null;
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') {
      this.dead = true;
      return null;
    }
    try {
      const worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
        this.settle(event.data.id, event.data.results);
      };
      worker.onerror = () => this.kill();
      worker.onmessageerror = () => this.kill();
      this.worker = worker;
      return worker;
    } catch {
      this.dead = true;
      return null;
    }
  }

  /** 终止 Worker，并让所有等待中的请求以 null 结束（调用方回退主线程） */
  private kill(): void {
    this.dead = true;
    try {
      this.worker?.terminate();
    } catch {
      // 忽略
    }
    this.worker = null;
    for (const id of [...this.pending.keys()]) this.settle(id, null);
  }

  private settle(id: number, result: AnalyzeBatchResult[] | null): void {
    const resolve = this.pending.get(id);
    if (!resolve) return;
    this.pending.delete(id);
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    resolve(result);
  }

  /**
   * 解析一批文件。返回 null 表示 Worker 不可用/超时，调用方应在主线程兜底。
   */
  async analyze(jobs: ParseJob[]): Promise<AnalyzeBatchResult[] | null> {
    if (jobs.length === 0) return [];
    const worker = this.spawn();
    if (!worker) return null;

    const id = ++this.seq;
    return new Promise<AnalyzeBatchResult[] | null>((resolve) => {
      this.pending.set(id, resolve);
      this.timers.set(
        id,
        setTimeout(() => this.settle(id, null), TIMEOUT_MS),
      );
      try {
        worker.postMessage({ id, jobs, grammarsBase: grammarsBaseUrl() });
      } catch {
        this.settle(id, null);
      }
    });
  }

  dispose(): void {
    this.kill();
  }
}
