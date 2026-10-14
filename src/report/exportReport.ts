/**
 * exportReport.ts —— N5② 导出入口（UI 层，依赖浏览器 + mermaid）
 *
 * 把 `AnalysisState` 序列化为单文件离线 HTML 并下载：
 *   1. buildReportModel 聚合数据（纯函数，见 buildReport.ts）
 *   2. 用 mermaid.render 把三张图转成 SVG 内联（渲染失败则退化展示 Mermaid 源码）
 *   3. Blob + 锚点下载，浏览器与 Tauri webview 均可用
 */

import type { RepoMeta } from '../types/repo';
import type { AnalysisState } from '../hooks/useCodeAnalysis';
import { buildReportModel, renderReportHtml } from './buildReport';

/** 把 Mermaid 源码渲染为 SVG 字符串；无内容或渲染失败返回 undefined */
async function renderSvg(code: string): Promise<string | undefined> {
  if (!code || !code.trim()) return undefined;
  try {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      themeVariables: {
        background: '#ffffff',
        primaryColor: '#eef1fb',
        primaryTextColor: '#1f2330',
        primaryBorderColor: '#4a6cf7',
        lineColor: '#7c9eff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
      },
    });
    const id = `report-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { svg } = await mermaid.render(id, code);
    return svg;
  } catch {
    return undefined;
  }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 导出当前分析的 HTML 报告 */
export async function exportHtmlReport(meta: RepoMeta, state: AnalysisState): Promise<void> {
  const model = buildReportModel(meta, state);
  const [call, module, cls] = await Promise.all([
    renderSvg(state.mermaid),
    renderSvg(state.moduleMermaid),
    renderSvg(state.classMermaid),
  ]);
  const html = renderReportHtml(model, { call, module, class: cls });
  const safeName = (meta.name || 'codeatlas').replace(/[^\w.-]+/g, '_');
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), `codeatlas-report-${safeName}.html`);
}
