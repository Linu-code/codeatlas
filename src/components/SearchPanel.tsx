/**
 * SearchPanel —— 全局代码搜索面板（Cmd/Ctrl+Shift+F）
 *
 * 能力（对应提示词）：
 *   · 正则搜索（可选区分大小写）
 *   · 结果按"文件 → 匹配行"分组，显示匹配计数
 *   · 点击结果跳转到文件并高亮该行
 *   · 搜索在 Web Worker 中执行，10 秒超时自动终止（不卡 UI）
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchState } from '../hooks/useGlobalSearch';

interface Props {
  state: SearchState;
  /** 是否已加载项目 */
  hasProject: boolean;
  onSearch: (pattern: string, flags: string) => void;
  onClose: () => void;
  onOpenFile: (file: string, line: number) => void;
}

export default function SearchPanel({ state, hasProject, onSearch, onClose, onOpenFile }: Props) {
  const { t } = useTranslation(['analysis', 'common', 'errors']);
  const [pattern, setPattern] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);

  /** 按文件聚合结果，渲染成 文件 → 行 的两级结构 */
  const grouped = useMemo(() => {
    const map = new Map<string, typeof state.results>();
    for (const r of state.results) {
      const list = map.get(r.path) ?? [];
      list.push(r);
      map.set(r.path, list);
    }
    return [...map.entries()];
  }, [state.results]);

  const submit = () => {
    if (!pattern.trim()) return;
    onSearch(pattern, caseSensitive ? 'g' : 'gi');
  };

  return (
    <section
      className="flex h-72 shrink-0 flex-col border-t"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
      aria-label={t('analysis:globalSearch')}
    >
      <header className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="text-xs font-semibold">{t('analysis:globalSearch')}</span>

        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
          placeholder={t('analysis:searchPlaceholder')}
          className="h-7 w-72 rounded border px-2 font-mono text-[12px]"
          style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
          autoFocus
        />
        <label className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          {t('analysis:searchCaseSensitive')}
        </label>
        <button
          onClick={submit}
          disabled={!hasProject || state.running}
          className="rounded border px-2 py-0.5 text-[11px] disabled:opacity-40"
          style={{ borderColor: 'var(--c-border)' }}
        >
          {state.running ? t('common:searching') : t('common:search')}
        </button>

        {!state.running && state.totalMatches > 0 && (
          <span className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:searchResultCount', {
              count: state.totalMatches,
              files: state.filesMatched,
            })}
          </span>
        )}
        {state.truncated && (
          <span className="text-[11px]" style={{ color: 'var(--c-warning)' }}>
            {t('analysis:searchTruncated', { count: state.results.length })}
          </span>
        )}

        <button onClick={onClose} className="ms-auto rounded px-2 py-0.5 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
          {t('common:close')}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 text-[12px]">
        {state.running && (
          <p style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:searchRunning')} {state.progress.loaded}/{state.progress.total}
          </p>
        )}
        {state.error && (
          <p style={{ color: 'var(--c-error)' }}>
            {state.error.code === 'timeout' ? t('analysis:searchTimeout') : t('errors:invalid-input')}
          </p>
        )}
        {!state.running && !state.error && state.results.length === 0 && (
          <p style={{ color: 'var(--c-text-2)' }}>{t('common:noResult')}</p>
        )}

        {grouped.map(([file, matches]) => (
          <div key={file} className="mb-2">
            <div className="mb-1 truncate font-medium" style={{ color: 'var(--c-text)' }} title={file}>
              {file}
              <span className="ms-2 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
                {matches.length}
              </span>
            </div>
            {matches.map((m) => (
              <button
                key={`${m.path}:${m.line}`}
                data-search-result
                onClick={() => onOpenFile(m.path, m.line)}
                className="flex w-full gap-2 rounded px-2 py-0.5 text-start hover:bg-[var(--c-bg-3)]"
                title={m.text}
              >
                <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--c-primary)' }}>
                  {m.line}
                </span>
                <span className="truncate font-mono text-[11.5px]" style={{ color: 'var(--c-text-2)' }}>
                  {m.text}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
