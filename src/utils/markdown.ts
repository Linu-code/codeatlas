/**
 * Markdown 渲染工具
 *  - markdown-it 实例（html:false 防注入）
 *  - 相对资源路径解析：README 里的 ![](./assets/x.png) 需要改写为真实来源
 *      · GitHub：raw.githubusercontent.com/{owner}/{repo}/{branch}/
 *      · 本地 ZIP：由调用方注入 blob URL 解析器
 *  - 链接改写：相对链接指向 GitHub 网页视图
 */

import MarkdownIt from 'markdown-it';

/** 渲染器类型由构造函数推导（@types/markdown-it 以 export= 形式导出，直接引用类型名会报 TS2749） */
export function createMarkdownRenderer() {
  return new MarkdownIt({
    html: false, // 安全：不渲染原始 HTML
    linkify: true,
    typographer: true,
  });
}

export const md = createMarkdownRenderer();

/** 是否为外部绝对地址 */
export function isAbsoluteSrc(src: string): boolean {
  return /^(https?:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:');
}

/**
 * 纯函数版的相对路径解析（便于单测）：
 * 把 README 中的相对资源路径拼接为绝对 URL。
 * baseUrl 为空时原样返回（离线 ZIP 场景由 blob 解析器接管）。
 */
export function resolveRelativeSrc(src: string, baseUrl: string | null): string {
  if (!src || isAbsoluteSrc(src)) return src;
  if (!baseUrl) return src;
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  // 去 ./ 前缀；../ 不越界，直接规范化掉
  let rel = src.replace(/^\.\//, '');
  while (rel.startsWith('../')) rel = rel.slice(3);
  return normalizedBase + rel;
}

export interface RenderOptions {
  /** 资源绝对前缀，如 https://raw.githubusercontent.com/o/r/main/ */
  baseUrl?: string | null;
  /** 自定义资源解析（ZIP 场景：返回 blob URL）；返回 null 表示回退到 baseUrl 规则 */
  resolveAsset?: (src: string) => string | null;
  /** 相对链接跳转前缀（GitHub 网页视图） */
  linkBase?: string | null;
}

/** 渲染 Markdown 为 HTML 字符串（不做 DOM 改写，DOM 改写见 rewriteRenderedDom） */
export function renderMarkdown(text: string, _options: RenderOptions = {}): string {
  return md.render(text);
}

/** 派生 GitHub 资源前缀 */
export function githubRawBase(owner: string, repo: string, branch: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`;
}

export function githubLinkBase(owner: string, repo: string, branch: string): string {
  return `https://github.com/${owner}/${repo}/blob/${branch}/`;
}
