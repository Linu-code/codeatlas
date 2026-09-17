import { describe, expect, it } from 'vitest';
import {
  annotateDirectories,
  detectPurposeByContent,
  matchPurposeRule,
  PURPOSE_RULES,
} from '../../src/analysis/directories';
import { buildTree } from '../../src/sources/tree';
import { FileNode } from '../../src/types/repo';

const files = (paths: string[]): FileNode[] =>
  paths.map((p) => ({ path: p, type: 'file' as const, size: 1 }));

describe('matchPurposeRule（规则表）', () => {
  it('常见目录命中预期用途', () => {
    expect(matchPurposeRule('src')).toBe('source');
    expect(matchPurposeRule('tests')).toBe('tests');
    expect(matchPurposeRule('__tests__')).toBe('tests');
    expect(matchPurposeRule('docs')).toBe('docs');
    expect(matchPurposeRule('.github')).toBe('ci');
    expect(matchPurposeRule('packages')).toBe('monorepo');
    expect(matchPurposeRule('locales')).toBe('localization');
    expect(matchPurposeRule('node_modules')).toBe('vendor');
  });

  it('大小写不敏感', () => {
    expect(matchPurposeRule('SRC')).toBe('source');
    expect(matchPurposeRule('Docs')).toBe('docs');
  });

  it('未知目录返回 null', () => {
    expect(matchPurposeRule('weird-random-folder')).toBeNull();
  });

  it('规则表内部无重复名称（防止优先级歧义）', () => {
    const seen = new Set<string>();
    for (const rule of PURPOSE_RULES) {
      for (const name of rule.names) {
        expect(seen.has(name), `duplicate rule name: ${name}`).toBe(false);
        seen.add(name);
      }
    }
  });
});

describe('detectPurposeByContent（内容启发式）', () => {
  it('测试命名文件占比高 → tests', () => {
    const paths = ['a/x.test.ts', 'a/y.test.ts', 'a/z.spec.js', 'a/util.ts'];
    expect(detectPurposeByContent('a', paths)).toBe('tests');
  });

  it('markdown 占比过半 → docs', () => {
    const paths = ['b/a.md', 'b/b.md', 'b/c.md', 'b/d.png'];
    expect(detectPurposeByContent('b', paths)).toBe('docs');
  });

  it('样式文件占比过半 → styles', () => {
    const paths = ['c/a.css', 'c/b.scss', 'c/c.less', 'c/d.ts'];
    expect(detectPurposeByContent('c', paths)).toBe('styles');
  });

  it('数据文件占比过半 → config', () => {
    const paths = ['d/a.json', 'd/b.yaml', 'd/c.yml', 'd/d.json'];
    expect(detectPurposeByContent('d', paths)).toBe('config');
  });

  it('无法判断时返回 null', () => {
    expect(detectPurposeByContent('e', ['e/a.ts', 'e/b.ts'])).toBeNull();
    expect(detectPurposeByContent('nonexistent', ['e/a.ts'])).toBeNull();
  });
});

describe('annotateDirectories（前两层范围）', () => {
  it('标注根层与第二层目录，规则优先于启发式', () => {
    const tree = buildTree(
      files([
        'src/index.ts',
        'src/widgets/a.tsx',
        'tests/a.test.ts',
        'docs/guide.md',
        'src/deep/inner/file.ts',
      ]),
    );
    const purposes = annotateDirectories(tree);

    expect(purposes.get('src')?.key).toBe('source');
    expect(purposes.get('src')?.confidence).toBe('rule');
    expect(purposes.get('tests')?.key).toBe('tests');
    expect(purposes.get('docs')?.key).toBe('docs');
    // 第二层也覆盖
    expect(purposes.has('src/widgets')).toBe(true);
  });

  it('第三层及更深不再标注（避免噪音）', () => {
    const tree = buildTree(files(['src/deep/inner/file.ts']));
    const purposes = annotateDirectories(tree);
    expect(purposes.has('src')).toBe(true);
    expect(purposes.has('src/deep')).toBe(false);
  });
});
