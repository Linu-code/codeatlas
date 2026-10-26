/**
 * analysisCache.ts —— 分析结果持久化层（N4）
 *
 * 解决「每次打开都全量重算」：把单文件的解析产物（FileAnalysis + FileMetrics）
 * 按「内容哈希」缓存进 IndexedDB。再次打开同一仓库时：
 *   · 文件内容未变 → 直接复用缓存，**跳过 AST 解析**（解析是大仓库最耗时的一环）
 *   · 文件内容变了 → 只重解析这一个文件（增量）
 *
 * 设计要点：
 *   1. 版本化：AnalysisFormatVersion 递增即全部旧缓存失效（沿用 cache.ts 的
 *      TREE_FORMAT_VERSION 模式）。分析结果结构一旦变化必须递增，否则旧快照误导。
 *   2. 键设计：`${repoKey}::${hash}` —— repoKey 隔离不同仓库，hash 定位文件版本。
 *      FileAnalysis 里带 path，回读后与树逐项核对，双重保险。
 *   3. 纯函数测试：hash 计算、命中判定、payload 组装全部拆成纯函数，
 *      单测在 Node 环境直接断言（真实 IndexedDB 读写由 E2E 覆盖）。
 *   4. 降级：IndexedDB 不可用（隐私模式 / Node 单测）时所有操作静默返回 null，
 *      主流程照常全量分析 —— 缓存是加速器，不是依赖。
 *
 * 缓存内容（每文件一条记录，value 结构）：
 *   { v: 版本, hash, analysis: FileAnalysis, metrics: FileMetrics | null }
 */

import type { FileAnalysis } from '../analysis/langs/types';
import type { FileMetrics } from '../analysis/metrics';
import { hashText } from '../utils/hash';

const DB_NAME = 'codeatlas';
const DB_VERSION = 2; // v1 → v2：新增 analysis store
const STORE_ANALYSIS = 'analysis';

/**
 * 分析结果缓存**结构版本**。
 * 变更记录：1 → 初始版本（N4 引入）。
 * 注意：FileAnalysis/FileMetrics 结构、提取规则、度量算法任何一处变化都必须递增，
 * 否则旧缓存会被当作有效结果直接展示。
 */
export const ANALYSIS_FORMAT_VERSION = 1;

/** 缓存记录（持久化形态） */
export interface CachedAnalysis {
  v: number;
  /** 该文件的源文本哈希（回读时与当前文本核对，防止键冲突） */
  hash: string;
  analysis: FileAnalysis;
  metrics: FileMetrics | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ANALYSIS)) db.createObjectStore(STORE_ANALYSIS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null); // 缓存失败不阻断主流程
    });
  } catch {
    return null; // 无 IndexedDB 时静默降级
  }
}

/** 分析缓存键：repoKey::contentHash */
export function analysisKey(repoKey: string, hash: string): string {
  return `${repoKey}::${hash}`;
}

/**
 * 计算文件的分析缓存键。
 * @param repoKey 仓库键（owner/repo@branch 或本地目录路径）
 * @param text 文件源文本（未超限的文件）
 */
export function analysisCacheKey(repoKey: string, text: string): string {
  return analysisKey(repoKey, hashText(text));
}

// ---------- 纯函数（单测直接覆盖） ----------

/** 读取缓存并做完整校验：版本 / 哈希 / 路径三重核对，任一不符视为未命中 */
export function resolveCachedRecord(
  rec: CachedAnalysis | unknown,
  expectedHash: string,
  expectedPath: string,
): { analysis: FileAnalysis; metrics: FileMetrics | null } | null {
  if (!rec || typeof rec !== 'object') return null;
  const r = rec as CachedAnalysis;
  if (r.v !== ANALYSIS_FORMAT_VERSION) return null;
  if (r.hash !== expectedHash) return null;
  if (r.analysis?.path !== expectedPath) return null;
  return { analysis: r.analysis, metrics: r.metrics ?? null };
}

/** 组装持久化 payload（单测断言字段） */
export function buildCachedRecord(
  hash: string,
  analysis: FileAnalysis,
  metrics: FileMetrics | null,
): CachedAnalysis {
  return { v: ANALYSIS_FORMAT_VERSION, hash, analysis, metrics };
}

// ---------- IndexedDB 读写 ----------

/** 读取单文件缓存；未命中 / 版本不符 / 无 IndexedDB → null */
export async function getCachedAnalysis(
  repoKeyStr: string,
  hash: string,
  path: string,
): Promise<{ analysis: FileAnalysis; metrics: FileMetrics | null } | null> {
  const rec = await tx<CachedAnalysis>(STORE_ANALYSIS, 'readonly', (s) =>
    s.get(analysisKey(repoKeyStr, hash)),
  );
  return resolveCachedRecord(rec, hash, path);
}

/** 写入单文件缓存（失败静默，不阻断主流程） */
export function putCachedAnalysis(
  repoKeyStr: string,
  hash: string,
  analysis: FileAnalysis,
  metrics: FileMetrics | null,
): Promise<unknown> {
  const payload = buildCachedRecord(hash, analysis, metrics);
  return tx(STORE_ANALYSIS, 'readwrite', (s) =>
    s.put(payload, analysisKey(repoKeyStr, hash)),
  );
}

// ---------- 维护操作 ----------

/** 清空全部分析缓存（设置页"清除缓存"用） */
export async function clearAllAnalysisCache(): Promise<void> {
  await tx(STORE_ANALYSIS, 'readwrite', (s) => s.clear() as IDBRequest<undefined>);
}

/** 分析缓存记录数（设置页用量展示） */
export async function analysisCacheStats(): Promise<number> {
  const n = await tx<number>(STORE_ANALYSIS, 'readonly', (s) => s.count() as IDBRequest<number>);
  return n ?? 0;
}
