/**
 * Prism 语言包按需加载器
 *
 * 为什么要按需：Prism 全语言静态导入会让首屏 bundle 膨胀（实测 +350 kB）。
 * 冷启动 <2s 是硬性要求，因此这里只静态引入 4 个核心语法（markup/css/clike/javascript），
 * 其余语言在用户第一次打开对应文件时动态 import，并自动处理 Prism 的语法依赖链。
 */

import Prism from 'prismjs';

// 核心语法：其它语言包都建立在这四个之上，体积很小
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';

type Loader = () => Promise<unknown>;

/** 动态语言包映射（键为 Prism 语言名） */
const LOADERS: Record<string, Loader> = {
  typescript: () => import('prismjs/components/prism-typescript'),
  jsx: () => import('prismjs/components/prism-jsx'),
  tsx: () => import('prismjs/components/prism-tsx'),
  json: () => import('prismjs/components/prism-json'),
  yaml: () => import('prismjs/components/prism-yaml'),
  toml: () => import('prismjs/components/prism-toml'),
  markdown: () => import('prismjs/components/prism-markdown'),
  bash: () => import('prismjs/components/prism-bash'),
  python: () => import('prismjs/components/prism-python'),
  go: () => import('prismjs/components/prism-go'),
  rust: () => import('prismjs/components/prism-rust'),
  java: () => import('prismjs/components/prism-java'),
  c: () => import('prismjs/components/prism-c'),
  cpp: () => import('prismjs/components/prism-cpp'),
  sql: () => import('prismjs/components/prism-sql'),
  ini: () => import('prismjs/components/prism-ini'),
  scss: () => import('prismjs/components/prism-scss'),
};

/** Prism 语法之间的依赖链（加载目标语言前必须先加载这些） */
const DEPS: Record<string, string[]> = {
  typescript: ['javascript'],
  jsx: ['markup', 'javascript'],
  tsx: ['jsx', 'typescript'],
  cpp: ['c'],
  scss: ['css'],
};

const inFlight = new Map<string, Promise<void>>();

function loadOne(lang: string): Promise<void> {
  const cached = inFlight.get(lang);
  if (cached) return cached;

  const task = (async () => {
    for (const dep of DEPS[lang] ?? []) {
      if (!Prism.languages[dep]) await loadOne(dep);
    }
    const loader = LOADERS[lang];
    if (loader) {
      try {
        await loader();
      } catch {
        // 语言包加载失败：调用方回退为纯文本渲染（不阻断预览）
      }
    }
  })();

  inFlight.set(lang, task);
  return task;
}

/** 确保指定语言可用（幂等、并发安全） */
export async function ensurePrismLanguage(lang: string): Promise<void> {
  if (!lang || lang === 'none') return;
  if (Prism.languages[lang]) return;
  if (!LOADERS[lang] && !DEPS[lang]) return; // 未知语言，调用方走纯文本
  await loadOne(lang);
}

/** 是否已具备该语法（同步判断，用于渲染时机决策） */
export function hasPrismLanguage(lang: string): boolean {
  return Boolean(lang && lang !== 'none' && Prism.languages[lang]);
}

export { Prism };
