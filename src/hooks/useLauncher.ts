/**
 * useLauncher —— 顶栏"命令中心"的全局状态（搜索 / 历史 / 提交）
 *
 * 与项目数据解耦：顶栏是一个**全局**入口，提交 GitHub 网址或 owner/repo
 * 会打开一个项目标签；输入关键词则走 GitHub 仓库搜索并展示下拉。
 * 因此这部分状态放在工作区级别（而非某个项目内部）。
 *
 * 注：原先这些逻辑在 useRepo 内；多项目工作区下上移到此处，
 * useRepo 只保留单个项目自身的浏览/分析职责。
 */

import { useCallback, useState } from 'react';
import { RepoError, RepoSearchResult } from '../types/repo';
import { searchRepositories } from '../sources/github';
import { resolveTopBarInput } from '../utils/githubUrl';
import { workspace } from '../workspace/workspace';

const HISTORY_LIMIT = 10;

export function useLauncher(token: string) {
  const [searchResults, setSearchResults] = useState<RepoSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState<RepoError | null>(null);

  const pushHistory = useCallback((input: string) => {
    setHistory((prev) => [input, ...prev.filter((h) => h !== input)].slice(0, HISTORY_LIMIT));
  }, []);

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

  /** 顶栏提交入口：空输入无响应；搜索走下拉；网址/短写打开一个项目标签 */
  const submit = useCallback(
    async (raw: string) => {
      const resolved = resolveTopBarInput(raw);
      if (!resolved) return;
      pushHistory(raw.trim());
      if (resolved.kind === 'search') {
        await runSearch(resolved.query);
        return;
      }
      setSearchResults([]);
      workspace.openGithub(
        resolved.kind === 'url'
          ? resolved.parsed
          : { owner: resolved.owner, repo: resolved.repo, branch: null, subDir: null },
      );
    },
    [pushHistory, runSearch],
  );

  /** 下拉选中某条搜索结果 → 打开对应仓库 */
  const pickResult = useCallback((fullName: string) => {
    setSearchResults([]);
    const [owner, repo] = fullName.split('/');
    if (owner && repo) workspace.openGithub({ owner, repo, branch: null, subDir: null });
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    searchResults,
    searchLoading,
    history,
    error,
    submit,
    pickResult,
    clearError,
  };
}
