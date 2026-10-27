import { describe, expect, it } from 'vitest';
import { formatNumber, formatSize, formatStars } from '../../src/utils/format';

/**
 * 十种界面语言必须映射到各自的 Intl 区域。
 * 早期实现只区分 zh / ja，其余八种一律 en-US —— 德语的 1.234,5 会显示成 1,234.5。
 */
describe('formatNumber —— 区域映射', () => {
  it('德语用点分千位、逗号小数', () => {
    expect(formatNumber(1234567, 'de')).toBe('1.234.567');
  });

  it('英语用逗号分千位', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567');
  });

  it('简体中文与英文同为逗号', () => {
    expect(formatNumber(1234567, 'zh')).toBe('1,234,567');
  });

  it('繁体中文不会被 zh 前缀抢先匹配成 zh-CN', () => {
    // zh-TW 的千位分隔符同为逗号，但走的是不同 locale；这里只需确认不抛错且格式正确
    expect(formatNumber(1234, 'zh-TW')).toBe('1,234');
  });

  it('未知语言回退 en-US', () => {
    expect(formatNumber(1234, 'xx-YY')).toBe('1,234');
    expect(formatNumber(1234, '')).toBe('1,234');
  });
});

describe('formatSize', () => {
  it('KB 的小数点跟随区域', () => {
    expect(formatSize(1536, 'en')).toBe('1.5 KB');
    expect(formatSize(1536, 'de')).toBe('1,5 KB');
  });

  it('小于 1KB 用整数 + B', () => {
    expect(formatSize(512, 'en')).toBe('512 B');
  });

  it('MB 边界与精度', () => {
    expect(formatSize(1024 * 1024, 'en')).toBe('1.0 MB');
    expect(formatSize(1024 * 1024 * 2.25, 'en')).toBe('2.3 MB');
  });

  it('非法输入返回占位符而不是 NaN', () => {
    expect(formatSize(-1, 'en')).toBe('—');
    expect(formatSize(Number.NaN, 'en')).toBe('—');
  });
});

describe('formatStars', () => {
  it('英文用 K', () => {
    expect(formatStars(12000, 'en')).toBe('12K');
  });

  it('中文用万', () => {
    expect(formatStars(12000, 'zh')).toContain('万');
  });

  it('非法输入返回占位符', () => {
    expect(formatStars(Number.POSITIVE_INFINITY, 'en')).toBe('—');
  });
});
