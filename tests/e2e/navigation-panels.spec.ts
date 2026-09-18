/**
 * E2E：N2 导航能力 + N3 架构视图
 *
 * 覆盖：
 *   · 命令面板 Ctrl+K：模糊搜索 → 打开文件（验收 N2「命令面板」）
 *   · 符号搜索 Ctrl+T：直接跳到符号定义（验收 N2「符号搜索」）
 *   · 阅读路线面板：自动排序 + 入口标注（验收 N2「阅读路线」）
 *   · 大纲面板：当前文件的符号树（验收 N2「大纲视图」）
 *   · 架构视图：模块依赖图渲染 / 循环依赖 / 分层 / 类图（验收 N3 四项）
 *
 * 全部基于本地 ZIP 夹具，不依赖网络。
 */

import { expect, test } from '@playwright/test';
import {
  buildClassFixtureZip,
  buildFixtureZip,
  clickToolbar,
  loadFixtureZip,
  openFileInTree,
  saveScreenshot,
} from './helpers';

let zipPath: string;
let classZipPath: string;

test.beforeAll(async () => {
  zipPath = await buildFixtureZip();
  classZipPath = await buildClassFixtureZip();
});

test('命令面板：Ctrl+K 模糊搜索并打开文件', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  await page.keyboard.press('Control+k');
  const palette = page.locator('[data-command-palette]');
  await expect(palette).toBeVisible();

  const input = palette.locator('input');
  await input.fill('core');

  // 文件条目出现（面板按 命令/文件/符号 分组）
  const fileItem = palette.locator('[data-palette-item="file"]').first();
  await expect(fileItem).toBeVisible();
  await expect(fileItem).toContainText('core.ts');

  // 回车执行 → 打开对应文件
  await input.press('Enter');
  await expect(page.locator('footer')).toContainText('core.ts', { timeout: 20_000 });
  await expect(palette).toBeHidden();

  await saveScreenshot(page, 'command-palette');
});

test('命令面板：Esc 关闭 / 命令条目可执行', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  await page.keyboard.press('Control+k');
  const palette = page.locator('[data-command-palette]');
  await expect(palette).toBeVisible();
  await palette.locator('input').press('Escape');
  await expect(palette).toBeHidden();

  // 再开一次，搜索并执行「代码度量」命令 → 度量面板打开
  await page.keyboard.press('Control+k');
  await page.locator('[data-command-palette] input').fill('metrics');
  await page.locator('[data-command-palette] [data-palette-item="command"]').first().click();
  await expect(page.getByText(/健康评分|Health score|健全性スコア/).first()).toBeVisible({
    timeout: 30_000,
  });
});

test('符号搜索：Ctrl+T 直接跳到符号定义', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  await page.keyboard.press('Control+t');
  const palette = page.locator('[data-command-palette]');
  await expect(palette).toBeVisible();

  await palette.locator('input').fill('compute');
  const symbolItem = palette.locator('[data-palette-item="symbol"]').first();
  await expect(symbolItem).toBeVisible({ timeout: 30_000 });

  await symbolItem.click();
  // compute 定义在 src/core.ts
  await expect(page.locator('footer')).toContainText('core.ts', { timeout: 20_000 });
});

test('阅读路线：自动排序 + 入口标注 + 点击跳转', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  await clickToolbar(page, ['阅读路线', 'Reading path', '読書ルート']);

  const panel = page.locator('section[aria-label]').filter({ hasText: /阅读路线|Reading path|読書ルート/ }).first();
  await expect(panel).toBeVisible({ timeout: 30_000 });

  // 入口文件（main.ts 无人依赖、依赖 core）应排在第 1 位
  const firstStep = panel.locator('[data-reading-step="1"]');
  await expect(firstStep).toBeVisible({ timeout: 30_000 });
  await expect(firstStep).toContainText('src/main.ts');
  await expect(firstStep).toContainText(/入口|Entry/);

  // 点击第 1 项 → 打开 main.ts
  await firstStep.click();
  await expect(page.locator('footer')).toContainText('main.ts', { timeout: 20_000 });

  await saveScreenshot(page, 'reading-path');
});

test('大纲：当前文件的符号树（类 → 方法嵌套）', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  await page.locator('aside').first().getByText('src', { exact: true }).click();
  await openFileInTree(page, 'util.ts');
  await expect(page.locator('.code-scroll code')).toContainText('add');

  await clickToolbar(page, ['大纲', 'Outline', 'アウトライン']);
  const panel = page.locator('section[aria-label]').filter({ hasText: /大纲|Outline|アウトライン/ }).first();
  await expect(panel).toBeVisible({ timeout: 30_000 });

  await expect(panel.locator('[data-outline-node="add"]')).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('[data-outline-node="sub"]')).toBeVisible();

  // 点击符号 → 跳到对应行
  await panel.locator('[data-outline-node="sub"]').click();
  await expect(page.locator('footer')).toContainText('util.ts');
});

test('架构视图：模块依赖图 + 分层 + 循环依赖', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  await clickToolbar(page, ['架构视图', 'Architecture', 'アーキテクチャ']);
  const panel = page.locator('section[aria-label]').filter({ hasText: /架构视图|Architecture|アーキテクチャ/ }).first();
  await expect(panel).toBeVisible({ timeout: 30_000 });

  // ---- 模块页签：Mermaid 依赖图渲染出 SVG ----
  const svg = panel.locator('[data-graph-host] svg');
  await expect(svg).toBeVisible({ timeout: 40_000 });
  await expect(panel.locator('[data-graph-host]')).toContainText('src');

  await saveScreenshot(page, 'architecture-modules');

  // ---- 循环依赖页签：夹具无环 → 明确提示 ✓ ----
  await panel.locator('[data-arch-tab="cycles"]').click();
  await expect(panel).toContainText(/未发现循环依赖|No circular dependencies|循環依存は見つかりません/);

  // ---- 分层页签：src 目录应归类为源代码 ----
  await panel.locator('[data-arch-tab="layers"]').click();
  const sourceRow = panel.locator('[data-layer="source"]');
  await expect(sourceRow).toBeVisible();
  await expect(sourceRow).toContainText('src');

  await saveScreenshot(page, 'architecture-layers');
});

test('架构视图：类图（继承/实现）+ 外部基类提示', async ({ page }) => {
  await loadFixtureZip(page, classZipPath);

  await clickToolbar(page, ['架构视图', 'Architecture', 'アーキテクチャ']);
  const panel = page.locator('section[aria-label]').filter({ hasText: /架构视图|Architecture|アーキテクチャ/ }).first();
  await expect(panel).toBeVisible({ timeout: 30_000 });

  await panel.locator('[data-arch-tab="classes"]').click();

  // 类图渲染：User 继承 Base、实现 IGreeter
  const svg = panel.locator('[data-graph-host] svg');
  await expect(svg).toBeVisible({ timeout: 40_000 });
  await expect(panel.locator('[data-graph-host]')).toContainText('User');
  await expect(panel.locator('[data-graph-host]')).toContainText('Base');

  await saveScreenshot(page, 'architecture-classes');
});
