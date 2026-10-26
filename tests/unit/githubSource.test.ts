/**
 * GitHubSource 边界行为：
 *   · 子模块（type: 'commit'）不是文件，不能出现在文件树里
 *   · tree 被 GitHub 截断时必须显式报错，而不是静默给出半个仓库
 *   · subDir 过滤按路径段匹配
 *   · jsDelivr 兜底清单的路径带前导斜杠，需归一化后才能与 subDir 对齐
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubSource } from '../../src/sources/github';
import { flattenFiles } from '../../src/sources/tree';
import { RepoError } from '../../src/types/repo';

type Route = (url: string) => unknown;

function stubFetch(route: Route): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      const result = route(url);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function makeSource(over: Partial<ConstructorParameters<typeof GitHubSource>[0]> = {}) {
  return new GitHubSource({
    owner: 'acme',
    repo: 'widgets',
    branch: 'main',
    cacheEnabled: false,
    ...over,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('GitHubSource 文件树', () => {
  it('过滤子模块（type: commit）', async () => {
    stubFetch(() => ({
      truncated: false,
      tree: [
        { path: 'src', type: 'tree' },
        { path: 'src/index.ts', type: 'blob', size: 10 },
        { path: 'vendor/lib', type: 'commit' }, // git submodule
      ],
    }));

    const files = await makeSource().listFiles();
    expect(flattenFiles(files)).toEqual(['src/index.ts']);
  });

  it('tree 被截断时抛出 truncated 错误', async () => {
    stubFetch(() => ({
      truncated: true,
      tree: [{ path: 'src/index.ts', type: 'blob', size: 10 }],
    }));

    await expect(makeSource().listFiles()).rejects.toMatchObject({ code: 'truncated' });
  });

  it('subDir 按路径段过滤，不会误吃同名前缀目录', async () => {
    stubFetch(() => ({
      truncated: false,
      tree: [
        { path: 'src/index.ts', type: 'blob', size: 1 },
        { path: 'src/deep/a.ts', type: 'blob', size: 1 },
        { path: 'srcfoo/b.ts', type: 'blob', size: 1 },
      ],
    }));

    const files = await makeSource({ subDir: 'src' }).listFiles();
    expect(flattenFiles(files).sort()).toEqual(['deep/a.ts', 'index.ts']);
  });
});

describe('GitHubSource → jsDelivr 兜底', () => {
  it('清单里的 / 前缀被剥离，subDir 仍可用', async () => {
    stubFetch((url) => {
      if (url.includes('api.github.com')) return new Response('boom', { status: 500 });
      return {
        files: [
          { name: '/README.md', type: 'file', size: 1 },
          { name: '/src/index.ts', type: 'file', size: 1 },
          { name: '/src/utils/a.ts', type: 'file', size: 1 },
        ],
      };
    });

    const root = await makeSource({ jsdelivrFallback: true }).listFiles();
    expect(flattenFiles(root).sort()).toEqual(['README.md', 'src/index.ts', 'src/utils/a.ts']);
    expect(root.some((n) => n.path === '')).toBe(false);

    const sub = await makeSource({ jsdelivrFallback: true, subDir: 'src' }).listFiles();
    expect(flattenFiles(sub).sort()).toEqual(['index.ts', 'utils/a.ts']);
  });

  it('未开启兜底时 API 失败原样抛出', async () => {
    stubFetch(() => new Response('boom', { status: 500 }));
    await expect(makeSource().listFiles()).rejects.toBeInstanceOf(RepoError);
  });
});
