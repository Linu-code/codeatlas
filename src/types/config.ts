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

/** 模型规模档位：决定会话侧预算（切片点数 / 展开轮数 / 提示词详略） */
export const AI_TIERS = ['small', 'medium', 'large'] as const;
export type AiTier = (typeof AI_TIERS)[number];

export interface AiConfig {
  provider: AiProvider;
  /** 留空用该提供方的默认地址 */
  baseUrl: string;
  /** 留空用该提供方的默认模型 */
  model: string;
  /**
   * 模型规模。本地 3B~7B 模型常见上下文只有 4k~8k，而工具默认会把
   * 包 + 若干切片 + 多轮历史一起塞进去——不区分档位就会直接超窗。
   */
  tier?: AiTier;
}

/**
 * 各档位的会话预算。
 *
 * 为什么不直接按"模型窗口"定义：Ollama 没有可靠的窗口字段可读，
 * 假装知道就会给出错误承诺。这里只保证「包 + 切片 + 历史」不超过一个有依据的上限，
 * 并在包超出档位建议时明确提醒用户。
 */
/** 取档位对应的预算；旧配置没有 tier 时按 small（本地小模型）处理 */
export function tierLimits(ai: AiConfig): (typeof AI_TIER_LIMITS)[AiTier] {
  return AI_TIER_LIMITS[ai.tier ?? 'small'];
}

export const AI_TIER_LIMITS: Record<
  AiTier,
  { windowHint: number; sliceBudget: number; maxRounds: number; brief: boolean }
> = {
  // 4k 窗口：切片总量 ≤800，最多 2 轮，提示词走精简版
  small: { windowHint: 4000, sliceBudget: 800, maxRounds: 2, brief: true },
  // 8k~16k
  medium: { windowHint: 12000, sliceBudget: 2400, maxRounds: 3, brief: false },
  // 32k+：切片预算沿用「包的 2 倍」（5.0 的规则），这里 0 表示交给调用方算
  large: { windowHint: 64000, sliceBudget: 0, maxRounds: 3, brief: false },
};

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
  ai: { provider: 'off', baseUrl: '', model: '', tier: 'small' },
};
