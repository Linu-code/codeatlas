/**
 * E2E 共享工具
 *
 * 1. 生成 ZIP 测试夹具：用一个**自包含的小型 TypeScript 项目**，
 *    覆盖文件树、README 渲染、语法高亮、调用图、度量、符号跳转等全部验收点。
 *    夹具在 Node 侧用 JSZip 现造，因此 E2E 不依赖任何外部仓库（可离线跑）。
 * 2. 通用操作封装：上传 ZIP、切换面板、等待分析完成、截图落盘。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { expect, type Page } from '@playwright/test';

export const SCREENSHOT_DIR = path.resolve('docs', 'screenshots');
export const FIXTURE_DIR = path.resolve('test-results', 'fixtures');

/** 夹具项目源码：刻意包含调用链、分支、嵌套与注释，便于断言度量与调用图 */
const FIXTURE_FILES: Record<string, string> = {
  'README.md': `# Fixture Project

一个用于 E2E 测试的小型 TypeScript 项目。

## 用法

\`\`\`ts
import { compute } from './src/core';
compute([1, 2, 3]);
\`\`\`
`,
  'package.json': JSON.stringify(
    { name: 'codeatlas-fixture', version: '1.0.0', description: 'E2E fixture', license: 'MIT' },
    null,
    2,
  ),
  'LICENSE': 'MIT License\n\nCopyright (c) 2026 Fixture\n',
  'src/util.ts': `/** 基础工具：被 core 与 main 复用（用于验证 PageRank 排序） */
export function add(a: number, b: number): number {
  return a + b;
}

export function sub(a: number, b: number): number {
  return a - b;
}
`,
  'src/core.ts': `import { add, sub } from './util';

/** 计算统计值：含多个分支，用于验证圈复杂度 */
export function compute(xs: number[]): number {
  let total = 0;
  for (const x of xs) {
    if (x > 0 && x < 100) {
      total = add(total, x);
    } else if (x >= 100) {
      total = sub(total, x);
    }
  }
  return total;
}
`,
  'src/main.ts': `import { compute } from './core';

function printResult(value: number) {
  console.log('result', value);
}

export function main() {
  printResult(compute([1, 2, 3]));
}
`,
  'src/tool.py': `def helper(value):
    return value + 1


def run():
    return helper(41)
`,
  'src/styles.css': 'body {\n  margin: 0;\n}\n',
  'docs/guide.md': '# Guide\n\nSee README.\n',
  'tests/core.test.ts': `import { compute } from '../src/core';

test('compute', () => {
  expect(compute([1, 2])).toBe(3);
});
`,
};

/** 生成夹具 ZIP 并返回文件路径 */
export async function buildFixtureZip(): Promise<string> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const zipPath = path.join(FIXTURE_DIR, 'fixture-project.zip');

  const zip = new JSZip();
  for (const [filePath, content] of Object.entries(FIXTURE_FILES)) {
    zip.file(filePath, content);
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(zipPath, buffer); // 若已存在则覆盖，保证夹具始终与源码同步
  return zipPath;
}

export const FIXTURE_FILES_LIST = Object.keys(FIXTURE_FILES);

/** 上传 ZIP 并等待文件树出现 */
export async function loadFixtureZip(page: Page, zipPath: string): Promise<void> {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', zipPath);
  // 文件树出现即视为加载完成（左侧栏标题为「文件」/「Files」/「ファイル」）
  await expect(page.locator('aside[role], aside').first()).toBeVisible();
  await expect(page.getByText('README.md').first()).toBeVisible({ timeout: 20_000 });
}

/** 点击工具条按钮（按文案匹配，兼容三种语言） */
export async function clickToolbar(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    const btn = page.getByRole('button', { name: label, exact: false }).first();
    if (await btn.count()) {
      await btn.click();
      return;
    }
  }
  throw new Error(`toolbar button not found: ${labels.join(' | ')}`);
}

/** 打开某个文件（在文件树中点击文件名） */
export async function openFileInTree(page: Page, fileName: string): Promise<void> {
  await page.getByText(fileName, { exact: true }).first().click();
}

/** 保存截图到 docs/screenshots（README 引用这些图） */
export async function saveScreenshot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

/** 收集页面发起过的所有请求域名 */
export function trackRequestHosts(page: Page): { hosts: Set<string>; urls: string[] } {
  const hosts = new Set<string>();
  const urls: string[] = [];
  page.on('request', (req) => {
    try {
      const u = new URL(req.url());
      hosts.add(u.host);
      urls.push(req.url());
    } catch {
      // data:/blob: 等忽略
    }
  });
  return { hosts, urls };
}
