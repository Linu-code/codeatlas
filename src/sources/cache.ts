/**
 * IndexedDB 缓存层（无第三方依赖，手写薄封装）
 *
 * 设计：
 *   DB: codeatlas   version 1
 *   store "trees": key = repoKey, value = FileNode[]（文件树快照）
 *   store "files": key = `${repoKey}::${path}`, value = { text, ts }
 *   store "meta":  key = repoKey, value = { ts, branch, fileCount }
 *
 * 命中缓存即秒开；顶栏"刷新"会按 repoKey 清空后重新拉取。
 * ZIP 源不写缓存（本地文件本身就是最快的来源，且体积不可控）。
 */

import { FileNode } from '../types/repo';

const DB_NAME = 'codeatlas';
const DB_VERSION = 1;
const STORE_TREES = 'trees';
const STORE_FILES = 'files';

/**
 * 文件树缓存**结构版本**。
 *
 * 为什么要它：树结构由算法生成，算法一旦变化（例如修复"目录重复"bug），
 * 旧缓存里存的仍是错误结构，用户升级后会继续看到旧数据，误以为没修好。
 * 递增此版本即可让全部旧树缓存自动失效并重新拉取（无需用户手动清缓存）。
 *
 * 变更记录：1 → 2（修复 GitHub 显式目录条目导致的目录重复）
 */
const TREE_FORMAT_VERSION = 2;

interface CachedTree {
  v: number;
  nodes: FileNode[];
}

/** 缓存键：owner/repo@branch */
export function repoKey(owner: string, repo: string, branch: string): string {
  return `${owner}/${repo}@${branch}`;
}

export function fileKey(key: string, path: string): string {
  return `${key}::${path}`;
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
      if (!db.objectStoreNames.contains(STORE_TREES)) db.createObjectStore(STORE_TREES);
      if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES);
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
    return null; // 无 IndexedDB（隐私模式等）时静默降级
  }
}

// ---------- 文件树 ----------
/**
 * 读取树缓存。以下情况一律视为失效（返回 null，交由上层重新拉取）：
 *   · 无缓存
 *   · 旧格式（直接存数组，无版本号）
 *   · 版本号与当前 TREE_FORMAT_VERSION 不一致
 */
export async function getCachedTree(key: string): Promise<FileNode[] | null> {
  const rec = await tx<CachedTree | FileNode[]>(STORE_TREES, 'readonly', (s) => s.get(key));
  if (!rec) return null;
  if (Array.isArray(rec)) return null; // 旧格式（无版本号）
  if (rec.v !== TREE_FORMAT_VERSION) return null; // 结构已变更
  return rec.nodes && rec.nodes.length > 0 ? rec.nodes : null;
}

export function putCachedTree(key: string, tree: FileNode[]): Promise<unknown> {
  const payload: CachedTree = { v: TREE_FORMAT_VERSION, nodes: tree };
  return tx(STORE_TREES, 'readwrite', (s) => s.put(payload, key));
}

// ---------- 文件内容 ----------
export async function getCachedFile(key: string, path: string): Promise<string | null> {
  const rec = await tx<{ text: string }>(STORE_FILES, 'readonly', (s) => s.get(fileKey(key, path)));
  return rec?.text ?? null;
}

export function putCachedFile(key: string, path: string, text: string): Promise<unknown> {
  return tx(STORE_FILES, 'readwrite', (s) =>
    s.put({ text, ts: Date.now() }, fileKey(key, path)),
  );
}

// ---------- 维护操作 ----------
/** 清空指定仓库的缓存（刷新按钮用） */
export async function clearRepoCache(key: string): Promise<void> {
  await deleteByPrefix(STORE_TREES, key);
  await deleteByPrefix(STORE_FILES, key + '::');
}

/** 清空全部缓存（设置页"清除缓存"用） */
export async function clearAllCache(): Promise<void> {
  await tx(STORE_TREES, 'readwrite', (s) => s.clear() as IDBRequest<undefined>);
  await tx(STORE_FILES, 'readwrite', (s) => s.clear() as IDBRequest<undefined>);
}

async function deleteByPrefix(store: string, prefix: string): Promise<void> {
  const db = await openDb().catch(() => null);
  if (!db) return;
  await new Promise<void>((resolve) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    const req = s.openKeyCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const k = String(cursor.key);
      if (k === prefix || k.startsWith(prefix)) s.delete(cursor.key);
      cursor.continue();
    };
    req.onerror = () => resolve();
  });
}

/** 缓存用量概览（设置页展示） */
export async function cacheStats(): Promise<{ trees: number; files: number }> {
  const count = async (store: string) => {
    const n = await tx<number>(store, 'readonly', (s) => s.count() as IDBRequest<number>);
    return n ?? 0;
  };
  return { trees: await count(STORE_TREES), files: await count(STORE_FILES) };
}
