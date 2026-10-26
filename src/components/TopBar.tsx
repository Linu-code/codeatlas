/**
 * TopBar —— 命令中心
 *
 * 交互契约（对应提示词需求）：
 *   · 圆角输入框居中，占顶栏 40~60% 宽度
 *   · 回车触发搜索/加载，无需按钮
 *   · 空输入回车 → 无响应
 *   · 搜索中：输入框内 spinner + i18n「搜索中...」
 *   · 输入仓库名 → 下拉前 10 条（star / 描述 / 语言），↑↓ 选择、回车确认、Esc 关闭
 *   · 输入完整网址 → 回车直接加载，不显示下拉
 *   · 空输入时 ↑↓ 调出历史记录（最近 10 条）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RepoSearchResult } from '../types/repo';
import { formatStars } from '../utils/format';
import MainMenu from './MainMenu';

interface TopBarProps {
  searchResults: RepoSearchResult[];
  searchLoading: boolean;
  history: string[];
  onSubmit: (raw: string) => void;
  onPickResult: (fullName: string) => void;
  onOpenZip: (file: File) => void;
  /** N5①：Tauri 桌面端用原生对话框打开本地目录；浏览器传入 null 即隐藏 */
  onOpenLocalDir: (() => void) | null;
  hasProject: boolean;
  canRefresh: boolean;
  onCloseProject: () => void;
  onOpenSettings: () => void;
}

export default function TopBar({
  searchResults,
  searchLoading,
  history,
  onSubmit,
  onPickResult,
  onOpenZip,
  onOpenLocalDir,
  hasProject,
  canRefresh,
  onCloseProject,
  onOpenSettings,
}: TopBarProps) {
  const { t, i18n } = useTranslation(['common', 'viewer']);
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 输入完整网址时不显示下拉（提示词明确要求）
  const looksLikeUrl = useMemo(() => /github\.com/i.test(value.trim()), [value]);
  const showDropdown = open && !looksLikeUrl && searchResults.length > 0;

  useEffect(() => {
    if (searchResults.length > 0 && !looksLikeUrl) {
      setOpen(true);
      setHighlight(searchResults.length > 0 ? 0 : -1);
    } else if (looksLikeUrl) {
      setOpen(false);
    }
  }, [searchResults, looksLikeUrl]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 下拉导航
    if (showDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % searchResults.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + searchResults.length) % searchResults.length);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === 'Enter' && highlight >= 0) {
        e.preventDefault();
        const pick = searchResults[highlight];
        setValue(pick.fullName);
        setOpen(false);
        onPickResult(pick.fullName);
        return;
      }
    }

    // 空输入时 ↑↓ 调出历史记录
    if (!value.trim() && history.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next);
        setValue(history[next]);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setValue(next >= 0 ? history[next] : '');
        return;
      }
    }

    if (e.key === 'Enter') {
      const raw = value.trim();
      if (!raw) return; // 空输入无响应
      setOpen(false);
      setHistoryIndex(-1);
      onSubmit(raw);
    }
  };

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-3 border-b px-3"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
    >
      <div className="flex shrink-0 items-center gap-2">
        <span
          className="grid h-7 w-7 place-items-center rounded font-bold text-white"
          style={{ background: 'var(--c-primary)' }}
        >
          CA
        </span>
        <span className="text-sm font-semibold">CodeAtlas</span>
      </div>

      {/* 命令中心：占顶栏可用宽度的 40~60%（flex-[2] 配合同级 flex-1 构成该比例） */}
      <div className="relative mx-auto flex w-full max-w-[60%] min-w-[280px] flex-1 justify-center">
        <div className="relative w-full">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setHistoryIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => searchResults.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={t('common:search')}
            aria-label={t('common:search')}
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls="topbar-search-listbox"
            aria-autocomplete="list"
            aria-activedescendant={
              showDropdown && highlight >= 0 ? `topbar-opt-${highlight}` : undefined
            }
            className="h-8 w-full rounded-full border px-4 text-sm outline-none transition-colors"
            style={{
              background: 'var(--c-bg)',
              borderColor: 'var(--c-border)',
              color: 'var(--c-text)',
            }}
          />
          {(searchLoading || (value && !looksLikeUrl)) && (
            <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs" style={{ color: 'var(--c-text-2)' }}>
              {searchLoading ? (
                <span className="flex items-center gap-2">
                  <span className="ca-spinner" aria-hidden />
                  {t('common:searching')}
                </span>
              ) : null}
            </span>
          )}

          {showDropdown && (
            <ul
              id="topbar-search-listbox"
              className="absolute top-9 z-30 max-h-80 w-full overflow-auto rounded-lg border py-1 shadow-xl"
              style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
              role="listbox"
            >
              {searchResults.map((r, i) => (
                <li
                  key={r.fullName}
                  id={`topbar-opt-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setValue(r.fullName);
                    setOpen(false);
                    onPickResult(r.fullName);
                  }}
                  className="cursor-pointer px-3 py-2"
                  style={{ background: i === highlight ? 'var(--c-bg-3)' : 'transparent' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{r.fullName}</span>
                    <span className="shrink-0 text-xs" style={{ color: 'var(--c-text-2)' }}>
                      ★ {formatStars(r.stars, i18n.language)} · {r.language ?? '—'}
                    </span>
                  </div>
                  {r.description && (
                    <div className="truncate text-xs" style={{ color: 'var(--c-text-2)' }}>
                      {r.description}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          data-testid="open-settings"
          onClick={onOpenSettings}
          aria-label={t('common:settingsTitle')}
          title={t('common:settingsTitle')}
          className="grid h-8 w-8 place-items-center rounded border hover:bg-[var(--c-bg-3)]"
          style={{ borderColor: 'var(--c-border)', background: 'var(--c-bg)', color: 'var(--c-text)' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
            <circle cx="9" cy="6" r="2.2" fill="var(--c-bg)" />
            <circle cx="16" cy="12" r="2.2" fill="var(--c-bg)" />
            <circle cx="8" cy="18" r="2.2" fill="var(--c-bg)" />
          </svg>
        </button>
        <MainMenu
          hasProject={hasProject}
          canRefresh={canRefresh}
          onOpenZip={() => fileRef.current?.click()}
          onOpenLocalDir={onOpenLocalDir}
          onCloseProject={onCloseProject}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onOpenZip(f);
            e.target.value = '';
          }}
        />
      </div>
    </header>
  );
}
