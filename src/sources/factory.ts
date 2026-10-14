/**
 * 数据源工厂 —— UI 层唯一入口。
 *
 * 打包策略：GitHubSource 轻量（零依赖）静态引入；
 * ZipSource 依赖 JSZip（约 100 kB），LocalDirSource 依赖 Tauri IPC（仅桌面端），
 * 两者都改为动态 import，只在用户真正打开时才加载对应 chunk —— 满足冷启动 <2s 的目标。
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

/**
 * 打开本地目录（仅 Tauri 桌面端）。
 * 浏览器（无 Tauri IPC）直接抛 not-found-dir —— 调用方应在 UI 层提前用
 * isTauri() 判断并给出「仅桌面版支持」的提示，这里只是兜底。
 */
export async function createLocalDirRepo(rootPath: string): Promise<RepoFS> {
  const { LocalDirSource } = await import('./local');
  return LocalDirSource.open(rootPath);
}

export { GitHubSource };
