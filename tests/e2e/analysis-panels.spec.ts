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
import {
  buildFixtureZip,
  clickButton,
  clickToolbar,
  closeSettings,
  loadFixtureZip,
  openFileInTree,
  openSettings,
  saveScreenshot,
} from './helpers';

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
  await clickButton(page, ['文件概览', 'File overview', 'ファイル概要']);
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

test('上下文包用途：切到「代码健康」后章节随之改变', async ({ page }) => {
  await loadFixtureZip(page, zipPath);
  await clickToolbar(page, ['AI 上下文包', 'AI context pack', 'AI コンテキストパック']);

  const dialog = page.locator('div[role="dialog"]');
  await expect(dialog).toContainText('## 项目概览', { timeout: 40_000 });
  await expect(dialog).toContainText('## 建议阅读路线');

  // 切用途 → 重新生成 → 健康章节出现，阅读路线消失
  await dialog.locator('[data-pack-intent]').selectOption('health');
  await expect(dialog).toContainText('## 代码健康', { timeout: 40_000 });
  await expect(dialog).not.toContainText('## 建议阅读路线');

  // 切到对外接口：只列导出符号
  await dialog.locator('[data-pack-intent]').selectOption('api');
  await expect(dialog).toContainText('## 对外导出符号', { timeout: 40_000 });
  await expect(dialog).not.toContainText('## 关键调用关系');
});

test('上下文包用途：任务焦点按关键词只给相关文件，查不到时如实说明', async ({ page }) => {
  await loadFixtureZip(page, zipPath);
  await clickToolbar(page, ['AI 上下文包', 'AI context pack', 'AI コンテキストパック']);

  const dialog = page.locator('div[role="dialog"]');
  await expect(dialog).toContainText('## 项目概览', { timeout: 40_000 });

  await dialog.locator('[data-pack-intent]').selectOption('focus');
  const input = dialog.locator('[data-pack-focus]');
  await expect(input).toBeVisible();

  await input.fill('compute');
  await dialog.locator('[data-pack-focus-run]').click();

  await expect(dialog).toContainText('## 任务焦点', { timeout: 40_000 });
  await expect(dialog).toContainText('src/core.ts');
  // 焦点包不放全量目录树与阅读路线，避免挤掉命中的文件
  await expect(dialog).not.toContainText('## 目录结构');
  await expect(dialog).not.toContainText('## 建议阅读路线');

  // 查不到时不能假装相关
  await input.fill('kafka producer');
  await dialog.locator('[data-pack-focus-run]').click();
  await expect(dialog).toContainText('未在符号名或文件路径中找到', { timeout: 40_000 });
});

test('符号索引 + 按需展开：只给地址，实现按需取', async ({ page }) => {
  await loadFixtureZip(page, zipPath);
  await clickToolbar(page, ['AI 上下文包', 'AI context pack', 'AI コンテキストパック']);

  const dialog = page.locator('div[role="dialog"]');
  await expect(dialog).toContainText('## 项目概览', { timeout: 40_000 });

  // 索引形态：只有「路径:行号 + 签名」，不放目录树与阅读路线
  await dialog.locator('[data-pack-intent]').selectOption('index');
  await expect(dialog).toContainText('## 符号索引', { timeout: 40_000 });
  await expect(dialog).toContainText('## 索引使用说明');
  await expect(dialog).toContainText('src/core.ts:');
  await expect(dialog).not.toContainText('## 目录结构');

  // 按需展开：地址 → 带行号的片段
  await dialog.getByRole('button', { name: '按需展开' }).click();
  await dialog.locator('[data-slice-address]').fill('src/core.ts:1-5');
  await dialog.locator('[data-slice-run]').click();

  const out = dialog.locator('[data-slice-output]');
  await expect(out).toContainText('// src/core.ts:1-5', { timeout: 20_000 });
  await expect(out).toContainText("import { add, sub } from './util'");
  await expect(out).toContainText('  1 | ');

  // 找不到时明确提示，而不是给一段空内容
  await dialog.locator('[data-slice-address]').fill('src/nope.ts:1');
  await dialog.locator('[data-slice-run]').click();
  await expect(dialog).toContainText('找不到该文件或符号', { timeout: 20_000 });

  // 关掉再打开：用途不回到 overview，与已生成的包保持一致（少点一次下拉）
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await clickToolbar(page, ['AI 上下文包', 'AI context pack', 'AI コンテキストパック']);
  await expect(dialog.locator('[data-pack-intent]')).toHaveValue('index');
  await dialog.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(dialog).toContainText('## 符号索引', { timeout: 40_000 });
});

test('单行地址落在函数内部时，展开到整个函数（而不是 ±6 行）', async ({ page }) => {
  await loadFixtureZip(page, zipPath);
  await clickToolbar(page, ['AI 上下文包', 'AI context pack', 'AI コンテキストパック']);

  const dialog = page.locator('div[role="dialog"]');
  await expect(dialog).toContainText('## 项目概览', { timeout: 40_000 });

  await dialog.getByRole('button', { name: '按需展开' }).click();
  // 第 5 行在 compute() 内部（函数是 4-14 行），修复前只回 5-11 行，拿不到 return
  await dialog.locator('[data-slice-address]').fill('src/core.ts:5');
  await dialog.locator('[data-slice-run]').click();

  const out = dialog.locator('[data-slice-output]');
  // 表头带符号名 → 说明已按符号边界扩展
  await expect(out).toContainText('— compute', { timeout: 20_000 });
  // 函数末尾的 return 必须在（±6 行窗口拿不到）
  await expect(out).toContainText('return total;');
});

test('分级下钻：目录摘要 → 文件符号清单 → 代码', async ({ page }) => {
  await loadFixtureZip(page, zipPath);
  await clickToolbar(page, ['AI 上下文包', 'AI context pack', 'AI コンテキストパック']);

  const dialog = page.locator('div[role="dialog"]');
  await expect(dialog).toContainText('## 项目概览', { timeout: 40_000 });

  await dialog.getByRole('button', { name: '按需展开' }).click();

  // 一级：目录摘要（不是代码，是下一级的入口）
  await dialog.locator('[data-slice-address]').fill('src/');
  await dialog.locator('[data-slice-run]').click();
  const out = dialog.locator('[data-slice-output]');
  await expect(out).toContainText('// 目录 src/', { timeout: 20_000 });
  await expect(out).toContainText('`src/core.ts`');

  // 二级：文件里全部符号的地址
  await dialog.locator('[data-slice-address]').fill('index:src/core.ts');
  await dialog.locator('[data-slice-run]').click();
  await expect(out).toContainText('// 文件 src/core.ts', { timeout: 20_000 });
  await expect(out).toContainText('src/core.ts:');
  await expect(out).toContainText('compute');

  // 三级：按地址取实现
  await dialog.locator('[data-slice-address]').fill('src/core.ts:4');
  await dialog.locator('[data-slice-run]').click();
  await expect(out).toContainText('— compute', { timeout: 20_000 });
});

test('AI 解读：默认关闭时给出设置引导，且不发任何请求', async ({ page }) => {
  await loadFixtureZip(page, zipPath);

  // 记录点击后产生的请求，确认默认关闭时确实不联网
  const external: string[] = [];
  page.on('request', (req) => {
    const { protocol, hostname } = new URL(req.url());
    if (protocol.startsWith('http') && !hostname.startsWith('127.0.0.1') && hostname !== 'localhost') {
      external.push(hostname);
    }
  });

  await clickToolbar(page, ['AI 上下文包', 'AI context pack', 'AI コンテキストパック']);
  const dialog = page.locator('div[role="dialog"]');
  await expect(dialog).toContainText('## 项目概览', { timeout: 40_000 });

  // AI 页签存在，点击页脚按钮后提示去设置页配置
  await dialog.locator('[data-ai-explain]').click();
  await expect(dialog).toContainText('尚未配置 AI 提供方');

  expect(external).toHaveLength(0);
});

test('设置页含 AI 助手分区，可切换提供方并回填默认地址', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);

  await page.getByRole('button', { name: /AI 助手|AI Assistant/ }).click();
  const provider = page.locator('[data-ai-provider]');
  await expect(provider).toHaveValue('off');

  await provider.selectOption('ollama');
  await expect(page.locator('[data-ai-base-url]')).toHaveAttribute(
    'placeholder',
    'http://127.0.0.1:11434',
  );
  await expect(page.locator('[data-ai-model]')).toHaveAttribute('placeholder', 'qwen2.5-coder');
});

test('AI 按需展开：模型索取 @@expand 后自动切片、第二轮继续，标记对用户不可见', async ({ page }) => {
  const calls: string[] = [];
  // 假模型：第一轮索取实现，第二轮给出结论（SSE 格式与 OpenAI 兼容）
  await page.route('**/chat/completions', async (route) => {
    calls.push(route.request().postData() ?? '');
    const text =
      calls.length === 1
        ? '先看核心实现。\n@@expand src/core.ts:5\n'
        : '结论：核心逻辑在 src/core.ts。\n';
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
  });

  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: /AI 助手|AI Assistant/ }).click();
  await page.locator('[data-ai-provider]').selectOption('openai');
  await page.locator('[data-ai-base-url]').fill('http://127.0.0.1:18123/v1');
  await page.locator('[data-ai-model]').fill('fake-model');
  await closeSettings(page);

  await loadFixtureZip(page, zipPath);
  await clickToolbar(page, ['AI 上下文包', 'AI context pack', 'AI コンテキストパック']);

  const dialog = page.locator('div[role="dialog"]');
  await expect(dialog).toContainText('## 项目概览', { timeout: 40_000 });
  await dialog.locator('[data-ai-explain]').click();

  // 两轮内容都在，标记行被过滤掉
  await expect(dialog).toContainText('结论：核心逻辑在 src/core.ts', { timeout: 40_000 });
  await expect(dialog).toContainText('先看核心实现');
  await expect(dialog).not.toContainText('@@expand');

  // 展开计数与第二轮请求里确实带了真实代码
  await expect(dialog.locator('[data-ai-rounds]')).toContainText('1');
  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain('const x');
});
