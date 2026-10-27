import { describe, expect, it } from 'vitest';
import { resolveFocus, tokenizeQuery } from '../../src/analysis/focus';

const symbols = [
  { name: 'login', file: 'src/auth/login.ts', line: 10, signature: 'export function login(user: string)' },
  { name: 'loginWithToken', file: 'src/auth/login.ts', line: 40, signature: 'export function loginWithToken(t: string)' },
  { name: 'logout', file: 'src/auth/logout.ts', line: 5, signature: 'export function logout()' },
  { name: 'renderTree', file: 'src/ui/tree.ts', line: 12, signature: 'export function renderTree(n: Node)' },
];

const filePaths = ['src/auth/login.ts', 'src/auth/logout.ts', 'src/ui/tree.ts', 'src/app.ts'];

describe('tokenizeQuery', () => {
  it('按驼峰 / 下划线 / 标点切词', () => {
    expect(tokenizeQuery('focusTrap')).toEqual(['focus', 'trap']);
    expect(tokenizeQuery('active-file')).toEqual(['active', 'file']);
    expect(tokenizeQuery('renderer core')).toEqual(['renderer', 'core']);
  });

  it('连续大写按词边界切开（HTTPServer → http, server）', () => {
    expect(tokenizeQuery('HTTPServer')).toEqual(['http', 'server']);
  });

  it('丢弃停用词、单字符与重复词', () => {
    expect(tokenizeQuery('add the component component')).toEqual(['component']);
    expect(tokenizeQuery('a b c')).toEqual([]);
  });

  it('领域名词不当停用词（否则查询会被清空）', () => {
    expect(tokenizeQuery('file module component')).toEqual(['file', 'module', 'component']);
  });

  it('保留中文词（用于匹配目录用途）', () => {
    expect(tokenizeQuery('路由 组件')).toEqual(['路由', '组件']);
  });
});

describe('resolveFocus', () => {
  it('精确符号名得分高于仅包含', () => {
    const r = resolveFocus({ query: 'login', symbols, filePaths });
    const login = r.hits.find((h) => h.file === 'src/auth/login.ts');
    expect(login).toBeDefined();
    expect(login!.seed).toBe(true);
    // login 与 loginWithToken 都在同一文件，分数叠加后仍应是首位
    expect(r.hits[0].file).toBe('src/auth/login.ts');
    expect(r.symbolKeys[0]).toContain('login');
  });

  it('按依赖边扩散，邻居分数低于种子', () => {
    const edges = [
      { from: 'src/ui/tree.ts', to: 'src/auth/login.ts' },
      { from: 'src/auth/login.ts', to: 'src/auth/logout.ts' },
    ];
    const r = resolveFocus({ query: 'renderTree', symbols, filePaths, fileEdges: edges });
    const seed = r.hits.find((h) => h.file === 'src/ui/tree.ts');
    const neighbor = r.hits.find((h) => h.file === 'src/auth/login.ts');
    expect(seed).toBeDefined();
    expect(neighbor).toBeDefined();
    expect(neighbor!.seed).toBe(false);
    expect(neighbor!.score).toBeLessThan(seed!.score);
    expect(neighbor!.reasons[0]).toContain('扩散');
  });

  it('只保留两端都在结果内的依赖边', () => {
    const edges = [
      { from: 'src/auth/login.ts', to: 'src/app.ts' },
      { from: 'src/app.ts', to: 'src/ui/tree.ts' },
    ];
    const r = resolveFocus({ query: 'login', symbols, filePaths, fileEdges: edges, maxFiles: 1 });
    expect(r.hits).toHaveLength(1);
    expect(r.edges).toEqual([]);
  });

  it('无命中时返回空结果，不拿全量凑数', () => {
    const r = resolveFocus({ query: 'kafka producer', symbols, filePaths });
    expect(r.hits).toEqual([]);
    expect(r.symbolKeys).toEqual([]);
  });

  it('中文查询可落到目录用途上', () => {
    const r = resolveFocus({
      query: '认证 流程',
      symbols,
      filePaths,
      dirLabels: [{ dir: 'src/auth', label: '认证' }],
    });
    expect(r.hits.map((h) => h.file).sort()).toEqual(['src/auth/login.ts', 'src/auth/logout.ts']);
    expect(r.hits[0].reasons.join('')).toContain('目录用途');
  });

  it('实现文件永远排在测试文件之前（即使测试词面命中更高）', () => {
    const withTests = [
      ...symbols,
      { name: 'routerHandler', file: 'test/router.test.ts', line: 1, signature: 'function routerHandler()' },
    ];
    const r = resolveFocus({ query: 'router', symbols: withTests, filePaths });
    expect(r.hits[0].file).toBe('test/router.test.ts');
    // 只有测试文件命中时才由它顶上
    const mixed = resolveFocus({
      query: 'login',
      symbols: withTests,
      filePaths: [...filePaths, 'test/login.test.ts'],
      fileEdges: [{ from: 'test/login.test.ts', to: 'src/auth/login.ts' }],
    });
    expect(mixed.hits[0].file).toBe('src/auth/login.ts');
    expect(mixed.hits.findIndex((h) => h.file.startsWith('test/'))).toBeGreaterThan(0);
  });

  it('只在测试文件命中时打标记，供包内如实提示', () => {
    const withTest = [
      ...symbols,
      { name: 'routerHandler', file: 'test/router.test.ts', line: 1, signature: 'function routerHandler()' },
    ];
    expect(resolveFocus({ query: 'router', symbols: withTest, filePaths }).onlyTestHits).toBe(true);
    expect(resolveFocus({ query: 'login', symbols: withTest, filePaths }).onlyTestHits).toBe(false);
  });

  it('maxFiles 限制结果规模，按分数截断', () => {
    const r = resolveFocus({ query: 'src', symbols, filePaths, maxFiles: 2 });
    expect(r.hits.length).toBeLessThanOrEqual(2);
    const scores = r.hits.map((h) => h.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('空查询直接返回空，不抛错', () => {
    expect(resolveFocus({ query: '', symbols, filePaths }).hits).toEqual([]);
    expect(resolveFocus({ query: '   ', symbols, filePaths }).hits).toEqual([]);
  });
});
