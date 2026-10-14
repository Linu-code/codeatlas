/**
 * E2E：N5② 导出 HTML 报告入口（对应命令面板命令）
 *
 * 覆盖：仓库已加载时，`Ctrl/Cmd+K` 打开命令面板、搜索 "report" 后
 * 「导出 HTML 报告」命令可见（证明 buildReport + exportReport 已接入 UI）。
 * 不实际触发下载，避免污染测试产物目录与 mermaid 渲染时序抖动。
 */

import { expect, test } from '@playwright/test';
import { buildFixtureZip, loadFixtureZip } from './helpers';

let zipPath: string;

test.beforeAll(async () => {
  zipPath = await buildFixtureZip();
});

test('命令面板含「导出 HTML 报告」入口', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  // 打开命令面板（仅命令区），搜索 report
  await page.keyboard.press('Control+k');
  const input = page.locator('[data-command-palette] input');
  await expect(input).toBeVisible();
  await input.fill('report');

  // 命令存在（中文默认语言下标签为「导出 HTML 报告」）
  await expect(page.getByText('导出 HTML 报告')).toBeVisible();
});
