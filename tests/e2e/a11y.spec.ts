/**
 * E2E：可访问性（N6）
 *
 * 覆盖三块：
 *   1. 键盘导航 —— 对话框焦点陷阱 / Esc 关闭 / 焦点归还；命令面板 ↑↓；文件树 ↑↓ roving 焦点
 *   2. ARIA     —— dialog/aria-modal、combobox/aria-activedescendant、tree/treeitem/aria-level
 *   3. 对比度   —— 四套主题下次要文本（--c-text-2）对次级背景（--c-bg-2）≥ WCAG AA 4.5:1
 */

import { expect, test } from '@playwright/test';
import { buildFixtureZip, loadFixtureZip } from './helpers';

/** sRGB 相对亮度（WCAG 2.x） */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** 两色对比度 */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

test('设置对话框：焦点陷阱 + Esc 关闭 + 焦点归还', async ({ page }) => {
  await page.goto('/');
  const opener = page.getByTestId('open-settings');
  await opener.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');

  // 打开后焦点落在对话框内
  const focusInside = () =>
    page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  expect(await focusInside()).toBe(true);

  // 连按 Tab 多次，焦点仍被限制在对话框内（未逃逸到背景）
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('Tab');
  expect(await focusInside()).toBe(true);

  // Shift+Tab 反向亦不逃逸
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Shift+Tab');
  expect(await focusInside()).toBe(true);

  // Esc 关闭并归还焦点
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('命令面板：aria-activedescendant 随 ↑↓ 变化', async ({ page }) => {
  const zip = await buildFixtureZip();
  await loadFixtureZip(page, zip);

  await page.keyboard.press('Control+k');
  const palette = page.locator('[data-command-palette]');
  await expect(palette).toBeVisible();
  await expect(palette).toHaveAttribute('aria-modal', 'true');

  const combo = page.locator('input[aria-controls="palette-listbox"]');
  await expect(combo).toHaveAttribute('aria-activedescendant', /palette-opt-\d+/);
  const before = await combo.getAttribute('aria-activedescendant');

  await page.keyboard.press('ArrowDown');
  await expect(combo).not.toHaveAttribute('aria-activedescendant', before ?? '');
  // 高亮项 data-palette-index 与 activedescendant 一致
  const activeIndex = await combo.getAttribute('aria-activedescendant');
  await expect(
    page.locator(`[data-palette-index="${activeIndex?.replace('palette-opt-', '')}"]`),
  ).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('文件树：tree 语义 + ↑↓ roving 焦点导航', async ({ page }) => {
  const zip = await buildFixtureZip();
  await loadFixtureZip(page, zip);

  const tree = page.locator('[role="tree"]');
  await expect(tree).toBeVisible();

  const firstItem = tree.locator('[role="treeitem"]').first();
  await expect(firstItem).toHaveAttribute('aria-level', '1');

  await firstItem.focus();
  const p1 = await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset?.path);
  expect(p1).toBeTruthy();

  await page.keyboard.press('ArrowDown');
  const p2 = await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset?.path);
  expect(p2).toBeTruthy();
  expect(p2).not.toBe(p1);

  // 只有当前项 tabIndex=0（roving）
  const zeroCount = await tree.locator('[role="treeitem"][tabindex="0"]').count();
  expect(zeroCount).toBe(1);
});

test('四套主题：次要文本对比度 ≥ WCAG AA 4.5:1', async ({ page }) => {
  await page.goto('/');
  const themes = ['light', 'atlas-light', 'dark', 'atlas-dark'];
  for (const theme of themes) {
    const colors = await page.evaluate((th) => {
      document.documentElement.dataset.theme = th;
      const cs = getComputedStyle(document.documentElement);
      return {
        fg: cs.getPropertyValue('--c-text-2').trim(),
        bg: cs.getPropertyValue('--c-bg-2').trim(),
      };
    }, theme);
    const ratio = contrast(colors.fg, colors.bg);
    expect(ratio, `${theme}: ${colors.fg} on ${colors.bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  }
});
