/**
 * CallGraphPanel —— 调用图面板
 *
 * 职责：面板头部（统计 / 重新分析 / 关闭）+ 把 Mermaid 渲染交给共享的 MermaidView
 * （渲染、SVG/PNG 导出、复制源码三处逻辑三个面板一致，见 MermaidView 注释）。
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { CallGraphState } from '../hooks/useCodeAnalysis';
import MermaidView from './MermaidView';

interface Props {
  state: CallGraphState;
  onAnalyze: () => void;
  onClose: () => void;
  /** 点击节点跳转到文件（file:line） */
  onOpenFile?: (file: string, line: number) => void;
}

export default function CallGraphPanel({ state, onAnalyze, onClose, onOpenFile }: Props) {
  const { t } = useTranslation(['analysis', 'common']);
  const graph = state.graph;

  /** 点击节点 → 打开对应文件（节点标签形如 "fnName (行号)"） */
  const handleNodeClick = useCallback(
    (label: string) => {
      if (!onOpenFile || !graph) return;
      const name = label.replace(/\s*\(\d+\)\s*$/, '').trim();
      const hit = graph.nodes.find((n) => n.name === name);
      if (hit) onOpenFile(hit.file, hit.line);
    },
    [graph, onOpenFile],
  );

  return (
    <section
      className="flex h-72 shrink-0 flex-col border-t"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
      aria-label={t('analysis:callGraph')}
    >
      <header className="flex shrink-0 items-center gap-3 px-3 py-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--c-text)' }}>
          {t('analysis:callGraph')}
        </span>

        {graph && (
          <span className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:graphStats', {
              nodes: graph.nodes.length,
              edges: graph.edges.length,
              parsed: graph.parsedFiles,
              total: graph.parsedFiles + graph.failedFiles.length,
            })}
          </span>
        )}
        {graph?.truncated && (
          <span className="text-[11px]" style={{ color: 'var(--c-warning)' }}>
            {t('analysis:graphTruncated', { kept: graph.nodes.length, total: graph.totalNodes })}
          </span>
        )}
        {graph && graph.failedFiles.length > 0 && (
          <span className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:parseFailedCount', { count: graph.failedFiles.length })}
          </span>
        )}

        <div className="ms-auto flex items-center gap-2">
          <button
            onClick={onAnalyze}
            disabled={state.running}
            className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {state.running
              ? `${t('analysis:analyzing')} ${state.progress.parsed}/${state.progress.total}`
              : t('analysis:analyze')}
          </button>
          <button onClick={onClose} className="rounded px-2 py-1 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('common:close')}
          </button>
        </div>
      </header>

      {state.running && state.progress.total === 0 && (
        <p className="px-3 text-xs" style={{ color: 'var(--c-text-2)' }}>
          {t('analysis:analyzing')}
        </p>
      )}
      {!state.running && state.empty && (
        <p className="px-3 text-xs" style={{ color: 'var(--c-text-2)' }}>
          {t('analysis:noGraph')}
        </p>
      )}

      <MermaidView code={state.mermaid} onNodeClick={handleNodeClick} exportName="codeatlas-callgraph" />
    </section>
  );
}
