/**
 * ReferencesPanel —— 符号引用面板（转到定义 / 查找引用）
 *
 * 展示：
 *   · 定义位置（可能多处，跨文件）
 *   · 引用列表（文件:行号，点击跳转）
 *   · 未找到定义时的提示（外部依赖/未索引）
 */

import { useTranslation } from 'react-i18next';
import type { SymbolEntry } from '../analysis/scopeGraph';

interface Props {
  symbol: string | null;
  entry: SymbolEntry | null;
  /** 是否已完成索引 */
  indexed: boolean;
  onClose: () => void;
  onOpenFile: (file: string, line: number) => void;
}

export default function ReferencesPanel({ symbol, entry, indexed, onClose, onOpenFile }: Props) {
  const { t } = useTranslation(['analysis', 'common']);

  return (
    <section
      className="flex h-64 shrink-0 flex-col border-t"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
      aria-label={t('analysis:findReferences')}
    >
      <header className="flex shrink-0 items-center gap-3 px-3 py-2">
        <span className="text-xs font-semibold">
          {t('analysis:findReferences')} {symbol ? `· ${symbol}` : ''}
        </span>
        {entry && (
          <span className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:refStats', {
              defs: entry.definitions.length,
              refs: entry.references.length,
              files: entry.fileCount,
            })}
          </span>
        )}
        <button
          onClick={onClose}
          className="ms-auto rounded px-2 py-0.5 text-[11px]"
          style={{ color: 'var(--c-text-2)' }}
        >
          {t('common:close')}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 text-[12px]">
        {!symbol && (
          <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:pickSymbolHint')}</p>
        )}

        {symbol && !indexed && (
          <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:indexing')}</p>
        )}

        {symbol && indexed && !entry && (
          <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:noDefinition')}</p>
        )}

        {entry && (
          <>
            <div className="mb-2">
              <div className="mb-1 text-[11px] font-semibold" style={{ color: 'var(--c-text-2)' }}>
                {t('analysis:definition')}
              </div>
              {entry.definitions.length === 0 ? (
                <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:noDefinition')}</p>
              ) : (
                entry.definitions.map((d) => (
                  <button
                    key={`${d.file}:${d.line}`}
                    onClick={() => onOpenFile(d.file, d.line)}
                    className="flex w-full gap-2 rounded px-2 py-0.5 text-start hover:bg-[var(--c-bg-3)]"
                  >
                    <span className="truncate font-mono text-[11.5px]" style={{ color: 'var(--c-primary)' }}>
                      {d.file}
                    </span>
                    <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--c-text-2)' }}>
                      :{d.line}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div>
              <div className="mb-1 text-[11px] font-semibold" style={{ color: 'var(--c-text-2)' }}>
                {t('analysis:references')}
              </div>
              {entry.references.length === 0 ? (
                <p style={{ color: 'var(--c-text-2)' }}>{t('common:noResult')}</p>
              ) : (
                entry.references.map((r) => (
                  <button
                    key={`${r.file}:${r.line}:${r.column}`}
                    onClick={() => onOpenFile(r.file, r.line)}
                    className="flex w-full gap-2 rounded px-2 py-0.5 text-start hover:bg-[var(--c-bg-3)]"
                  >
                    <span className="truncate font-mono text-[11.5px]" style={{ color: 'var(--c-text)' }}>
                      {r.file}
                    </span>
                    <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--c-text-2)' }}>
                      :{r.line}:{r.column}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
