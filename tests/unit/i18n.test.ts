/**
 * i18n 资源完整性
 *
 * 10 种语言的键结构必须完全一致（防止漏翻 / 漏键）。
 * 新增语言时只需在此登记，类型与断言会一起生效。
 */

import { describe, expect, it } from 'vitest';
import type { Language } from '../../src/types/config';
import { de } from '../../src/i18n/locales/de';
import { en } from '../../src/i18n/locales/en';
import { es } from '../../src/i18n/locales/es';
import { fr } from '../../src/i18n/locales/fr';
import { ja } from '../../src/i18n/locales/ja';
import { ko } from '../../src/i18n/locales/ko';
import { pt } from '../../src/i18n/locales/pt';
import { ru } from '../../src/i18n/locales/ru';
import { zh } from '../../src/i18n/locales/zh';
import { zhTW } from '../../src/i18n/locales/zh-TW';
import { NAMESPACES, LANGUAGES } from '../../src/i18n';

type Dict = Record<string, unknown>;

const locales: Record<Language, Record<string, Dict>> = {
  zh: zh as unknown as Record<string, Dict>,
  'zh-TW': zhTW as unknown as Record<string, Dict>,
  en: en as unknown as Record<string, Dict>,
  ja: ja as unknown as Record<string, Dict>,
  ko: ko as unknown as Record<string, Dict>,
  es: es as unknown as Record<string, Dict>,
  fr: fr as unknown as Record<string, Dict>,
  de: de as unknown as Record<string, Dict>,
  pt: pt as unknown as Record<string, Dict>,
  ru: ru as unknown as Record<string, Dict>,
};

/** 递归收集所有叶子键路径，如 viewer.linePrefix */
function collectKeys(obj: Dict, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') out.push(...collectKeys(v as Dict, path));
    else out.push(path);
  }
  return out.sort();
}

describe('i18n 资源完整性', () => {
  it('支持 10 种语言', () => {
    expect(LANGUAGES).toHaveLength(10);
    expect(LANGUAGES).toEqual(['zh', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru']);
  });

  it('每个语言包都已登记且键结构与基准一致', () => {
    const baseKeys = collectKeys(locales.en);
    for (const lang of LANGUAGES) {
      expect(locales[lang], `${lang} 未在 locales 中登记`).toBeDefined();
      expect(collectKeys(locales[lang]), `${lang} 键结构与基准不一致`).toEqual(baseKeys);
    }
  });

  it('四个命名空间在各语言中都存在', () => {
    for (const lang of LANGUAGES) {
      for (const ns of NAMESPACES) {
        expect(locales[lang][ns], `${lang} missing namespace ${ns}`).toBeDefined();
      }
    }
  });

  it('没有空字符串翻译', () => {
    const walk = (obj: Dict, path = '') => {
      for (const [k, v] of Object.entries(obj)) {
        const p = path ? `${path}.${k}` : k;
        if (v && typeof v === 'object') walk(v as Dict, p);
        else expect(String(v).length, `empty translation at ${p}`).toBeGreaterThan(0);
      }
    };
    for (const lang of LANGUAGES) walk(locales[lang]);
  });

  it('插值占位符未被翻译破坏（{{…}} 数量一致）', () => {
    const placeholders = (text: string) => (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort().join(',');
    const collectPlaceholders = (obj: Dict, prefix = '', out = new Map<string, string>()) => {
      for (const [k, v] of Object.entries(obj)) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object') collectPlaceholders(v as Dict, p, out);
        else out.set(p, placeholders(String(v)));
      }
      return out;
    };
    const base = collectPlaceholders(locales.en);
    for (const lang of LANGUAGES) {
      const current = collectPlaceholders(locales[lang]);
      for (const [key, value] of base) {
        if (!value) continue;
        expect(current.get(key), `${lang} 的 ${key} 占位符不匹配`).toBe(value);
      }
    }
  });

  it('错误码全部有对应文案（与 RepoErrorCode 对齐）', () => {
    const codes = [
      'invalid-input',
      'not-found',
      'private',
      'timeout',
      'rate-limit',
      'network',
      'bad-zip',
      'empty-zip',
      'zip-insecure',
      'not-found-dir',
      'parse-error',
    ];
    for (const lang of LANGUAGES) {
      for (const code of codes) {
        expect(locales[lang].errors[code], `${lang} missing error: ${code}`).toBeTruthy();
      }
    }
  });
});
