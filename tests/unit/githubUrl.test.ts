import { describe, expect, it } from 'vitest';
import { parseGitHubUrl, resolveTopBarInput } from '../../src/utils/githubUrl';

describe('parseGitHubUrl', () => {
  it('解析标准 https URL', () => {
    expect(parseGitHubUrl('https://github.com/facebook/react')).toEqual({
      owner: 'facebook',
      repo: 'react',
      branch: null,
      subDir: null,
    });
  });

  it('解析 .git 后缀 / tree 分支 / 子目录', () => {
    expect(parseGitHubUrl('https://github.com/facebook/react.git').repo).toBe('react');
    expect(parseGitHubUrl('https://github.com/facebook/react/tree/v18.3.1').branch).toBe('v18.3.1');
    const r = parseGitHubUrl('https://github.com/facebook/react/tree/main/packages/react');
    expect(r.branch).toBe('main');
    expect(r.subDir).toBe('packages/react');
  });

  it('容忍 http、www、首尾空白、query/hash、尾部斜杠', () => {
    expect(parseGitHubUrl('  http://www.github.com/vuejs/core  ').repo).toBe('core');
    expect(parseGitHubUrl('https://github.com/a/b/tree/main?s=1#readme').branch).toBe('main');
    expect(parseGitHubUrl('https://github.com/a/b/').repo).toBe('b');
  });

  it('解析 SSH 形态', () => {
    expect(parseGitHubUrl('git@github.com:vuejs/core.git')).toEqual({
      owner: 'vuejs',
      repo: 'core',
      branch: null,
      subDir: null,
    });
  });

  it('blob 单文件视图等非法形态抛 TypeError', () => {
    expect(() => parseGitHubUrl('https://github.com/a/b/blob/main/index.js')).toThrow(TypeError);
    expect(() => parseGitHubUrl('https://gitlab.com/a/b')).toThrow(TypeError);
  });
});

describe('resolveTopBarInput（顶栏命令中心判定）', () => {
  it('空输入返回 null → 回车无响应', () => {
    expect(resolveTopBarInput('')).toBeNull();
    expect(resolveTopBarInput('   ')).toBeNull();
  });

  it('完整网址 → 直接加载', () => {
    const r = resolveTopBarInput('https://github.com/facebook/react');
    expect(r?.kind).toBe('url');
  });

  it('owner/repo 短写 → 直接加载', () => {
    expect(resolveTopBarInput('facebook/react')).toEqual({
      kind: 'owner-repo',
      owner: 'facebook',
      repo: 'react',
    });
  });

  it('普通单词 → 搜索', () => {
    expect(resolveTopBarInput('react')).toEqual({ kind: 'search', query: 'react' });
  });
});
