/**
 * MetricsPanel —— 代码度量面板
 *
 * 展示（对应提示词）：
 *   · 项目健康评分 + 平均复杂度
 *   · 文件级度量概览（圈复杂度 / 认知复杂度 / SLOC）
 *   · 函数级复杂度排序（超过阈值标红：圈复杂度 > 15、认知复杂度 > 25）
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COGNITIVE_WARN, CYCLOMATIC_WARN, type FileMetrics } from '../analysis/metrics';
import type { AnalysisState } from '../hooks/useCodeAnalysis';

interface Props {
  state: AnalysisState;
  onClose: () => void;
  onOpenFile: (file: string, line: number) => void;
}

type Mode = 'functions' | 'files';

export default function MetricsPanel({ state, onClose, onOpenFile }: Props) {
  const { t } = useTranslation(['analysis', 'common']);
  const [mode, setMode] = useState<Mode>('functions');

  /** 全仓库函数按圈复杂度降序（只展示前 50，避免长列表） */
  const topFunctions = useMemo(
    () =>
      state.metrics
        .flatMap((f) => f.functions.map((fn) => ({ ...fn, path: f.path })))
        .sort((a, b) => b.cyclomatic - a.cyclomatic || b.cognitive - a.cognitive)
        .slice(0, 50),
    [state.metrics],
  );

  const health = state.health;

  return (
    <section
      className="flex h-72 shrink-0 flex-col border-t"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
      aria-label={t('analysis:metrics')}
    >
      <header className="flex shrink-0 items-center gap-3 px-3 py-2">
        <span className="text-xs font-semibold">{t('analysis:metrics')}</span>

        {health && (
          <span className="flex items-center gap-2 text-[11px]">
            <span style={{ color: 'var(--c-text-2)' }}>{t('analysis:healthScore')}</span>
            <span
              className="rounded px-1.5 py-[1px] font-semibold"
              style={{
                background: health.score >= 80 ? 'var(--c-success)' : health.score >= 60 ? 'var(--c-warning)' : 'var(--c-error)',
                color: '#1b1d23',
              }}
            >
              {health.score}
            </span>
            <span style={{ color: 'var(--c-text-2)' }}>
              {t('analysis:avgComplexity', {
                cyc: health.avgCyclomatic,
                cog: health.avgCognitive,
              })}
            </span>
            {health.highComplexityCount > 0 && (
              <span style={{ color: 'var(--c-error)' }}>
                {t('analysis:highComplexity', { count: health.highComplexityCount })}
              </span>
            )}
          </span>
        )}

        <div className="ms-auto flex items-center gap-2">
          <button
            onClick={() => setMode('functions')}
            className="rounded border px-2 py-0.5 text-[11px]"
            style={{
              borderColor: mode === 'functions' ? 'var(--c-primary)' : 'var(--c-border)',
              color: mode === 'functions' ? 'var(--c-primary)' : 'var(--c-text)',
            }}
          >
            {t('analysis:metricFunctions')}
          </button>
          <button
            onClick={() => setMode('files')}
            className="rounded border px-2 py-0.5 text-[11px]"
            style={{
              borderColor: mode === 'files' ? 'var(--c-primary)' : 'var(--c-border)',
              color: mode === 'files' ? 'var(--c-primary)' : 'var(--c-text)',
            }}
          >
            {t('analysis:metricFiles')}
          </button>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('common:close')}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {state.running && (
          <p className="text-[12px]" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:analyzing')} {state.progress.parsed}/{state.progress.total}
          </p>
        )}
        {!state.running && state.empty && (
          <p className="text-[12px]" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:noGraph')}
          </p>
        )}

        {!state.running && mode === 'functions' && topFunctions.length > 0 && (
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr style={{ color: 'var(--c-text-2)' }}>
                <th className="border-b px-2 py-1 text-start" style={{ borderColor: 'var(--c-border)' }}>
                  {t('analysis:metricName')}
                </th>
                <th className="border-b px-2 py-1 text-start" style={{ borderColor: 'var(--c-border)' }}>
                  {t('analysis:metricLocation')}
                </th>
                <th className="border-b px-2 py-1 text-end" style={{ borderColor: 'var(--c-border)' }}>
                  {t('analysis:cyclomatic')}
                </th>
                <th className="border-b px-2 py-1 text-end" style={{ borderColor: 'var(--c-border)' }}>
                  {t('analysis:cognitive')}
                </th>
                <th className="border-b px-2 py-1 text-end" style={{ borderColor: 'var(--c-border)' }}>
                  {t('analysis:sloc')}
                </th>
              </tr>
            </thead>
            <tbody>
              {topFunctions.map((fn) => (
                <tr
                  key={`${fn.path}:${fn.line}:${fn.name}`}
                  className="cursor-pointer hover:bg-[var(--c-bg-3)]"
                  onClick={() => onOpenFile(fn.path, fn.line)}
                >
                  <td className="max-w-[240px] truncate px-2 py-0.5" style={{ color: 'var(--c-text)' }}>
                    {fn.name}
                  </td>
                  <td className="max-w-[320px] truncate px-2 py-0.5 font-mono" style={{ color: 'var(--c-text-2)' }}>
                    {fn.path}:{fn.line}
                  </td>
                  <td
                    className="px-2 py-0.5 text-end font-mono"
                    style={{ color: fn.cyclomatic > CYCLOMATIC_WARN ? 'var(--c-error)' : 'var(--c-text)', fontWeight: fn.cyclomatic > CYCLOMATIC_WARN ? 600 : 400 }}
                  >
                    {fn.cyclomatic}
                  </td>
                  <td
                    className="px-2 py-0.5 text-end font-mono"
                    style={{ color: fn.cognitive > COGNITIVE_WARN ? 'var(--c-error)' : 'var(--c-text)' }}
                  >
                    {fn.cognitive}
                  </td>
                  <td className="px-2 py-0.5 text-end font-mono" style={{ color: 'var(--c-text-2)' }}>
                    {fn.sloc}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!state.running && mode === 'files' && state.metrics.length > 0 && (
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr style={{ color: 'var(--c-text-2)' }}>
                <th className="border-b px-2 py-1 text-start" style={{ borderColor: 'var(--c-border)' }}>
                  {t('analysis:metricFile')}
                </th>
                <th className="border-b px-2 py-1 text-end" style={{ borderColor: 'var(--c-border)' }}>
                  {t('analysis:cyclomatic')}
                </th>
                <th className="border-b px-2 py-1 text-end" style={{ borderColor: 'var(--c-border)' }}>
                  {t('analysis:cognitive')}
                </th>
                <th className="border-b px-2 py-1 text-end" style={{ borderColor: 'var(--c-border)' }}>
                  {t('analysis:sloc')}
                </th>
                <th className="border-b px-2 py-1 text-end" style={{ borderColor: 'var(--c-border)' }}>
                  {t('analysis:metricFunctionsCount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {state.metrics.map((m: FileMetrics) => (
                <tr
                  key={m.path}
                  className="cursor-pointer hover:bg-[var(--c-bg-3)]"
                  onClick={() => onOpenFile(m.path, 1)}
                >
                  <td className="max-w-[420px] truncate px-2 py-0.5 font-mono" style={{ color: 'var(--c-text)' }}>
                    {m.path}
                  </td>
                  <td
                    className="px-2 py-0.5 text-end font-mono"
                    style={{ color: m.maxFunctionComplexity > CYCLOMATIC_WARN ? 'var(--c-error)' : 'var(--c-text)' }}
                  >
                    {m.cyclomatic}
                  </td>
                  <td className="px-2 py-0.5 text-end font-mono">{m.cognitive}</td>
                  <td className="px-2 py-0.5 text-end font-mono" style={{ color: 'var(--c-text-2)' }}>
                    {m.sloc}
                  </td>
                  <td className="px-2 py-0.5 text-end font-mono" style={{ color: 'var(--c-text-2)' }}>
                    {m.functions.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
