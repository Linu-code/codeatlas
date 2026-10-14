/**
 * E2E：网络白名单（对应验收 12）
 *
 * 验收要求：除 GitHub API 外不发起任何外部请求；没有任何 AI/LLM 调用。
 * 本文件把该要求固化为断言：
 *   1. 完全离线流程（ZIP + 全部分析面板）→ 除自身源站外**零外部请求**
 *   2. 在线流程（加载 GitHub 仓库，用本地 mock 驱动）→ 请求域名只能是
 *      api.github.com / raw.githubusercontent.com
 *      并且**不允许出现任何已知 AI 服务域名**（防御性黑名单）
 *
 * 说明：本机无法访问 GitHub，在线用例改用 page.route 拦截的两个域名的 mock
 * 响应来驱动——真实网络请求仍会触发 request 事件，因此域名白名单断言依旧有效，
 * 且用例无需真实联网即可稳定运行（不再 test.skip）。
 */

import { expect, test } from '@playwright/test';
import {
  MOCK_GITHUB,
  buildFixtureZip,
  clickToolbar,
  loadFixtureZip,
  mockGitHub,
  trackRequestHosts,
} from './helpers';

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

test('在线流程只访问 GitHub 域名（本地 mock，可离线稳定运行）', async ({ page }) => {
  const tracker = trackRequestHosts(page);
  // 拦截 GitHub API / raw 内容请求，返回仿真数据以驱动真实在线代码路径
  await mockGitHub(page, MOCK_GITHUB);

  await page.goto('/');
  // 顶栏输入框现为 combobox 角色（可访问性改造后）
  const input = page.locator('header').getByRole('combobox').first();
  await input.fill('https://github.com/acme/demo');
  await input.press('Enter');

  // 等待在线加载完成：文件树与 README 可见
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('README.md').first()).toBeVisible({ timeout: 20_000 });

  // 域名数据在 Node 侧已收集完毕
  const hosts = [...tracker.hosts].filter(
    (h) => !h.startsWith('localhost') && !h.startsWith('127.0.0.1'),
  );

  // 成功加载：断言域名白名单（只允许 GitHub 域）
  for (const host of hosts) {
    expect(ALLOWED_GITHUB_HOSTS.has(host), `不允许请求 ${host}`).toBe(true);
  }
  // 确实走过了 GitHub API（而非只命中缓存）
  expect(
    hosts.some((h) => h === 'api.github.com') || hosts.some((h) => h === 'raw.githubusercontent.com'),
  ).toBe(true);
  // 任何 AI 服务域名都不得出现
  for (const host of hosts) expect(AI_HOSTS).not.toContain(host);
});
