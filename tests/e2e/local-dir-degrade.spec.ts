/**
 * E2E：N5① 浏览器降级（对应验收 8 延伸 + 设计约束「浏览器无文件系统权限」）
 *
 * 生产构建以 `vite preview` 运行，属于纯浏览器上下文（isTauri() === false）。
 * 此时 TopBar 收到的 onOpenLocalDir 为 null，必须隐藏「打开本地目录」按钮，
 * 避免用户点击后触发 Tauri 专属的 select_dir / read_dir 而崩溃。
 *
 * 覆盖：
 *   · 默认语言下「打开本地目录」按钮不渲染（count === 0）
 *   · 切换中/英/日后该按钮仍不渲染（三语言强对齐）
 *   · 「打开本地 ZIP」按钮始终可见（与本地目录按钮互斥无关，永远可用）
 */

import { expect, test } from '@playwright/test';

const LOCAL_DIR_LABELS = ['打开本地目录', 'Open local folder', 'ローカルフォルダを開く'];
const ZIP_LABELS = ['打开本地 ZIP', 'Open local ZIP', 'ローカル ZIP を開く'];

/** 断言「打开本地目录」按钮在三种语言下均不渲染 */
async function expectLocalDirButtonAbsent(page: import('@playwright/test').Page): Promise<void> {
  for (const label of LOCAL_DIR_LABELS) {
    await expect(page.getByRole('button', { name: label })).toHaveCount(0);
  }
}

test('浏览器降级：默认语言下本地目录按钮隐藏、ZIP 按钮可见', async ({ page }) => {
  await page.goto('/');
  // 顶栏渲染（品牌文字出现即代表 TopBar 挂载成功；exact 避免命中主题选项「CodeAtlas 专属」与页脚版本号）
  await expect(page.getByText('CodeAtlas', { exact: true })).toBeVisible();

  await expectLocalDirButtonAbsent(page);

  // ZIP 按钮始终可见：默认语言未知，逐一尝试任一口语种命中即可
  let zipVisible = false;
  for (const label of ZIP_LABELS) {
    if ((await page.getByRole('button', { name: label }).count()) > 0) {
      zipVisible = true;
      break;
    }
  }
  expect(zipVisible).toBe(true);
});

test('浏览器降级：切换中/英/日后本地目录按钮始终隐藏', async ({ page }) => {
  await page.goto('/');
  const langSelect = page.locator('header select').nth(1);

  for (const lang of ['zh', 'en', 'ja']) {
    await langSelect.selectOption(lang);
    await expectLocalDirButtonAbsent(page);
  }
});
