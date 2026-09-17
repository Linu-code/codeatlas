/**
 * CallGraphPanel —— 调用图面板
 *
 * 功能（对应提示词）：
 *   · Mermaid 渲染调用关系图（动态 import，不拖累首屏）
 *   · 导出 SVG（Blob 下载，保留矢量清晰度）
 *   · 导出 PNG（SVG → Image → Canvas 2 倍缩放 → toBlob，保证清晰可读）
 *   · 复制 Mermaid 代码
 *   · 统计信息：函数数 / 调用数 / 解析文件数 / 截断提示 / 解析失败数
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CallGraphState } from '../hooks/useCodeAnalysis';

interface Props {
  state: CallGraphState;
  onAnalyze: () => void;
  onClose: () => void;
  /** 点击节点跳转到文件（file:line） */
  onOpenFile?: (file: string, line: number) => void;
}

/** 下载 Blob */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CallGraphPanel({ state, onAnalyze, onClose, onOpenFile }: Props) {
  const { t } = useTranslation(['analysis', 'common']);
  const hostRef = useRef<HTMLDivElement>(null);
  const [svgText, setSvgText] = useState('');
  const [renderError, setRenderError] = useState(false);
  const [copied, setCopied] = useState(false);

  // ---------- Mermaid 渲染（动态加载，避免首屏体积） ----------
  useEffect(() => {
    let cancelled = false;
    setRenderError(false);
    setSvgText('');

    if (!state.mermaid) return undefined;

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          securityLevel: 'loose',
          themeVariables: {
            background: 'transparent',
            primaryColor: '#23262e',
            primaryTextColor: '#e4e6eb',
            primaryBorderColor: '#4a6cf7',
            lineColor: '#7c9eff',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '12px',
          },
        });
        const { svg } = await mermaid.render(`callgraph-${Date.now()}`, state.mermaid);
        if (cancelled) return;
        setSvgText(svg);
        if (hostRef.current) hostRef.current.innerHTML = svg;
      } catch {
        if (!cancelled) setRenderError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.mermaid]);

  // ---------- 导出 SVG ----------
  const exportSvg = useCallback(() => {
    if (!svgText) return;
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    download(blob, 'codeatlas-callgraph.svg');
  }, [svgText]);

  // ---------- 导出 PNG（2x 缩放，长图不糊） ----------
  const exportPng = useCallback(async () => {
    if (!svgText) return;
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image load failed'));
        img.src = url;
      });
      const scale = 2;
      const width = (img.naturalWidth || 1200) * scale;
      const height = (img.naturalHeight || 800) * scale;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // 深色背景，保证导出的图在任意查看器里都清晰
      ctx.fillStyle = '#1b1d23';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) download(blob, 'codeatlas-callgraph.png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [svgText]);

  const copyMermaid = useCallback(async () => {
    await navigator.clipboard.writeText(state.mermaid);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [state.mermaid]);

  const graph = state.graph;

  /** 点击节点 → 打开对应文件（Mermaid 会给节点加 id，这里用标签里的函数名反查） */
  const handleGraphClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onOpenFile || !graph) return;
      const target = (e.target as Element).closest('.node');
      if (!target) return;
      const label = target.textContent ?? '';
      // 节点标签形如 "fnName (行号)"
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
      {/* 头部：标题 + 统计 + 操作 */}
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
          <button
            onClick={exportSvg}
            disabled={!svgText}
            className="rounded border px-2 py-1 text-[11px] disabled:opacity-40"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {t('analysis:exportSvg')}
          </button>
          <button
            onClick={exportPng}
            disabled={!svgText}
            className="rounded border px-2 py-1 text-[11px] disabled:opacity-40"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {t('analysis:exportPng')}
          </button>
          <button
            onClick={copyMermaid}
            disabled={!state.mermaid}
            className="rounded border px-2 py-1 text-[11px] disabled:opacity-40"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {copied ? t('analysis:mermaidCopied') : t('analysis:copyMermaid')}
          </button>
          <button onClick={onClose} className="rounded px-2 py-1 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('common:close')}
          </button>
        </div>
      </header>

      {/* 画布 */}
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {state.running && state.progress.total === 0 && (
          <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:analyzing')}
          </p>
        )}
        {!state.running && state.empty && (
          <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:noGraph')}
          </p>
        )}
        {renderError && (
          <p className="text-xs" style={{ color: 'var(--c-error)' }}>
            {t('analysis:renderFailed')}
          </p>
        )}
        <div ref={hostRef} onClick={handleGraphClick} data-graph-host />
      </div>
    </section>
  );
}
