/**
 * 分级寻址：仓库 → 模块 → 目录 → 文件 → 符号 → 代码。
 *
 * 为什么需要它：索引包永遠只能是**样本**。实测 Vue（5055 符号）在 2000 预算下
 * 只列得出 93 条 —— 1.8%，模型想找的符号大概率不在包里，而且它没有任何办法
 * 走进去。一级级的"摘要"把这条路修通：
 *
 *   · 模块地图（~300 token）  —— 有哪些模块，每个模块几文件几符号
 *   · 目录摘要（~600 token）  —— 这个目录下有哪些子目录与文件，各自几符号
 *   · 文件索引（~100 token）  —— 这个文件里的全部符号及其地址
 *   · 代码片段（~100 token）  —— 按 `path:行号` 取实现
 *
 * 每一级都**便宜且完整**：不抽样、不猜，全部条目都带可继续寻址的地址。
 */

import type { FileAnalysis } from './langs/types';
import { moduleOf } from './moduleGraph';
import { isTestPath } from './paths';
import { estimateTokens } from '../utils/tokenEstimator';

/** 从符号级信息里取"关键符号"：调用方通常已按重要性排好序 */
export interface NamedSymbol {
  name: string;
  file: string;
  line: number;
}

/** 目录归一：去 `./` 前缀与首尾斜杠，根目录返回 '' */
export function normalizeDir(dir: string): string {
  let d = dir.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  d = d.replace(/^\/+|\/+$/g, '');
  return d === '.' ? '' : d;
}

/** 某目录下的直接子目录与直接文件 */
function splitEntries(
  dir: string,
  files: FileAnalysis[],
): { subdirs: string[]; direct: FileAnalysis[] } {
  const prefix = dir ? `${dir}/` : '';
  const subdirs = new Set<string>();
  const direct: FileAnalysis[] = [];
  for (const f of files) {
    if (prefix && !f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) direct.push(f);
    else subdirs.add(`${prefix}${rest.slice(0, slash)}`);
  }
  return { subdirs: [...subdirs].sort(), direct };
}

/** 目录下（含所有子孙）的统计 */
function countUnder(dir: string, files: FileAnalysis[]): { files: number; symbols: number } {
  const prefix = dir ? `${dir}/` : '';
  let n = 0;
  let symbols = 0;
  for (const f of files) {
    if (prefix && !f.path.startsWith(prefix)) continue;
    n += 1;
    symbols += f.definitions.length;
  }
  return { files: n, symbols };
}

export interface DirectoryDigest {
  text: string;
  dir: string;
  fileCount: number;
  symbolCount: number;
  truncated: boolean;
}

/**
 * 目录摘要：子目录（含文件/符号数）+ 文件（符号数 + 最多 3 个符号地址）。
 * 两种条目都带**可继续寻址的地址**（`dir/` 或 `path:行号`），不会走到死路。
 */
export function buildDirectoryDigest(
  rawDir: string,
  files: FileAnalysis[],
  opts: { maxTokens?: number } = {},
): DirectoryDigest {
  const maxTokens = opts.maxTokens ?? 1200;
  const dir = normalizeDir(rawDir);
  const { subdirs, direct } = splitEntries(dir, files);
  const total = countUnder(dir, files);

  const header =
    `// 目录 ${dir ? `${dir}/` : '(仓库根)'} — ${total.files} 个文件 / ${total.symbols} 个符号`;

  const subLines = subdirs.map((sub) => {
    const c = countUnder(sub, files);
    return `- \`${sub}/\` ${c.files} 文件 / ${c.symbols} 符号`;
  });

  const fileLines = direct
    .slice()
    .sort((a, b) => b.definitions.length - a.definitions.length || a.path.localeCompare(b.path))
    .map((f) => {
      const top = f.definitions
        .slice(0, 3)
        .map((d) => `\`${f.path}:${d.line}\` ${d.name}`)
        .join('、');
      return `- \`${f.path}\` ${f.definitions.length} 符号${top ? ` — ${top}` : ''}`;
    });

  const parts = [header];
  if (subLines.length) parts.push('## 子目录', '', ...subLines);
  if (fileLines.length) parts.push('## 文件', '', ...fileLines);

  let text = parts.join('\n');
  let truncated = false;

  // 超预算时先砍"关键符号"细节，再砍文件行，最后砍子目录行 —— 保结构、降细节
  if (estimateTokens(text) > maxTokens) {
    truncated = true;
    const bare = [
      header,
      ...(subLines.length ? ['## 子目录', '', ...subLines] : []),
      ...(fileLines.length ? ['## 文件', '', ...fileLines.map((l) => l.split(' — ')[0])] : []),
    ].join('\n');
    text = bare;
  }
  if (estimateTokens(text) > maxTokens) {
    const keep = Math.max(0, Math.floor(fileLines.length * 0.5));
    const kept = [
      header,
      ...(subLines.length ? ['## 子目录', '', ...subLines] : []),
      ...(keep ? ['## 文件', '', ...fileLines.slice(0, keep).map((l) => l.split(' — ')[0])] : []),
      `- …另有 ${fileLines.length - keep} 个文件未列出`,
    ].join('\n');
    text = kept;
  }

  return {
    text,
    dir,
    fileCount: total.files,
    symbolCount: total.symbols,
    truncated,
  };
}

/** 单文件符号索引：该文件**全部**符号的地址（不抽样） */
export function buildFileSymbolIndex(
  filePath: string,
  files: FileAnalysis[],
): { text: string; symbolCount: number } | null {
  const file = files.find((f) => f.path === filePath);
  if (!file) return null;
  const lines = file.definitions
    .slice()
    .sort((a, b) => a.line - b.line)
    .map((d) => `- \`${file.path}:${d.line}\` ${d.name}`);
  const head = `// 文件 ${file.path} — ${file.definitions.length} 个符号`;
  return {
    text: [head, ...lines].join('\n'),
    symbolCount: file.definitions.length,
  };
}

/**
 * 模块地图：每个模块一行，带 3 个关键符号名。
 * 这是索引包的"目录页"——它保证**每个模块都可被寻址**，
 * 即使符号样本一条都没覆盖到该模块。
 */
export function buildModuleMap(
  files: FileAnalysis[],
  ranked: NamedSymbol[],
  opts: { symbolsPerModule?: number } = {},
): { text: string; moduleCount: number } {
  const perModule = opts.symbolsPerModule ?? 3;

  /** 模块地址：与 moduleOf 同一套聚合规则（`src/<sub>`、`packages/<pkg>`），根目录写作 `./` */
  const addrOf = (file: string) => {
    const m = moduleOf(file);
    return m === '(root)' ? './' : `${m}/`;
  };

  const counts = new Map<string, number>();
  const names = new Map<string, string[]>();
  const order: string[] = [];

  // 先按符号数把模块排出来（决定地图里谁在前）
  for (const f of files) {
    const addr = addrOf(f.path);
    if (!counts.has(addr)) {
      counts.set(addr, 0);
      order.push(addr);
    }
    counts.set(addr, (counts.get(addr) ?? 0) + f.definitions.length);
  }
  // 测试 / 示例模块排最后：express 的 test/ 有 93 个符号，按数量排序会压过 lib/（19），
  // 模型照着地图探索就会先去读测试。数量仍然是同组内的顺序依据。
  order.sort((a, b) => {
    const ta = isTestPath(a) ? 1 : 0;
    const tb = isTestPath(b) ? 1 : 0;
    if (ta !== tb) return ta - tb;
    return (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
  });

  // 关键符号取自 ranked（调用方已按重要性排序）
  for (const s of ranked) {
    const addr = addrOf(s.file);
    const list = names.get(addr);
    if (!list) names.set(addr, [s.name]);
    else if (list.length < perModule && !list.includes(s.name)) list.push(s.name);
  }

  const lines = order
    .filter((addr) => (counts.get(addr) ?? 0) > 0)
    .map((addr) => {
      const top = (names.get(addr) ?? []).join('、');
      return `- \`${addr}\` ${counts.get(addr)} 符号${top ? ` — ${top}` : ''}`;
    });

  return { text: lines.join('\n'), moduleCount: lines.length };
}
