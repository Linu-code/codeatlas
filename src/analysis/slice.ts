/**
 * 按需展开：把「`路径:行号`」这样的地址解析成片段，只取真正需要的那几百 token。
 *
 * 为什么需要它：上下文包是**一次性交付**的摘要。AI 想知道某个函数怎么写，
 * 只能再要一次整个文件 —— 这一趟往返的 token 往往比省下来的还多。
 * 有了地址 + 切片，包可以退化成**索引**（有什么、在哪），实现细节按需索取。
 *
 * 设计取向与全仓一致：**宁可少给，不可乱给**。
 *   · 同名符号有多个定义 → 返回候选列表让用户选，不猜
 *   · 路径匹配到多个文件 → 同上
 *   · 地址无法解析 → 明确返回 invalid，由调用方提示正确格式
 */

import type { FileAnalysis } from './langs/types';
import { estimateTokens } from '../utils/tokenEstimator';

export interface SliceTarget {
  /** 仓库相对路径（POSIX） */
  path: string;
  /** 1-based 起始行 */
  startLine: number;
  /** 1-based 结束行（含） */
  endLine: number;
  /** 展示用标签：符号名或行段 */
  label: string;
  /** 单行地址命中了某个符号，已按符号边界扩展（调用方可据此提示"完整函数"） */
  snapped?: boolean;
}

export interface SliceCandidate {
  path: string;
  line: number;
  name: string;
}

export type AddressResult =
  | { kind: 'ok'; target: SliceTarget }
  | { kind: 'ambiguous'; candidates: SliceCandidate[] }
  | { kind: 'invalid'; reason: 'empty' | 'not-found' };

export interface ResolveContext {
  files: FileAnalysis[];
  /** 仓库全部文件路径（用于路径补全，含未解析的文件） */
  paths: string[];
}

/** 去掉用户从 Markdown 里复制时带上的反引号 / 引号 / 行尾标点 */
function cleanAddress(raw: string): string {
  return raw
    .trim()
    .replace(/^[`'"“”‘’]+|[`'"“”‘’]+$/g, '')
    .replace(/[，。；、]$/, '')
    .trim();
}

/** 路径补全：先精确，再按后缀匹配（允许只写 `core.ts` 或 `src/core.ts`） */
function matchPath(input: string, paths: string[]): { path: string } | { candidates: string[] } | null {
  const p = input.replace(/\\/g, '/').replace(/^\.\//, '');
  if (paths.includes(p)) return { path: p };
  const suffix = `/${p}`;
  const hits = paths.filter((x) => x.endsWith(suffix));
  if (hits.length === 1) return { path: hits[0] };
  if (hits.length > 1) return { candidates: hits.slice(0, 10) };
  return null;
}

/**
 * 解析地址。支持四种写法：
 *   `src/a.ts`                 整个文件
 *   `src/a.ts:42`              单行（自动前后各带几行上下文）
 *   `src/a.ts:42-80`           行段
 *   `src/a.ts#createRenderer`  文件内按符号名定位（最精确）
 *   裸符号名 `createRenderer`  全仓唯一时才解析，多义则返回候选
 */
export function resolveAddress(rawAddress: string, ctx: ResolveContext): AddressResult {
  const address = cleanAddress(rawAddress);
  if (!address) return { kind: 'invalid', reason: 'empty' };

  // ---------- 1. 路径 + 符号：src/a.ts#name ----------
  const hash = /^(.+?)#([A-Za-z_$][\w$]*)$/.exec(address);
  if (hash) {
    const matched = matchPath(hash[1], ctx.paths);
    if (!matched || 'candidates' in matched) {
      return matched && 'candidates' in matched
        ? { kind: 'ambiguous', candidates: matched.candidates.map((p) => ({ path: p, line: 1, name: hash[2] })) }
        : { kind: 'invalid', reason: 'not-found' };
    }
    const file = ctx.files.find((f) => f.path === matched.path);
    const def = file?.definitions.find((d) => d.name === hash[2]);
    if (!def) return { kind: 'invalid', reason: 'not-found' };
    return {
      kind: 'ok',
      target: {
        path: matched.path,
        startLine: def.line,
        endLine: Math.max(def.line, def.endLine),
        label: def.name,
      },
    };
  }

  // ---------- 2. 路径 + 行号 / 行段：src/a.ts:42 或 src/a.ts:42-80 ----------
  const lineRange = /^(.+?):(\d+)(?:-(\d+))?$/.exec(address);
  if (lineRange) {
    const matched = matchPath(lineRange[1], ctx.paths);
    if (!matched) return { kind: 'invalid', reason: 'not-found' };
    if ('candidates' in matched) {
      return {
        kind: 'ambiguous',
        candidates: matched.candidates.map((p) => ({ path: p, line: Number(lineRange[2]), name: '' })),
      };
    }
    const start = Number(lineRange[2]);
    const end = lineRange[3] ? Number(lineRange[3]) : start;
    if (start <= 0) return { kind: 'invalid', reason: 'not-found' };

    // 单行地址：如果这一行落在某个符号内部，**按符号边界扩展**。
    // 这是索引 → 展开链路上最关键的一环：索引里给的就是 `路径:行号`，
    // 若只回 ±6 行，模型拿到的是半截函数（60 行的函数只能看到头部），
    // 要么再要一次（多一轮往返），要么基于半截代码下结论（更糟）。
    // 显式行段（`a-b`）不扩展：用户已经划定了范围，替他做主是越界。
    if (!lineRange[3]) {
      const file = ctx.files.find((f) => f.path === matched.path);
      const enclosing = file?.definitions.filter((d) => d.line <= start && start <= d.endLine);
      if (enclosing && enclosing.length > 0) {
        // 嵌套时取最内层（跨度最小），否则会把整个模块都吐出来
        const inner = enclosing.reduce((a, b) => (a.endLine - a.line <= b.endLine - b.line ? a : b));
        return {
          kind: 'ok',
          target: {
            path: matched.path,
            startLine: inner.line,
            endLine: Math.max(inner.line, inner.endLine),
            label: inner.name,
            snapped: true,
          },
        };
      }
    }

    return {
      kind: 'ok',
      target: {
        path: matched.path,
        startLine: start,
        endLine: Math.max(start, end),
        label: end > start ? `${matched.path}:${start}-${end}` : `${matched.path}:${start}`,
      },
    };
  }

  // ---------- 3. 只有路径：整个文件 ----------
  if (address.includes('/') || /\.[a-z0-9]+$/i.test(address)) {
    const matched = matchPath(address, ctx.paths);
    if (!matched) return { kind: 'invalid', reason: 'not-found' };
    if ('candidates' in matched) {
      return {
        kind: 'ambiguous',
        candidates: matched.candidates.map((p) => ({ path: p, line: 1, name: '' })),
      };
    }
    return {
      kind: 'ok',
      target: { path: matched.path, startLine: 1, endLine: Number.POSITIVE_INFINITY, label: matched.path },
    };
  }

  // ---------- 4. 裸符号名：全仓唯一定义才解析 ----------
  if (!/^[A-Za-z_$][\w$]*$/.test(address)) return { kind: 'invalid', reason: 'not-found' };
  const defs: SliceCandidate[] = [];
  for (const file of ctx.files) {
    for (const d of file.definitions) {
      if (d.name === address) defs.push({ path: file.path, line: d.line, name: d.name });
    }
  }
  if (defs.length === 0) return { kind: 'invalid', reason: 'not-found' };
  if (defs.length > 1) return { kind: 'ambiguous', candidates: defs.slice(0, 10) };

  const only = defs[0];
  const file = ctx.files.find((f) => f.path === only.path);
  const def = file?.definitions.find((d) => d.name === only.name && d.line === only.line);
  return {
    kind: 'ok',
    target: {
      path: only.path,
      startLine: only.line,
      endLine: Math.max(only.line, def?.endLine ?? only.line),
      label: only.name,
    },
  };
}

export interface SliceOptions {
  /** 片段 token 上限（默认 800） */
  maxTokens?: number;
  /** 单行地址时前后各带多少行上下文（默认 6） */
  contextLines?: number;
}

export interface SliceResult {
  /** 带行号的代码文本（含表头注释） */
  text: string;
  startLine: number;
  endLine: number;
  tokens: number;
  truncated: boolean;
  /** 该文件总行数 */
  totalLines: number;
}

/**
 * 「按需展开」的端到端结果。
 * 与 AddressResult 不同：这里已经读过文件，可能因为二进制 / 读失败而失败。
 */
export type SliceOutcome =
  | { kind: 'ok'; text: string; tokens: number; truncated: boolean }
  | { kind: 'ambiguous'; candidates: SliceCandidate[] }
  | { kind: 'invalid'; reason: 'empty' | 'not-found' | 'read-failed' };

/**
 * 按行号切出代码片段。
 * 行号前缀用固定宽度，方便直接贴回对话里做引用。
 */
export function formatSlice(source: string, target: SliceTarget, opts: SliceOptions = {}): SliceResult {
  const maxTokens = opts.maxTokens ?? 800;
  const contextLines = opts.contextLines ?? 6;
  const lines = source.split(/\r\n|\r|\n/);

  const isWholeFile = target.endLine === Number.POSITIVE_INFINITY;
  const start = Math.max(1, Math.min(target.startLine, Math.max(lines.length, 1)));
  let end = isWholeFile
    ? lines.length
    : Math.min(target.endLine, lines.length);
  if (end <= start && !isWholeFile) {
    // 单行地址：前后补上下文，避免只给一行没有任何信息
    end = Math.min(lines.length, start + contextLines);
  }

  const width = String(end).length;
  const pad = (n: number) => String(n).padStart(width, ' ');

  const renderRange = (from: number, to: number): string => {
    const body = lines.slice(from - 1, to).map((line, i) => `${pad(from + i)} | ${line}`);
    return body.join('\n');
  };

  let tokens = 0;
  let truncated = false;
  let currentEnd = end;
  let body = renderRange(start, currentEnd);

  const header = (to: number) =>
    `// ${target.path}:${start}-${to}（${to - start + 1} 行，共 ${lines.length} 行）` +
    (target.label && target.label !== target.path ? ` — ${target.label}` : '');

  // 超出预算时从尾部收缩（保留开头：函数签名与声明通常在前）
  while (currentEnd > start) {
    const text = `${header(currentEnd)}\n${body}`;
    tokens = estimateTokens(text);
    if (tokens <= maxTokens) break;
    truncated = true;
    // 按比例收缩，避免大文件里逐行循环几百次
    const shrink = Math.max(1, Math.floor((currentEnd - start + 1) * 0.15));
    currentEnd = Math.max(start, currentEnd - shrink);
    body = renderRange(start, currentEnd);
  }

  const text = `${header(currentEnd)}\n${body}`;
  tokens = estimateTokens(text);
  if (truncated) {
    // 截断说明本身也要算进预算，但只是一行，可接受
    return {
      text: `${text}\n// …已按 token 预算截断；完整范围 ${target.path}:${start}-${end}`,
      startLine: start,
      endLine: currentEnd,
      tokens,
      truncated: true,
      totalLines: lines.length,
    };
  }
  return { text, startLine: start, endLine: currentEnd, tokens, truncated: false, totalLines: lines.length };
}
