import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * CodeAtlas 前端构建配置。
 *  - base './'：Tauri 以 tauri:// 协议加载 dist/，相对路径最稳。
 *  - clearScreen/envPrefix/strictPort：Tauri 官方推荐配置。
 *  - Vitest：分析层与数据层为纯函数，跑在 node 环境。
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'chrome105',
    // Mermaid 的各图表引擎（elk / cytoscape 等）体量天然在 500 kB 以上，
    // 但它们只在打开"调用图"面板时按需加载，不影响首屏，故放宽警告阈值。
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
