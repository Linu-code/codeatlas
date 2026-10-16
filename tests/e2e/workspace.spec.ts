/**
 * E2E：多项目工作区（N5③）
 *
 * 用两个不同的 ZIP 夹具模拟"同时打开两个项目"：
 *   · 单项目时项目标签条不出现（视觉与旧版一致）
 *   · 打开第二个项目 → 顶部出现项目标签条（2 个标签），并自动激活新项目
 *   · 点击标签切换，内容随激活项目变化
 *   · 关闭标签 → 回到单项目，标签条消失
 */

import { expect, test } from '@playwright/test';
import { buildClassFixtureZip, buildFixtureZip, saveScreenshot } from './helpers';

const CLOSE_LABEL = /关闭项目|Close project|プロジェクトを閉じる/;

test('多项目工作区：打开两个项目 → 标签切换 → 关闭', async ({ page }) => {
  const zipA = await buildFixtureZip();
  const zipB = await buildClassFixtureZip();

  await page.goto('/');

  // 第一个项目：就地加载（不出现标签条）
  await page.setInputFiles('input[type=file]', zipA);
  await expect(page.getByText('README.md').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /Fixture Project/ })).toBeVisible();
  await expect(page.locator('[data-project-tabs]')).toHaveCount(0);

  // 第二个项目：追加为标签并激活
  await page.setInputFiles('input[type=file]', zipB);
  const tabs = page.locator('[data-project-tabs]');
  await expect(tabs).toBeVisible({ timeout: 20_000 });
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(tabs.getByRole('tab').first()).toContainText('fixture-project.zip');
  await expect(tabs.getByRole('tab').nth(1)).toContainText('fixture-classes.zip');
  // 激活的是新项目（类图夹具的 README 标题）
  await expect(page.getByRole('heading', { name: /Class fixture/ })).toBeVisible();

  await saveScreenshot(page, 'workspace-tabs');

  // 切回第一个项目
  await tabs.getByRole('tab').first().click();
  await expect(page.getByRole('heading', { name: /Fixture Project/ })).toBeVisible();

  // 关闭第二个项目 → 回到单项目，标签条消失
  const secondTab = tabs.getByRole('tab').nth(1);
  await secondTab.hover();
  await secondTab.getByRole('button', { name: CLOSE_LABEL }).click();
  await expect(page.locator('[data-project-tabs]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Fixture Project/ })).toBeVisible();
});
