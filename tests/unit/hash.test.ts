/**
 * 内容哈希（N4 增量分析指纹）—— 确定性断言
 *
 * FNV-1a 必须跨环境稳定：浏览器与 Node 计算同一文本得到同一指纹。
 * 这里固定几个已知样本的期望值（手工核对过），防止实现被意外改动。
 */

import { describe, expect, it } from 'vitest';
import { fnv1a, hashText } from '../../src/utils/hash';

describe('fnv1a 内容哈希', () => {
  it('确定性强：同一输入恒等输出', () => {
    const a = hashText('export function foo() {}');
    const b = hashText('export function foo() {}');
    expect(a).toBe(b);
  });

  it('输出为 8 位十六进制', () => {
    expect(hashText('x')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashText('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('空串有固定指纹（FNV-1a offset basis 终值）', () => {
    // FNV-1a 32 位空串：0x811c9dc5 经过 0 轮后即为 811c9dc5
    expect(fnv1a('')).toBe('811c9dc5');
  });

  it('内容变化 → 指纹变化（增量判断的基础）', () => {
    expect(hashText('const a = 1;')).not.toBe(hashText('const a = 2;'));
  });

  it('不同长度文本指纹不同', () => {
    const seen = new Set(['a', 'ab', 'abc', 'abcd'].map((s) => hashText(s)));
    expect(seen.size).toBe(4);
  });

  it('中英文混合内容指纹稳定', () => {
    const zh = 'export const 标题 = "文件"';
    expect(hashText(zh)).toMatch(/^[0-9a-f]{8}$/);
    expect(hashText(zh)).toBe(hashText(zh));
  });
});
