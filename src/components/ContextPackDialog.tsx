/**
 * ContextPackDialog —— AI 上下文包生成
 *
 * 交互（对应提示词）：
 *   · 点击「生成 AI 上下文包」→ 在 5 秒内生成（实测毫秒级，取决于已分析文件数）
 *   · 展示 token 预算 / 实际 token / 收纳符号数 / 是否截断
 *   · 预览 Markdown、复制、下载 .codeatlas/context.md 与 codeatlas-context.json
 *   · 预算可在设置页调整（默认 1000，验收要求 ≤ 2000）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContextPack, PackIntent } from '../analysis/contextPack';
import type { SliceOutcome } from '../analysis/slice';
import type { AiConfig } from '../types/config';
import { AiError, buildExplainPrompt, streamChatMessages } from '../utils/aiClient';
import { runExpandingChat, type ExpandRound } from '../utils/aiExpand';
import { loadAiKey } from '../utils/configStore';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface Props {
  open: boolean;
  pack: ContextPack | null;
  generating: boolean;
  budget: number;
  /** AI 解读配置；provider 为 off 时按钮引导用户去设置页 */
  ai: AiConfig;
  /** 生成；传 budget / intent 时按该组合重新生成 */
  onGenerate: (budget?: number, intent?: PackIntent, focusQuery?: string) => void;
  /** 持久化预算（写入配置），可选 */
  onBudgetChange?: (budget: number) => void;
  /** 按需展开：把 `路径:行号` 解析成带行号的代码片段 */
  onSlice: (address: string) => Promise<SliceOutcome>;
  /** 当前用途（受控）：由 ProjectView 持有，保证与已生成的包一致，并能持久化 */
  intent: PackIntent;
  onIntentChange: (intent: PackIntent) => void;
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
  ai,
  onGenerate,
  onBudgetChange,
  onSlice,
  intent,
  onIntentChange,
  onClose,
}: Props) {
  const { t } = useTranslation(['analysis', 'common']);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open, onClose);
  const [tab, setTab] = useState<'md' | 'json' | 'ai' | 'slice'>('md');
  const [copied, setCopied] = useState(false);
  const [focusQuery, setFocusQuery] = useState('');
  // ---------- 按需展开 ----------
  const [sliceAddr, setSliceAddr] = useState('');
  const [sliceOut, setSliceOut] = useState<SliceOutcome | null>(null);
  const [sliceBusy, setSliceBusy] = useState(false);

  const runSlice = useCallback(async () => {
    if (sliceBusy) return;
    setTab('slice');
    setSliceBusy(true);
    try {
      setSliceOut(await onSlice(sliceAddr));
    } finally {
      setSliceBusy(false);
    }
  }, [onSlice, sliceAddr, sliceBusy]);

  // ---------- AI 解读（默认关闭；只有点按钮才发请求） ----------
  const [aiText, setAiText] = useState('');
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRounds, setAiRounds] = useState<ExpandRound[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const stopAi = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAiRunning(false);
  }, []);

  const runAi = useCallback(async () => {
    if (!pack) return;
    setTab('ai');
    setAiError(null);

    if (ai.provider === 'off') {
      setAiError(t('analysis:aiNotConfigured'));
      return;
    }

    stopAi();
    setAiText('');
    setAiRounds([]);
    setAiRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // 索引包里没有实现细节，模型会输出 `@@expand 路径:行号` 索取；
      // 这里捕获、切片、回灌，用户只看到干净正文 + 「已展开 N 处」。
      await runExpandingChat({
        messages: [{ role: 'user', content: buildExplainPrompt(pack.markdown, { expand: true }) }],
        chat: (messages, handlers) =>
          streamChatMessages(ai, loadAiKey(), messages, {
            signal: handlers.signal,
            onDelta: handlers.onDelta,
          }),
        resolve: onSlice,
        maxRounds: 3,
        signal: controller.signal,
        onDelta: (delta) => setAiText((prev) => prev + delta),
        onRound: (round) => setAiRounds((prev) => [...prev, round]),
      });
    } catch (e) {
      if (e instanceof AiError && e.code === 'aborted') return;
      const message = e instanceof Error ? e.message : String(e);
      setAiError(t('analysis:aiFailed', { message }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setAiRunning(false);
    }
  }, [pack, ai, t, stopAi, onSlice]);

  // 关闭对话框 / 组件卸载：中断在途请求（避免响应回来时对已卸载组件 setState）
  useEffect(() => {
    if (open) return undefined;
    stopAi();
    return undefined;
  }, [open, stopAi]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const sliceText = sliceOut?.kind === 'ok' ? sliceOut.text : '';
  const pickCandidate = useCallback(
    async (path: string, line: number) => {
      const addr = `${path}:${line}`;
      setSliceAddr(addr);
      setSliceBusy(true);
      try {
        setSliceOut(await onSlice(addr));
      } finally {
        setSliceBusy(false);
      }
    },
    [onSlice],
  );

  const copy = useCallback(async () => {
    const text =
      tab === 'slice'
        ? sliceText
        : tab === 'ai'
          ? aiText
          : tab === 'md'
            ? pack?.markdown
            : pack?.json;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [pack, tab, aiText, sliceText]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
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
          <select
            data-pack-intent
            value={intent}
            onChange={(e) => {
              const next = e.target.value as PackIntent;
              onIntentChange(next);
              onGenerate(undefined, next, focusQuery);
            }}
            disabled={generating}
            aria-label={t('analysis:packIntent')}
            title={t('analysis:packIntentHint')}
            className="ms-auto shrink-0 rounded border px-1.5 py-0.5 text-xs disabled:opacity-40"
            style={{
              background: 'var(--c-bg)',
              borderColor: 'var(--c-border)',
              color: 'var(--c-text)',
            }}
          >
            <option value="overview">{t('analysis:intentOverview')}</option>
            <option value="health">{t('analysis:intentHealth')}</option>
            <option value="api">{t('analysis:intentApi')}</option>
            <option value="focus">{t('analysis:intentFocus')}</option>
            <option value="index">{t('analysis:intentIndex')}</option>
          </select>
          <div className="flex items-center gap-1" role="group" aria-label={t('common:maxTokens')}>
            {[2000, 8000, 32000, 64000].map((b) => (
              <button
                key={b}
                onClick={() => {
                  onBudgetChange?.(b);
                  onGenerate(b, intent, focusQuery);
                }}
                disabled={generating}
                title={`${b} tokens`}
                className="rounded border px-1.5 py-0.5 disabled:opacity-40"
                style={{
                  borderColor: budget === b ? 'var(--c-primary)' : 'var(--c-border)',
                  color: budget === b ? 'var(--c-primary)' : 'var(--c-text-2)',
                }}
              >
                {b / 1000}k
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {(
              [
                ['md', 'Markdown'],
                ['json', 'JSON'],
                ['ai', 'AI'],
                ['slice', t('analysis:sliceTab')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                data-pack-tab={id}
                onClick={() => setTab(id)}
                className="rounded border px-2 py-0.5"
                style={{
                  borderColor: tab === id ? 'var(--c-primary)' : 'var(--c-border)',
                  color: tab === id ? 'var(--c-primary)' : 'var(--c-text)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {intent === 'focus' && (
          <div className="mb-2 flex items-center gap-2">
            <input
              data-pack-focus
              value={focusQuery}
              onChange={(e) => setFocusQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !generating) onGenerate(undefined, 'focus', focusQuery);
              }}
              placeholder={t('analysis:focusQueryPlaceholder')}
              aria-label={t('analysis:focusQueryPlaceholder')}
              className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
              style={{
                background: 'var(--c-bg)',
                borderColor: 'var(--c-border)',
                color: 'var(--c-text)',
              }}
            />
            <button
              data-pack-focus-run
              onClick={() => onGenerate(undefined, 'focus', focusQuery)}
              disabled={generating}
              className="shrink-0 rounded px-3 py-1 text-white disabled:opacity-50"
              style={{ background: 'var(--c-primary)' }}
            >
              {t('analysis:focusQueryRun')}
            </button>
            <span className="shrink-0" style={{ color: 'var(--c-text-2)' }}>
              {t('analysis:focusQueryHint')}
            </span>
          </div>
        )}

        <div
          className="mb-3 min-h-[200px] flex-1 overflow-auto rounded border p-3"
          style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)' }}
        >
          {tab === 'slice' ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <input
                  data-slice-address
                  value={sliceAddr}
                  onChange={(e) => setSliceAddr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runSlice();
                  }}
                  placeholder={t('analysis:slicePlaceholder')}
                  aria-label={t('analysis:slicePlaceholder')}
                  className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                  style={{
                    background: 'var(--c-bg-2)',
                    borderColor: 'var(--c-border)',
                    color: 'var(--c-text)',
                  }}
                />
                <button
                  data-slice-run
                  onClick={() => void runSlice()}
                  disabled={sliceBusy}
                  className="shrink-0 rounded px-3 py-1 text-white disabled:opacity-50"
                  style={{ background: 'var(--c-primary)' }}
                >
                  {t('analysis:sliceRun')}
                </button>
              </div>
              <p className="mb-2 m-0" style={{ color: 'var(--c-text-2)' }}>
                {t('analysis:sliceHint')}
              </p>

              {sliceBusy && <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:analyzing')}</p>}

              {!sliceBusy && !sliceOut && (
                <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:sliceEmpty')}</p>
              )}

              {sliceOut?.kind === 'ok' && (
                <pre data-slice-output className="m-0 whitespace-pre font-mono text-[11.5px] leading-5">
                  {sliceOut.text}
                </pre>
              )}

              {sliceOut?.kind === 'invalid' && (
                <p style={{ color: 'var(--c-warning)' }}>
                  {sliceOut.reason === 'empty'
                    ? t('analysis:sliceEmpty')
                    : sliceOut.reason === 'read-failed'
                      ? t('analysis:sliceReadFailed')
                      : t('analysis:sliceNotFound')}
                </p>
              )}

              {sliceOut?.kind === 'ambiguous' && (
                <>
                  <p style={{ color: 'var(--c-warning)' }}>{t('analysis:sliceAmbiguous')}</p>
                  <ul className="m-0 list-none p-0">
                    {sliceOut.candidates.map((c) => (
                      <li key={`${c.path}:${c.line}`}>
                        <button
                          onClick={() => void pickCandidate(c.path, c.line)}
                          className="mb-1 rounded border px-2 py-0.5 text-left"
                          style={{ borderColor: 'var(--c-border)', color: 'var(--c-primary)' }}
                        >
                          {c.path}:{c.line}
                          {c.name ? ` — ${c.name}` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : tab === 'ai' ? (
            <>
              {aiError && <p style={{ color: 'var(--c-warning)' }}>{aiError}</p>}
              {aiRounds.length > 0 && (
                <p
                  data-ai-rounds
                  className="m-0 mb-1"
                  style={{ color: 'var(--c-text-2)' }}
                  title={aiRounds.map((r) => `${r.address}${r.ok ? '' : ' (×)'}`).join('\n')}
                >
                  {t('analysis:aiExpanded', {
                    count: aiRounds.length,
                    tokens: aiRounds.reduce((n, r) => n + r.tokens, 0),
                  })}
                </p>
              )}
              {aiRunning && !aiText && (
                <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:aiRunning')}</p>
              )}
              {aiText && (
                <pre className="m-0 whitespace-pre-wrap font-sans text-[12px] leading-6">
                  {aiText}
                  {aiRunning && <span style={{ color: 'var(--c-primary)' }}>▍</span>}
                </pre>
              )}
              {!aiRunning && !aiText && !aiError && (
                <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:aiIdle')}</p>
              )}
            </>
          ) : (
            <>
              {generating && <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:analyzing')}</p>}
              {!generating && !pack && (
                <p style={{ color: 'var(--c-text-2)' }}>{t('analysis:contextPackEmpty')}</p>
              )}
              {pack && (
                <pre className="m-0 whitespace-pre-wrap font-mono text-[11.5px] leading-5">
                  {tab === 'md' ? pack.markdown : pack.json}
                </pre>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center gap-2">
          <button
            onClick={() => onGenerate(undefined, intent, focusQuery)}
            disabled={generating}
            className="rounded px-3 py-1 text-white disabled:opacity-50"
            style={{ background: 'var(--c-primary)' }}
          >
            {generating ? t('analysis:analyzing') : t('analysis:contextPackGenerate')}
          </button>
          <button
            data-ai-explain
            onClick={() => void runAi()}
            disabled={!pack || generating || aiRunning}
            className="rounded border px-3 py-1 disabled:opacity-40"
            style={{ borderColor: 'var(--c-primary)', color: 'var(--c-primary)' }}
          >
            {aiRunning ? t('analysis:aiRunning') : t('analysis:aiExplain')}
          </button>
          {aiRunning && (
            <button
              onClick={stopAi}
              className="rounded border px-3 py-1"
              style={{ borderColor: 'var(--c-warning)', color: 'var(--c-warning)' }}
            >
              {t('analysis:aiStop')}
            </button>
          )}
          <button
            onClick={() => void copy()}
            disabled={tab === 'ai' ? !aiText : !pack}
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
