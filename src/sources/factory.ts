/**
 * 数据源工厂 —— UI 层唯一入口。
 *
 * 打包策略：GitHubSource 轻量（零依赖）静态引入；
 * ZipSource 依赖 JSZip（约 100 kB），改为动态 import，
 * 只在用户真正打开 ZIP 时才加载对应 chunk —— 满足冷启动 <2s 的目标。
 */

import { RepoFS } from '../types/repo';
import { GitHubSource } from './github';

/** 从解析结果创建 GitHub 数据源 */
export function createGithubRepo(
  parsed: { owner: string; repo: string; branch: string | null; subDir: string | null },
  opts: { token?: string; jsdelivrFallback?: boolean; forceRefresh?: boolean } = {},
): RepoFS {
  return new GitHubSource({
    owner: parsed.owner,
    repo: parsed.repo,
    branch: parsed.branch,
    subDir: parsed.subDir,
    token: opts.token,
    jsdelivrFallback: opts.jsdelivrFallback,
    forceRefresh: opts.forceRefresh,
  });
}

/** 打开本地 ZIP（File 对象）—— 动态加载 JSZip */
export async function createZipRepo(file: File): Promise<RepoFS> {
  const { ZipSource } = await import('./zip');
  return ZipSource.open(file);
}

/** 从字节数组打开 ZIP（Tauri 拖入场景：Rust 读字节后经 IPC 传入） */
export async function createZipRepoFromBytes(bytes: Uint8Array, fileName: string): Promise<RepoFS> {
  const { ZipSource } = await import('./zip');
  return ZipSource.openBytes(bytes, fileName);
}

export { GitHubSource };
