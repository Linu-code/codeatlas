/**
 * ContextPackDialog —— AI 上下文包生成
 *
 * 交互（对应提示词）：
 *   · 点击「生成 AI 上下文包」→ 在 5 秒内生成（实测毫秒级，取决于已分析文件数）
 *   · 展示 token 预算 / 实际 token / 收纳符号数 / 是否截断
 *   · 预览 Markdown、复制、下载 .codeatlas/context.md 与 codeatlas-context.json
 *   · 预算可在设置页调整（默认 1000，验收要求 ≤ 2000）
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContextPack } from '../analysis/contextPack';

interface Props {
  open: boolean;
  pack: ContextPack | null;
  generating: boolean;
  budget: number;
  onGenerate: () => void;
  onClose: () => void;
}

function download(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ContextPackDialog({
  open,
  pack,
  generating,
  budget,
  onGenerate,
  onClose,
}: Props) {
  const { t } = useTranslation(['analysis', 'common']);
  const [tab, setTab] = useState<'md' | 'json'>('md');
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!pack) return;
    await navigator.clipboard.writeText(tab === 'md' ? pack.markdown : pack.json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [pack, tab]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={t('analysis:contextPack')}
    >
      <div
        className="flex max-h-[80vh] w-[760px] max-w-[94vw] flex-col rounded-lg border p-4 text-xs shadow-2xl"
        style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center gap-3">
          <h2 className="text-sm font-semibold">{t('analysis:contextPack')}</h2>
          {pack && (
            <>
              <span style={{ color: 'var(--c-text-2)' }}>
                {t('analysis:contextPackTokens', { tokens: pack.tokens, budget })}
              </span>
              <span style={{ color: 'var(--c-text-2)' }}>
                {t('analysis:contextPackSymbols', {
                  included: pack.includedSymbols,
                  total: pack.totalSymbols,
                })}
              </span>
              {pack.truncated && (
                <span style={{ color: 'var(--c-warning)' }}>{t('analysis:contextPackTruncated')}</span>
              )}
            </>
          )}
          <div className="ms-auto flex items-center gap-2">
            <button
              onClick={() => setTab('md')}
              className="rounded border px-2 py-0.5"
              style={{
                borderColor: tab === 'md' ? 'var(--c-primary)' : 'var(--c-border)',
                color: tab === 'md' ? 'var(--c-primary)' : 'var(--c-text)',
              }}
            >
              Markdown
            </button>
            <button
              onClick={() => setTab('json')}
              className="rounded border px-2 py-0.5"
              style={{
                borderColor: tab === 'json' ? 'var(--c-primary)' : 'var(--c-border)',
                color: tab === 'json' ? 'var(--c-primary)' : 'var(--c-text)',
              }}
            >
              JSON
            </button>
          </div>
        </header>

        <div
          className="mb-3 min-h-[200px] flex-1 overflow-auto rounded border p-3"
          style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)' }}
        >
          {generating && <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:analyzing')}</p>}
          {!generating && !pack && <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:contextPackEmpty')}</p>}
          {pack && (
            <pre className="m-0 whitespace-pre-wrap font-mono text-[11.5px] leading-5">
              {tab === 'md' ? pack.markdown : pack.json}
            </pre>
          )}
        </div>

        <footer className="flex items-center gap-2">
          <button
            onClick={onGenerate}
            disabled={generating}
            className="rounded px-3 py-1 text-white disabled:opacity-50"
            style={{ background: 'var(--c-primary)' }}
          >
            {generating ? t('analysis:analyzing') : t('analysis:contextPackGenerate')}
          </button>
          <button
            onClick={() => void copy()}
            disabled={!pack}
            className="rounded border px-3 py-1 disabled:opacity-40"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {copied ? t('common:copied') : t('common:copy')}
          </button>
          <button
            onClick={() => pack && download(pack.markdown, 'context.md', 'text/markdown')}
            disabled={!pack}
            className="rounded border px-3 py-1 disabled:opacity-40"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {t('analysis:downloadMd')}
          </button>
          <button
            onClick={() => pack && download(pack.json, 'codeatlas-context.json', 'application/json')}
            disabled={!pack}
            className="rounded border px-3 py-1 disabled:opacity-40"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {t('analysis:downloadJson')}
          </button>
          <button
            onClick={onClose}
            className="ms-auto rounded border px-3 py-1"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {t('common:close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
