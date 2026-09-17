/**
 * GitHubSource —— 在线数据源
 *
 * 请求策略（节省 API 配额，默认白名单仅 GitHub 域）：
 *   1. 文件树：GET /repos/{o}/{r}/git/trees/{branch}?recursive=1（一次拿全树）
 *      URL 未指定分支时先 GET /repos/{o}/{r} 探测 default_branch。
 *   2. 文件内容：GET raw.githubusercontent.com/{o}/{r}/{branch}/{path}（不计 API 配额）
 *   3. 搜索：GET /search/repositories?q={q}&per_page=10&sort=stars
 *   4. Token 可选（设置页填入），仅用于提高限流额度。
 *   5. jsDelivr 兜底默认关闭（网络白名单约束），开启后生效。
 */

import {
  FileNode,
  README_CANDIDATES,
  RepoError,
  RepoFS,
  RepoMeta,
  RepoSearchResult,
  isBinaryPath,
} from '../types/repo';
import { flattenFiles } from './tree';
import { buildTree } from './tree';
import { fetchWithTimeout, toRepoError } from './http';
import {
  clearRepoCache,
  getCachedFile,
  getCachedTree,
  putCachedFile,
  putCachedTree,
  repoKey,
} from './cache';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const JSDELIVR_CDN = 'https://cdn.jsdelivr.net/gh';
const JSDELIVR_DATA = 'https://data.jsdelivr.com/v1/packages/gh';

export interface GitHubSourceOptions {
  owner: string;
  repo: string;
  branch?: string | null;
  subDir?: string | null;
  token?: string;
  /** jsDelivr 兜底开关（来自用户设置，默认关） */
  jsdelivrFallback?: boolean;
  /** 是否使用 IndexedDB 缓存（默认开） */
  cacheEnabled?: boolean;
  /** 强制忽略缓存重新拉取（刷新按钮） */
  forceRefresh?: boolean;
}

interface GhTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

/** jsDelivr 数据 API 的平铺文件清单 */
interface JsdelivrFile {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

export class GitHubSource implements RepoFS {
  readonly meta: RepoMeta;
  private token?: string;
  private allowJsdelivr: boolean;
  private cacheEnabled: boolean;
  private forceRefresh: boolean;
  private treeCache: FileNode[] | null = null;
  private textCache = new Map<string, string>();
  private blobCache = new Map<string, Blob>();

  constructor(private opts: GitHubSourceOptions) {
    this.meta = {
      name: `${opts.owner}/${opts.repo}`,
      source: 'github',
      owner: opts.owner,
      repo: opts.repo,
      branch: opts.branch ?? undefined,
    };
    this.token = opts.token;
    this.allowJsdelivr = opts.jsdelivrFallback ?? false;
    this.cacheEnabled = opts.cacheEnabled ?? true;
    this.forceRefresh = opts.forceRefresh ?? false;
  }

  /** 缓存键（分支探测完成后才有意义） */
  private cacheKey(): string {
    return repoKey(this.opts.owner, this.opts.repo, this.meta.branch ?? 'HEAD');
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  /** 分支探测：显式分支 > URL 分支 > default_branch（一次 repos 请求） */
  private async resolveBranch(): Promise<string> {
    if (this.opts.branch) return this.opts.branch;
    if (this.meta.branch) return this.meta.branch;

    const res = await fetchWithTimeout(
      `${API}/repos/${this.opts.owner}/${this.opts.repo}`,
      { headers: this.headers() },
      15_000,
      this.allowJsdelivr,
    );
    if (!res.ok) throw await toRepoError(res, `${this.opts.owner}/${this.opts.repo}`);
    const data = (await res.json()) as { default_branch?: string; stargazers_count?: number };
    // 顺带记录星标数（顶栏展示用）
    if (typeof data.stargazers_count === 'number') this.meta.stars = data.stargazers_count;
    const branch = data.default_branch || 'main';
    this.meta.branch = branch;
    return branch;
  }

  async listFiles(): Promise<FileNode[]> {
    if (this.treeCache) return this.treeCache;

    const branch = await this.resolveBranch();

    // ① 缓存命中：秒开（刷新时跳过）
    if (this.cacheEnabled && !this.forceRefresh) {
      const cached = await getCachedTree(this.cacheKey());
      if (cached && cached.length > 0) {
        this.treeCache = cached;
        return cached;
      }
    }

    let nodes: FileNode[];
    try {
      nodes = await this.fetchTreeViaApi(branch);
    } catch (e) {
      // ② 网络失败（离线/限流）时，即便刷新也回退到旧缓存，保证内网可用
      const stale = this.cacheEnabled ? await getCachedTree(this.cacheKey()) : null;
      if (stale && stale.length > 0) {
        this.treeCache = stale;
        return stale;
      }
      // API 失败且用户开启了兜底 → jsDelivr 静态清单；否则原样抛错
      if (!this.allowJsdelivr) throw e;
      nodes = await this.fetchTreeViaJsdelivr(branch);
    }

    this.treeCache = nodes;
    if (this.cacheEnabled) void putCachedTree(this.cacheKey(), nodes);
    return nodes;
  }

  /** 清空本仓库缓存（刷新按钮调用） */
  async clearCache(): Promise<void> {
    this.treeCache = null;
    this.textCache.clear();
    await clearRepoCache(this.cacheKey());
  }

  private async fetchTreeViaApi(branch: string): Promise<FileNode[]> {
    const prefix = this.opts.subDir ? this.opts.subDir + '/' : '';
    const res = await fetchWithTimeout(
      `${API}/repos/${this.opts.owner}/${this.opts.repo}/git/trees/${branch}?recursive=1`,
      { headers: this.headers() },
      15_000,
      this.allowJsdelivr,
    );
    if (!res.ok) throw await toRepoError(res, 'git/trees');
    const data = (await res.json()) as { tree?: GhTreeEntry[]; truncated?: boolean };
    if (!data.tree) throw new RepoError('not-found', 'empty tree');

    const entries = data.tree
      .filter((e) => !prefix || e.path.startsWith(prefix))
      .map((e) => ({
        path: prefix ? e.path.slice(prefix.length) : e.path,
        type: (e.type === 'tree' ? 'dir' : 'file') as FileNode['type'],
        size: e.size,
      }))
      .filter((e) => e.path.length > 0);

    return buildTree(entries);
  }

  private async fetchTreeViaJsdelivr(branch: string): Promise<FileNode[]> {
    const url = `${JSDELIVR_DATA}/${this.opts.owner}/${this.opts.repo}@${branch}?structure=flat`;
    const res = await fetchWithTimeout(url, {}, 15_000, true);
    if (!res.ok) throw await toRepoError(res, 'jsdelivr data');
    const data = (await res.json()) as { files?: JsdelivrFile[] };
    const prefix = this.opts.subDir ? this.opts.subDir + '/' : '';
    const entries: FileNode[] = (data.files ?? [])
      .filter((f) => f.type === 'file')
      .map((f) => ({
        path: prefix ? f.name.slice(prefix.length) : f.name,
        type: 'file' as const,
        size: f.size,
      }))
      .filter((e) => e.path.length > 0 && e.path !== (prefix.replace(/\/$/, '').split('/').pop() ?? ''));
    return buildTree(entries);
  }

  async readFile(path: string): Promise<string> {
    const cached = this.textCache.get(path);
    if (cached !== undefined) return cached;

    // ① IndexedDB 缓存命中（刷新时跳过）
    if (this.cacheEnabled && !this.forceRefresh) {
      const diskCached = await getCachedFile(this.cacheKey(), path);
      if (diskCached !== null) {
        this.textCache.set(path, diskCached);
        return diskCached;
      }
    }

    const branch = await this.resolveBranch();
    const rel = this.opts.subDir ? `${this.opts.subDir}/${path}` : path;
    const sources = [`${RAW}/${this.opts.owner}/${this.opts.repo}/${branch}/${rel}`];
    if (this.allowJsdelivr) {
      sources.push(`${JSDELIVR_CDN}/${this.opts.owner}/${this.opts.repo}@${branch}/${rel}`);
    }
    for (const url of sources) {
      const res = await fetchWithTimeout(url, {}, 15_000, this.allowJsdelivr);
      if (res.ok) {
        const text = await res.text();
        this.textCache.set(path, text);
        if (this.cacheEnabled) void putCachedFile(this.cacheKey(), path, text);
        return text;
      }
    }

    // ② 网络不可用时回退旧缓存（企业内网场景）
    const stale = this.cacheEnabled ? await getCachedFile(this.cacheKey(), path) : null;
    if (stale !== null) return stale;

    throw new RepoError('not-found', `readFile failed: ${path}`);
  }

  async readBlob(path: string): Promise<Blob> {
    const cached = this.blobCache.get(path);
    if (cached) return cached;

    const branch = await this.resolveBranch();
    const rel = this.opts.subDir ? `${this.opts.subDir}/${path}` : path;
    const res = await fetchWithTimeout(
      `${RAW}/${this.opts.owner}/${this.opts.repo}/${branch}/${rel}`,
      {},
      15_000,
      this.allowJsdelivr,
    );
    if (!res.ok) throw await toRepoError(res, `blob: ${path}`);
    const blob = await res.blob();
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
          // 内容获取失败就试下一个候选名
        }
      }
    }
    return null;
  }

  dispose(): void {
    this.textCache.clear();
    this.blobCache.clear();
    this.treeCache = null;
  }
}

// ---------- GitHub Search API（顶栏下拉） ----------

interface GhSearchResponse {
  items?: {
    full_name: string;
    description: string | null;
    stargazers_count: number;
    language: string | null;
  }[];
}

/** 仓库搜索：按 star 降序取前 10（提示词要求） */
export async function searchRepositories(
  query: string,
  token?: string,
): Promise<RepoSearchResult[]> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url =
    `${API}/search/repositories?q=${encodeURIComponent(query)}` +
    `&per_page=10&sort=stars&order=desc`;
  const res = await fetchWithTimeout(url, { headers }, 15_000);
  if (!res.ok) throw await toRepoError(res, 'search');
  const data = (await res.json()) as GhSearchResponse;
  return (data.items ?? []).map((it) => ({
    fullName: it.full_name,
    description: it.description ?? '',
    stars: it.stargazers_count ?? 0,
    language: it.language,
  }));
}
