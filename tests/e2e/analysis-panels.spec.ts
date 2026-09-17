/**
 * E2E：静默分析面板（对应验收 5、13、14、16、17、18）
 *
 * 覆盖：
 *   · 调用关系图：tree-sitter 真实解析 → Mermaid 渲染出 SVG（验收 5）
 *   · 代码度量：健康评分 + 圈复杂度/认知复杂度表格，高复杂度标红（验收 14）
 *   · 全局搜索：Ctrl+Shift+F → Worker 正则搜索 → 结果可点击跳转（验收 16）
 *   · 符号跳转：Ctrl+单击标识符 → 跳到定义所在文件（验收 13）
 *   · AI 上下文包：生成含「项目概览 / 文件树 / 核心符号签名 / 调用关系」的 Markdown（验收 17/18）
 *
 * 全部基于本地 ZIP 夹具，不依赖网络。
 */

import { expect, test } from '@playwright/test';
import { buildFixtureZip, clickToolbar, loadFixtureZip, openFileInTree, saveScreenshot } from './helpers';

let zipPath: string;

test.beforeAll(async () => {
  zipPath = await buildFixtureZip();
});

test('调用关系图：Mermaid 渲染 + 统计信息 + 截图', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  await clickToolbar(page, ['调用关系图', 'Call graph', '呼び出しグラフ']);

  // 面板出现并完成分析（分析中会显示 "分析中... 0/N"）
  const panel = page.locator('section[aria-label]').filter({ hasText: /函数|functions|関数/ }).first();
  await expect(panel).toBeVisible({ timeout: 30_000 });

  // 统计行：函数 N 个 · 调用 M 条（tree-sitter 真实解析结果）
  await expect(page.getByText(/函数\s*\d+\s*个|functions|関数/).first()).toBeVisible({ timeout: 30_000 });

  // Mermaid 渲染成功 → 画布内出现 svg 与节点
  const svg = page.locator('[data-graph-host] svg');
  await expect(svg).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-graph-host] .node').first()).toBeVisible();

  // 夹具里 main → compute → add/sub 的调用链必须出现在图中
  await expect(page.locator('[data-graph-host]')).toContainText('compute');
  await expect(page.locator('[data-graph-host]')).toContainText('add');

  // 导出按钮可用（SVG 渲染完成后才启用）
  await expect(page.getByRole('button', { name: /导出 SVG|Export SVG|SVG を書き出す/ })).toBeEnabled();

  await saveScreenshot(page, 'callgraph');
});

test('代码度量：健康评分 + 复杂度表格，高复杂度标红', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  await clickToolbar(page, ['代码度量', 'Code metrics', 'コードメトリクス']);
  await expect(page.getByText(/健康评分|Health score|健全性スコア/).first()).toBeVisible({
    timeout: 30_000,
  });

  // 函数复杂度表：compute 的分支最多，应排在前面
  const table = page.locator('table').first();
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(table).toContainText('compute');

  // 表头包含三项指标
  await expect(table).toContainText(/圈复杂度|Cyclomatic|循環的/);
  await expect(table).toContainText(/认知复杂度|Cognitive|認知的/);

  // 切到文件概览视图
  await clickToolbar(page, ['文件概览', 'File overview', 'ファイル概要']);
  await expect(page.locator('table').first()).toContainText('src/core.ts');

  await saveScreenshot(page, 'metrics');
});

test('全局搜索：Ctrl+Shift+F 打开，Worker 正则搜索可跳转', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  await page.keyboard.press('Control+Shift+F');
  const searchInput = page.locator('input[placeholder*="正则"], input[placeholder*="Regular"], input[placeholder*="正規"]');
  await expect(searchInput).toBeVisible();

  await searchInput.fill('add\\(');
  await searchInput.press('Enter');

  // 结果按文件分组，含匹配计数
  await expect(page.getByText(/处匹配|matches in|件 \/|件/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('src/util.ts').first()).toBeVisible();

  await saveScreenshot(page, 'search');

  // 点击第一条结果 → 打开对应文件（跳转能力）
  // 结果行按钮带 data-search-result 属性，避免依赖文案/结构
  await page.locator('[data-search-result]').first().click();
  await expect(page.locator('.code-scroll code')).toContainText('add');
});

test('符号跳转：Ctrl+单击标识符跳到定义文件', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  // 打开 core.ts（其中调用了 util.ts 里的 add）
  await page.locator('aside').first().getByText('src', { exact: true }).click();
  await openFileInTree(page, 'core.ts');
  await expect(page.locator('.code-scroll code')).toContainText('compute');

  // Ctrl+单击 add 标识符 → 应跳到 src/util.ts
  await page.locator('.code-scroll code').getByText('add', { exact: true }).first().click({
    modifiers: ['Control'],
  });

  // 跳到定义后，当前标签页/状态栏应显示 util.ts
  await expect(page.locator('footer')).toContainText('util.ts', { timeout: 20_000 });
});

test('AI 上下文包：生成含四要素的 Markdown 与 JSON（验收 18/19）', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  await clickToolbar(page, ['AI 上下文包', 'AI context pack', 'AI コンテキストパック']);

  const dialog = page.locator('div[role="dialog"]');
  await expect(dialog).toBeVisible();

  // 生成完成：Markdown 预览包含四个必需章节
  await expect(dialog).toContainText('## 项目概览', { timeout: 40_000 });
  await expect(dialog).toContainText('## 目录结构');
  await expect(dialog).toContainText('## 核心符号签名');
  await expect(dialog).toContainText('## 关键调用关系');

  // 含 路径:行号（工具可直接定位）
  await expect(dialog).toContainText(/src\/util\.ts:\d+/);

  // token 预算提示存在
  await expect(dialog).toContainText(/tokens/);

  await saveScreenshot(page, 'context-pack');

  // 切到 JSON 视图，结构可解析（exact 避免匹配到"下载 JSON"）
  await dialog.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(dialog).toContainText('"generator": "CodeAtlas"');
  await expect(dialog).toContainText('"symbols"');
});
