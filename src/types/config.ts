/**
 * 用户配置类型与默认值。
 * 存储位置：~/.codeatlas/config.json（经 Tauri IPC 读写）；
 * 浏览器 dev 模式下降级为 localStorage。
 */

/** 支持的界面语言（10 种，均 LTR；RTL 预留在 i18n/syncDocumentLanguage） */
export type Language =
  | 'zh'
  | 'zh-TW'
  | 'en'
  | 'ja'
  | 'ko'
  | 'es'
  | 'fr'
  | 'de'
  | 'pt'
  | 'ru';

/** 主题 id 的单一来源（白名单校验、设置页选项都由它派生，避免各抄一份漏改） */
export const THEME_IDS = ['light', 'dark', 'system', 'atlas'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/**
 * AI 提供方。
 *   off    —— 默认，完全不发请求（保持"零后台外部请求"）
 *   ollama —— 本地 Ollama（默认 127.0.0.1:11434）
 *   openai —— 任意 OpenAI 兼容接口（OpenAI / DeepSeek / 通义 / 自建网关…）
 */
export const AI_PROVIDERS = ['off', 'ollama', 'openai'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface AiConfig {
  provider: AiProvider;
  /** 留空用该提供方的默认地址 */
  baseUrl: string;
  /** 留空用该提供方的默认模型 */
  model: string;
}

/** 各提供方的默认值（设置页的 placeholder 与请求层共用，避免两处硬编码） */
export const AI_DEFAULTS: Record<Exclude<AiProvider, 'off'>, { baseUrl: string; model: string }> = {
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5-coder' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};

export interface AppConfig {
  /** 首次启动由系统语言检测写入，之后启动只读不检测 */
  language: Language;
  theme: ThemeId;
  /** AI 上下文包 token 预算（对应 --max-tokens） */
  maxTokens: number;
  /** jsDelivr 兜底开关：默认关闭以满足"仅 GitHub 域请求"约束 */
  jsdelivrFallback: boolean;
  /** AI 解读配置（默认 off，不产生任何外部请求） */
  ai: AiConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  language: 'zh',
  theme: 'atlas',
  maxTokens: 1000,
  jsdelivrFallback: false,
  ai: { provider: 'off', baseUrl: '', model: '' },
};
