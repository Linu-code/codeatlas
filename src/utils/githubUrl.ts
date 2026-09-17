/**
 * 输入解析：顶栏命令中心的一切输入先经过这里。
 *
 * 三种输入形态（对应提示词需求）：
 *   1. GitHub 完整网址  → 直接加载（支持 /tree/branch、.git、SSH 形态）
 *   2. owner/repo 短写  → 直接加载（默认分支）
 *   3. 其他任意文本     → GitHub Search API 搜索
 */

import { RepoError } from '../types/repo';

/** 单段：不含 / 空格 ? # 的字符 */
const SEG = '[^/\\s#?]+';

const RE_HTTPS = new RegExp(
  `^(?:https?:\\/\\/)?(?:www\\.)?github\\.com\\/(${SEG})\\/(${SEG})` +
    `(?:\\/tree\\/([^/\\s#?]+)((?:\\/[^\\s#?]*)?))?` +
    `\\/?([?#].*)?$`,
  'i',
);

const RE_SSH = new RegExp(`^git@github\\.com:(${SEG})\\/(${SEG})(\\.git)?$`, 'i');
const RE_OWNER_REPO = new RegExp(`^(${SEG})\\/(${SEG})$`);
const RE_SUFFIX_GIT = /\.git$/i;

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  branch: string | null;
  subDir: string | null;
}

/** 解析 GitHub 仓库 URL。非 github.com 域名或 blob 单文件视图抛 TypeError */
export function parseGitHubUrl(url: string): ParsedGitHubUrl {
  const input = url.trim();
  const ssh = input.match(RE_SSH);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2].replace(RE_SUFFIX_GIT, ''), branch: null, subDir: null };
  }
  const m = input.match(RE_HTTPS);
  if (!m) throw new TypeError(`not a github repo url: ${url}`);
  return {
    owner: m[1],
    repo: m[2].replace(RE_SUFFIX_GIT, ''),
    branch: m[3] ?? null,
    subDir: m[4] ? m[4].replace(/^\//, '').replace(/\/$/, '') || null : null,
  };
}

/** 顶栏输入的解析结果 */
export type ResolvedInput =
  | { kind: 'url'; url: string; parsed: ParsedGitHubUrl }
  | { kind: 'owner-repo'; owner: string; repo: string }
  | { kind: 'search'; query: string };

/**
 * 解析顶栏输入。空输入返回 null（回车无响应的判定在此）。
 * 形如 owner/repo 的短写直接加载；"react" 这类单词走搜索。
 */
export function resolveTopBarInput(raw: string): ResolvedInput | null {
  const input = raw.trim();
  if (!input) return null;

  // 疑似 URL：含 github.com 或 git@ 前缀
  if (/github\.com/i.test(input) || /^git@github\.com:/i.test(input)) {
    return { kind: 'url', url: input, parsed: parseGitHubUrl(input) };
  }
  // owner/repo 短写（不含空格、无协议）
  const short = input.match(RE_OWNER_REPO);
  if (short) {
    return { kind: 'owner-repo', owner: short[1], repo: short[2] };
  }
  // 其余一律视为搜索关键词
  return { kind: 'search', query: input };
}

/** 供数据层使用的便捷转换：非法 URL 统一转成 RepoError(invalid-input) */
export function parsedOrThrow(url: string): ParsedGitHubUrl {
  try {
    return parseGitHubUrl(url);
  } catch {
    throw new RepoError('invalid-input', `invalid github url: ${url}`);
  }
}
