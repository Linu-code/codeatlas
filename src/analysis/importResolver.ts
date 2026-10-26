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
  /**
   * 包名（小写）→ 入口文件。
   * monorepo 里 `import { x } from '@vue/shared'` 指向的是 `packages/shared/src/index.ts`，
   * 不是 npm 包；不建这张表，Vue 这类仓库有 400+ 条依赖边会因为没有 node_modules 而全部丢失。
   */
  byPackage: Map<string, string>;
  /**
   * 目录后缀（小写）→ 该目录下的文件。
   * 用于「完整模块路径」的语言：Go 的 `github.com/o/r/binding`、Rust 的 `crate::a::b`、
   * Python 的 `from flask import X`、Java 的 `com.example.user`。
   *
   * 键是**目录路径的任意后缀**：`src/flask` 会同时登记为 `src/flask` 与 `flask`，
   * 否则 Python 的 `import flask` 永远匹配不到 `src/flask/`。
   * 同一后缀对应多个目录时不登记（歧义 → 不猜）。
   */
  byDir: Map<string, string[]>;
}

/** monorepo 包入口：packages|libs|modules|apps/<pkg>/(src/)?index.{ext} */
const PKG_ENTRY_RE =
  /^(?:packages|libs|modules|apps)\/([^/]+)\/(?:src\/)?(?:index|mod)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

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
  const byPackage = new Map<string, string>();
  const dirFiles = new Map<string, string[]>();
  const dirSuffix = new Map<string, Set<string>>();

  for (const p of paths) {
    set.add(p);
    const stem = stemOf(p);
    const list = byStem.get(stem);
    if (list) list.push(p);
    else byStem.set(stem, [p]);

    const pkg = PKG_ENTRY_RE.exec(p);
    if (pkg) {
      const name = pkg[1].toLowerCase();
      if (!byPackage.has(name)) byPackage.set(name, p);
    }

    const slash = p.lastIndexOf('/');
    if (slash > 0) {
      const dir = p.slice(0, slash).toLowerCase();
      const inDir = dirFiles.get(dir);
      if (inDir) inDir.push(p);
      else dirFiles.set(dir, [p]);
    }
  }

  // 目录的每个路径后缀都登记一次；同后缀多个目录视为歧义，不登记
  const ambiguous = new Set<string>();
  for (const dir of dirFiles.keys()) {
    const segs = dir.split('/');
    for (let i = 0; i < segs.length; i += 1) {
      const key = segs.slice(i).join('/');
      if (ambiguous.has(key)) continue;
      const owners = dirSuffix.get(key);
      if (!owners) dirSuffix.set(key, new Set([dir]));
      else if (!owners.has(dir)) {
        ambiguous.add(key);
        dirSuffix.delete(key);
      }
    }
  }

  const byDir = new Map<string, string[]>();
  for (const [key, owners] of dirSuffix) {
    for (const dir of owners) byDir.set(key, dirFiles.get(dir)!);
  }

  for (const list of byStem.values()) list.sort();
  for (const list of byDir.values()) list.sort();
  return { paths: set, byStem, byPackage, byDir };
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
 * 目录级解析：说明符的最后 1~3 段匹配仓库内的目录。
 *
 * 覆盖「完整模块路径」语言：
 *   Go      github.com/gin-gonic/gin/binding  → binding/binding.go
 *   Python  from app.models import X          → app/models/(__init__.py | models.py)
 *   Rust    crate::analysis::graph            → analysis/graph/(mod.rs | graph.rs)
 *   Java    com.example.user                  → .../user/User.java
 *
 * 只在按文件名打分失败后调用；且必须能确定唯一入口，否则返回 null（不猜）。
 */
function resolveByDir(segments: string[], ctx: ResolveContext, fromPath: string): string | null {
  if (segments.length === 0) return null;
  const lower = segments.map((s) => s.toLowerCase());

  for (let take = Math.min(3, lower.length); take >= 1; take -= 1) {
    const suffix = lower.slice(lower.length - take);
    const files = ctx.byDir.get(suffix.join('/'));
    if (!files || files.length === 0) continue;

    const dirName = suffix[take - 1];
    // 入口优先级：与目录同名的文件（Go / Java / Rust 惯例）> index 类文件
    // 必须排除 fromPath：Go 的同包文件互不 import，命中自己说明这条说明符没有跨文件含义。
    const sameName = files.find((p) => stemOf(p) === dirName && p !== fromPath);
    if (sameName) return sameName;

    const indexHit = files.find((p) => INDEX_FILES.includes(stemOf(p)) && p !== fromPath);
    if (indexHit) return indexHit;

    // 目录存在但入口不明确 → 不猜
    return null;
  }
  return null;
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
  let spec = rawSpec.trim().replace(/^['"`]|['"`]$/g, '').replace(/;$/, '');
  if (!spec) return null;

  // ---------- 0. Python 相对导入：点号是层级，不是路径分隔符 ----------
  // `from .sansio import x` → `./sansio`；`from ..models import y` → `../models`
  // 不转换的话 `.sansio` 会被当成名字里带点的目录，整个包的内部依赖全部解析失败。
  const pyRel = /^(\.+)([A-Za-z_][\w.]*)$/.exec(spec);
  if (pyRel) {
    const up = pyRel[1].length - 1;
    const rest = pyRel[2].replace(/\./g, '/');
    spec = up === 0 ? `./${rest}` : `${'../'.repeat(up)}${rest}`;
  } else if (/^\.+$/.test(spec)) {
    spec = './';
  }

  // ---------- 1. 相对路径 ----------
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const baseDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
    const combined = normalizePath((spec.startsWith('/') ? '' : baseDir) + spec);
    if (!combined) return null;
    const hit = relativeCandidates(combined).find((c) => ctx.paths.has(c));
    return hit && hit !== fromPath ? hit : null;
  }

  // ---------- 2. 模块路径（点号 / 斜杠 / Rust 双冒号） ----------
  // ---------- 2.1 monorepo 包名优先：@vue/shared → packages/shared/src/index.ts ----------
  // 放在打分之前：包入口是确定的一对一映射，比按名字相似度猜更可靠。
  const pkgName = spec.startsWith('@') ? spec.split('/')[1] : spec.split('/')[0];
  if (pkgName) {
    const entry = ctx.byPackage.get(pkgName.toLowerCase());
    if (entry && entry !== fromPath) return entry;
  }

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
  if (bestScore !== 0 && best.length === 1) {
    return best[0];
  }

  // ---------- 4. 目录级匹配（Go / Python / Rust / Java 的完整模块路径） ----------
  // 必须放在按文件名匹配之后：`import 'utils/format'` 应优先命中 format.ts，
  // 而不是目录 utils 的入口文件。
  return resolveByDir(cleaned, ctx, fromPath);
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
 *
 * 目标选择顺序（与文件头"宁可少连"原则一致）：
 *   1. 本文件内有定义 → 不算跨文件边
 *   2. 全局只有唯一一个文件定义该符号 → 连它
 *   3. 多个文件都定义 → 只在「本文件 import 的目标里恰好有且仅有一个」时才连
 *   4. 仍然多义 → 放弃
 *
 * 曾经的实现是「多义时取排序后的第一个文件」，在 Vue 这类仓库里会产生 30%~40% 的
 * 假边（`get` / `map` / `helper` 这类通用名到处都是），而且这些边权重是 2，
 * 会把阅读路线的排序整个带偏。
 *
 * @param importEdges 已知的文件级导入边，用于给多义符号提供约束（可选）
 */
export function buildCallEdges(
  files: FileAnalysis[],
  index: ScopeIndex,
  importEdges: FileEdge[] = [],
): FileEdge[] {
  // 文件 → 它导入的文件集合（只用于消歧，不必精确）
  const depsOf = new Map<string, Set<string>>();
  for (const edge of importEdges) {
    const set = depsOf.get(edge.from) ?? new Set<string>();
    set.add(edge.to);
    depsOf.set(edge.from, set);
  }

  const seen = new Set<string>();
  const edges: FileEdge[] = [];

  for (const file of files) {
    const deps = depsOf.get(file.path);

    for (const call of file.calls) {
      const entry = index.symbols.get(call.to);
      if (!entry || entry.definitions.length === 0) continue;

      // 定义所在文件（去重、排除自身）
      const defFiles = [...new Set(entry.definitions.map((d) => d.file))].filter(
        (f) => f !== file.path,
      );
      if (defFiles.length === 0) continue;

      let target: string | undefined;
      if (defFiles.length === 1) {
        target = defFiles[0];
      } else if (deps) {
        const viaImport = defFiles.filter((f) => deps.has(f));
        if (viaImport.length === 1) target = viaImport[0];
      }
      if (!target) continue;

      const key = `${file.path}\u0000${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: file.path, to: target });
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
