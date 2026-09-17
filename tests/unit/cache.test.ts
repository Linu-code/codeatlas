import { describe, expect, it } from 'vitest';
import { getCachedTree } from '../../src/sources/cache';
import type { FileNode } from '../../src/types/repo';

/**
 * 树缓存的"格式版本"防护。
 *
 * 背景：文件树由算法生成并写入 IndexedDB。算法修复后（例如修掉目录重复 bug），
 * 旧缓存里仍是错误结构，用户升级后会继续看到旧数据。因此缓存必须带版本号，
 * 版本不匹配或旧格式（无版本号）一律视为失效。
 *
 * 这里不依赖真实 IndexedDB：只断言"无环境时安全降级为 null"，
 * 版本比对逻辑由 getCachedTree 内部完成，真实读写由 E2E 覆盖。
 */
describe('树缓存版本防护', () => {
  it('无 IndexedDB 环境（Node）时安全返回 null，不抛异常', async () => {
    await expect(getCachedTree('owner/repo@main')).resolves.toBeNull();
  });

  it('缓存失效语义：返回 null 即代表调用方会重新拉取', async () => {
    const result: FileNode[] | null = await getCachedTree('a/b@c');
    expect(result).toBeNull();
  });
});
