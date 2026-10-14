/**
 * LocalDirSource —— 本地目录数据源（N5①，完全离线、无网络依赖）
 *
 * 只跑在 Tauri 桌面端：浏览器里没有文件系统访问权（见 factory 的降级分支）。
 *
 * 与 ZipSource 的关系：
 *   · 同一套 RepoFS 契约 —— 上层 UI / 分析层零感知
 *   · 文件树由 Rust read_dir 预取的条目构建（不递归进 .git / node_modules）
 *   · 文本读取走 read_text_file（避免 base64 编解码开销），二进制走 read_file_base64
 *
 * 安全：read_dir 在 Rust 侧做过滤与上限保护，本类只消费结果；
 *       缓存键用「目录绝对路径」命名空间，与 github/zip 源完全隔离。
 */

import { FileNode, README_CANDIDATES, RepoError, RepoFS, RepoMeta, isBinaryPath } from '../types/repo';
import { buildTree, flattenFiles } from './tree';
import { invokeSafe } from '../utils/tauri';

/** Rust read_dir 返回的单个条目（结构与 lib.rs 的 DirEntryInfo 对齐） */
export interface LocalDirEntry {
  /** 相对 POSIX 路径（'src/core.ts'） */
  path: string;
  is_dir: boolean;
  size: number;
}

export class LocalDirSource implements RepoFS {
  readonly meta: RepoMeta;

  private entries = new Map<string, LocalDirEntry>();
  private treeCache: FileNode[] | null = null;
  private textCache = new Map<string, string>();
  private blobCache = new Map<string, Blob>();

  private constructor(
    /** 被打开的目录的绝对路径（缓存命名空间 + 后续读取的基址） */
    public readonly rootPath: string,
    entries: LocalDirEntry[],
  ) {
    this.meta = {
      name: rootPath.split(/[\\/]/).filter(Boolean).pop() ?? 'local-project',
      source: 'local',
      // 缓存命名空间用（useCodeAnalysis.cacheNs）：绝对路径防同名目录冲突
      rootPath: rootPath.replace(/[\\/]+$/, ''),
    };
    for (const e of entries) this.entries.set(e.path, e);
  }

  /** 打开本地目录：Rust 递归列目录 → 构建索引。throw not-found-dir / empty-zip */
  static async open(rootPath: string): Promise<LocalDirSource> {
    const entries = await invokeSafe<LocalDirEntry[]>('read_dir', { path: rootPath });
    if (!entries) throw new RepoError('not-found-dir', `cannot read directory: ${rootPath}`);
    if (entries.length === 0) throw new RepoError('empty-zip', `no readable files: ${rootPath}`);
    return new LocalDirSource(rootPath, entries);
  }

  async listFiles(): Promise<FileNode[]> {
    if (this.treeCache) return this.treeCache;
    const flat: FileNode[] = [...this.entries.values()]
      .filter((e) => !e.is_dir)
      .map((e) => ({ path: e.path, type: 'file' as const, size: e.size }));
    this.treeCache = buildTree(flat);
    return this.treeCache;
  }

  /** 拼出磁盘绝对路径（条目路径由 Rust 保证相对，这里做一次防御性校验） */
  private absPath(rel: string): string {
    if (rel.includes('..') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
      throw new RepoError('zip-insecure', `unsafe local path: ${rel}`);
    }
    return this.rootPath.replace(/[\\/]+$/, '') + '/' + rel;
  }

  async readFile(path: string): Promise<string> {
    const cached = this.textCache.get(path);
    if (cached !== undefined) return cached;
    if (!this.entries.has(path)) throw new RepoError('not-found', `no entry: ${path}`);
    const text = await invokeSafe<string>('read_text_file', { path: this.absPath(path) });
    if (text === null) throw new RepoError('parse-error', `read failed: ${path}`);
    this.textCache.set(path, text);
    return text;
  }

  async readBlob(path: string): Promise<Blob> {
    const cached = this.blobCache.get(path);
    if (cached) return cached;
    if (!this.entries.has(path)) throw new RepoError('not-found', `no entry: ${path}`);
    const base64 = await invokeSafe<string>('read_file_base64', { path: this.absPath(path) });
    if (!base64) throw new RepoError('parse-error', `read failed: ${path}`);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeFor(path) });
    this.blobCache.set(path, blob);
    return blob;
  }

  async readAny(path: string): Promise<string | Blob> {
    return isBinaryPath(path) ? this.readBlob(path) : this.readFile(path);
  }

  async findReadme(): Promise<{ path: string; text: string } | null> {
    const flat = flattenFiles(await this.listFiles());
    for (const candidate of README_CANDIDATES) {
      const hit =
        flat.find((p) => p === candidate) ??
        flat.find((p) => p.split('/').length === 2 && p.endsWith('/' + candidate));
      if (hit) {
        try {
          return { path: hit, text: await this.readFile(hit) };
        } catch {
          // 继续尝试下一个候选名
        }
      }
    }
    return null;
  }

  dispose(): void {
    this.entries.clear();
    this.treeCache = null;
    this.textCache.clear();
    this.blobCache.clear();
  }
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
};

function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}
