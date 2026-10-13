/**
 * E2E：N4 分析结果持久化 + 增量分析
 *
 * 覆盖：
 *   · 首次分析（冷缓存）：状态栏不显示增量提示
 *   · 同项目二次分析（命中 IndexedDB 缓存）：状态栏出现「缓存命中 N 个文件 · 重解析 0 个」
 *   · 状态栏的命中数字等于夹具中可分析文件数（证明全部走缓存，未重新 AST 解析）
 *
 * 基于本地 ZIP 夹具，无网络依赖。注意：浏览器上下文共享同一 IndexedDB，
 * 因此用「同页面内重新打开同一 ZIP」模拟二次打开 —— 与真实用户「关闭后重开」等价
 * （重开会复用同一浏览器 profile 的 IndexedDB）。
 */

import { expect, test } from '@playwright/test';
import { buildFixtureZip, clickToolbar, loadFixtureZip } from './helpers';

let zipPath: string;

test.beforeAll(async () => {
  zipPath = await buildFixtureZip();
});

/** 触发一次完整分析：打开度量面板（内部会调用 analyze） */
async function triggerAnalysis(page: import('@playwright/test').Page) {
  await clickToolbar(page, ['代码度量', 'Metrics', 'メトリクス']);
  // 健康评分出现即代表分析完成（度量面板依赖完整分析结果）
  await expect(page.getByText(/健康评分|Health score|健全性スコア/).first()).toBeVisible({
    timeout: 30_000,
  });
}

test('N4 增量分析：二次打开命中缓存，状态栏显示命中数', async ({ page }) => {
  // ---------- 第一次：冷缓存全量解析 ----------
  await loadFixtureZip(page, zipPath);
  await triggerAnalysis(page);

  // 冷缓存：三种语言的增量提示都不应出现
  const footer = page.locator('footer');
  await expect(footer).not.toContainText(/缓存命中|from cache|キャッシュヒット/, { timeout: 5_000 });

  // ---------- 重新加载同一 ZIP（同 profile，IndexedDB 已写入） ----------
  await loadFixtureZip(page, zipPath);
  await triggerAnalysis(page);

  // 状态栏出现增量统计：全部文件命中缓存（夹具可分析文件 5 个：core/util/main/tool.py + tests/core.test.ts）
  // 注意：tests/core.test.ts 是 .ts → 也在可分析范围内，共 5 个
  await expect(footer).toContainText(/缓存命中|from cache/, { timeout: 10_000 });

  // 命中数 = 全部可分析文件数（5 个 TS/TSX/PY），重解析 0（三语言正则兼容）
  await expect(footer).toContainText(
    /缓存命中 5 个文件 · 重解析 0 个|5 files from cache · 0 re-parsed|キャッシュヒット 5 ファイル · 再解析 0 ファイル/,
  );

  // 结果依然正确：符号索引可用（跳转面板未退化）
  await page.keyboard.press('Control+t');
  const palette = page.locator('[data-command-palette]');
  await expect(palette).toBeVisible();
  await palette.locator('input').fill('compute');
  await expect(palette.locator('[data-palette-item="symbol"]').first()).toBeVisible({
    timeout: 10_000,
  });
});
