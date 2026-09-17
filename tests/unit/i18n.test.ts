import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/locales/en';
import { ja } from '../../src/i18n/locales/ja';
import { zh } from '../../src/i18n/locales/zh';
import { NAMESPACES, LANGUAGES } from '../../src/i18n';

type Dict = Record<string, unknown>;

const locales: Record<string, Record<string, Dict>> = {
  zh: zh as unknown as Record<string, Dict>,
  en: en as unknown as Record<string, Dict>,
  ja: ja as unknown as Record<string, Dict>,
};

/** 递归收集所有叶子键路径，如 viewer.purpose.tests */
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
  it('支持的语言为 zh/en/ja', () => {
    expect(LANGUAGES).toEqual(['zh', 'en', 'ja']);
  });

  it('四个命名空间在各语言中都存在', () => {
    for (const lang of LANGUAGES) {
      for (const ns of NAMESPACES) {
        expect(locales[lang][ns], `${lang} missing namespace ${ns}`).toBeDefined();
      }
    }
  });

  it('三语言键结构完全一致（防止漏翻）', () => {
    const zhKeys = collectKeys(locales.zh);
    const enKeys = collectKeys(locales.en);
    const jaKeys = collectKeys(locales.ja);
    expect(enKeys).toEqual(zhKeys);
    expect(jaKeys).toEqual(zhKeys);
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
      'parse-error',
    ];
    for (const lang of LANGUAGES) {
      for (const code of codes) {
        expect(locales[lang].errors[code], `${lang} missing error: ${code}`).toBeTruthy();
      }
    }
  });
});
