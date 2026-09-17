/**
 * 网络请求辅助：超时控制 + 错误归类。
 * 网络白名单约束：默认只允许 github.com 系域名（api.github.com / raw.githubusercontent.com）。
 */

import { RepoError } from '../types/repo';

/** 允许发起请求的域名白名单（验收 12：除 GitHub API 外零外部请求） */
export const ALLOWED_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com']);

/** jsDelivr 兜底域名：仅在用户显式开启设置后加入白名单 */
export const JSDELIVR_HOSTS = new Set(['cdn.jsdelivr.net', 'data.jsdelivr.com']);

export function assertAllowedUrl(url: string, allowJsdelivr: boolean): void {
  const host = new URL(url).host;
  const ok = ALLOWED_HOSTS.has(host) || (allowJsdelivr && JSDELIVR_HOSTS.has(host));
  if (!ok) {
    // 这是编程错误（不该出现的请求源），直接抛出以便测试捕获
    throw new RepoError('network', `blocked by network whitelist: ${host}`);
  }
}

/** 带超时与错误归类的 fetch 封装 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
  allowJsdelivr = false,
): Promise<Response> {
  assertAllowedUrl(url, allowJsdelivr);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    // AbortError → timeout；其余归为 network
    const isAbort = e instanceof DOMException && e.name === 'AbortError';
    throw new RepoError(isAbort ? 'timeout' : 'network', `fetch failed: ${url}`, { cause: e });
  } finally {
    clearTimeout(timer);
  }
}

/** 非 2xx 响应归类：403+限流耗尽 → rate-limit；404 → not-found */
export async function toRepoError(res: Response, what: string): Promise<RepoError> {
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    return new RepoError('rate-limit', `rate limit exceeded: ${what}`);
  }
  if (res.status === 404) {
    return new RepoError('not-found', `not found: ${what}`);
  }
  if (res.status === 401 || res.status === 403) {
    return new RepoError('private', `access denied: ${what}`);
  }
  return new RepoError('network', `HTTP ${res.status}: ${what}`);
}
