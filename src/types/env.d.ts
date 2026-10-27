/**
 * 构建期注入的全局常量（见 vite.config.ts 的 define）。
 * 版本号唯一来源是 package.json，前端不再手写一份。
 */
declare const __APP_VERSION__: string;
