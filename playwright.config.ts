import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 配置
 *
 * 针对**生产构建**运行（`npm run build` 后的 `vite preview`），
 * 因为生产构建才包含真实的资源路径、Worker 打包与 grammars 目录，
 * 开发服务器会掩盖一部分打包问题。
 *
 * 端口 4173 与 vite preview 默认端口一致；本地已有服务时直接复用，CI 里会自动启动。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // 分析类用例会一起拉高 CPU，串行更稳定
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
