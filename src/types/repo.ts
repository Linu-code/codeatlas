/**
 * CodeAtlas 核心类型定义
 *
 * RepoFS 是数据层统一契约：GitHubSource 与 ZipSource 都实现它，
 * 上层 UI / 分析层完全不感知数据来自网络还是本地 ZIP。
 */

/** 文件树节点。path 恒为 POSIX 风格相对路径（'src/index.ts'） */
export interface FileNode {
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FileNode[];
}

export interface RepoMeta {
  /** 展示名：GitHub 为 owner/repo，ZIP 为文件名 */
  name: string;
  source: 'github' | 'zip';
  owner?: string;
  repo?: string;
  branch?: string;
  /** 仓库星标数（搜索结果/仓库信息可拿到，ZIP 无） */
  stars?: number;
}

/** README 候选文件名（按优先级） */
export const README_CANDIDATES = [
  'README.md',
  'readme.md',
  'Readme.md',
  'README.MD',
  'README_zh.md',
  'README-zh.md',
  'README.markdown',
] as const;

/** 常见二进制扩展名：走 Blob 读取而非 UTF-8 文本 */
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp',
  'pdf', 'zip', 'gz', 'tar', 'woff', 'woff2', 'ttf', 'eot',
  'mp4', 'mp3', 'wav', 'exe', 'dll', 'so', 'dylib', 'wasm',
]);

export function isBinaryPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTS.has(ext);
}

/** 错误码：直接对应 i18n errors 命名空间的 key（提示词要求的所有错误场景） */
export type RepoErrorCode =
  | 'invalid-input'   // 输入既不是 URL 也不是可搜索内容
  | 'not-found'       // 仓库不存在（匿名访问私有仓库也是 404）
  | 'private'         // 带 Token 访问私有仓库被拒
  | 'timeout'         // 网络超时
  | 'rate-limit'      // GitHub API 限流
  | 'network'         // 其他网络错误
  | 'bad-zip'         // ZIP 格式错误
  | 'empty-zip'       // ZIP 无有效文件
  | 'zip-insecure'    // ZIP 内含路径穿越条目（安全拦截）
  | 'parse-error';    // 文件解析失败

export class RepoError extends Error {
  /** ES2020 lib 下 Error.cause 未声明，这里自行声明 */
  cause?: unknown;

  constructor(
    public readonly code: RepoErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    if (options?.cause !== undefined) this.cause = options.cause;
    this.name = 'RepoError';
  }
}

/** 数据层统一接口 */
export interface RepoFS {
  readonly meta: RepoMeta;
  /** 完整文件树（目录已构建、已排序） */
  listFiles(): Promise<FileNode[]>;
  /** UTF-8 文本读取（带缓存） */
  readFile(path: string): Promise<string>;
  /** 二进制读取（图片/字体等） */
  readBlob(path: string): Promise<Blob>;
  /** 按扩展名自动选择文本/二进制 */
  readAny(path: string): Promise<string | Blob>;
  /** 定位并读取 README */
  findReadme(): Promise<{ path: string; text: string } | null>;
  /** 释放内存缓存 */
  dispose(): void;
}

/** GitHub 仓库搜索结果（顶栏下拉展示项） */
export interface RepoSearchResult {
  fullName: string;      // owner/repo
  description: string;
  stars: number;
  language: string | null;
}
