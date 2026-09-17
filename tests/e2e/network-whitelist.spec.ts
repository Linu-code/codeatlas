/**
 * E2E：网络白名单（对应验收 12）
 *
 * 验收要求：除 GitHub API 外不发起任何外部请求；没有任何 AI/LLM 调用。
 * 本文件把该要求固化为断言：
 *   1. 完全离线流程（ZIP + 全部分析面板）→ 除自身源站外**零外部请求**
 *   2. 在线流程（加载 GitHub 仓库）→ 请求域名只能是 api.github.com / raw.githubusercontent.com
 *      并且**不允许出现任何已知 AI 服务域名**（防御性黑名单）
 */

import { expect, test } from '@playwright/test';
import { buildFixtureZip, clickToolbar, loadFixtureZip, trackRequestHosts } from './helpers';

/** 已知 AI / LLM 服务域名（出现即视为违反硬性约束） */
const AI_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.deepseek.com',
  'openrouter.ai',
  'api.mistral.ai',
  'huggingface.co',
  'api.cohere.ai',
];

const ALLOWED_GITHUB_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com']);

let zipPath: string;

test.beforeAll(async () => {
  zipPath = await buildFixtureZip();
});

test('离线流程（ZIP + 分析面板）不产生任何外部请求', async ({ page }) => {
  const tracker = trackRequestHosts(page);

  await loadFixtureZip(page, zipPath);

  // 打开代码文件
  await page.locator('aside').first().getByText('src', { exact: true }).click();
  await page.getByText('core.ts', { exact: true }).first().click();

  // 依次触发：调用图（会懒加载 tree-sitter 运行时与语法包）、度量、上下文包
  await clickToolbar(page, ['调用关系图', 'Call graph', '呼び出しグラフ']);
  await expect(page.locator('[data-graph-host] svg')).toBeVisible({ timeout: 40_000 });

  await clickToolbar(page, ['代码度量', 'Code metrics', 'コードメトリクス']);
  await expect(page.getByText(/健康评分|Health score|健全性スコア/).first()).toBeVisible({
    timeout: 30_000,
  });

  await page.keyboard.press('Control+Shift+F');
  await page
    .locator('input[placeholder*="正则"], input[placeholder*="Regular"], input[placeholder*="正規"]')
    .fill('compute');
  await page.keyboard.press('Enter');
  await expect(page.getByText('src/core.ts').first()).toBeVisible({ timeout: 20_000 });

  // ---------- 断言 ----------
  const external = [...tracker.hosts].filter(
    (h) => !h.startsWith('localhost') && !h.startsWith('127.0.0.1'),
  );
  expect(external, `发现意外的外部请求域名: ${external.join(', ')}`).toEqual([]);

  for (const host of tracker.hosts) {
    expect(AI_HOSTS).not.toContain(host);
  }
});

test('在线流程只访问 GitHub 域名（网络不可用时自动跳过）', async ({ page }) => {
  // 该用例依赖真实 GitHub 网络；给较短的失败判定，避免拖慢整个 E2E
  test.setTimeout(90_000);
  const tracker = trackRequestHosts(page);

  let loaded = false;
  let message = '';
  let hosts: string[] = [];

  try {
    await page.goto('/');
    // 用体积很小的公开仓库，减少 API 配额消耗
    // 注意：顶栏输入框没有显式 type 属性，这里用 role 定位而非属性选择器
    const input = page.locator('header').getByRole('textbox').first();
    await input.fill('https://github.com/sindresorhus/is-odd');
    await input.press('Enter');

    // 等待加载结果：成功（出现文件树）或失败（出现错误横幅）
    const tree = page.locator('aside').first();
    const errorBanner = page.locator('[role="alert"]');
    await Promise.race([
      tree.waitFor({ state: 'visible', timeout: 25_000 }).catch(() => null),
      errorBanner.waitFor({ state: 'visible', timeout: 25_000 }).catch(() => null),
    ]);

    loaded = await tree.isVisible().catch(() => false);
    message = loaded ? '' : ((await errorBanner.textContent().catch(() => '')) ?? '').trim();

    // 域名数据在 Node 侧已收集完毕，无需页面继续存活
    hosts = [...tracker.hosts].filter(
      (h) => !h.startsWith('localhost') && !h.startsWith('127.0.0.1'),
    );
  } finally {
    // 显式关闭页面：网络受限时页面上可能残留挂起的请求，
    // 若交给框架回收会导致 worker 无法退出（表现为整个 E2E 卡住数分钟）。
    await page.close({ runBeforeUnload: false }).catch(() => null);
  }

  if (!loaded) {
    test.skip(true, `GitHub 不可达或已限流（提示：${message || 'timeout'}）——本用例允许跳过`);
  }

  // 成功加载：断言域名白名单
  for (const host of hosts) {
    expect(ALLOWED_GITHUB_HOSTS.has(host), `不允许请求 ${host}`).toBe(true);
  }
  expect(
    hosts.some((h) => h === 'api.github.com') || hosts.some((h) => h === 'raw.githubusercontent.com'),
  ).toBe(true);
  // 任何 AI 服务域名都不得出现
  for (const host of hosts) expect(AI_HOSTS).not.toContain(host);
});
