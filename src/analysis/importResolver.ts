/**
 * importResolver.ts —— 导入说明符 → 文件路径的解析（跨语言）
 *
 * 为什么单独一层：各语言的 import 语义差别很大
 *   · JavaScript / TypeScript / Python：相对路径（`./x`、`../y`），可省略扩展名与 /index
 *   · Java / C# / PHP：点号包名（`com.example.User`），对应目录层级
 *   · Go / Rust：斜杠模块路径（`app/util`、`crate::foo::bar`）
 *   · 打包器别名：`@/utils/x`、`~/x`
 * 统一在这里做"保守的最佳努力"解析。
 *
 * 设计原则——宁可少连，不可乱连：
 *   错的依赖边比缺失的依赖边危害更大，它会让 PageRank 排序与循环依赖检测误导用户。
 *   因此只有在**置信度最高且唯一**时才返回一条边，多个候选时一律放弃（返回 null）。
 */

import type { FileAnalysis } from './symbols';
import type { ScopeIndex } from './scopeGraph';

export interface FileEdge {
  from: string;
  to: string;
}

/** 解析上下文：预先索引好的候选表（避免每个 import 都线性扫描全部文件） */
export interface ResolveContext {
  paths: Set<string>;
  /** 文件名（去扩展名，小写）→ 路径列表 */
  byStem: Map<string, string[]>;
}

/** 可用扩展名（解析相对路径时逐个尝试） */
const EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'go', 'rs', 'java',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh',
  'cs', 'php', 'kt', 'kts', 'swift', 'rb',
];

/** 目录入口文件（`import './utils'` → `utils/index.ts`） */
const INDEX_FILES = ['index', 'mod', '__init__'];

/** 包管理器别名前缀：解析时直接丢掉这一层（`@/utils/x` → `utils/x`） */
const ALIAS_TOKENS = new Set(['@', '~', '$']);

/** Rust 的路径前缀关键字（`crate::a::b`、`super::x`） */
const RUST_PREFIXES = new Set(['crate', 'super', 'self']);

/** 取文件名（去扩展名，小写）：`src/utils/format.ts` → `format` */
export function stemOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.indexOf('.');
  return (dot === -1 ? base : base.slice(0, dot)).toLowerCase();
}

/** 建立解析上下文 */
export function buildResolveContext(paths: Iterable<string>): ResolveContext {
  const set = new Set<string>();
  const byStem = new Map<string, string[]>();
  for (const p of paths) {
    set.add(p);
    const stem = stemOf(p);
    const list = byStem.get(stem);
    if (list) list.push(p);
    else byStem.set(stem, [p]);
  }
  for (const list of byStem.values()) list.sort();
  return { paths: set, byStem };
}

/** POSIX 风格路径规范化（处理 ../ 与 ./） */
export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** 相对说明符的候选路径（含扩展名与目录入口补全） */
export function relativeCandidates(combined: string): string[] {
  const out = [combined];
  for (const ext of EXTENSIONS) {
    out.push(`${combined}.${ext}`);
    // `./foo.d` + `ts` 这类复合后缀（d.ts）单独处理，避免生成 foo.d.ts 之外的无意义组合
  }
  out.push(`${combined}.d.ts`);
  for (const idx of INDEX_FILES) {
    for (const ext of EXTENSIONS) out.push(`${combined}/${idx}.${ext}`);
  }
  return out;
}

/** 判断 segments 是否为 fileSegments 的连续子序列 */
function isContiguousSubsequence(segments: string[], fileSegments: string[]): boolean {
  if (segments.length === 0) return false;
  const lower = fileSegments.map((s) => s.toLowerCase());
  const target = segments.map((s) => s.toLowerCase());
  for (let i = 0; i + target.length <= lower.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length; j++) {
      if (lower[i + j] !== target[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * 解析一条导入说明符。
 * @returns 目标文件路径；无法高置信度判定时返回 null
 */
export function resolveImportSpec(
  fromPath: string,
  rawSpec: string,
  ctx: ResolveContext,
): string | null {
  const spec = rawSpec.trim().replace(/^['"`]|['"`]$/g, '').replace(/;$/, '');
  if (!spec) return null;

  // ---------- 1. 相对路径 ----------
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const baseDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
    const combined = normalizePath((spec.startsWith('/') ? '' : baseDir) + spec);
    if (!combined) return null;
    const hit = relativeCandidates(combined).find((c) => ctx.paths.has(c));
    return hit && hit !== fromPath ? hit : null;
  }

  // ---------- 2. 模块路径（点号 / 斜杠 / Rust 双冒号） ----------
  const segments = spec
    .replace(/\\/g, '/')
    .split(/[.:/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // 丢弃别名与语言前缀
  const cleaned: string[] = [];
  for (const seg of segments) {
    if (cleaned.length === 0 && (ALIAS_TOKENS.has(seg) || RUST_PREFIXES.has(seg))) continue;
    cleaned.push(seg);
  }
  if (cleaned.length === 0) return null;

  const last = cleaned[cleaned.length - 1].toLowerCase();
  const candidates = (ctx.byStem.get(last) ?? []).filter((p) => p !== fromPath);
  if (candidates.length === 0) return null;

  // ---------- 3. 打分：连续匹配 > 部分匹配 ----------
  let bestScore = 0;
  let best: string[] = [];
  for (const path of candidates) {
    const dirSegments = path.split('/');
    const stem = stemOf(path);
    const fileSegments = [...dirSegments.slice(0, -1), stem];
    let score = 0;
    if (isContiguousSubsequence(cleaned, fileSegments)) {
      score = 2;
    } else if (cleaned.length >= 2) {
      // 末段已匹配（byStem 保证），再看倒数第二段是否出现在目录里
      const penult = cleaned[cleaned.length - 2].toLowerCase();
      const dirs = dirSegments.slice(0, -1).map((s) => s.toLowerCase());
      score = dirs.includes(penult) ? 1 : 0;
    }
    if (score > bestScore) {
      bestScore = score;
      best = [path];
    } else if (score === bestScore && score > 0) {
      best.push(path);
    }
  }

  // 歧义（多个同分候选）时不猜，交给调用方忽略这条边
  if (bestScore === 0 || best.length !== 1) return null;
  return best[0];
}

/** 由导入关系构建文件级依赖边（去重、排序，保证确定性） */
export function buildImportEdges(files: FileAnalysis[], ctx: ResolveContext): FileEdge[] {
  const seen = new Set<string>();
  const edges: FileEdge[] = [];
  for (const file of files) {
    for (const spec of file.imports) {
      const target = resolveImportSpec(file.path, spec, ctx);
      if (!target) continue;
      const key = `${file.path}\u0000${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: file.path, to: target });
    }
  }
  return edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/**
 * 由调用关系构建文件级依赖边：调用目标 → 定义所在文件。
 * 同文件优先（局部优先解析），否则取排序后的第一个定义文件。
 */
export function buildCallEdges(files: FileAnalysis[], index: ScopeIndex): FileEdge[] {
  const seen = new Set<string>();
  const edges: FileEdge[] = [];
  for (const file of files) {
    for (const call of file.calls) {
      const entry = index.symbols.get(call.to);
      if (!entry || entry.definitions.length === 0) continue;
      const sorted = [...entry.definitions].sort(
        (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
      );
      const target = sorted.find((d) => d.file === file.path) ?? sorted[0];
      if (!target || target.file === file.path) continue;
      const key = `${file.path}\u0000${target.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: file.path, to: target.file });
    }
  }
  return edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** 合并两类边并加权（导入 1、调用 2 —— 调用是更强的耦合信号） */
export function mergeWeightedEdges(
  importEdges: FileEdge[],
  callEdges: FileEdge[],
): { from: string; to: string; weight: number }[] {
  const weights = new Map<string, { from: string; to: string; weight: number }>();
  for (const e of importEdges) {
    const key = `${e.from}\u0000${e.to}`;
    const cur = weights.get(key);
    if (cur) cur.weight += 1;
    else weights.set(key, { from: e.from, to: e.to, weight: 1 });
  }
  for (const e of callEdges) {
    const key = `${e.from}\u0000${e.to}`;
    const cur = weights.get(key);
    if (cur) cur.weight += 2;
    else weights.set(key, { from: e.from, to: e.to, weight: 2 });
  }
  return [...weights.values()].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
}
