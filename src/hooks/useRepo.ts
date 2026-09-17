/**
 * useRepo —— 项目状态中枢
 *
 * 职责：
 *   · 顶栏输入解析 → 加载仓库 / 搜索仓库 / 打开 ZIP（File 或字节流）
 *   · 文件树、README、标签页、当前文件内容
 *   · 缓存刷新（清 IndexedDB 后重拉）
 *   · 错误统一为 RepoError（组件层按 code 取 i18n 文案）
 *
 * 多窗口约定：每个 Tauri 窗口各持有一份本 hook 实例，状态天然隔离。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RepoFS, RepoError, RepoSearchResult, FileNode, isBinaryPath } from '../types/repo';
import { createGithubRepo, createZipRepo, createZipRepoFromBytes } from '../sources/factory';
import { searchRepositories } from '../sources/github';
import { resolveTopBarInput } from '../utils/githubUrl';
import { isPreviewable, prismLangOf } from '../theme/themes';

export type TabKind = 'code' | 'markdown' | 'unsupported' | 'binary' | 'loading';

export interface OpenTab {
  path: string;
  kind: TabKind;
  content: string | null;
  /** Prism 语言（kind === 'code' 时有效） */
  language: string;
  error: RepoError | null;
}

export interface UseRepoOptions {
  token?: string;
  jsdelivrFallback?: boolean;
}

const HISTORY_LIMIT = 10;

/** 无扩展名的常见文本文件 */
const BARE_TEXT_FILES = ['license', 'makefile', 'dockerfile', 'procfile', 'authors'];
const EXTRA_TEXT_EXTS = new Set(['txt', 'log', 'env', 'gitignore', 'editorconfig', 'lock', 'csv', 'tsv']);

function classify(path: string): TabKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (isBinaryPath(path)) return 'binary';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (isPreviewable(path) || EXTRA_TEXT_EXTS.has(ext)) return 'code';
  const base = (path.split('/').pop() ?? '').toLowerCase();
  if (BARE_TEXT_FILES.includes(base)) return 'code';
  return 'unsupported';
}

export function useRepo(options: UseRepoOptions = {}) {
  const { token, jsdelivrFallback } = options;

  const [fs, setFs] = useState<RepoFS | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [readme, setReadme] = useState<{ path: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RepoError | null>(null);

  const [searchResults, setSearchResults] = useState<RepoSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  const requestIdRef = useRef(0);
  /** 记住最后一次加载目标，供"刷新"复用 */
  const lastTargetRef = useRef<{ owner: string; repo: string; branch: string | null; subDir: string | null } | null>(null);

  const pushHistory = useCallback((input: string) => {
    setHistory((prev) => [input, ...prev.filter((h) => h !== input)].slice(0, HISTORY_LIMIT));
  }, []);

  /** 打开文件到标签页（已打开则激活） */
  const openFile = useCallback(async (path: string, repo: RepoFS) => {
    const kind = classify(path);
    setActiveTab(path);
    setTabs((prev) => {
      if (prev.some((t) => t.path === path)) return prev;
      return [
        ...prev,
        {
          path,
          kind: kind === 'unsupported' || kind === 'binary' ? kind : 'loading',
          content: null,
          language: prismLangOf(path),
          error: null,
        },
      ];
    });
    if (kind === 'unsupported' || kind === 'binary') return;

    try {
      const text = await repo.readFile(path);
      setTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, kind, content: text, error: null } : t)),
      );
    } catch (e) {
      const err = e instanceof RepoError ? e : new RepoError('parse-error', String(e));
      setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, error: err } : t)));
    }
  }, []);

  /** 统一的"装载数据源"流程：拉树 + 找 README + 自动打开 README */
  const mountSource = useCallback(
    async (source: RepoFS, rid: number) => {
      const [files, readmeFile] = await Promise.all([source.listFiles(), source.findReadme()]);
      if (rid !== requestIdRef.current) return;
      setFs(source);
      setTree(files);
      setReadme(readmeFile);
      setTabs(
        readmeFile
          ? [
              {
                path: readmeFile.path,
                kind: 'markdown',
                content: readmeFile.text,
                language: 'markdown',
                error: null,
              },
            ]
          : [],
      );
      setActiveTab(readmeFile?.path ?? null);
    },
    [],
  );

  /** 加载 GitHub 仓库 */
  const loadRepo = useCallback(
    async (
      parsed: { owner: string; repo: string; branch: string | null; subDir: string | null },
      opts: { forceRefresh?: boolean } = {},
    ) => {
      const rid = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      setSearchResults([]);
      lastTargetRef.current = parsed;
      try {
        const source = createGithubRepo(parsed, { token, jsdelivrFallback, forceRefresh: opts.forceRefresh });
        if (opts.forceRefresh && 'clearCache' in source) {
          await (source as unknown as { clearCache: () => Promise<void> }).clearCache();
        }
        await mountSource(source, rid);
      } catch (e) {
        if (rid !== requestIdRef.current) return;
        setError(e instanceof RepoError ? e : new RepoError('network', String(e)));
      } finally {
        if (rid === requestIdRef.current) setLoading(false);
      }
    },
    [jsdelivrFallback, mountSource, token],
  );

  /** 打开本地 ZIP（File 对象，浏览器 file input） */
  const loadZip = useCallback(
    async (file: File) => {
      const rid = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      setSearchResults([]);
      lastTargetRef.current = null;
      try {
        await mountSource(await createZipRepo(file), rid);
      } catch (e) {
        if (rid !== requestIdRef.current) return;
        setError(e instanceof RepoError ? e : new RepoError('bad-zip', String(e)));
      } finally {
        if (rid === requestIdRef.current) setLoading(false);
      }
    },
    [mountSource],
  );

  /** 打开本地 ZIP（字节流：Tauri 拖入 / 新窗口按路径读取） */
  const loadZipBytes = useCallback(
    async (bytes: Uint8Array, fileName: string) => {
      const rid = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      setSearchResults([]);
      lastTargetRef.current = null;
      try {
        await mountSource(await createZipRepoFromBytes(bytes, fileName), rid);
      } catch (e) {
        if (rid !== requestIdRef.current) return;
        setError(e instanceof RepoError ? e : new RepoError('bad-zip', String(e)));
      } finally {
        if (rid === requestIdRef.current) setLoading(false);
      }
    },
    [mountSource],
  );

  /** 刷新：清缓存重拉（验收：支持手动刷新） */
  const refresh = useCallback(async () => {
    const target = lastTargetRef.current;
    if (!target) return;
    await loadRepo(target, { forceRefresh: true });
  }, [loadRepo]);

  /** 搜索仓库 */
  const runSearch = useCallback(
    async (query: string) => {
      setSearchLoading(true);
      setError(null);
      try {
        setSearchResults(await searchRepositories(query, token));
      } catch (e) {
        setError(e instanceof RepoError ? e : new RepoError('network', String(e)));
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [token],
  );

  /** 顶栏提交入口 */
  const submit = useCallback(
    async (raw: string) => {
      const resolved = resolveTopBarInput(raw);
      if (!resolved) return; // 空输入无响应
      pushHistory(raw.trim());
      if (resolved.kind === 'search') {
        await runSearch(resolved.query);
        return;
      }
      await loadRepo(
        resolved.kind === 'url'
          ? resolved.parsed
          : { owner: resolved.owner, repo: resolved.repo, branch: null, subDir: null },
      );
    },
    [loadRepo, pushHistory, runSearch],
  );

  const closeTab = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      setActiveTab((cur) => (cur === path ? (next.length ? next[next.length - 1].path : null) : cur));
      return next;
    });
  }, []);

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTab(null);
  }, []);

  useEffect(() => {
    return () => {
      fs?.dispose();
    };
  }, [fs]);

  return {
    fs,
    tree,
    readme,
    loading,
    error,
    searchResults,
    searchLoading,
    tabs,
    activeTab,
    activeTabData: tabs.find((t) => t.path === activeTab) ?? null,
    history,
    submit,
    loadZip,
    loadZipBytes,
    refresh,
    openFile: (path: string) => (fs ? openFile(path, fs) : Promise.resolve()),
    closeTab,
    closeAllTabs,
    clearError: () => setError(null),
    clearSearch: () => setSearchResults([]),
  };
}
