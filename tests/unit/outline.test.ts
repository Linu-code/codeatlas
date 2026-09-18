/**
 * outline —— 符号大纲树（N2）
 * 用行区间包含关系把扁平符号表还原成嵌套结构。
 */
import { describe, expect, it } from 'vitest';
import { buildOutline, outlineCount } from '../../src/analysis/outline';
import type { SymbolDef, SymbolKind } from '../../src/analysis/langs/types';

/** 构造符号定义：显式给出起始行与结束行，便于表达"区间包含" */
function def(name: string, kind: SymbolKind, endLine: number, startLine: number): SymbolDef {
  return {
    name,
    kind,
    line: startLine,
    endLine,
    signature: `${name}()`,
    exported: true,
  };
}

describe('buildOutline', () => {
  it('方法归属到其所属的类（区间包含）', () => {
    const defs = [
      def('User', 'class', 10, 1),
      def('greet', 'method', 5, 3),
      def('save', 'method', 9, 7),
      def('helper', 'function', 14, 12),
    ];
    const outline = buildOutline(defs);
    expect(outline.map((n) => n.name)).toEqual(['User', 'helper']);
    expect(outline[0].children.map((n) => n.name)).toEqual(['greet', 'save']);
    expect(outline[1].children).toEqual([]);
  });

  it('嵌套函数归到外层函数', () => {
    const defs = [
      def('outer', 'function', 10, 1),
      def('inner', 'function', 5, 3),
    ];
    const outline = buildOutline(defs);
    expect(outline).toHaveLength(1);
    expect(outline[0].children[0].name).toBe('inner');
  });

  it('同级符号不互相嵌套', () => {
    const defs = [def('a', 'function', 3, 1), def('b', 'function', 6, 4)];
    const outline = buildOutline(defs);
    expect(outline.map((n) => n.name)).toEqual(['a', 'b']);
    expect(outline[0].children).toEqual([]);
  });

  it('乱序输入也能正确嵌套（内部先排序）', () => {
    const defs = [
      def('save', 'method', 9, 7),
      def('User', 'class', 10, 1),
      def('greet', 'method', 5, 3),
    ];
    const outline = buildOutline(defs);
    expect(outline.map((n) => n.name)).toEqual(['User']);
    expect(outline[0].children.map((n) => n.name)).toEqual(['greet', 'save']);
  });

  it('outlineCount 统计含嵌套的全部节点', () => {
    const defs = [def('C', 'class', 10, 1), def('m', 'method', 5, 2), def('f', 'function', 14, 12)];
    expect(outlineCount(buildOutline(defs))).toBe(3);
  });

  it('空输入返回空数组', () => {
    expect(buildOutline([])).toEqual([]);
  });
});
