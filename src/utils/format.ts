/**
 * 地区化格式化工具（提示词要求：日期、数字按地区格式化）
 * 统一走 Intl，语言取自 i18next 当前语言。
 */

/**
 * 语言代码 → Intl 区域。
 * 顺序敏感：zh-TW / zh-HK / zh-Hant 必须排在 zh 之前，否则会先命中 zh-CN。
 * 十种界面语言必须一一对应，漏一个就会让该语言退回 en-US（德语的 1.234,5 显示成 1,234.5）。
 */
const LOCALE_TABLE: readonly (readonly [string, string])[] = [
  ['zh-tw', 'zh-TW'],
  ['zh-hk', 'zh-TW'],
  ['zh-hant', 'zh-TW'],
  ['zh', 'zh-CN'],
  ['ja', 'ja-JP'],
  ['ko', 'ko-KR'],
  ['es', 'es-ES'],
  ['fr', 'fr-FR'],
  ['de', 'de-DE'],
  ['pt', 'pt-BR'],
  ['ru', 'ru-RU'],
  ['en', 'en-US'],
];

function localeOf(lang: string): string {
  const l = (lang || 'en').toLowerCase();
  return LOCALE_TABLE.find(([prefix]) => l.startsWith(prefix))?.[1] ?? 'en-US';
}

/** 一位小数的本地化数字（KB / MB 用，德语应为 1,5 而不是 1.5） */
function oneDecimal(n: number, lang: string): string {
  return new Intl.NumberFormat(localeOf(lang), {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(n);
}

/** 星标数：中文用"万"，英文用 K/M，日文同英文 */
export function formatStars(stars: number, lang: string): string {
  if (!Number.isFinite(stars)) return '—';
  return new Intl.NumberFormat(localeOf(lang), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(stars);
}

export function formatNumber(n: number, lang: string): string {
  return new Intl.NumberFormat(localeOf(lang)).format(n);
}

/** 文件大小：B / KB / MB，本地化单位分隔 */
export function formatSize(bytes: number, lang: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${formatNumber(bytes, lang)} B`;
  if (bytes < 1024 * 1024) return `${oneDecimal(bytes / 1024, lang)} KB`;
  return `${oneDecimal(bytes / 1024 / 1024, lang)} MB`;
}
