/**
 * E2E：工作区持久化
 *
 * 覆盖：打开一个 GitHub 项目 → 刷新页面（不做任何输入）→ 自动恢复该项目。
 * 用本地 mock 驱动在线代码路径，无真实网络依赖。
 */

import { expect, test } from '@playwright/test';
import { MOCK_GITHUB, mockGitHub } from './helpers';

const SAVED_KEY = 'codeatlas.workspace.v1';

test('刷新页面后自动恢复上次的 GitHub 项目', async ({ page }) => {
  await mockGitHub(page, MOCK_GITHUB);
  await page.goto('/');

  const input = page.locator('header').getByRole('combobox').first();
  await input.fill('https://github.com/acme/demo');
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: /Demo Project/ })).toBeVisible({ timeout: 20_000 });

  // 防抖 400ms 后写入
  await page.waitForFunction((key) => !!localStorage.getItem(key), SAVED_KEY, { timeout: 5_000 });

  // 刷新：不输入任何东西，应自动恢复
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Demo Project/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('aside').first().getByText('README.md').first()).toBeVisible({
    timeout: 20_000,
  });

  // 只有一个项目时，项目标签条不显示
  await expect(page.locator('[data-project-tabs]')).toHaveCount(0);
});
