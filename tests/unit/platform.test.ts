/**
 * 单测：平台展示层适配
 *
 * 只测纯函数；isMac() 依赖真实 navigator，不在此断言（由 E2E 的运行平台决定）。
 */

import { describe, expect, it } from 'vitest';
import { isModPressed, platformizeShortcut } from '../../src/utils/platform';

describe('platformizeShortcut', () => {
  it('macOS：Ctrl 与德语 Strg 都替换为 ⌘', () => {
    expect(platformizeShortcut('Ctrl+K 打开', true)).toBe('⌘+K 打开');
    expect(platformizeShortcut('Strg+K öffnen', true)).toBe('⌘+K öffnen');
    expect(platformizeShortcut('Ctrl+クリック', true)).toBe('⌘+クリック');
  });

  it('非 macOS：原样返回', () => {
    expect(platformizeShortcut('Ctrl+K 打开', false)).toBe('Ctrl+K 打开');
    expect(platformizeShortcut('Strg+K öffnen', false)).toBe('Strg+K öffnen');
  });

  it('不误伤以 Ctrl 开头的普通单词', () => {
    expect(platformizeShortcut('Control panel', true)).toBe('Control panel');
  });
});

describe('isModPressed', () => {
  const ev = (ctrlKey: boolean, metaKey: boolean) => ({ ctrlKey, metaKey });

  it('macOS 只认 ⌘（metaKey）', () => {
    expect(isModPressed(ev(false, true), true)).toBe(true);
    expect(isModPressed(ev(true, false), true)).toBe(false);
  });

  it('Windows / Linux 只认 Ctrl', () => {
    expect(isModPressed(ev(true, false), false)).toBe(true);
    expect(isModPressed(ev(false, true), false)).toBe(false);
  });

  it('两个都按也只算一次按下', () => {
    expect(isModPressed(ev(true, true), true)).toBe(true);
    expect(isModPressed(ev(true, true), false)).toBe(true);
  });
});
