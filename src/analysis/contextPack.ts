/**
 * contextPack.ts —— 一键生成 AI 上下文包
 *
 * 五步流水线（提示词指定的核心算法）：
 *   1. 符号提取：遍历全部文件，只取函数/类定义与签名，**忽略函数体**（token 最大节省点）
 *   2. 构建依赖图：节点 = 文件，边 = 导入/调用关系，边权按信号强度加权
 *   3. PageRank 排序：对依赖图跑 PageRank，得到文件重要性，符号继承所在文件的重要性
 *   4. Token 预算裁剪：按重要性降序，用二分搜索找到"能塞进预算的最大符号集合"
 *   5. 格式化输出：Markdown（给人看）/ JSON（给工具读），结构固定，包含
 *      项目概览 → 文件树（带一句话说明）→ 核心符号签名（按 PageRank 排序，含路径:行号）→ 调用关系摘要
 *
 * 输出文件：.codeatlas/context.md 或 codeatlas-context.json
 */

import type { FileAnalysis, SymbolDef } from './symbols';
import type { ScopeIndex } from './scopeGraph';
import { buildDependencyEdges, pageRank } from './pagerank';
import { estimateTokens } from '../utils/tokenEstimator';
import type { FileMetrics } from './metrics';

export interface ContextPackInput {
  /** 仓库展示名（owner/repo 或 ZIP 文件名） */
  repoName: string;
  branch?: string;
  files: FileAnalysis[];
  index: ScopeIndex;
  metrics?: FileMetrics[];
  /** 文件树（用于生成带说明的目录树） */
  treePaths: string[];
  /** 目录用途标注（来自 analysis/directories.ts） */
  dirPurposes?: Map<string, { key: string; confidence: 'rule' | 'heuristic' }>;
  /** 目录用途的中文/本地化文案（由 UI 传入 i18n 结果，保证离线且不硬编码语言） */
  purposeLabels?: Record<string, string>;
  /** token 预算（对应 --max-tokens） */
  maxTokens: number;
  /** 语言标签，用于输出头部说明 */
  languageLabel?: string;
}

export interface RankedSymbol {
  name: string;
  kind: SymbolDef['kind'];
  file: string;
  line: number;
  signature: string;
  /** 所在文件的 PageRank 分数 */
  score: number;
  /** 该符号被引用次数 */
  refCount: number;
}

export interface ContextPack {
  markdown: string;
  json: string;
  /** 估算 token 数 */
  tokens: number;
  /** 保底开销（仅项目概览）的 token 数：预算低于此值无法再裁剪 */
  minTokens: number;
  /** 收纳的符号数 / 候选符号总数 */
  includedSymbols: number;
  totalSymbols: number;
  /** 文件树中保留的文件数（因预算被省略时为 0） */
  includedFiles: number;
  truncated: boolean;
}

/** 第 1+3 步：抽取符号并按 PageRank 排序 */
export function rankSymbols(input: ContextPackInput): RankedSymbol[] {
  const { files, index } = input;

  // 依赖图 → PageRank
  const filePaths = files.map((f) => f.path);
  const callsOutByFile = new Map<string, string[]>();
  for (const f of files) {
    // 调用目标 → 定义所在文件（用于构建文件级边）
    const targets = new Set<string>();
    for (const call of f.calls) {
      const entry = index.symbols.get(call.to);
      if (entry) for (const d of entry.definitions) if (d.file !== f.path) targets.add(d.file);
    }
    callsOutByFile.set(f.path, [...targets]);
  }
  const edges = buildDependencyEdges(
    files.map((f) => ({ path: f.path, imports: f.imports, callsOut: callsOutByFile.get(f.path) ?? [] })),
  );
  const ranks = pageRank(filePaths, edges);

  const out: RankedSymbol[] = [];
  for (const file of files) {
    const score = ranks.get(file.path) ?? 0;
    for (const def of file.definitions) {
      const entry = index.symbols.get(def.name);
      out.push({
        name: def.name,
        kind: def.kind,
        file: file.path,
        line: def.line,
        signature: def.signature,
        score,
        refCount: entry ? entry.references.length : 0,
      });
    }
  }

  // 排序：文件重要性优先，其次被引用次数，再其次导出符号优先（对外接口更重要）
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      b.refCount - a.refCount ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
}

/** 生成文件树（带一句话说明），限制条数避免占满预算 */
function renderFileTree(input: ContextPackInput, maxFiles: number): { text: string; included: number } {
  const paths = input.treePaths;
  const purposes = input.dirPurposes;
  const labels = input.purposeLabels ?? {};

  // 目录用途说明块
  const dirLines: string[] = [];
  if (purposes) {
    for (const [dir, p] of [...purposes.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 24)) {
      dirLines.push(`- \`${dir}/\` — ${labels[p.key] ?? p.key}`);
    }
  }

  // 文件清单：优先展示源码与文档，限制数量
  const important = paths
    .filter((p) => /\.(ts|tsx|js|jsx|py|md|json|toml|yaml|yml|go|rs|java)$/i.test(p))
    .sort((a, b) => {
      const depth = (s: string) => s.split('/').length;
      return depth(a) - depth(b) || a.localeCompare(b);
    });
  const shown = important.slice(0, maxFiles);

  const treeLines = shown.map((p) => `- \`${p}\``).join('\n');
  const omitted = important.length - shown.length;
  const omittedLine = omitted > 0 ? `\n- … 另有 ${omitted} 个文件未列出` : '';

  const sections: string[] = [];
  if (dirLines.length) sections.push(`### 目录用途\n${dirLines.join('\n')}`);
  sections.push(`### 文件清单（${shown.length}/${important.length}）\n${treeLines}${omittedLine}`);

  return { text: sections.join('\n\n'), included: shown.length };
}

/** 第 4+5 步：按预算裁剪并格式化 */
export function generateContextPack(input: ContextPackInput): ContextPack {
  const budget = input.maxTokens;
  const ranked = rankSymbols(input);

  // 项目概览（固定开销，先算出来）
  const langs = countLanguages(input.files);
  const totalSloc = input.metrics?.reduce((s, m) => s + m.sloc, 0);

  const header = [
    `# ${input.repoName} — CodeAtlas 上下文包`,
    '',
    '> 本文件由 CodeAtlas 本地静态分析生成（无 AI 参与）。',
    '> 内容：项目概览 / 目录树 / 核心符号签名（按 PageRank 排序）/ 关键调用关系。',
    '',
    '## 项目概览',
    `- 仓库：${input.repoName}${input.branch ? ` @${input.branch}` : ''}`,
    `- 分析文件：${input.files.length} 个（JS/TS/Python）`,
    `- 语言分布：${langs}`,
    `- 符号总数：${ranked.length}（函数/类定义）`,
    totalSloc !== undefined ? `- 代码行数：${totalSloc}` : '',
    `- token 预算：${budget}`,
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const treeBlock = renderFileTree(input, 60);

  const callSummary = renderCallSummary(input, ranked);

  // 符号区：用二分搜索找"最大可容纳符号数"
  const renderSymbols = (count: number): string => {
    if (count <= 0) return '## 核心符号签名\n\n（预算不足，未包含符号列表）';
    const lines = ['## 核心符号签名（按重要性排序）', ''];
    for (const s of ranked.slice(0, count)) {
      const kindLabel = s.kind === 'class' ? 'class' : s.kind === 'method' ? 'method' : 'function';
      lines.push(`- \`${s.file}:${s.line}\` **${s.name}** (${kindLabel}) — \`${oneLine(s.signature)}\``);
    }
    return lines.join('\n');
  };

  const assemble = (count: number, withTree: boolean): { markdown: string; included: number } => {
    const parts = [header];
    if (withTree) parts.push('## 目录结构', treeBlock.text);
    parts.push(renderSymbols(count), callSummary);
    const markdown = parts.join('\n\n');
    return { markdown, included: Math.min(count, ranked.length) };
  };

  /**
   * 二分搜索：在给定"是否包含目录树"的前提下，找出满足预算的最大符号数。
   * 找不到（连 0 个符号都超预算）时返回 null，交由调用方降级。
   */
  const search = (withTree: boolean): { markdown: string; included: number } | null => {
    let low = 0;
    let high = ranked.length;
    let best: { markdown: string; included: number } | null = null;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = assemble(mid, withTree);
      if (estimateTokens(candidate.markdown) <= budget) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  };

  // 降级优先级：目录树+符号 → 仅符号 → 仅头部（保证极小预算下也是合法文档）
  let chosen = { markdown: header, included: 0 };
  let treeIncluded = false;
  for (const withTree of [true, false]) {
    const result = search(withTree);
    if (result) {
      chosen = result;
      treeIncluded = withTree;
      break;
    }
  }

  const { markdown, included } = chosen;
  const tokens = estimateTokens(markdown);
  /** 保底开销：只有项目概览时的 token 数（预算低于此值时无法进一步裁剪） */
  const minTokens = estimateTokens(header);

  const json = JSON.stringify(
    {
      generator: 'CodeAtlas',
      note: 'Generated by deterministic static analysis. No AI involved.',
      repo: input.repoName,
      branch: input.branch ?? null,
      budget: budget,
      estimatedTokens: tokens,
      overview: {
        analyzedFiles: input.files.length,
        languages: langs,
        totalSymbols: ranked.length,
        includedSymbols: included,
        sloc: totalSloc ?? null,
      },
      directories: input.dirPurposes
        ? [...input.dirPurposes.entries()].map(([dir, p]) => ({
            path: dir,
            purpose: input.purposeLabels?.[p.key] ?? p.key,
            confidence: p.confidence,
          }))
        : [],
      files: input.treePaths,
      symbols: ranked.slice(0, included).map((s) => ({
        name: s.name,
        kind: s.kind,
        file: s.file,
        line: s.line,
        signature: s.signature,
        refCount: s.refCount,
        rank: Number(s.score.toFixed(6)),
      })),
      calls: collectTopCalls(input, ranked, 40),
    },
    null,
    2,
  );

  return {
    markdown,
    json,
    tokens,
    minTokens,
    includedSymbols: included,
    totalSymbols: ranked.length,
    includedFiles: treeIncluded ? treeBlock.included : 0,
    truncated: included < ranked.length || !treeIncluded,
  };
}

/** 关键调用关系摘要：只保留"重要符号之间"的边，避免噪音 */
function collectTopCalls(
  input: ContextPackInput,
  ranked: RankedSymbol[],
  limit: number,
): { from: string; to: string; file: string; line: number }[] {
  const importance = new Map<string, number>();
  ranked.forEach((s, i) => importance.set(`${s.file}#${s.name}`, ranked.length - i));

  const out: { from: string; to: string; file: string; line: number }[] = [];
  for (const f of input.files) {
    const localDefs = new Map(f.definitions.map((d) => [d.name, d]));
    for (const call of f.calls) {
      if (!call.from) continue;
      const fromDef = localDefs.get(call.from);
      const targetEntry = input.index.symbols.get(call.to);
      if (!fromDef || !targetEntry || targetEntry.definitions.length === 0) continue;
      const targetDef = targetEntry.definitions[0];
      out.push({ from: call.from, to: call.to, file: f.path, line: call.line });
      void targetDef;
    }
  }
  // 去重 + 按"两端符号重要性"排序
  const seen = new Set<string>();
  return out
    .filter((c) => {
      const k = `${c.from}->${c.to}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort(
      (a, b) =>
        (importance.get(`${b.file}#${b.from}`) ?? 0) - (importance.get(`${a.file}#${a.from}`) ?? 0),
    )
    .slice(0, limit);
}

function renderCallSummary(input: ContextPackInput, ranked: RankedSymbol[]): string {
  const calls = collectTopCalls(input, ranked, 25);
  if (calls.length === 0) return '## 关键调用关系\n\n（未检测到仓库内的函数调用边）';
  const lines = ['## 关键调用关系（仓库内）', ''];
  for (const c of calls) {
    lines.push(`- \`${c.file}:${c.line}\` ${c.from} → ${c.to}`);
  }
  return lines.join('\n');
}

function countLanguages(files: FileAnalysis[]): string {
  const map = new Map<string, number>();
  for (const f of files) map.set(f.language, (map.get(f.language) ?? 0) + 1);
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/`/g, "'").trim();
}
