/**
 * 主题系统
 *
 * 四套主题（提示词要求）：
 *   light  —— 通用浅色
 *   dark   —— 通用深色（VSCode 风格中性灰）
 *   system —— 跟随系统（实时监听 prefers-color-scheme）
 *   atlas  —— CodeAtlas 专属（Atlas Blue，深浅两变体）
 *
 * 实现方式：CSS 变量集中在 src/index.css 的 [data-theme="..."] 选择器里，
 * JS 只负责解析出最终 data-theme 值并写入 <html>，附带系统主题变化监听。
 * 这样切换主题是纯 CSS 变量替换，零重渲染成本。
 */

import type { ThemeId } from '../types/config';

export type ResolvedTheme = 'light' | 'dark' | 'atlas-light' | 'atlas-dark';

const THEME_STORAGE_KEY = 'codeatlas.theme';

export const THEME_OPTIONS: { id: ThemeId; labelKey: string }[] = [
  { id: 'light', labelKey: 'common.themeLight' },
  { id: 'dark', labelKey: 'common.themeDark' },
  { id: 'system', labelKey: 'common.themeSystem' },
  { id: 'atlas', labelKey: 'common.themeAtlas' },
];

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 主题 id + 系统偏好 → 最终生效的 CSS 主题名 */
export function resolveTheme(theme: ThemeId, prefersDark = systemPrefersDark()): ResolvedTheme {
  switch (theme) {
    case 'light':
      return 'light';
    case 'dark':
      return 'dark';
    case 'system':
      return prefersDark ? 'dark' : 'light';
    case 'atlas':
      // Atlas 主题同样提供深浅两变体，跟随系统偏好选择
      return prefersDark ? 'atlas-dark' : 'atlas-light';
    default:
      return 'atlas-dark';
  }
}

export function applyTheme(theme: ThemeId): ResolvedTheme {
  const resolved = resolveTheme(theme);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved;
    // 让浏览器原生控件（滚动条、输入框）跟随深浅色
    document.documentElement.style.colorScheme = resolved.endsWith('dark') ? 'dark' : 'light';
  }
  return resolved;
}

export function readSavedTheme(): ThemeId | null {
  if (typeof localStorage === 'undefined') return null;
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  const ids: string[] = ['light', 'dark', 'system', 'atlas'];
  return saved && ids.includes(saved) ? (saved as ThemeId) : null;
}

export function saveTheme(theme: ThemeId): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/**
 * 监听系统主题变化。返回取消订阅函数。
 * 仅在当前主题为 system 或 atlas 时才有实际效果（其余主题 resolved 值不受系统影响）。
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => onChange();
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

/** Prism 语法高亮所需的语言 class 映射（token 颜色由 CSS 变量按主题切换） */
export const EXT_TO_PRISM: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  txt: 'none',
  css: 'css',
  scss: 'scss',
  html: 'markup',
  htm: 'markup',
  vue: 'markup',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cpp2: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  php: 'php',
  phtml: 'php',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  sql: 'sql',
  ini: 'ini',
  xml: 'markup',
  svg: 'markup',
};

/** 可预览的扩展名（对齐支持分析的语言全集，另有纯预览型如 md/json/yml） */
export const PREVIEWABLE_EXTS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'py', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx',
  'cs', 'php', 'phtml', 'kt', 'kts', 'swift', 'rb', 'rake', 'gemspec',
  'md', 'markdown', 'json', 'yaml', 'yml', 'toml', 'txt', 'css', 'scss', 'html', 'htm', 'sh',
]);

export function extOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

export function isPreviewable(path: string): boolean {
  return PREVIEWABLE_EXTS.has(extOf(path));
}

export function prismLangOf(path: string): string {
  return EXT_TO_PRISM[extOf(path)] ?? 'none';
}
