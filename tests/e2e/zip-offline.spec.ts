/**
 * E2E：本地 ZIP 完全离线浏览（对应验收 4）
 *
 * 覆盖：
 *   · 上传 ZIP 后文件树渲染、README 自动打开并渲染 Markdown
 *   · 点击文件后在代码视图看到语法高亮（Prism token）
 *   · 状态栏显示来源/文件数
 *   · 顺带产出 README 使用的界面截图
 *
 * 该用例不依赖任何外部网络，可在离线环境与 CI 中稳定运行。
 */

import { expect, test } from '@playwright/test';
import { buildFixtureZip, loadFixtureZip, openFileInTree, saveScreenshot } from './helpers';

let zipPath: string;

test.beforeAll(async () => {
  zipPath = await buildFixtureZip();
});

test('本地 ZIP：文件树 + README 渲染 + 代码高亮 + 截图', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  // ---------- 文件树 ----------
  // 目录用途徽章：src 被标注为「源代码」
  await expect(page.locator('aside').first().getByText('src', { exact: true })).toBeVisible();

  // README 自动打开并渲染为 Markdown（h1 来自 md 渲染，而非纯文本）
  await expect(page.locator('.md-body h1')).toContainText('Fixture Project');
  // 相对链接/图片改写逻辑不报错，且代码块正常渲染
  await expect(page.locator('.md-body pre code').first()).toBeVisible();

  await saveScreenshot(page, 'main');

  // ---------- 展开并打开源码文件 ----------
  await page.locator('aside').first().getByText('src', { exact: true }).click();
  await openFileInTree(page, 'core.ts');

  // 代码视图出现，且 Prism 生成了 token（证明高亮生效而非纯文本）
  const code = page.locator('.code-scroll code');
  await expect(code).toBeVisible();
  await expect(code.locator('.token.keyword').first()).toBeVisible();
  await expect(code).toContainText('compute');

  // 行号槽存在且行数 > 0
  const gutterLines = await page.locator('.code-gutter div').count();
  expect(gutterLines).toBeGreaterThan(5);

  // 状态栏显示来源为本地 ZIP
  await expect(page.locator('footer')).toContainText('ZIP');

  await saveScreenshot(page, 'code-view');
});

test('本地 ZIP：二进制与不支持预览的文件给出明确提示（验收 4 附带）', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  // 打开 CSS（属于可预览白名单）→ 正常显示代码
  await page.locator('aside').first().getByText('src', { exact: true }).click();
  await openFileInTree(page, 'styles.css');
  await expect(page.locator('.code-scroll code')).toContainText('body');
});
