/**
 * E2E：i18n 与主题（对应验收 6、7、10、11）
 *
 * 覆盖：
 *   · 切换中/英/日，UI 文本实时变化（验收 6）
 *   · 语言选择持久化，刷新后保持（验收 7）
 *   · 主题切换：Atlas Blue 与普通深色的 data-theme 取值不同（验收 10）
 *   · 跟随系统：模拟深色/浅色偏好，data-theme 自动解析（验收 11）
 *
 * 说明：主题与语言不再是顶栏下拉，统一从「设置 → 外观」切换（data-* 属性定位）。
 */

import { expect, test } from '@playwright/test';
import {
  buildFixtureZip,
  loadFixtureZip,
  openMainMenu,
  openMenu,
  setLanguage,
  setTheme,
} from './helpers';

// 本文件默认在"系统深色"下运行，让 atlas 主题解析出确定的 atlas-dark；
// 需要验证浅色分支的用例会自行用 colorScheme: 'light' 开独立上下文。
test.use({ colorScheme: 'dark' });

let zipPath: string;

test.beforeAll(async () => {
  zipPath = await buildFixtureZip();
});

test('语言切换：中文 → English → 日本語，文案实时变化且刷新后保持', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  // 默认中文：主菜单里的分析项为中文
  await openMainMenu(page);
  await expect(page.getByRole('menuitem', { name: '代码度量' })).toBeVisible();
  await page.keyboard.press('Escape');

  // 切英文
  await setLanguage(page, 'en');
  await openMainMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Code metrics' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('open-settings')).toHaveAttribute('aria-label', 'Settings');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // 切日文
  await setLanguage(page, 'ja');
  await openMainMenu(page);
  await expect(page.getByRole('menuitem', { name: 'コードメトリクス' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

  // 刷新后保持日文（语言偏好已持久化）
  await page.reload();
  await openMainMenu(page);
  await expect(page.getByRole('menuitem', { name: 'コードメトリクス' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('10 种语言全部可选：<html lang> 与菜单文案同步', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  // 抽样断言「代码度量」这一条在各语言下的文案，确保语言包真的被加载
  const samples: { lang: string; label: string }[] = [
    { lang: 'zh-TW', label: '程式碼度量' },
    { lang: 'ko', label: '코드 메트릭' },
    { lang: 'es', label: 'Métricas de código' },
    { lang: 'fr', label: 'Métriques de code' },
    { lang: 'de', label: 'Code-Metriken' },
    { lang: 'pt', label: 'Métricas de código' },
    { lang: 'ru', label: 'Метрики кода' },
  ];

  for (const sample of samples) {
    await setLanguage(page, sample.lang);
    await expect(page.locator('html')).toHaveAttribute('lang', sample.lang);
    await openMenu(page, 'analysis');
    await expect(page.getByRole('menuitem', { name: sample.label })).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('主题：Atlas Blue 与普通深色有明显不同的 data-theme', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  const html = page.locator('html');

  // 普通深色
  await setTheme(page, 'dark');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const darkBg = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('--c-bg').trim(),
  );

  // Atlas Blue 专属主题（深色偏好下解析为 atlas-dark）
  await setTheme(page, 'atlas');
  await expect(html).toHaveAttribute('data-theme', 'atlas-dark');
  const atlasBg = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('--c-bg').trim(),
  );

  // 两套主题背景色必须不同（验收 10：明显区别）
  expect(atlasBg).not.toBe(darkBg);
  expect(atlasBg).toBe('#1b1d23'); // 提示词指定的暖灰黑
  expect(darkBg).toBe('#1e1e1e'); // 普通深色用中性灰

  // 浅色主题校验
  await setTheme(page, 'light');
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('跟随系统：模拟深色偏好时实时解析为对应深色主题', async ({ browser }) => {
  // 独立上下文，显式声明系统偏好为深色
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');

  await setTheme(page, 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // 切到 atlas：仍跟随系统，但落到 Atlas 深色变体
  await setTheme(page, 'atlas');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'atlas-dark');

  await context.close();
});

test('跟随系统：模拟浅色偏好时解析为浅色主题', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto('/');

  await setTheme(page, 'atlas');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'atlas-light');

  await context.close();
});
