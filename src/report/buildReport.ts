/**
 * buildReport.ts —— N5② HTML 报告导出（纯函数核心）
 *
 * 设计：把 `AnalysisState` 聚合成一份**可序列化**的 `ReportModel`，再渲染成
 * **单文件离线 HTML**（内联 CSS，零外部请求，双击即开）。
 *
 * 与 Mermaid 渲染解耦：本文件不 import mermaid，因此可被 Vitest 单测直接覆盖；
 * 真正的 SVG 渲染发生在 UI 层 `exportReport.ts`（用 `mermaid.render` 把图转成 SVG
 * 后通过 `svgs` 参数注入），渲染失败也不影响报告主体（退化展示 Mermaid 源码）。
 */

import type { RepoMeta } from '../types/repo';
import type { AnalysisState } from '../hooks/useCodeAnalysis';
import { CYCLOMATIC_WARN, COGNITIVE_WARN } from '../analysis/metrics';

/** 报告 schema 版本（与 app 版本号无关，仅用于格式演进判断） */
export const REPORT_SCHEMA = '1.0';

export interface ReportSummary {
  name: string;
  source: string;
  generatedAt: string;
  filesAnalyzed: number;
  totalSloc: number;
  totalFunctions: number;
  healthScore: number | null;
  avgCyclomatic: number | null;
  avgCognitive: number | null;
  highComplexityCount: number;
  languages: { lang: string; files: number; sloc: number }[];
}

export interface ReportFileRow {
  path: string;
  lang: string;
  cyclomatic: number;
  cognitive: number;
  sloc: number;
  /** 该文件内最高函数圈复杂度（用于定位热点文件） */
  maxFn: number;
}

export interface ReportFunctionRow {
  file: string;
  name: string;
  line: number;
  cyclomatic: number;
  cognitive: number;
}

export interface ReportModel {
  summary: ReportSummary;
  topFiles: ReportFileRow[];
  topFunctions: ReportFunctionRow[];
  readingPath: { order: number; path: string; role: string }[];
  cycles: string[][];
  dirCycles: string[][];
  layers: { key: string; dirs: string[]; files: number }[];
  callGraph: { nodes: number; edges: number; truncated: boolean; mermaid: string };
  moduleGraph: { nodes: number; edges: number; mermaid: string };
  classGraph: { nodes: number; mermaid: string };
}

const TOP_N = 20;

/** 把分析状态聚合为可序列化的报告模型 */
export function buildReportModel(
  meta: RepoMeta,
  state: AnalysisState,
  now: Date = new Date(),
): ReportModel {
  const { metrics, health, graph, readingPath, cycles, layers, moduleGraph, classGraph, mermaid, moduleMermaid, classMermaid } = state;

  // ---------- 概览 ----------
  const totalSloc = metrics.reduce((s, f) => s + f.sloc, 0);
  const totalFunctions = metrics.reduce((s, f) => s + f.functions.length, 0);

  const langMap = new Map<string, { files: number; sloc: number }>();
  for (const f of metrics) {
    const cur = langMap.get(f.language) ?? { files: 0, sloc: 0 };
    cur.files += 1;
    cur.sloc += f.sloc;
    langMap.set(f.language, cur);
  }
  const languages = [...langMap.entries()]
    .map(([lang, v]) => ({ lang, files: v.files, sloc: v.sloc }))
    .sort((a, b) => b.sloc - a.sloc);

  const summary: ReportSummary = {
    name: meta.name,
    source: meta.source,
    generatedAt: now.toISOString(),
    filesAnalyzed: metrics.length,
    totalSloc,
    totalFunctions,
    healthScore: health ? health.score : null,
    avgCyclomatic: health ? health.avgCyclomatic : null,
    avgCognitive: health ? health.avgCognitive : null,
    highComplexityCount: health ? health.highComplexityCount : 0,
    languages,
  };

  // ---------- 热点文件 / 函数 ----------
  const topFiles: ReportFileRow[] = metrics
    .map((f) => ({
      path: f.path,
      lang: f.language as string,
      cyclomatic: f.cyclomatic,
      cognitive: f.cognitive,
      sloc: f.sloc,
      maxFn: f.functions.reduce((m, fn) => Math.max(m, fn.cyclomatic), 0),
    }))
    .sort((a, b) => b.maxFn - a.maxFn || b.cyclomatic - a.cyclomatic)
    .slice(0, TOP_N);

  const allFns = metrics.flatMap((f) =>
    f.functions.map((fn) => ({
      file: f.path,
      name: fn.name,
      line: fn.line,
      cyclomatic: fn.cyclomatic,
      cognitive: fn.cognitive,
    })),
  );
  const topFunctions: ReportFunctionRow[] = allFns
    .sort((a, b) => b.cyclomatic - a.cyclomatic || b.cognitive - a.cognitive)
    .slice(0, TOP_N);

  // ---------- 阅读路线 ----------
  const readingPathOut = (readingPath?.steps ?? []).map((s) => ({
    order: s.order,
    path: s.path,
    role: s.role,
  }));

  // ---------- 图 ----------
  const callGraph = {
    nodes: graph?.nodes.length ?? 0,
    edges: graph?.edges.length ?? 0,
    truncated: graph?.truncated ?? false,
    mermaid,
  };
  const moduleGraphOut = {
    nodes: moduleGraph?.nodes.length ?? 0,
    edges: moduleGraph?.edges.length ?? 0,
    mermaid: moduleMermaid,
  };
  const classGraphOut = {
    nodes: classGraph?.nodes.length ?? 0,
    mermaid: classMermaid,
  };

  return {
    summary,
    topFiles,
    topFunctions,
    readingPath: readingPathOut,
    cycles: cycles?.cycles ?? [],
    dirCycles: cycles?.dirCycles ?? [],
    layers: (layers ?? []).map((l) => ({ key: l.key, dirs: l.dirs, files: l.files })),
    callGraph,
    moduleGraph: moduleGraphOut,
    classGraph: classGraphOut,
  };
}

// ---------------------------------------------------------------------------
// HTML 渲染（单文件离线，内联 CSS，无外部请求）
// ---------------------------------------------------------------------------

function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function diagramSection(
  title: string,
  svg: string | undefined,
  mermaidSrc: string,
  fallbackNote: string,
): string {
  const body = svg && svg.trim().length > 0
    ? `<div class="diagram">${svg}</div>`
    : `<p class="muted">${esc(fallbackNote)}</p>${
        mermaidSrc
          ? `<details><summary>Mermaid 源码</summary><pre>${esc(mermaidSrc)}</pre></details>`
          : ''
      }`;
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

export interface ReportSvgs {
  call?: string;
  module?: string;
  class?: string;
}

export function renderReportHtml(model: ReportModel, svgs: ReportSvgs = {}): string {
  const { summary } = model;

  const langRows = summary.languages
    .map(
      (l) =>
        `<tr><td>${esc(l.lang)}</td><td class="num">${l.files}</td><td class="num">${l.sloc}</td></tr>`,
    )
    .join('');

  const fileRows = model.topFiles
    .map(
      (f) =>
        `<tr><td>${esc(f.path)}</td><td>${esc(f.lang)}</td>` +
        `<td class="num ${f.maxFn > CYCLOMATIC_WARN ? 'warn' : ''}">${f.maxFn}</td>` +
        `<td class="num">${f.cyclomatic}</td><td class="num">${f.cognitive}</td>` +
        `<td class="num">${f.sloc}</td></tr>`,
    )
    .join('');

  const fnRows = model.topFunctions
    .map(
      (f) =>
        `<tr><td>${esc(f.file)}</td><td>${esc(f.name)}</td><td class="num">${f.line}</td>` +
        `<td class="num ${f.cyclomatic > CYCLOMATIC_WARN ? 'warn' : ''}">${f.cyclomatic}</td>` +
        `<td class="num ${f.cognitive > COGNITIVE_WARN ? 'warn' : ''}">${f.cognitive}</td></tr>`,
    )
    .join('');

  const pathRows = model.readingPath.length
    ? model.readingPath
        .map(
          (s) =>
            `<tr><td class="num">${s.order}</td><td>${esc(s.path)}</td><td>${esc(s.role)}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="3" class="muted">无可用阅读路线</td></tr>`;

  const cycleList = model.dirCycles.length
    ? model.dirCycles
        .map((c) => `<li>${c.map(esc).join(' → ')}</li>`)
        .join('')
    : model.cycles.length
      ? model.cycles.map((c) => `<li>${c.map(esc).join(' → ')}</li>`).join('')
      : '<li class="muted">未检测到循环依赖</li>';

  const layerRows = model.layers.length
    ? model.layers
        .map(
          (l) =>
            `<tr><td>${esc(l.key)}</td><td class="num">${l.files}</td><td>${l.dirs
              .map(esc)
              .join(', ')}</td></tr>`,
        )
        .join('')
    : '';

  const health = summary.healthScore == null
    ? '<span class="muted">无</span>'
    : `<strong>${summary.healthScore}</strong>`;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CodeAtlas 报告 · ${esc(summary.name)}</title>
<style>
  :root { --fg:#1f2330; --muted:#6b7280; --line:#e3e6ec; --warn:#c0392b; --bg:#ffffff; --soft:#f7f8fa; --accent:#4a6cf7; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif; color:var(--fg); background:var(--bg); }
  header { padding:28px 32px; border-bottom:1px solid var(--line); background:var(--soft); }
  header h1 { margin:0 0 4px; font-size:22px; }
  header .sub { color:var(--muted); font-size:13px; }
  main { padding:24px 32px 48px; max-width:1100px; margin:0 auto; }
  h2 { font-size:17px; margin:32px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  .cards { display:flex; flex-wrap:wrap; gap:14px; margin:18px 0; }
  .card { flex:1 1 140px; border:1px solid var(--line); border-radius:10px; padding:14px 16px; background:var(--soft); }
  .card .k { color:var(--muted); font-size:12px; }
  .card .v { font-size:22px; font-weight:600; margin-top:2px; }
  table { border-collapse:collapse; width:100%; margin:8px 0; font-size:13px; }
  th,td { border:1px solid var(--line); padding:6px 10px; text-align:left; vertical-align:top; }
  th { background:var(--soft); font-weight:600; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  td.warn { color:var(--warn); font-weight:600; }
  .muted { color:var(--muted); }
  .diagram { overflow:auto; border:1px solid var(--line); border-radius:8px; padding:12px; background:#fff; }
  .diagram svg { max-width:100%; height:auto; }
  details { margin-top:8px; }
  pre { white-space:pre-wrap; word-break:break-word; background:var(--soft); border:1px solid var(--line); border-radius:8px; padding:12px; font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
  ul { margin:6px 0; padding-left:22px; }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
  @media (max-width:760px){ .two { grid-template-columns:1fr; } }
  footer { margin-top:40px; padding:16px 32px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>CodeAtlas 代码分析报告</h1>
  <div class="sub">项目：${esc(summary.name)} ｜ 数据源：${esc(summary.source)} ｜ 生成时间：${esc(summary.generatedAt)}</div>
</header>
<main>
  <div class="cards">
    <div class="card"><div class="k">健康评分</div><div class="v">${health}</div></div>
    <div class="card"><div class="k">分析文件数</div><div class="v">${summary.filesAnalyzed}</div></div>
    <div class="card"><div class="k">总代码行 (SLOC)</div><div class="v">${summary.totalSloc}</div></div>
    <div class="card"><div class="k">函数数</div><div class="v">${summary.totalFunctions}</div></div>
    <div class="card"><div class="k">平均圈复杂度</div><div class="v">${summary.avgCyclomatic ?? '—'}</div></div>
    <div class="card"><div class="k">高复杂函数数</div><div class="v">${summary.highComplexityCount}</div></div>
  </div>

  <section>
    <h2>语言分布</h2>
    <table><thead><tr><th>语言</th><th class="num">文件数</th><th class="num">SLOC</th></tr></thead>
    <tbody>${langRows}</tbody></table>
  </section>

  <div class="two">
    <section>
      <h2>热点文件（按最高函数复杂度）</h2>
      <table><thead><tr><th>文件</th><th>语言</th><th class="num">峰值CC</th><th class="num">CC</th><th class="num">认知</th><th class="num">SLOC</th></tr></thead>
      <tbody>${fileRows}</tbody></table>
    </section>
    <section>
      <h2>最复杂函数 Top ${model.topFunctions.length}</h2>
      <table><thead><tr><th>文件</th><th>函数</th><th class="num">行</th><th class="num">CC</th><th class="num">认知</th></tr></thead>
      <tbody>${fnRows}</tbody></table>
    </section>
  </div>

  <section>
    <h2>建议阅读路线</h2>
    <table><thead><tr><th class="num">序号</th><th>文件</th><th>角色</th></tr></thead>
    <tbody>${pathRows}</tbody></table>
  </section>

  <div class="two">
    <section>
      <h2>循环依赖</h2>
      <ul>${cycleList}</ul>
    </section>
    <section>
      <h2>分层（按目录用途）</h2>
      ${
        layerRows
          ? `<table><thead><tr><th>用途</th><th class="num">文件数</th><th>目录</th></tr></thead><tbody>${layerRows}</tbody></table>`
          : '<p class="muted">无分层数据</p>'
      }
    </section>
  </div>

  ${diagramSection(
    `调用关系图（${model.callGraph.nodes} 节点 / ${model.callGraph.edges} 边${model.callGraph.truncated ? ' · 已截断' : ''}）`,
    svgs.call,
    model.callGraph.mermaid,
    '当前分析无调用图数据。',
  )}
  ${diagramSection(
    `模块依赖图（${model.moduleGraph.nodes} 节点 / ${model.moduleGraph.edges} 边）`,
    svgs.module,
    model.moduleGraph.mermaid,
    '模块依赖图节点过多或暂无可渲染内容。',
  )}
  ${diagramSection(
    `类图（${model.classGraph.nodes} 个类/接口）`,
    svgs.class,
    model.classGraph.mermaid,
    '当前语言未提供类继承信息，或类图为空。',
  )}
</main>
<footer>
  CodeAtlas · 纯本地静态分析生成 · 单文件离线报告（schema ${esc(REPORT_SCHEMA)}）
</footer>
</body>
</html>`;
}
