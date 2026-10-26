/**
 * persistence.ts —— 工作区持久化（重启后恢复上次打开的项目）
 *
 * 只持久化**可重建**的数据源：
 *   · github —— owner/repo/branch/subDir，重新拉取即可
 *   · local  —— 绝对路径，重新扫描即可
 * ZIP 是内存中的 File / 字节流，重启后无法还原，因此不持久化（打开时提示用户重新选择）。
 *
 * 存储位置用 localStorage（Tauri WebView 与浏览器一致），不写 `~/.codeatlas/config.json`：
 * 工作区是高频变化的会话状态，不该与用户配置混在一起反复落盘。
 *
 * 多窗口约定：由「普通启动」的窗口负责恢复与保存；拖入 ZIP/目录打开的窗口带
 * windowParams，既不恢复也不保存，避免多窗口互相覆盖。
 */

import type { ProjectEntry } from './workspace';

const KEY = 'codeatlas.workspace.v1';

export interface SavedGithub {
  owner: string;
  repo: string;
  branch: string | null;
  subDir: string | null;
}

export interface SavedProject {
  kind: 'github' | 'local';
  parsed?: SavedGithub;
  rootPath?: string;
}

export interface SavedWorkspace {
  projects: SavedProject[];
  activeIndex: number;
}

/**
 * 把当前工作区快照压成可持久化结构。
 * 只保留 github / local；activeIndex 指向**压缩后**列表中的位置。
 */
export function serializeWorkspace(
  projects: ProjectEntry[],
  activeId: string,
): SavedWorkspace {
  const saved: SavedProject[] = [];
  let activeIndex = 0;

  for (const p of projects) {
    const src = p.source;
    if (src.kind === 'github') {
      if (p.id === activeId) activeIndex = saved.length;
      saved.push({ kind: 'github', parsed: src.parsed });
    } else if (src.kind === 'local') {
      if (p.id === activeId) activeIndex = saved.length;
      saved.push({ kind: 'local', rootPath: src.rootPath });
    }
  }

  if (saved.length === 0) activeIndex = 0;
  return { projects: saved, activeIndex };
}

/** 结构校验：磁盘上的数据可能来自旧版本或被手工改坏，一律先校验再用 */
export function isValidSaved(value: unknown): value is SavedWorkspace {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.projects)) return false;
  if (typeof v.activeIndex !== 'number' || !Number.isFinite(v.activeIndex)) return false;

  return v.projects.every((p) => {
    if (!p || typeof p !== 'object') return false;
    const item = p as Record<string, unknown>;
    if (item.kind === 'local') return typeof item.rootPath === 'string' && item.rootPath.length > 0;
    if (item.kind === 'github') {
      const parsed = item.parsed as Record<string, unknown> | undefined;
      return (
        !!parsed &&
        typeof parsed.owner === 'string' &&
        typeof parsed.repo === 'string' &&
        parsed.owner.length > 0 &&
        parsed.repo.length > 0
      );
    }
    return false;
  });
}

export function loadWorkspace(): SavedWorkspace | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidSaved(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveWorkspace(saved: SavedWorkspace): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // 隐私模式 / 配额超限：持久化失败不应影响正常使用
  }
}
