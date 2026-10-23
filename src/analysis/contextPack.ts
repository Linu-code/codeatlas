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
  /** 仓库文件总数（可选）：用于在概览里说明"本次分析覆盖率"，超大项目必备 */
  totalFiles?: number;
  /** 目录用途标注（来自 analysis/directories.ts） */
  dirPurposes?: Map<string, { key: string; confidence: 'rule' | 'heuristic' }>;
  /** 目录用途的中文/本地化文案（由 UI 传入 i18n 结果，保证离线且不硬编码语言） */
  purposeLabels?: Record<string, string>;
  /** token 预算（对应 --max-tokens） */
  maxTokens: number;
  /**
   * 建议阅读路线（N2）。传入后会在目录结构之后追加「建议阅读路线」章节，
   * 让读者（人或 AI）先知道"从哪读起"，而不是面对一堆并列符号。
   */
  readingPath?: ReadingPathEntry[];
  /** 语言标签，用于输出头部说明 */
  languageLabel?: string;
  /**
   * package.json 原文（可选）。传入后会解析出构建脚本 / 依赖 / 入口，
   * 让 AI 知道"这个项目怎么跑、用什么技术栈"——超大项目只靠符号很难上手。
   */
  manifestText?: string;
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
  /** 是否为导出 / 公开符号（用于生成"公共接口"摘要） */
  exported: boolean;
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
        exported: def.exported,
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

/** 文件路径 → 顶层模块名（超大项目按模块聚合才有用） */
function moduleOf(path: string): string {
  const i = path.indexOf('/');
  return i < 0 ? '(根目录)' : path.slice(0, i);
}

interface ManifestInfo {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  scripts: [string, string][];
  deps: string[];
  devDeps: string[];
}

/** 解析 package.json（失败返回 null，绝不影响上下文包生成） */
function parseManifest(text: string): ManifestInfo | null {
  try {
    const p = JSON.parse(text) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const obj = (v: unknown) =>
      v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    const scripts = Object.entries(obj(p.scripts))
      .filter(([, v]) => typeof v === 'string')
      .slice(0, 6)
      .map(([k, v]) => [k, v as string] as [string, string]);
    return {
      name: str(p.name),
      version: str(p.version),
      main: str(p.main),
      module: str(p.module),
      scripts,
      deps: Object.keys(obj(p.dependencies)).slice(0, 12),
      devDeps: Object.keys(obj(p.devDependencies)).slice(0, 12),
    };
  } catch {
    return null;
  }
}

/** 从锁文件推断包管理器 */
function detectPackageManager(paths: string[]): string | null {
  if (paths.includes('pnpm-lock.yaml')) return 'pnpm';
  if (paths.includes('yarn.lock')) return 'yarn';
  if (paths.includes('bun.lockb') || paths.includes('bun.lock')) return 'bun';
  if (paths.includes('package-lock.json')) return 'npm';
  return null;
}

/** 常见入口文件（目录浅者优先，最多 8 个） */
function detectEntryFiles(paths: string[]): string[] {
  const re =
    /(^|\/)(main|index|app|server|cli|bootstrap|entry)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|c|cc|cpp|cs)$/i;
  return paths
    .filter((p) => re.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, 8);
}

/**
 * 生成目录结构：目录用途 + 模块地图 + 关键文件。
 *
 * 不再平铺文件清单：超大项目（数千文件）平铺 60 条既占预算又几乎无信息量。
 * 改为「模块（顶层目录）→ 文件数 → 关键文件（按 PageRank）」的层级摘要，
 * 信息密度高且与项目规模无关（模块数天然有界）。
 */
function renderFileTree(
  input: ContextPackInput,
  fileScores: Map<string, number>,
  maxKeyFiles: number,
): { text: string; included: number } {
  const purposes = input.dirPurposes;
  const labels = input.purposeLabels ?? {};

  // 目录用途
  const dirLines: string[] = [];
  if (purposes) {
    for (const [dir, p] of [...purposes.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 24)) {
      dirLines.push(`- \`${dir}/\` — ${labels[p.key] ?? p.key}`);
    }
  }

  // 模块地图：按顶层目录聚合（只统计参与分析的源码文件）
  const byModule = new Map<string, string[]>();
  for (const f of input.files) {
    const m = moduleOf(f.path);
    let arr = byModule.get(m);
    if (!arr) {
      arr = [];
      byModule.set(m, arr);
    }
    arr.push(f.path);
  }
  const moduleLines = [...byModule.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 60)
    .map(([m, paths]) => {
      const key = [...paths]
        .sort((a, b) => (fileScores.get(b) ?? 0) - (fileScores.get(a) ?? 0))
        .slice(0, 3)
        .map((p) => `\`${p}\``)
        .join(', ');
      const label = m === '(根目录)' ? '(根目录)' : `\`${m}/\``;
      return `- ${label} — ${paths.length} 个文件 · 关键：${key}`;
    });

  // 关键文件：按 PageRank 排序（比"按深度平铺"更能反映核心）
  const keyFiles = [...input.files]
    .sort((a, b) => (fileScores.get(b.path) ?? 0) - (fileScores.get(a.path) ?? 0))
    .slice(0, maxKeyFiles)
    .map((f) => `- \`${f.path}\``);

  // 顶层配置文件（AI 判断构建方式时常需要）
  const isTop = (p: string) => !p.includes('/');
  const isConfig = (p: string) =>
    /\.(json|toml|ya?ml|ini|cfg|lock|txt)$/i.test(p) ||
    /^(dockerfile|makefile|\.gitignore|\.editorconfig|\.env\.example)$/i.test(p);
  const configPaths = input.treePaths.filter((p) => isTop(p) && isConfig(p)).slice(0, 12);

  const sections: string[] = [];
  if (dirLines.length) sections.push(`### 目录用途\n${dirLines.join('\n')}`);
  if (moduleLines.length) {
    sections.push(`### 模块地图（${byModule.size} 个模块）\n${moduleLines.join('\n')}`);
  }

  // 公共接口：导出符号名一行逗号分隔（token 极省，AI 判断对外契约用）
  const exportedNames = [
    ...new Set(
      [...input.files]
        .sort((a, b) => (fileScores.get(b.path) ?? 0) - (fileScores.get(a.path) ?? 0))
        .flatMap((f) => f.definitions.filter((d) => d.exported).map((d) => d.name)),
    ),
  ].slice(0, 60);
  if (exportedNames.length) {
    sections.push(
      `### 公共接口（导出符号 Top ${exportedNames.length}）\n${exportedNames.join(', ')}`,
    );
  }

  sections.push(
    `### 关键文件（按重要性 Top ${keyFiles.length}/${input.files.length}）\n${keyFiles.join('\n')}`,
  );
  if (configPaths.length) {
    sections.push(`### 配置文件\n${configPaths.map((p) => `- \`${p}\``).join('\n')}`);
  }

  return { text: sections.join('\n\n'), included: keyFiles.length + configPaths.length };
}

/** 阅读路线条目（N2：由 readingPath.ts 生成，此处只关心渲染所需字段） */
export interface ReadingPathEntry {
  path: string;
  order: number;
  role: 'entry' | 'core' | 'support' | 'leaf';
}

/** 角色 → 中文标签（上下文包是固定语言产物，与其它章节保持一致） */
const READING_ROLE_LABEL: Record<ReadingPathEntry['role'], string> = {
  entry: '入口',
  core: '枢纽',
  support: '中间层',
  leaf: '末端',
};

/** 渲染「建议阅读路线」章节；未提供路线时返回 null（不产出空章节） */
function renderReadingPath(input: ContextPackInput): string | null {
  const steps = input.readingPath;
  if (!steps || steps.length === 0) return null;
  const lines = [
    '## 建议阅读路线',
    '',
    '> 按依赖图的角色与 PageRank 排序：入口 → 枢纽 → 中间层 → 末端。',
    '> 依赖关系由本地静态分析得出，顺序可复现。',
    '',
  ];
  for (const step of steps) {
    lines.push(`${step.order}. \`${step.path}\` — ${READING_ROLE_LABEL[step.role]}`);
  }
  return lines.join('\n');
}

/** 第 4+5 步：按预算裁剪并格式化 */
export function generateContextPack(input: ContextPackInput): ContextPack {
  const budget = input.maxTokens;
  const ranked = rankSymbols(input);

  /** 文件 → PageRank（ranked 已按分数降序，首次出现即该文件的最高分） */
  const fileScores = new Map<string, number>();
  for (const s of ranked) if (!fileScores.has(s.file)) fileScores.set(s.file, s.score);

  // 项目概览（固定开销，先算出来）
  const langs = countLanguages(input.files);
  const totalSloc = input.metrics?.reduce((s, m) => s + m.sloc, 0);
  const entries = detectEntryFiles(input.treePaths);
  const manifest = input.manifestText ? parseManifest(input.manifestText) : null;
  const packageManager = detectPackageManager(input.treePaths);

  const headerParts = [
    `# ${input.repoName} — CodeAtlas 上下文包`,
    '',
    '> 本文件由 CodeAtlas 本地静态分析生成（无 AI 参与）。',
    '> 内容：项目概览 / 构建与运行 / 技术栈 / 目录结构与模块地图 / 建议阅读路线 / 核心符号签名 / 关键调用关系。',
    '> 符号只含签名（无函数体）：需要实现细节时，请按 `路径:行号` 打开源码。',
    '',
    '## 项目概览',
    `- 仓库：${input.repoName}${input.branch ? ` @${input.branch}` : ''}`,
    `- 分析文件：${input.files.length} 个`,
    input.totalFiles && input.totalFiles > input.files.length
      ? `- 仓库文件：${input.totalFiles} 个（本次分析 ${input.files.length} 个，按核心目录 / 入口优先级选取）`
      : '',
    `- 语言分布：${langs}`,
    `- 符号总数：${ranked.length}（函数/类定义）`,
    totalSloc !== undefined ? `- 代码行数：${totalSloc}` : '',
    entries.length ? `- 入口文件：${entries.map((e) => `\`${e}\``).join(', ')}` : '',
    `- token 预算：${budget}`,
    '',
  ];

  // 构建与运行 / 技术栈：只有拿到 package.json 时才输出（缺失不影响其它章节）
  if (manifest) {
    headerParts.push('## 构建与运行', '');
    const pkg = [manifest.name, manifest.version].filter(Boolean).join('@');
    if (pkg) headerParts.push(`- 包：${pkg}`);
    const entry = manifest.main || manifest.module;
    if (entry) headerParts.push(`- 入口：\`${entry}\``);
    if (manifest.scripts.length) {
      headerParts.push(
        `- 脚本：${manifest.scripts.map(([k, v]) => `\`${k}\` = \`${oneLine(v)}\``).join('；')}`,
      );
    }
    if (packageManager) headerParts.push(`- 包管理器：${packageManager}`);
    headerParts.push('');

    if (manifest.deps.length || manifest.devDeps.length) {
      headerParts.push('## 技术栈', '');
      if (manifest.deps.length) headerParts.push(`- 运行时依赖：${manifest.deps.join(', ')}`);
      if (manifest.devDeps.length) headerParts.push(`- 开发依赖：${manifest.devDeps.join(', ')}`);
      headerParts.push('');
    }
  }

  const header = headerParts.filter(Boolean).join('\n');

  const treeBlock = renderFileTree(input, fileScores, 80);

  const readingBlock = renderReadingPath(input);

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
    // 阅读路线紧跟在目录结构之后：先告诉读者"从哪读起"，再给符号清单
    if (readingBlock) parts.push(readingBlock);
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

  /**
   * JSON 的 files 字段必须限长：全量 treePaths 在超大项目里可达数千条
   * （≈ 上万 token），会架空"有限上下文"的意义。
   * 排序也重要：先按 PageRank 放**关键文件**，再用其余路径补满 ——
   * 若只按文件树顺序截断，前 400 条可能全是某个字母序靠前的目录。
   */
  const MAX_JSON_FILES = 400;
  const allFiles = input.treePaths;
  const byImportance = [...fileScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);
  const listedFiles: string[] = [];
  const pickedFiles = new Set<string>();
  for (const p of byImportance) {
    if (listedFiles.length >= MAX_JSON_FILES) break;
    if (pickedFiles.has(p)) continue;
    pickedFiles.add(p);
    listedFiles.push(p);
  }
  for (const p of allFiles) {
    if (listedFiles.length >= MAX_JSON_FILES) break;
    if (pickedFiles.has(p)) continue;
    pickedFiles.add(p);
    listedFiles.push(p);
  }

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
      entryFiles: entries,
      manifest: manifest
        ? {
            name: manifest.name ?? null,
            version: manifest.version ?? null,
            packageManager,
            scripts: Object.fromEntries(manifest.scripts),
            dependencies: manifest.deps,
            devDependencies: manifest.devDeps,
          }
        : null,
      directories: input.dirPurposes
        ? [...input.dirPurposes.entries()].map(([dir, p]) => ({
            path: dir,
            purpose: input.purposeLabels?.[p.key] ?? p.key,
            confidence: p.confidence,
          }))
        : [],
      files: listedFiles,
      filesTotal: allFiles.length,
      readingPath: (input.readingPath ?? []).map((s) => ({
        order: s.order,
        path: s.path,
        role: s.role,
      })),
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
