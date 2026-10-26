/**
 * E2E：N5① 浏览器降级（设计约束「浏览器无文件系统权限」）
 *
 * 生产构建以 `vite preview` 运行，属于纯浏览器上下文（isTauri() === false）。
 * 此时 TopBar 收到的 onOpenLocalDir 为 null，主菜单里不应出现「打开本地目录」，
 * 避免用户点击后触发 Tauri 专属的 select_dir / read_dir 而崩溃。
 *
 * 覆盖：
 *   · 默认语言下该菜单项不渲染（count === 0）
 *   · 切换中/英/日后仍不渲染（三语言强对齐）
 *   · 「打开本地 ZIP」始终可用
 */

import { expect, test } from '@playwright/test';
import { openMenu, setLanguage } from './helpers';

const LOCAL_DIR_LABELS = ['打开本地目录', 'Open local folder', 'ローカルフォルダを開く'];
const ZIP_LABELS = ['打开本地 ZIP', 'Open local ZIP', 'ローカル ZIP を開く'];

/** 打开「打开」菜单，断言本地目录项不存在，然后关闭菜单 */
async function expectLocalDirItemAbsent(page: import('@playwright/test').Page): Promise<void> {
  await openMenu(page, 'open');
  for (const label of LOCAL_DIR_LABELS) {
    await expect(page.getByRole('menuitem', { name: label })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
}

test('浏览器降级：默认语言下本地目录项隐藏、ZIP 项可用', async ({ page }) => {
  await page.goto('/');
  // 顶栏渲染（「打开」菜单触发器出现即代表 TopBar 挂载成功）
  await expect(page.getByTestId('menu-open')).toBeVisible();

  await expectLocalDirItemAbsent(page);

  await openMenu(page, 'open');
  let zipVisible = false;
  for (const label of ZIP_LABELS) {
    if ((await page.getByRole('menuitem', { name: label }).count()) > 0) {
      zipVisible = true;
      break;
    }
  }
  await page.keyboard.press('Escape');
  expect(zipVisible).toBe(true);
});

test('浏览器降级：切换中/英/日后本地目录项始终隐藏', async ({ page }) => {
  await page.goto('/');
  for (const lang of ['zh', 'en', 'ja'] as const) {
    await setLanguage(page, lang);
    await expectLocalDirItemAbsent(page);
  }
});
