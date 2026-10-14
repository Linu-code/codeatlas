import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LocalDirSource } from '../../src/sources/local';
import { RepoError } from '../../src/types/repo';

vi.mock('../../src/utils/tauri', () => ({
  invokeSafe: vi.fn(),
}));

import { invokeSafe } from '../../src/utils/tauri';

const mockedInvoke = invokeSafe as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedInvoke.mockReset();
});

/** N5① 本地目录数据源：契约与安全边界 */
describe('LocalDirSource', () => {
  it('非 Tauri 环境（invoke 返回 null）抛 not-found-dir', async () => {
    mockedInvoke.mockResolvedValue(null);
    try {
      await LocalDirSource.open('C:/proj');
      expect.unreachable('should throw');
    } catch (e) {
      expect((e as RepoError).code).toBe('not-found-dir');
    }
  });

  it('空目录抛 empty-zip（与 ZIP 源一致的"无有效文件"语义）', async () => {
    mockedInvoke.mockResolvedValue([]);
    try {
      await LocalDirSource.open('C:/empty');
      expect.unreachable('should throw');
    } catch (e) {
      expect((e as RepoError).code).toBe('empty-zip');
    }
  });

  it('正常打开：meta 携带 rootPath（去尾斜杠）+ 文件树可构建', async () => {
    mockedInvoke.mockResolvedValue([
      { path: 'src/a.ts', is_dir: false, size: 10 },
      { path: 'src', is_dir: true, size: 0 },
      { path: 'README.md', is_dir: false, size: 5 },
    ]);
    const src = await LocalDirSource.open('C:/proj/');
    expect(src.meta.source).toBe('local');
    expect(src.meta.name).toBe('proj');
    // 缓存命名空间依赖：必须去尾斜杠，保证同一目录只有一种表示
    expect(src.meta.rootPath).toBe('C:/proj');
    const tree = await src.listFiles();
    const flat: string[] = [];
    const walk = (nodes: { path: string; children?: unknown[] }[]) => {
      for (const n of nodes) {
        flat.push(n.path);
        if (n.children) walk(n.children as never);
      }
    };
    walk(tree as never);
    expect(flat).toContain('src/a.ts');
    expect(flat).toContain('README.md');
    src.dispose();
  });

  it('路径穿越防御：readFile 拒绝 .. / 盘符', async () => {
    mockedInvoke.mockResolvedValue([{ path: 'a.ts', is_dir: false, size: 1 }]);
    const src = await LocalDirSource.open('C:/proj');
    for (const evil of ['../evil.sh', '/abs/x.ts', 'C:/win/evil.dll']) {
      try {
        // 先注入条目以绕过"条目不存在"分支，直达 absPath 校验
        (src as unknown as { entries: Map<string, unknown> }).entries.set(evil, {
          path: evil,
          is_dir: false,
          size: 1,
        });
        await src.readFile(evil);
        expect.unreachable(`should reject ${evil}`);
      } catch (e) {
        expect((e as RepoError).code).toBe('zip-insecure');
      }
    }
    src.dispose();
  });
});
