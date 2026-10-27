/**
 * 配置持久化
 *
 * 优先级（对应提示词"设置存储到 ~/.codeatlas/config.json"）：
 *   1. Tauri 环境：Rust 侧读写 ~/.codeatlas/config.json
 *   2. 浏览器 dev 环境：localStorage（键前缀 codeatlas.*）
 *
 * 注意：GitHub Token 单独存 localStorage，不写入配置文件 ——
 * 避免把凭据明文落盘（配置文件可能被同步/备份）。
 */

import {
  AI_PROVIDERS,
  AppConfig,
  DEFAULT_CONFIG,
  Language,
  THEME_IDS,
  ThemeId,
  type AiConfig,
  type AiProvider,
} from '../types/config';
import { LANGUAGES } from '../i18n';
import { invokeSafe, isTauri } from './tauri';

const LS_CONFIG_KEY = 'codeatlas.config';
const LS_TOKEN_KEY = 'codeatlas.token';
const LS_AI_KEY = 'codeatlas.aiKey';

/** 合并并校验外部配置（防止手工改坏配置文件） */
export function normalizeConfig(raw: unknown): AppConfig {
  const obj = (raw ?? {}) as Partial<AppConfig>;
  const maxTokens = Number(obj.maxTokens);
  const rawAi = (obj.ai ?? {}) as Partial<AiConfig>;
  return {
    // 语言白名单取自 i18n 的单一来源，新增语言时不会再漏（曾硬编码为 zh/en/ja）
    language: LANGUAGES.includes(obj.language as Language)
      ? (obj.language as Language)
      : DEFAULT_CONFIG.language,
    theme: THEME_IDS.includes(obj.theme as ThemeId) ? (obj.theme as ThemeId) : DEFAULT_CONFIG.theme,
    maxTokens:
      Number.isFinite(maxTokens) && maxTokens > 0 ? Math.min(maxTokens, 100_000) : DEFAULT_CONFIG.maxTokens,
    jsdelivrFallback: Boolean(obj.jsdelivrFallback),
    ai: {
      provider: AI_PROVIDERS.includes(rawAi.provider as AiProvider)
        ? (rawAi.provider as AiProvider)
        : DEFAULT_CONFIG.ai.provider,
      // 截断长度：配置文件可能被手工改坏，超长值只会在请求时变成无意义的 URL
      baseUrl: typeof rawAi.baseUrl === 'string' ? rawAi.baseUrl.trim().slice(0, 300) : '',
      model: typeof rawAi.model === 'string' ? rawAi.model.trim().slice(0, 120) : '',
    },
  };
}

export async function loadConfig(): Promise<AppConfig> {
  if (isTauri()) {
    const raw = await invokeSafe<string>('load_config');
    if (raw) {
      try {
        return normalizeConfig(JSON.parse(raw));
      } catch {
        // 配置损坏：回退默认值（并保留文件，交由用户手动修）
      }
    }
    return { ...DEFAULT_CONFIG };
  }
  if (typeof localStorage === 'undefined') return { ...DEFAULT_CONFIG };
  const raw = localStorage.getItem(LS_CONFIG_KEY);
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  if (isTauri()) {
    await invokeSafe('save_config', { json: JSON.stringify(config, null, 2) });
    return;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(config));
  }
}

export function loadToken(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(LS_TOKEN_KEY) ?? '';
}

export function saveToken(token: string): void {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(LS_TOKEN_KEY, token);
  else localStorage.removeItem(LS_TOKEN_KEY);
}

/** AI API Key：与 GitHub Token 同样只存 localStorage，不写入配置文件 */
export function loadAiKey(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(LS_AI_KEY) ?? '';
}

export function saveAiKey(key: string): void {
  if (typeof localStorage === 'undefined') return;
  if (key) localStorage.setItem(LS_AI_KEY, key);
  else localStorage.removeItem(LS_AI_KEY);
}
