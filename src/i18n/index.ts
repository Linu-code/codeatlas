/**
 * i18next 初始化
 *
 * 语言决定顺序（提示词要求"首次启动检测系统语言，之后读取用户设置"）：
 *   1. 用户配置（M3 从 ~/.codeatlas/config.json 读取；M2 暂用 localStorage）
 *   2. 系统/浏览器语言
 *   3. 回退 en
 *
 * 同时负责 <html lang> 与 <html dir> 的同步，为后续阿拉伯语/希伯来语接入预留 RTL 能力。
 */

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from '../types/config';
import { en } from './locales/en';
import { ja } from './locales/ja';
import { zh } from './locales/zh';

export const NAMESPACES = ['common', 'viewer', 'analysis', 'errors'] as const;
export const LANGUAGES: Language[] = ['zh', 'en', 'ja'];

/** 语言标记为 RTL 的列表（当前三语言均 LTR，预留扩展） */
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);

const LANG_STORAGE_KEY = 'codeatlas.language';

/** 检测系统语言并映射到支持列表 */
export function detectSystemLanguage(): Language {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  const lower = nav.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('ja')) return 'ja';
  return 'en';
}

/** 读取已保存语言（无则返回 null，表示"首次启动"） */
export function readSavedLanguage(): Language | null {
  if (typeof localStorage === 'undefined') return null;
  const saved = localStorage.getItem(LANG_STORAGE_KEY);
  return saved && (LANGUAGES as string[]).includes(saved) ? (saved as Language) : null;
}

export function saveLanguage(lang: Language): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_STORAGE_KEY, lang);
}

/** 同步 <html lang> 与 dir（RTL 预留） */
export function syncDocumentLanguage(lang: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL_LANGS.has(lang.split('-')[0]) ? 'rtl' : 'ltr';
}

export async function initI18n(): Promise<typeof i18next> {
  const initial = readSavedLanguage() ?? detectSystemLanguage();

  await i18next.use(initReactI18next).init({
    resources: {
      zh: { common: zh.common, viewer: zh.viewer, analysis: zh.analysis, errors: zh.errors },
      en: { common: en.common, viewer: en.viewer, analysis: en.analysis, errors: en.errors },
      ja: { common: ja.common, viewer: ja.viewer, analysis: ja.analysis, errors: ja.errors },
    },
    lng: initial,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: [...NAMESPACES],
    interpolation: { escapeValue: false }, // React 自身已做转义
    returnNull: false,
  });

  syncDocumentLanguage(initial);
  i18next.on('languageChanged', (lng) => {
    syncDocumentLanguage(lng);
    saveLanguage(lng as Language);
  });

  return i18next;
}

export default i18next;
