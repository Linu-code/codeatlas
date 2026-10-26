/**
 * CommandPalette —— 统一命令面板（N2）
 *
 * `Ctrl/Cmd + K` 打开（文件 / 符号 / 命令统一入口）
 * `Ctrl/Cmd + T` 打开并直接进入符号模式
 *
 * 设计：
 *   · 面板本身是"哑"的 —— 条目由 App 组装（带各自的 onRun），这里只负责
 *     模糊过滤、分组展示与键盘导航，便于单测与复用。
 *   · 键盘：↑↓ 选择、Enter 执行、Esc 关闭；鼠标悬停同步选中项。
 *   · 列表最多渲染 50 条 —— 大仓库有上万文件，全量渲染会卡死，过滤后再切片。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rankByFuzzy } from '../utils/fuzzy';
import { platformizeShortcut } from '../utils/platform';
import { useFocusTrap } from '../hooks/useFocusTrap';

export type PaletteSection = 'command' | 'file' | 'symbol';

export interface PaletteItem {
  id: string;
  section: PaletteSection;
  /** 主显示文本 */
  label: string;
  /** 右侧灰色说明（如文件路径、符号所在文件） */
  hint?: string;
  /** 参与匹配的补充关键词（如文件完整路径、命令拼音/英文别名） */
  keywords?: string;
  onRun: () => void;
}

interface Props {
  open: boolean;
  /** 打开时的模式：symbol 表示只搜符号（Ctrl+T） */
  mode: 'all' | 'symbol';
  items: PaletteItem[];
  onClose: () => void;
}

const SECTION_ORDER: PaletteSection[] = ['command', 'file', 'symbol'];

export default function CommandPalette({ open, mode, items, onClose }: Props) {
  const { t } = useTranslation(['analysis', 'common']);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // 焦点陷阱：Tab 循环 + Esc 关闭 + 关闭后焦点归还
  useFocusTrap(dialogRef, open, onClose);

  const pool = useMemo(
    () => (mode === 'symbol' ? items.filter((i) => i.section === 'symbol') : items),
    [items, mode],
  );

  const ranked = useMemo(
    () => rankByFuzzy(query, pool, (i) => ({ label: i.label, keywords: i.keywords }), 50),
    [pool, query],
  );

  // 每次打开重置状态并聚焦输入框
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open, mode]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // 选中项滚入可视区
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-palette-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const run = (index: number) => {
    const hit = ranked[index];
    if (!hit) return;
    onClose();
    hit.item.onRun();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, ranked.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      run(activeIndex);
    }
  };

  const sectionTitle: Record<PaletteSection, string> = {
    command: t('analysis:paletteCommands'),
    file: t('analysis:paletteFiles'),
    symbol: t('analysis:paletteSymbols'),
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-40 flex justify-center pt-24"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-palette-overlay
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('analysis:paletteTitle')}
        className="flex max-h-[60vh] w-[600px] flex-col overflow-hidden rounded-lg border shadow-2xl"
        style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)' }}
        data-command-palette
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={mode === 'symbol' ? t('analysis:paletteSymbolPlaceholder') : t('analysis:palettePlaceholder')}
          aria-label={t('analysis:paletteTitle')}
          role="combobox"
          aria-expanded={ranked.length > 0}
          aria-controls="palette-listbox"
          aria-autocomplete="list"
          aria-activedescendant={ranked.length > 0 ? `palette-opt-${activeIndex}` : undefined}
          className="h-10 shrink-0 border-b px-3 text-sm outline-none"
          style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
        />

        <div ref={listRef} id="palette-listbox" role="listbox" className="min-h-0 flex-1 overflow-auto py-1">
          {ranked.length === 0 && (
            <p className="px-3 py-4 text-xs" style={{ color: 'var(--c-text-2)' }}>
              {t('analysis:paletteNoResult')}
            </p>
          )}

          {SECTION_ORDER.map((section) => {
            const inSection = ranked
              .map((r, index) => ({ ...r, index }))
              .filter((r) => r.item.section === section);
            if (inSection.length === 0) return null;
            return (
              <div key={section} role="group" aria-label={sectionTitle[section]}>
                <p
                  className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--c-text-2)' }}
                >
                  {sectionTitle[section]}
                </p>
                {inSection.map(({ item, index }) => (
                  <button
                    key={item.id}
                    id={`palette-opt-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-palette-index={index}
                    data-palette-item={item.section}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => run(index)}
                    className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs"
                    style={{
                      background: index === activeIndex ? 'var(--c-bg-3)' : undefined,
                      color: 'var(--c-text)',
                    }}
                  >
                    <span className="truncate">{item.label}</span>
                    {item.hint && (
                      <span className="ms-auto shrink-0 truncate text-[10px]" style={{ color: 'var(--c-text-2)' }}>
                        {item.hint}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <p
          className="shrink-0 border-t px-3 py-1 text-[10px]"
          style={{ borderColor: 'var(--c-border)', color: 'var(--c-text-2)' }}
        >
          {platformizeShortcut(t('analysis:paletteHint'))}
        </p>
      </div>
    </div>
  );
}
