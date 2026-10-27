/**
 * 焦点检索：把「我要做某件事」翻译成「该读哪几个文件」。
 *
 * 为什么需要它：`overview` 包回答的是"这个项目是什么"，但用户真正的任务是具体的
 * （"加一个自定义指令"、"改登录鉴权"）。把整个项目摘要塞给 AI，模型仍然要靠猜。
 * 这里用**纯启发式**选出相关子图，不依赖 embedding，也不调模型：
 *
 *   1. 查询切词：非字母数字 / 驼峰 / 下划线 / 短横线都切开，小写去重
 *   2. 词 → 符号名（精确 > 前缀 > 包含）、文件路径（按段匹配 > 整串包含）、签名
 *   3. 命中的文件作为种子，沿文件依赖边**双向**扩散 1~2 跳（逐跳衰减）
 *   4. 输出相关文件、命中依据、以及这些文件之间的依赖边
 *
 * 设计取向与 importResolver 一致：**宁可少给，不可乱给**。没有命中就如实返回空，
 * 由调用方提示用户换关键词，而不是拿一堆不相干的文件凑数。
 */

import type { FileEdge } from './importResolver';

/** 检索所需的最小符号信息（contextPack 的 RankedSymbol 结构上兼容） */
export interface FocusSymbol {
  name: string;
  file: string;
  line: number;
  signature: string;
}

export interface FocusHit {
  file: string;
  score: number;
  /** 命中依据（用于在包里解释"为什么选它"，让结论可核查） */
  reasons: string[];
  /** 是否为直接命中（否则是依赖扩散进来的邻居） */
  seed: boolean;
}

export interface FocusResult {
  /** 切分后的查询词 */
  terms: string[];
  hits: FocusHit[];
  /** 命中文件之间的依赖边（只保留两端都在结果里的） */
  edges: FileEdge[];
  /** 命中的符号键 `${file}\u0000${name}`，按相关度降序 */
  symbolKeys: string[];
  matchedSymbols: number;
  /** 直接命中全部落在测试 / 示例文件里（实现代码没有匹配）—— 需要如实提示用户 */
  onlyTestHits: boolean;
}

/**
 * 停用词：只放真正没有区分度的虚词与泛动词。
 * 注意**不要**把 component / module / file 这类领域名词放进来 ——
 * 它们常是用户唯一能想起来的线索（"找一个 component"），删了就等于把查询清空。
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'how', 'what', 'why',
  'add', 'new', 'use', 'using', 'make', 'fix', 'bug', 'get', 'set',
  'want', 'need', 'should', 'about', 'into', 'when', 'where', 'which',
]);

/** 切词：非标识符字符 + 驼峰边界都切开 */
export function tokenizeQuery(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of query.split(/[^A-Za-z0-9\u4e00-\u9fff]+/)) {
    if (!raw) continue;
    // 驼峰 / 连续大写（HTTPServer → HTTP, Server）/ 数字边界
    const parts = raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(' ')
      .filter(Boolean);
    for (const p of parts) {
      const t = p.toLowerCase();
      if (t.length < 2 || STOP_WORDS.has(t) || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** 是否为纯 CJK 词（标识符里不会出现，只能匹配中文目录用途文案） */
function isCjk(term: string): boolean {
  return /[\u4e00-\u9fff]/.test(term);
}

/** 是否为测试 / 夹具路径：命中权重需要打折 */
const TEST_PATH_RE =
  /(^|\/)(__tests__|__mocks__|tests?|specs?|e2e|fixtures?|examples?|benchmarks?)\/|\.(test|spec|bench)\.[a-z]+$/i;

function isTestPath(file: string): boolean {
  return TEST_PATH_RE.test(file);
}

/** 单条符号名的匹配得分 */
function scoreName(name: string, terms: string[]): { score: number; hit: string | null } {
  const lower = name.toLowerCase();
  let best = 0;
  let hit: string | null = null;
  for (const term of terms) {
    if (isCjk(term)) continue;
    let s = 0;
    if (lower === term) s = 6;
    else if (lower.startsWith(term)) s = 4;
    else if (lower.includes(term)) s = 2.5;
    if (s > best) {
      best = s;
      hit = term;
    }
  }
  return { score: best, hit };
}

/** 路径匹配：整段相等比子串更有区分度（`auth/` 目录 vs 名字里恰好含 auth） */
function scorePath(file: string, terms: string[]): { score: number; hit: string | null } {
  const lower = file.toLowerCase();
  const segments = lower.split('/');
  let best = 0;
  let hit: string | null = null;
  for (const term of terms) {
    if (isCjk(term)) continue;
    let s = 0;
    if (segments.some((seg) => seg === term || seg.replace(/\.[a-z0-9]+$/, '') === term)) s = 5;
    else if (lower.includes(term)) s = 2;
    if (s > best) {
      best = s;
      hit = term;
    }
  }
  return { score: best, hit };
}

export interface FocusOptions {
  query: string;
  symbols: FocusSymbol[];
  filePaths: string[];
  /** 文件级依赖边，用于扩散 */
  fileEdges?: FileEdge[];
  /** 目录用途文案（i18n），用于让中文查询也能落到目录上 */
  dirLabels?: { dir: string; label: string }[];
  /** 结果最多保留多少个文件（默认 12） */
  maxFiles?: number;
  /** 扩散跳数（默认 2） */
  maxHops?: number;
}

/**
 * 解析查询，返回相关文件子图。
 * 无命中时 hits 为空数组 —— 调用方必须如实告知用户，不能悄悄退回全量。
 */
export function resolveFocus(opts: FocusOptions): FocusResult {
  const terms = tokenizeQuery(opts.query);
  const empty: FocusResult = {
    terms,
    hits: [],
    edges: [],
    symbolKeys: [],
    matchedSymbols: 0,
    onlyTestHits: false,
  };
  if (terms.length === 0) return empty;

  const maxFiles = opts.maxFiles ?? 12;
  const maxHops = opts.maxHops ?? 2;

  /** 测试 / 示例文件的权重折扣：问"这块怎么改"时，测试文件几乎不该排在实现文件前面 */
  const TEST_PENALTY = 0.3;

  /** 文件 → 种子分 / 依据 */
  const seedScore = new Map<string, number>();
  const reasons = new Map<string, string[]>();
  const addSeed = (file: string, score: number, reason: string) => {
    const weighted = isTestPath(file) ? score * TEST_PENALTY : score;
    if (weighted <= 0) return;
    seedScore.set(file, (seedScore.get(file) ?? 0) + weighted);
    const list = reasons.get(file);
    const text = isTestPath(file) ? `${reason}（测试文件，权重已下调）` : reason;
    if (list) {
      if (!list.includes(text)) list.push(text);
    } else {
      reasons.set(file, [text]);
    }
  };

  // ---------- 1. 路径命中 ----------
  for (const file of opts.filePaths) {
    const { score, hit } = scorePath(file, terms);
    if (hit) addSeed(file, score, `路径含 \`${hit}\``);
  }

  // ---------- 2. 符号命中 ----------
  const symbolScore = new Map<string, number>();
  let matchedSymbols = 0;
  for (const sym of opts.symbols) {
    const { score, hit } = scoreName(sym.name, terms);
    if (!hit) continue;
    matchedSymbols += 1;
    const key = `${sym.file}\u0000${sym.name}`;
    symbolScore.set(key, score);
    addSeed(sym.file, score, `符号 \`${sym.name}\` 含 \`${hit}\``);
  }

  // ---------- 3. 中文查询 → 目录用途文案 ----------
  // 标识符几乎不可能是中文，但目录用途（"组件"/"路由"/"测试"）可以是。
  // 这条让中文提问至少能落到正确的目录，而不是直接零命中。
  for (const { dir, label } of opts.dirLabels ?? []) {
    const hit = terms.find((t) => isCjk(t) && label.includes(t));
    if (!hit) continue;
    for (const file of opts.filePaths) {
      if (file === dir || file.startsWith(`${dir}/`)) {
        addSeed(file, 1.5, `目录用途「${label}」匹配 \`${hit}\``);
      }
    }
  }

  if (seedScore.size === 0) return empty;

  // ---------- 4. 沿依赖边双向扩散 ----------
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = adjacency.get(a);
    if (set) set.add(b);
    else adjacency.set(a, new Set([b]));
  };
  for (const e of opts.fileEdges ?? []) {
    link(e.from, e.to);
    link(e.to, e.from);
  }

  const total = new Map<string, number>();
  for (const [file, score] of seedScore) total.set(file, score);

  // BFS：每跳衰减 0.35，两跳后贡献 < 13%，再远就是噪音
  let frontier = [...seedScore.keys()];
  const visited = new Set(frontier);
  for (let hop = 1; hop <= maxHops; hop += 1) {
    const next: string[] = [];
    const decay = Math.pow(0.35, hop);
    for (const from of frontier) {
      const base = total.get(from) ?? 0;
      for (const to of adjacency.get(from) ?? []) {
        if (visited.has(to)) continue;
        // 邻居本身是测试文件时同样打折，避免测试反向把实现挤下去
        const weight = isTestPath(to) ? TEST_PENALTY : 1;
        total.set(to, (total.get(to) ?? 0) + base * decay * weight);
        visited.add(to);
        next.push(to);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  // 排序：**实现文件永远排在测试 / 示例之前**。
  // 只做分数折扣不够——测试里常能凑出更高的词面命中（`test/Router.js` 对查询 `router`），
  // 而用户问"这块怎么改"要的是实现。测试文件只在没有其它命中时才顶上。
  const hits: FocusHit[] = [...total.entries()]
    .sort((a, b) => {
      const ta = isTestPath(a[0]) ? 1 : 0;
      const tb = isTestPath(b[0]) ? 1 : 0;
      if (ta !== tb) return ta - tb;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .slice(0, maxFiles)
    .map(([file, score]) => ({
      file,
      score: Number(score.toFixed(2)),
      reasons: reasons.get(file) ?? ['依赖扩散命中'],
      seed: seedScore.has(file),
    }));

  const keep = new Set(hits.map((h) => h.file));
  const edges = (opts.fileEdges ?? []).filter((e) => keep.has(e.from) && keep.has(e.to));

  const symbolKeys = [...symbolScore.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);

  const seeds = [...seedScore.keys()];
  const onlyTestHits = seeds.length > 0 && seeds.every((f) => isTestPath(f));

  return { terms, hits, edges, symbolKeys, matchedSymbols, onlyTestHits };
}
