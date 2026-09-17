/**
 * E2E：i18n 与主题（对应验收 6、7、10、11）
 *
 * 覆盖：
 *   · 切换中/英/日，UI 文本实时变化（验收 6）
 *   · 语言选择写入 localStorage，刷新后保持（验收 7）
 *   · 主题切换：Atlas Blue 与普通深色的 data-theme 取值不同（验收 10）
 *   · 跟随系统：模拟深色偏好，data-theme 自动解析为 atlas-dark（验收 11）
 */

import { expect, test } from '@playwright/test';
import { buildFixtureZip, loadFixtureZip } from './helpers';

// 本文件默认在"系统深色"下运行，让 atlas 主题解析出确定的 atlas-dark；
// 需要验证浅色分支的用例会自行用 colorScheme: 'light' 开独立上下文。
test.use({ colorScheme: 'dark' });

let zipPath: string;

test.beforeAll(async () => {
  zipPath = await buildFixtureZip();
});

test('语言切换：中文 → English → 日本語，文案实时变化且刷新后保持', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  // 顶栏第二个 select 是语言切换器（第一个是主题）
  const langSelect = page.locator('header select').nth(1);
  const themeSelect = page.locator('header select').first();

  // 默认中文：工具条出现中文按钮
  await expect(page.getByRole('button', { name: '代码度量' })).toBeVisible();

  // 切英文
  await langSelect.selectOption('en');
  await expect(page.getByRole('button', { name: 'Code metrics' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  // html lang 同步
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // 切日文
  await langSelect.selectOption('ja');
  await expect(page.getByRole('button', { name: 'コードメトリクス' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

  // 刷新后保持日文（写入 localStorage 的语言偏好）
  await page.reload();
  await expect(page.getByRole('button', { name: 'コードメトリクス' })).toBeVisible();

  // 主题选择器仍可用（说明配置读取正常）
  await expect(themeSelect).toBeVisible();
});

test('主题：Atlas Blue 与普通深色有明显不同的 data-theme', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  const themeSelect = page.locator('header select').first();
  const html = page.locator('html');

  // 普通深色
  await themeSelect.selectOption('dark');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const darkBg = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('--c-bg').trim(),
  );

  // Atlas Blue 专属主题（深色偏好下解析为 atlas-dark）
  await themeSelect.selectOption('atlas');
  await expect(html).toHaveAttribute('data-theme', 'atlas-dark');
  const atlasBg = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('--c-bg').trim(),
  );

  // 两套主题背景色必须不同（验收 10：明显区别）
  expect(atlasBg).not.toBe(darkBg);
  expect(atlasBg).toBe('#1b1d23'); // 提示词指定的暖灰黑
  expect(darkBg).toBe('#1e1e1e'); // 普通深色用中性灰

  // 浅色主题校验
  await themeSelect.selectOption('light');
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('跟随系统：模拟深色偏好时实时解析为对应深色主题', async ({ browser }) => {
  // 独立上下文，显式声明系统偏好为深色
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');

  const themeSelect = page.locator('header select').first();
  await themeSelect.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // 切到 atlas：仍跟随系统，但落到 Atlas 深色变体
  await themeSelect.selectOption('atlas');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'atlas-dark');

  await context.close();
});

test('跟随系统：模拟浅色偏好时解析为浅色主题', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto('/');

  const themeSelect = page.locator('header select').first();
  await themeSelect.selectOption('atlas');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'atlas-light');

  await context.close();
});
