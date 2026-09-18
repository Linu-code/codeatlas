/**
 * cycles —— Tarjan 强连通分量（循环依赖检测）
 * 覆盖：无环、自环、互环、长环、多环、共享节点、目录级汇总、规范化旋转。
 */
import { describe, expect, it } from 'vitest';
import { canonicalizeCycle, findCycles } from '../../src/analysis/cycles';

const edge = (from: string, to: string) => ({ from, to });

describe('canonicalizeCycle', () => {
  it('旋转到字典序最小的元素开头', () => {
    expect(canonicalizeCycle(['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
    expect(canonicalizeCycle(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('findCycles', () => {
  it('无环图不报循环', () => {
    const report = findCycles(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c')]);
    expect(report.cycles).toHaveLength(0);
    expect(report.involvedFiles).toBe(0);
  });

  it('二元互环', () => {
    const report = findCycles(['a', 'b'], [edge('a', 'b'), edge('b', 'a')]);
    expect(report.cycles).toEqual([['a', 'b']]);
    expect([...report.involved].sort()).toEqual(['a', 'b']);
    expect(report.involvedFiles).toBe(2);
  });

  it('三元环（含规范化旋转）', () => {
    const report = findCycles(['c', 'a', 'b'], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);
    expect(report.cycles).toEqual([['a', 'b', 'c']]);
  });

  it('自环单独算一个循环', () => {
    const report = findCycles(['a'], [edge('a', 'a')]);
    expect(report.cycles).toEqual([['a']]);
  });

  it('多个独立环按长度与首元素排序', () => {
    const report = findCycles(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      [edge('a', 'b'), edge('b', 'a'), edge('c', 'd'), edge('d', 'e'), edge('e', 'c'), edge('f', 'a')],
    );
    expect(report.cycles).toEqual([
      ['a', 'b'],
      ['c', 'd', 'e'],
    ]);
    expect(report.involvedFiles).toBe(5);
  });

  it('环上的分支节点不误报为环成员', () => {
    // d 挂在 a 上，但没人指回 d → 不属于任何环
    const report = findCycles(
      ['a', 'b', 'd'],
      [edge('a', 'b'), edge('b', 'a'), edge('a', 'd')],
    );
    expect(report.cycles).toEqual([['a', 'b']]);
    expect(report.involved.has('d')).toBe(false);
  });

  it('忽略指向图外的边', () => {
    const report = findCycles(['a'], [edge('a', 'ghost'), edge('ghost', 'a')]);
    expect(report.cycles).toHaveLength(0);
  });

  it('目录级汇总：跨目录的环会折叠成目录环', () => {
    const report = findCycles(
      ['src/a.ts', 'lib/b.ts'],
      [edge('src/a.ts', 'lib/b.ts'), edge('lib/b.ts', 'src/a.ts')],
    );
    expect(report.dirCycles).toEqual([['lib', 'src']]);
  });

  it('同一目录内部的环不产生目录级环', () => {
    const report = findCycles(
      ['src/a.ts', 'src/b.ts'],
      [edge('src/a.ts', 'src/b.ts'), edge('src/b.ts', 'src/a.ts')],
    );
    expect(report.cycles).toHaveLength(1);
    expect(report.dirCycles).toHaveLength(0);
  });

  it('结果与输入顺序无关（可复现）', () => {
    const nodes = ['x', 'y', 'z', 'w'];
    const edges = [edge('x', 'y'), edge('y', 'z'), edge('z', 'x'), edge('w', 'y')];
    const a = findCycles(nodes, edges);
    const b = findCycles([...nodes].reverse(), [...edges].reverse());
    expect(a.cycles).toEqual(b.cycles);
  });

  it('长链不爆栈（迭代实现）', () => {
    const n = 5000;
    const nodes = Array.from({ length: n }, (_, i) => `f${i}`);
    const edges = Array.from({ length: n - 1 }, (_, i) => edge(`f${i}`, `f${i + 1}`));
    const report = findCycles(nodes, edges);
    expect(report.cycles).toHaveLength(0);
  });
});
