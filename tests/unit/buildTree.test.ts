import { describe, expect, it } from 'vitest';
import { buildTree, flattenDirs, flattenFiles } from '../../src/sources/tree';
import { FileNode } from '../../src/types/repo';

/**
 * buildTree 是双数据源共用的树构建算法。
 *
 * 重点覆盖 **GitHub `/git/trees?recursive=1` 的真实输入形态**：
 * 它同时返回「目录条目（type: tree）」与「文件条目（type: blob）」，
 * 渲染时必须保证每个目录只出现一次（曾出现过顶级目录重复两遍的 bug）。
 */

const file = (path: string, size = 1): FileNode => ({ path, type: 'file', size });
const dir = (path: string): FileNode => ({ path, type: 'dir' });

/** 统计某个路径在同一层级出现的次数（用于重复检测） */
function countChildren(nodes: FileNode[], path: string): number {
  return nodes.filter((n) => n.path === path).length;
}

/** 递归断言整棵树里没有重复的兄弟节点 */
function assertNoDuplicateSiblings(nodes: FileNode[], context = 'root'): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    expect(seen.has(node.path), `duplicate sibling "${node.path}" under ${context}`).toBe(false);
    seen.add(node.path);
  }
  for (const node of nodes) {
    if (node.children) assertNoDuplicateSiblings(node.children, node.path);
  }
}

describe('buildTree —— 基础行为', () => {
  it('平铺文件路径 → 嵌套树，自动补齐目录节点，目录优先排序', () => {
    const tree = buildTree([file('README.md'), file('src/index.ts'), file('src/utils/debounce.ts')]);
    expect(tree.map((n) => n.path)).toEqual(['src', 'README.md']);
    const src = tree[0];
    expect(src.type).toBe('dir');
    expect(src.children!.map((n) => n.path)).toEqual(['src/utils', 'src/index.ts']);
  });

  it('空输入返回空数组', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('深层嵌套正确构建', () => {
    const tree = buildTree([file('a/b/c/d.txt')]);
    let node = tree[0];
    for (let i = 0; i < 3; i++) {
      expect(node.type).toBe('dir');
      node = node.children![0];
    }
    expect(node.path).toBe('a/b/c/d.txt');
    expect(node.type).toBe('file');
  });
});

describe('buildTree —— 回归：显式目录条目不得造成重复（GitHub API 形态）', () => {
  /**
   * 最小复现场景：
   *   目录条目 types + 文件条目 types/errtypes/errtypes.go
   * 旧实现下 root 会出现两个 types，types 下会出现两个 errtypes。
   */
  it('单段目录条目 + 其下深层文件 → 目录只出现一次', () => {
    const tree = buildTree([
      dir('types'),
      file('types/errtypes/errtypes.go'),
      file('types/errtypes/other.go'),
    ]);

    assertNoDuplicateSiblings(tree);
    expect(countChildren(tree, 'types')).toBe(1);

    const types = tree.find((n) => n.path === 'types')!;
    expect(countChildren(types.children!, 'types/errtypes')).toBe(1);

    // 目录节点不能是叶子占位（children 必须含实际文件）
    const errtypes = types.children!.find((n) => n.path === 'types/errtypes')!;
    expect(errtypes.children!.map((n) => n.path)).toEqual([
      'types/errtypes/errtypes.go',
      'types/errtypes/other.go',
    ]);
  });

  it('多级目录条目与文件混排（模拟 ollama/ollama 结构）→ 无任何重复目录', () => {
    // 该结构按真实仓库简化：顶级目录 types/model/syncmap/version/x 都曾重复两遍
    const apiEntries: FileNode[] = [
      // GitHub 会为每个目录单独返回一条 tree 条目
      dir('x'),
      dir('types'),
      dir('types/errtypes'),
      dir('types/model'),
      dir('syncmap'),
      dir('version'),
      dir('docs'),
      dir('docs/zh'),
      // 文件条目（blob）
      file('README.md', 100),
      file('LICENSE', 20),
      file('x/term.go'),
      file('x/term_windows.go'),
      file('types/errtypes/errtypes.go'),
      file('types/model/model.go'),
      file('types/model/options.go'),
      file('syncmap/syncmap.go'),
      file('version/version.go'),
      file('docs/zh/README.md'),
    ];

    const tree = buildTree(apiEntries);

    // ① 全树无重复兄弟节点
    assertNoDuplicateSiblings(tree);

    // ② 目录路径集合无重复（这是用户看到的现象）
    const dirs = flattenDirs(tree);
    expect(new Set(dirs).size).toBe(dirs.length);

    // ③ 顶级目录各出现一次
    for (const top of ['x', 'types', 'syncmap', 'version', 'docs']) {
      expect(countChildren(tree, top), `top-level "${top}" duplicated`).toBe(1);
    }

    // ④ 二级目录也无重复
    const types = tree.find((n) => n.path === 'types')!;
    for (const sub of ['types/errtypes', 'types/model']) {
      expect(countChildren(types.children!, sub), `"${sub}" duplicated`).toBe(1);
    }

    // ⑤ 文件不丢：与输入文件条目数量一致（去重后共 10 个）
    const files = flattenFiles(tree);
    expect(files).toHaveLength(10);
    expect(files).toContain('types/errtypes/errtypes.go');
    expect(new Set(files).size).toBe(files.length);
  });

  it('目录条目出现在其子文件之后（乱序输入）也能正确合并', () => {
    const tree = buildTree([
      file('a/b/c.go'),
      dir('a/b'), // 显式目录条目排在子文件之后
      dir('a'),
    ]);
    assertNoDuplicateSiblings(tree);
    expect(countChildren(tree, 'a')).toBe(1);
    const a = tree[0];
    expect(countChildren(a.children!, 'a/b')).toBe(1);
    expect(flattenDirs(tree)).toEqual(['a', 'a/b']);
  });

  it('重复的目录条目只登记一次', () => {
    const tree = buildTree([dir('src'), dir('src'), dir('src/'), file('src/a.ts')]);
    assertNoDuplicateSiblings(tree);
    expect(countChildren(tree, 'src')).toBe(1);
  });

  it('重复的文件条目只挂载一次', () => {
    const tree = buildTree([file('a.ts'), file('a.ts'), file('b.ts')]);
    assertNoDuplicateSiblings(tree);
    expect(flattenFiles(tree)).toEqual(['a.ts', 'b.ts']);
  });
});

describe('buildTree —— 路径归一化', () => {
  it('尾斜杠与 ./ 前缀被归一，不产生重复节点', () => {
    const tree = buildTree([dir('src/'), dir('./src'), file('./src/index.ts'), file('src/util.ts')]);
    assertNoDuplicateSiblings(tree);
    expect(tree.map((n) => n.path)).toEqual(['src']);
    expect(flattenFiles(tree)).toEqual(['src/index.ts', 'src/util.ts']);
  });

  it('Windows 反斜杠路径归一为 POSIX', () => {
    const tree = buildTree([file('src\\win\\a.ts')]);
    expect(flattenFiles(tree)).toEqual(['src/win/a.ts']);
    expect(flattenDirs(tree)).toEqual(['src', 'src/win']);
  });

  it('空路径被忽略', () => {
    const tree = buildTree([file(''), dir(''), file('ok.ts')]);
    expect(flattenFiles(tree)).toEqual(['ok.ts']);
    expect(flattenDirs(tree)).toEqual([]);
  });

  it('只有目录条目的仓库也能建树（不崩、不重复）', () => {
    const tree = buildTree([dir('empty'), dir('empty/inner')]);
    expect(flattenDirs(tree)).toEqual(['empty', 'empty/inner']);
    expect(flattenFiles(tree)).toEqual([]);
  });
});

describe('flattenDirs（测试辅助）', () => {
  it('深度优先收集目录路径', () => {
    const tree = buildTree([file('a/b/c.ts'), file('a/d.ts')]);
    expect(flattenDirs(tree)).toEqual(['a', 'a/b']);
  });
});
