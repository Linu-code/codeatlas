/**
 * readingPath —— 建议阅读路线（N2）
 * 覆盖：角色判定、排序规则、目录分组、全量编号（截断只影响展示）、确定性。
 */
import { describe, expect, it } from 'vitest';
import { buildReadingPath, classifyRole } from '../../src/analysis/readingPath';
import type { FileAnalysis } from '../../src/analysis/symbols';

function mkFile(path: string, imports: string[] = []): FileAnalysis {
  return { path, language: 'typescript', definitions: [], calls: [], references: [], imports, hasError: false };
}

/**
 * 依赖形状：
 *   entry.ts → a.ts, b.ts
 *   a.ts, b.ts → core.ts
 *   core.ts → util.ts
 */
const FILES = [
  mkFile('entry.ts', ['./a', './b']),
  mkFile('a.ts', ['./core']),
  mkFile('b.ts', ['./core']),
  mkFile('core.ts', ['./util']),
  mkFile('util.ts'),
];

describe('classifyRole', () => {
  it('入口 / 枢纽 / 中间层 / 末端', () => {
    expect(classifyRole(0, 3)).toBe('entry'); // 没人依赖它，它依赖别人
    expect(classifyRole(3, 1)).toBe('core'); // 被多方依赖
    expect(classifyRole(1, 0)).toBe('leaf'); // 只被依赖，自己不依赖别人
    expect(classifyRole(1, 1)).toBe('support');
    expect(classifyRole(0, 0)).toBe('support'); // 孤立文件
  });

  it('被多方依赖优先判定为枢纽（重要性高于"不依赖别人"）', () => {
    expect(classifyRole(2, 0)).toBe('core');
  });
});

describe('buildReadingPath', () => {
  it('顺序为 入口 → 枢纽 → 中间层 → 末端', () => {
    const path = buildReadingPath(FILES, null);
    // 角色顺序是硬断言；同角色内部的次序只保证确定性（由路径名兜底）
    expect(path.steps.map((s) => s.role)).toEqual(['entry', 'core', 'support', 'support', 'leaf']);
    expect(path.steps[0].path).toBe('entry.ts');
    expect(path.steps[1].path).toBe('core.ts');
    expect(path.steps[4].path).toBe('util.ts');
    // 同角色内部按路径名排序，可复现
    expect(path.steps.slice(2, 4).map((s) => s.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('入度 / 出度按"不同邻居"计', () => {
    const path = buildReadingPath(FILES, null);
    const core = path.steps.find((s) => s.path === 'core.ts')!;
    expect(core.inDegree).toBe(2);
    expect(core.outDegree).toBe(1);
    const entry = path.steps.find((s) => s.path === 'entry.ts')!;
    expect(entry.inDegree).toBe(0);
    expect(entry.outDegree).toBe(2);
  });

  it('序号从 1 连续编号，并被 orderByPath 索引（供文件树角标）', () => {
    const path = buildReadingPath(FILES, null);
    expect(path.steps.map((s) => s.order)).toEqual([1, 2, 3, 4, 5]);
    expect(path.orderByPath.get('util.ts')).toBe(5);
  });

  it('截断只影响展示：全部文件仍有编号', () => {
    const path = buildReadingPath(FILES, null, { maxSteps: 2 });
    expect(path.steps).toHaveLength(2);
    expect(path.omitted).toBe(3);
    expect(path.totalFiles).toBe(5);
    expect(path.orderByPath.get('util.ts')).toBe(5);
    expect(path.orderByPath.size).toBe(5);
  });

  it('目录分组按路线中首次出现排序', () => {
    const files = [
      mkFile('src/entry.ts', ['./a']),
      mkFile('src/a.ts', ['../lib/b']),
      mkFile('lib/b.ts'),
      mkFile('docs/readme.md'),
    ];
    const path = buildReadingPath(files, null);
    expect(path.groups.map((g) => g.dir)).toContain('src');
    expect(path.groups.map((g) => g.dir).sort()).toEqual(['docs', 'lib', 'src']);
    // 入口所在目录排第一
    expect(path.groups[0].dir).toBe('src');
    expect(path.groups[0].firstOrder).toBe(1);
  });

  it('空输入返回空路线', () => {
    const path = buildReadingPath([], null);
    expect(path.steps).toEqual([]);
    expect(path.totalFiles).toBe(0);
    expect(path.orderByPath.size).toBe(0);
  });

  it('结果确定（同输入必得同输出）', () => {
    const a = buildReadingPath(FILES, null).steps.map((s) => s.path);
    const b = buildReadingPath([...FILES].reverse(), null).steps.map((s) => s.path);
    expect(a).toEqual(b);
  });
});
