/**
 * aiClient.ts —— AI 解读的请求层（可选功能，默认关闭）
 *
 * 两条通道，都不经过 sources/http.ts 的仓库域名白名单：
 *   ollama —— POST {base}/api/chat        NDJSON 流（每行一个 JSON，message.content 增量）
 *   openai —— POST {base}/chat/completions  SSE 流（`data: {...}`，choices[0].delta.content）
 *
 * 约束：
 *   · 只在用户主动点击「AI 解读」时发起请求，任何情况下都不做后台轮询/预取；
 *   · API Key 只存在 localStorage，不写入 config.json（与 GitHub Token 同策略）；
 *   · baseUrl 必须能解析为 http/https，其它协议（file:、data:、javascript:）一律拒绝。
 */

import { AI_DEFAULTS, type AiConfig, type AiProvider } from '../types/config';

export type AiErrorCode =
  | 'not-configured' // provider = off 或缺少模型
  | 'invalid-url' // baseUrl 不是合法 http(s) 地址
  | 'network' // 连接失败（Ollama 未启动、DNS、证书…）
  | 'http' // 服务返回非 2xx
  | 'empty' // 响应没有任何文本增量
  | 'aborted'; // 用户取消

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
  /** 便于测试注入 */
  fetchImpl?: typeof fetch;
}

/** 解析出实际使用的地址与模型（配置留空时用提供方默认值） */
export function resolveEndpoint(ai: AiConfig): { url: string; model: string; isOllama: boolean } {
  if (ai.provider === 'off') {
    throw new AiError('not-configured', 'AI provider is off');
  }
  const provider = ai.provider as Exclude<AiProvider, 'off'>;
  const defaults = AI_DEFAULTS[provider];
  const baseUrl = (ai.baseUrl.trim() || defaults.baseUrl).replace(/\/+$/, '');
  const model = ai.model.trim() || defaults.model;

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new AiError('invalid-url', `invalid base url: ${baseUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AiError('invalid-url', `unsupported protocol: ${parsed.protocol}`);
  }

  const isOllama = provider === 'ollama';
  return {
    url: isOllama ? `${baseUrl}/api/chat` : `${baseUrl}/chat/completions`,
    model,
    isOllama,
  };
}

/** 逐行流解析：缓冲区跨 chunk 保留，避免 JSON 被切断 */
function feedLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const merged = buffer + chunk;
  const parts = merged.split('\n');
  return { lines: parts.slice(0, -1), rest: parts[parts.length - 1] ?? '' };
}

/** 从一行流数据里取出文本增量（两种协议各一套） */
function deltaOfLine(line: string, isOllama: boolean): string {
  const text = line.trim();
  if (!text) return '';
  try {
    if (isOllama) {
      const json = JSON.parse(text) as { message?: { content?: string }; response?: string };
      return json.message?.content ?? json.response ?? '';
    }
    if (!text.startsWith('data:')) return '';
    const payload = text.slice(5).trim();
    if (!payload || payload === '[DONE]') return '';
    const json = JSON.parse(payload) as {
      choices?: { delta?: { content?: string }; message?: { content?: string } }[];
    };
    return json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? '';
  } catch {
    // 半行 / 心跳注释（`: keep-alive`）忽略
    return '';
  }
}

/**
 * 发送一次对话请求，边收边回调，返回完整文本。
 * 收完整 messages 而不是单条 prompt：多轮展开需要保留对话历史。
 */
export async function streamChatMessages(
  ai: AiConfig,
  apiKey: string,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const { url, model, isOllama } = resolveEndpoint(ai);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!isOllama && apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        stream: true,
        messages,
      }),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      throw new AiError('aborted', 'request aborted', e);
    }
    throw new AiError('network', `cannot reach ${url}`, e);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new AiError('http', `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  if (!res.body) throw new AiError('empty', 'response has no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const emit = (delta: string) => {
    if (!delta) return;
    full += delta;
    opts.onDelta?.(delta);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const { lines, rest } = feedLines(buffer, decoder.decode(value, { stream: true }));
      buffer = rest;
      for (const line of lines) emit(deltaOfLine(line, isOllama));
    }
    // 某些服务最后一行没有换行符
    if (buffer.trim()) emit(deltaOfLine(buffer, isOllama));
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      throw new AiError('aborted', 'stream aborted', e);
    }
    throw new AiError('network', 'stream interrupted', e);
  } finally {
    void reader.cancel().catch(() => undefined);
  }

  if (!full.trim()) throw new AiError('empty', 'model returned no text');
  return full;
}

/** 单轮便捷封装 */
export async function streamChat(
  ai: AiConfig,
  apiKey: string,
  prompt: string,
  opts: ChatOptions = {},
): Promise<string> {
  return streamChatMessages(ai, apiKey, [{ role: 'user', content: prompt }], opts);
}

/**
 * 把上下文包包装成「项目导读」指令。
 * 指令本身用英文（避免 10 语言各维护一份 prompt），只要求输出跟随仓库主语言。
 */
export function buildExplainPrompt(contextMarkdown: string, opts: { expand?: boolean } = {}): string {
  const lines = [
    'You are a senior software architect. Below is a structured context pack of a code repository,',
    'generated by CodeAtlas: file tree, module layers, key symbols, dependencies and reading path.',
    '',
    'Write a project walkthrough in the same language as the repository primary content.',
    'Use this structure:',
    '1. What the project does — 2-3 sentences.',
    '2. Architecture — main modules and their responsibilities.',
    '3. Reading order for a newcomer — 5-8 files, each with one line on why.',
    '4. Risks — only if the data actually shows them (cycles, god files, huge functions).',
    '',
    'Rules: never invent files, symbols or dependencies that are not in the context pack.',
    'Keep it under 600 words. Use Markdown headings and bullet lists.',
  ];

  // 按需展开协议：模型可以索取真实代码，工具会切片后回灌，用户看不到标记行
  if (opts.expand) {
    lines.push(
      '',
      'You can read real code on demand. When the pack is not enough, output a line containing only:',
      '@@expand <address>',
      'Address forms: `path:line`, `path:start-end`, `path#symbol`. Use paths that appear in the pack.',
      'The tool replaces that line with the actual code (with line numbers) and you continue.',
      'That line is invisible to the user — never mention or explain it.',
      'Request at most 3 slices, only when you truly need implementation details.',
    );
  }

  lines.push('', '---', contextMarkdown);
  return lines.join('\n');
}
