/**
 * 用户配置类型与默认值。
 * 存储位置：~/.codeatlas/config.json（经 Tauri IPC 读写）；
 * 浏览器 dev 模式下降级为 localStorage。
 */

export type Language = 'zh' | 'en' | 'ja';
export type ThemeId = 'light' | 'dark' | 'system' | 'atlas';

export interface AppConfig {
  /** 首次启动由系统语言检测写入，之后启动只读不检测 */
  language: Language;
  theme: ThemeId;
  /** AI 上下文包 token 预算（对应 --max-tokens） */
  maxTokens: number;
  /** jsDelivr 兜底开关：默认关闭以满足"仅 GitHub 域请求"约束 */
  jsdelivrFallback: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  language: 'zh',
  theme: 'atlas',
  maxTokens: 1000,
  jsdelivrFallback: false,
};
