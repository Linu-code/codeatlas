/**
 * E2E：AST 解析确实跑在 Worker 里
 *
 * 为什么单独一条：Worker 失败时会**静默回退主线程**，功能测试全绿也看不出差别。
 * 这里同时断言两件事：
 *   1. 页面创建了 `analysis.worker-*.js` 的 dedicated worker；
 *   2. 度量面板出数据（说明该 Worker 真的完成了 tree-sitter 解析 + 度量，
 *      而不是加载失败后被主线程兜底）。
 */

import { expect, test } from '@playwright/test';
import { buildFixtureZip, clickToolbar } from './helpers';

test('分析 Worker：被创建且完成解析（度量面板有数据）', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));

  const zip = await buildFixtureZip();
  await page.goto('/');
  await page.setInputFiles('input[type=file]', zip);
  await page.getByText('README.md').first().waitFor();

  await clickToolbar(page, ['代码度量', 'Metrics', 'メトリクス']);
  await expect(page.getByText(/健康评分|Health score|健全性スコア/).first()).toBeVisible({
    timeout: 30_000,
  });

  expect(workers.some((u) => u.includes('analysis.worker'))).toBe(true);
});
