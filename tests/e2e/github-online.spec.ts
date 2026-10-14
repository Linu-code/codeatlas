/**
 * E2E：在线场景（本地 mock GitHub，无需真实网络）
 *
 * 背景：本机 E2E 环境无法访问 GitHub，导致「在线流程」验收项此前只能 test.skip。
 * 现在用 page.route 拦截 api.github.com / raw.githubusercontent.com 并返回仿真数据，
 * 使**在线代码路径**（顶栏解析 → 分支探测 → 拉树 → 找 README → 读文件 → 搜索）被真实执行。
 *
 * 覆盖：
 *   · 验收 2 —— 输入 GitHub 网址能加载文件树与 README
 *   · 验收 3 —— 输入关键词能显示搜索结果列表
 *   · 顶栏搜索框具备 combobox 语义（顺带验证可访问性）
 */

import { expect, test } from '@playwright/test';
import { MOCK_GITHUB, mockGitHub } from './helpers';

test('加载 GitHub 仓库：文件树 + README 自动打开（验收 2）', async ({ page }) => {
  await mockGitHub(page, MOCK_GITHUB);
  await page.goto('/');

  const input = page.locator('header').getByRole('combobox').first();
  await input.fill('https://github.com/acme/demo');
  await input.press('Enter');

  // 文件树出现
  const tree = page.locator('aside').first();
  await expect(tree).toBeVisible({ timeout: 20_000 });
  await expect(tree.getByText('README.md').first()).toBeVisible({ timeout: 20_000 });

  // README 自动作为标签页打开并渲染为 markdown（h1）
  await expect(page.getByRole('heading', { name: /Demo Project/ })).toBeVisible({ timeout: 20_000 });

  // 展开目录并打开源码文件
  await tree.getByText('src', { exact: true }).click();
  await tree.getByText('index.ts', { exact: true }).click();
  await expect(page.locator('.code-scroll').getByText('greet').first()).toBeVisible({ timeout: 20_000 });
});

test('搜索仓库：下拉展示结果列表（验收 3）', async ({ page }) => {
  await mockGitHub(page, MOCK_GITHUB);
  await page.goto('/');

  const input = page.locator('header').getByRole('combobox').first();
  await input.fill('demo');
  await input.press('Enter');

  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible({ timeout: 20_000 });
  await expect(listbox.getByRole('option')).toHaveCount(MOCK_GITHUB.search?.length ?? 0);
  await expect(listbox.getByText('acme/demo', { exact: true }).first()).toBeVisible();

  // 键盘可用：↓ 改变高亮，aria-activedescendant 指向当前项
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', /topbar-opt-\d+/);
});
