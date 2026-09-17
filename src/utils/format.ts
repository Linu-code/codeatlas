/**
 * 地区化格式化工具（提示词要求：日期、数字按地区格式化）
 * 统一走 Intl，语言取自 i18next 当前语言。
 */

const localeOf = (lang: string): string => {
  if (lang.startsWith('zh')) return 'zh-CN';
  if (lang.startsWith('ja')) return 'ja-JP';
  return 'en-US';
};

/** 星标数：中文用"万"，英文用 K/M，日文同英文 */
export function formatStars(stars: number, lang: string): string {
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
  if (bytes < 1024) return `${formatNumber(bytes, lang)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(date: Date | number, lang: string): string {
  return new Intl.DateTimeFormat(localeOf(lang), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
