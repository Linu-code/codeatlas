/**
 * MermaidView —— Mermaid 图渲染 + 导出（调用图 / 模块依赖图 / 类图共用）
 *
 * 为什么抽出来：三个面板需要完全相同的渲染与导出逻辑
 * （SVG 矢量导出、PNG 2 倍缩放导出、复制 Mermaid 源码、节点点击回调），
 * 复制三份必然会漂移。
 *
 * Mermaid 仍走动态 import —— 它体积很大（数百 kB），不能进首屏包。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  /** Mermaid 源码；空串表示暂无可渲染内容 */
  code: string;
  /** 点击节点回调（参数为节点文本，由调用方解析成文件/行号） */
  onNodeClick?: (label: string) => void;
  /** 导出文件名前缀（默认 codeatlas-diagram） */
  exportName?: string;
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

/** 全局递增序号：保证同页面多次渲染的 DOM id 不冲突 */
let renderSeq = 0;

export default function MermaidView({ code, onNodeClick, exportName = 'codeatlas-diagram' }: Props) {
  const { t } = useTranslation(['analysis', 'common']);
  const hostRef = useRef<HTMLDivElement>(null);
  const [svgText, setSvgText] = useState('');
  const [renderError, setRenderError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRenderError(false);
    setSvgText('');
    if (hostRef.current) hostRef.current.innerHTML = '';
    if (!code) return undefined;

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
        const id = `diagram-${++renderSeq}`;
        const { svg } = await mermaid.render(id, code);
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
  }, [code]);

  const exportSvg = useCallback(() => {
    if (!svgText) return;
    download(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }), `${exportName}.svg`);
  }, [exportName, svgText]);

  const exportPng = useCallback(async () => {
    if (!svgText) return;
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image load failed'));
        img.src = url;
      });
      const scale = 2; // 2 倍缩放，长图不糊
      const width = (img.naturalWidth || 1200) * scale;
      const height = (img.naturalHeight || 800) * scale;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#1b1d23'; // 深色背景，导出图在任意查看器里都清晰
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) download(blob, `${exportName}.png`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [exportName, svgText]);

  const copyCode = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [code]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onNodeClick) return;
      const target = (e.target as Element).closest('.node');
      if (!target) return;
      onNodeClick(target.textContent ?? '');
    },
    [onNodeClick],
  );

  const btn =
    'rounded border px-2 py-1 text-[11px] disabled:opacity-40';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1">
        <button
          onClick={exportSvg}
          disabled={!svgText}
          className={btn}
          style={{ borderColor: 'var(--c-border)' }}
        >
          {t('analysis:exportSvg')}
        </button>
        <button
          onClick={exportPng}
          disabled={!svgText}
          className={btn}
          style={{ borderColor: 'var(--c-border)' }}
        >
          {t('analysis:exportPng')}
        </button>
        <button
          onClick={() => void copyCode()}
          disabled={!code}
          className={btn}
          style={{ borderColor: 'var(--c-border)' }}
        >
          {copied ? t('analysis:mermaidCopied') : t('analysis:copyMermaid')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {renderError && (
          <p className="text-xs" style={{ color: 'var(--c-error)' }}>
            {t('analysis:renderFailed')}
          </p>
        )}
        <div ref={hostRef} onClick={handleClick} data-graph-host />
      </div>
    </div>
  );
}
