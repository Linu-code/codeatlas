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

/**
 * 类图夹具：单独一个 ZIP，避免改动主夹具而影响既有的度量/调用图断言。
 * 内容刻意包含继承 + 接口实现 + 跨文件引用，用于验证 N3 类图。
 */
const CLASS_FIXTURE_FILES: Record<string, string> = {
  'README.md': '# Class fixture\n\n用于验证 N3 类图（继承 / 实现）的小型夹具。\n',
  'src/base.ts': `export class Base {
  greet(): string {
    return 'base';
  }
}
`,
  'src/user.ts': `import { Base } from './base';

export interface IGreeter {
  greet(): string;
}

export class User extends Base implements IGreeter {
  greet(): string {
    return 'user';
  }
}
`,
  'lib/plugin.py': `class PluginBase:
    pass


class MyPlugin(PluginBase):
    def run(self):
        return 1
`,
};

/** 生成类图夹具 ZIP */
export async function buildClassFixtureZip(): Promise<string> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const zipPath = path.join(FIXTURE_DIR, 'fixture-classes.zip');

  const zip = new JSZip();
  for (const [filePath, content] of Object.entries(CLASS_FIXTURE_FILES)) {
    zip.file(filePath, content);
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(zipPath, buffer);
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

export type MenuId = 'open' | 'project' | 'analysis';

/** 打开顶栏某个分组菜单（打开 / 项目 / 分析） */
export async function openMenu(page: Page, id: MenuId): Promise<void> {
  await page.getByTestId(`menu-${id}`).click();
  await page.getByRole('menu').waitFor({ state: 'visible' });
}

/** 兼容旧写法：默认打开「分析」菜单 */
export async function openMainMenu(page: Page): Promise<void> {
  await openMenu(page, 'analysis');
}

/**
 * 通过顶栏菜单执行一个操作（原工具条的按钮已收进菜单）。
 * labels 为多语言候选；依次尝试「分析 → 项目 → 打开」三个菜单。
 */
export async function clickToolbar(page: Page, labels: string[]): Promise<void> {
  for (const id of ['analysis', 'project', 'open'] as const) {
    await openMenu(page, id);
    for (const label of labels) {
      const item = page.getByRole('menuitem', { name: label, exact: false }).first();
      if (await item.count()) {
        await item.click();
        return;
      }
    }
    await page.keyboard.press('Escape');
  }
  throw new Error(`menu item not found: ${labels.join(' | ')}`);
}

/** 点击页面上任意按钮（面板内的页签等，不经过主菜单） */
export async function clickButton(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    const btn = page.getByRole('button', { name: label, exact: false }).first();
    if (await btn.count()) {
      await btn.click();
      return;
    }
  }
  throw new Error(`button not found: ${labels.join(' | ')}`);
}

/** 打开设置对话框（顶栏齿轮按钮） */
export async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('open-settings').click();
  await page.getByRole('dialog').waitFor({ state: 'visible' });
}

/** 关闭设置对话框（Esc） */
export async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}

/** 在设置页切换主题 */
export async function setTheme(page: Page, theme: string): Promise<void> {
  await openSettings(page);
  await page.locator(`[data-theme-option="${theme}"]`).click();
  await closeSettings(page);
}

/** 在设置页切换语言（lang 为 Language 的取值，如 'zh-TW'） */
export async function setLanguage(page: Page, lang: string): Promise<void> {
  await openSettings(page);
  await page.locator(`[data-language-option="${lang}"]`).click();
  await closeSettings(page);
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

// ---------------------------------------------------------------------------
// 在线场景 E2E：本地 mock GitHub API
// ---------------------------------------------------------------------------
//
// 本机环境无法访问 GitHub，导致「在线流程」用例此前只能 test.skip。
// 这里用 Playwright 的 page.route 拦截 api.github.com / raw.githubusercontent.com，
// 返回符合真实 GitHub API 形状的响应，从而**真实地跑通在线代码路径**（顶栏解析 →
// 分支探测 → 拉树 → 找 README → 读文件 → 搜索），而无需任何外部网络。

export interface MockTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

export interface MockSearchItem {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
}

export interface MockGitHubOptions {
  owner: string;
  repo: string;
  /** 默认分支，缺省 main */
  branch?: string;
  stars?: number;
  tree: MockTreeEntry[];
  /** 相对仓库根的路径 → 文本内容（raw 请求命中） */
  files: Record<string, string>;
  /** /search/repositories 返回的条目 */
  search?: MockSearchItem[];
}

/** 默认 mock 仓库：覆盖文件树、README、源码与配置文件 */
export const MOCK_GITHUB: MockGitHubOptions = {
  owner: 'acme',
  repo: 'demo',
  branch: 'main',
  stars: 128,
  tree: [
    { path: 'README.md', type: 'blob', size: 140 },
    { path: 'package.json', type: 'blob', size: 60 },
    { path: '.gitignore', type: 'blob', size: 20 },
    { path: 'src', type: 'tree' },
    { path: 'src/index.ts', type: 'blob', size: 220 },
    { path: 'src/util.ts', type: 'blob', size: 120 },
  ],
  files: {
    'README.md':
      '# Demo Project\n\n一个用于在线场景 E2E 的仓库。\n\n## 用法\n\n```ts\nimport { greet } from \'./src/index\';\n```\n',
    'package.json': '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n',
    '.gitignore': 'node_modules\n',
    'src/index.ts':
      "import { add } from './util';\n\n/** 打招呼：被调用图与符号索引使用 */\nexport function greet(name: string): string {\n  return `hi ${name}`;\n}\n\nexport function sum(xs: number[]): number {\n  return xs.reduce(add, 0);\n}\n",
    'src/util.ts': 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
  },
  search: [
    { full_name: 'acme/demo', description: 'A demo repo', stargazers_count: 128, language: 'TypeScript' },
    { full_name: 'acme/demo-cli', description: 'CLI demo', stargazers_count: 7, language: 'Go' },
    { full_name: 'other/demo-tools', description: 'Tooling demo', stargazers_count: 3, language: null },
  ],
};

/**
 * 拦截 GitHub API / raw 内容请求，返回 mock 数据。
 * 必须在 page.goto 之前调用。
 */
export async function mockGitHub(page: Page, opts: MockGitHubOptions): Promise<void> {
  const branch = opts.branch ?? 'main';

  // api.github.com：repos（分支探测/星标）、git/trees、search/repositories
  await page.route(/^https:\/\/api\.github\.com\//, async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (pathname === `/repos/${opts.owner}/${opts.repo}`) {
      return json({ default_branch: branch, stargazers_count: opts.stars ?? 0 });
    }
    if (pathname === `/repos/${opts.owner}/${opts.repo}/git/trees/${branch}`) {
      return json({ tree: opts.tree, truncated: false });
    }
    if (pathname === '/search/repositories') {
      return json({ items: opts.search ?? [] });
    }
    return json({ message: `unmocked endpoint: ${pathname}` }, 404);
  });

  // raw.githubusercontent.com：文件内容（/{owner}/{repo}/{branch}/{path...}）
  await page.route(/^https:\/\/raw\.githubusercontent\.com\//, async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.replace(/^\//, '').split('/');
    const filePath = parts.slice(3).join('/');
    const text = opts.files[filePath];
    if (text === undefined) {
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    }
    return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: text });
  });
}

