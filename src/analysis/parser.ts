/**
 * tree-sitter 解析器池（浏览器 / Node 双环境）
 *
 * 术语与设计：
 *   · runtime wasm  = web-tree-sitter 自身的 wasm（tree-sitter.wasm）
 *   · grammar wasm  = 各语言的语法包（tree-sitter-javascript.wasm 等）
 *   · 解析器池      = 每种语言复用一个 Parser 实例（Parser 创建有一定开销）
 *
 * 版本约束（重要）：项目锁定 web-tree-sitter@0.22.6 + tree-sitter-wasms@0.1.13。
 * 0.25+ 的运行时改用新版 dylink 段加载 wasm，与旧 ABI 构建的语法包不兼容
 * （报 getDylinkMetadata 失败），scripts/check-tree-sitter.cjs 可复现该问题。
 *
 * 降级策略（提示词要求）：
 *   · 语法包加载失败 → 该语言标记为不支持，调用方跳过并提示（i18n: errors.unsupportedLanguage）
 *   · 单文件解析超时/异常 → 计入 failedFiles，不影响其它文件
 */

import type ParserType from 'web-tree-sitter';

/** tree-sitter 运行时的类型（运行时按需动态 import，避免拖累首屏） */
type ParserModule = typeof ParserType;
type ParserInstance = InstanceType<ParserModule>;
type LanguageInstance = ParserType.Language;
type SyntaxNode = ParserType.SyntaxNode;

export type LangId =
  | 'javascript'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'go'
  | 'rust';

/** 支持的扩展名 → 语言 */
export const EXT_TO_LANG: Record<string, LangId> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript', // JSX 语法由 javascript 语法包覆盖（tree-sitter-wasms 未单独提供 jsx）
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  go: 'go',
  rs: 'rust',
};

export function langOfPath(path: string): LangId | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? null;
}

/** 解析结果（对上层屏蔽 tree-sitter 类型） */
export interface ParsedTree {
  rootNode: SyntaxNode;
  /** tree-sitter 是否报告语法错误（容错解析，仍可用于提取） */
  hasError: boolean;
}

interface PoolEntry {
  parser: ParserInstance;
  language: LanguageInstance;
}

/** 环境适配：浏览器走 URL 请求，Node 测试走文件路径 */
export interface ParserEnv {
  runtimeWasm: () => string;
  grammarWasm: (lang: LangId) => string;
}

/** 浏览器环境：从 public/grammars/ 加载（构建前由 scripts/copy-grammars.mjs 复制） */
export function browserEnv(): ParserEnv {
  const base =
    (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
    '/';
  const prefix = base.endsWith('/') ? base : base + '/';
  return {
    runtimeWasm: () => `${prefix}grammars/tree-sitter.wasm`,
    grammarWasm: (lang) => `${prefix}grammars/tree-sitter-${lang}.wasm`,
  };
}

let env: ParserEnv = browserEnv();
let initPromise: Promise<ParserModule> | null = null;
const pool = new Map<LangId, PoolEntry>();
/** 加载失败的语言（避免反复重试） */
const unsupported = new Set<LangId>();
let runtime: ParserModule | null = null;

/** 注入自定义环境（单测用 Node 文件路径） */
export function configureParserEnv(next: ParserEnv): void {
  env = next;
  initPromise = null;
  pool.clear();
  unsupported.clear();
}

/**
 * 初始化运行时 wasm（幂等）。
 * tree-sitter 运行时约 120 kB，用动态 import 拆成独立 chunk ——
 * 只有用户真正触发「调用图/跳转/度量」时才加载，保证冷启动不受影响。
 */
export async function initParsers(): Promise<ParserModule> {
  if (!initPromise) {
    initPromise = (async () => {
      const mod = (await import('web-tree-sitter')) as unknown as {
        default?: ParserModule;
        Parser?: ParserModule;
      };
      // 兼容 CJS/ESM 两种导出形态
      const ctor = (mod.default ?? mod.Parser ?? mod) as ParserModule;
      // 0.22 中 Language/Query 等静态成员在 init 完成后才挂上
      await ctor.init({ locateFile: () => env.runtimeWasm() });
      runtime = ctor;
      return ctor;
    })();
  }
  return initPromise;
}

/** 取（或创建）某语言的解析器；语言包不可用时返回 null（调用方走降级） */
export async function getParser(lang: LangId): Promise<ParserInstance | null> {
  if (unsupported.has(lang)) return null;
  const existing = pool.get(lang);
  if (existing) return existing.parser;

  const ctor = await initParsers();
  try {
    const language = await ctor.Language.load(env.grammarWasm(lang));
    const parser = new ctor();
    parser.setLanguage(language);
    pool.set(lang, { parser, language });
    return parser;
  } catch {
    // 语法包加载失败：标记不支持，交由上层提示"该语言暂不支持"
    unsupported.add(lang);
    return null;
  }
}

export function isRuntimeLoaded(): boolean {
  return runtime !== null;
}

/** 语言是否可用（用于 UI 提前提示） */
export async function isLanguageSupported(lang: LangId): Promise<boolean> {
  return (await getParser(lang)) !== null;
}

/** 解析源码；parser 不可用时返回 null */
export async function parseCode(code: string, lang: LangId): Promise<ParsedTree | null> {
  const parser = await getParser(lang);
  if (!parser) return null;
  try {
    const tree = parser.parse(code);
    if (!tree) return null;
    return { rootNode: tree.rootNode, hasError: tree.rootNode.hasError };
  } catch {
    return null;
  }
}
/** 释放全部解析器（切换项目时调用） */
export function disposeParsers(): void {
  for (const entry of pool.values()) {
    try {
      entry.parser.delete();
    } catch {
      // 忽略释放异常
    }
  }
  pool.clear();
}
