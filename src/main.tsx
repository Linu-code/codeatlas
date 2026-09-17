import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initI18n } from './i18n';
import { applyTheme, readSavedTheme } from './theme/themes';

// 多窗口约定：每个 Tauri 窗口 URL 带 ?win=<label>（M3 启用多窗口时读取）
const params = new URLSearchParams(window.location.search);
void params.get('win');

// 首屏前先定主题，避免白闪
applyTheme(readSavedTheme() ?? 'atlas');

// i18n 初始化完成后再挂载，保证首帧文案就是用户语言
void initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
