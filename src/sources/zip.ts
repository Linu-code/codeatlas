/**
 * ZipSource —— 本地 ZIP 数据源（完全离线）
 *
 * 两种入口：
 *   · ZipSource.open(file)        —— 浏览器 / Tauri 文件选择器
 *   · ZipSource.openBytes(bytes)  —— Tauri 拖入场景：Rust 读文件字节经 IPC 传入
 *
 * 安全：所有条目路径先过 sanitizeZipPath（防路径穿越），再写入内存索引。
 */

import JSZip from 'jszip';
import { FileNode, README_CANDIDATES, RepoError, RepoFS, RepoMeta, isBinaryPath } from '../types/repo';
import { buildTree, flattenFiles } from './tree';
import { sanitizeZipPath } from './zipSecurity';

interface ZipEntry {
  path: string;
  size: number;
  lazy: JSZip.JSZipObject | null;
}

export class ZipSource implements RepoFS {
  readonly meta: RepoMeta;
  private entries = new Map<string, ZipEntry>();
  private treeCache: FileNode[] | null = null;
  private textCache = new Map<string, string>();
  private blobCache = new Map<string, Blob>();

  private constructor(
    fileName: string,
    private zip: JSZip,
    private rawIndex: Map<string, string>, // 规范化路径 → ZIP 原始路径
  ) {
    this.meta = { name: fileName, source: 'zip' };
  }

  /** 打开 File 对象。throw bad-zip / empty-zip / zip-insecure */
  static async open(file: File): Promise<ZipSource> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return ZipSource.openBytes(bytes, file.name);
  }

  /** 打开字节数组（Tauri 拖入：Rust 读字节 → base64/ArrayBuffer → 此处） */
  static async openBytes(bytes: Uint8Array, fileName: string): Promise<ZipSource> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      throw new RepoError('bad-zip', `cannot unzip: ${fileName}`);
    }
    return ZipSource.fromZip(zip, fileName);
  }

  static async fromZip(zip: JSZip, fileName: string): Promise<ZipSource> {
    const source = new ZipSource(fileName, zip, new Map());
    source.index();
    if (source.entries.size === 0) {
      throw new RepoError('empty-zip', `no valid files in zip: ${fileName}`);
    }
    return source;
  }

  private index(): void {
    this.zip.forEach((relPath, entry) => {
      if (entry.dir) return;
      // __MACOSX 与 ._* 资源分叉文件是噪音，直接跳过
      if (relPath.startsWith('__MACOSX/') || relPath.split('/').pop()?.startsWith('._')) return;

      // 安全校验：穿越/绝对路径/保留名一律抛 zip-insecure
      const safe = sanitizeZipPath(relPath);

      const size =
        (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
      this.entries.set(safe, { path: safe, size, lazy: this.zip.file(relPath) });
      this.rawIndex.set(safe, relPath);
    });
  }

  async listFiles(): Promise<FileNode[]> {
    if (this.treeCache) return this.treeCache;
    const flat: FileNode[] = [...this.entries.values()].map((e) => ({
      path: e.path,
      type: 'file',
      size: e.size,
    }));
    this.treeCache = buildTree(flat);
    return this.treeCache;
  }

  async readFile(path: string): Promise<string> {
    const cached = this.textCache.get(path);
    if (cached !== undefined) return cached;
    const entry = this.entries.get(path);
    if (!entry?.lazy) throw new RepoError('not-found', `no entry: ${path}`);
    const text = await entry.lazy.async('string');
    this.textCache.set(path, text);
    return text;
  }

  async readBlob(path: string): Promise<Blob> {
    const cached = this.blobCache.get(path);
    if (cached) return cached;
    const entry = this.entries.get(path);
    if (!entry?.lazy) throw new RepoError('not-found', `no entry: ${path}`);
    const data = (await entry.lazy.async('uint8array')) as Uint8Array;
    const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeFor(path) });
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
    this.rawIndex.clear();
    this.textCache.clear();
    this.blobCache.clear();
    this.treeCache = null;
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
