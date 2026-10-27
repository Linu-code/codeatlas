import { describe, expect, it, vi } from 'vitest';
import { AiError, buildExplainPrompt, resolveEndpoint, streamChat } from '../../src/utils/aiClient';
import type { AiConfig } from '../../src/types/config';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

function fakeFetch(chunks: string[], init: ResponseInit = { status: 200 }) {
  return vi.fn(async () => new Response(streamOf(chunks), init));
}

const ollama: AiConfig = { provider: 'ollama', baseUrl: '', model: '' };
const openai: AiConfig = { provider: 'openai', baseUrl: '', model: '' };

describe('resolveEndpoint', () => {
  it('留空时用提供方默认值', () => {
    expect(resolveEndpoint(ollama)).toEqual({
      url: 'http://127.0.0.1:11434/api/chat',
      model: 'qwen2.5-coder',
      isOllama: true,
    });
    expect(resolveEndpoint(openai)).toEqual({
      url: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      isOllama: false,
    });
  });

  it('自定义地址去掉尾部斜杠', () => {
    const r = resolveEndpoint({ provider: 'openai', baseUrl: 'https://api.deepseek.com/v1/', model: 'deepseek-chat' });
    expect(r.url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(r.model).toBe('deepseek-chat');
  });

  it('provider 为 off 直接拒绝', () => {
    expect(() => resolveEndpoint({ provider: 'off', baseUrl: '', model: '' })).toThrow(AiError);
  });

  it('非 http(s) 协议被拒绝', () => {
    expect(() => resolveEndpoint({ provider: 'openai', baseUrl: 'file:///etc/passwd', model: 'x' })).toThrow(
      /unsupported protocol/,
    );
    expect(() => resolveEndpoint({ provider: 'ollama', baseUrl: 'not-a-url', model: 'x' })).toThrow(
      /invalid base url/,
    );
  });
});

describe('streamChat —— ollama NDJSON', () => {
  it('跨 chunk 拼出完整文本', async () => {
    const deltas: string[] = [];
    const fetchImpl = fakeFetch([
      '{"message":{"content":"Hello"}}\n{"message":{"content":" wo',
      'rld"}}\n{"done":true}\n',
    ]);

    const text = await streamChat(ollama, '', 'prompt', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: (d) => deltas.push(d),
    });

    expect(text).toBe('Hello world');
    expect(deltas).toEqual(['Hello', ' world']);
  });

  it('发送 stream=true 且不带 Authorization（本地模型不需要 key）', async () => {
    const fetchImpl = fakeFetch(['{"message":{"content":"x"}}\n']);
    await streamChat(ollama, 'ignored-key', 'p', { fetchImpl: fetchImpl as unknown as typeof fetch });

    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('http://127.0.0.1:11434/api/chat');
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(call[1].body))).toMatchObject({ stream: true, model: 'qwen2.5-coder' });
  });
});

describe('streamChat —— openai SSE', () => {
  it('解析 data: 行并忽略 [DONE] 与心跳', async () => {
    const fetchImpl = fakeFetch([
      ': keep-alive\n\ndata: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: {"choi',
      'ces":[{"delta":{"content":"B"}}]}\n\ndata: [DONE]\n\n',
    ]);

    const text = await streamChat(openai, 'sk-test', 'p', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(text).toBe('AB');
  });

  it('带 Authorization 头', async () => {
    const fetchImpl = fakeFetch(['data: {"choices":[{"delta":{"content":"x"}}]}\n']);
    await streamChat(openai, 'sk-abc', 'p', { fetchImpl: fetchImpl as unknown as typeof fetch });

    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer sk-abc');
    expect(call[0]).toBe('https://api.openai.com/v1/chat/completions');
  });
});

describe('streamChat —— 错误分类', () => {
  it('非 2xx 归为 http 并带响应片段', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 }));
    await expect(
      streamChat(openai, 'bad', 'p', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'http' });
  });

  it('连接失败归为 network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      streamChat(ollama, '', 'p', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('流为空文本归为 empty', async () => {
    const fetchImpl = fakeFetch(['{"done":true}\n']);
    await expect(
      streamChat(ollama, '', 'p', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'empty' });
  });

  it('用户取消归为 aborted', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('{"message":{"content":"a"}}\n'));
              init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
            },
          }),
        ),
    );

    const p = streamChat(ollama, '', 'p', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
    });
    controller.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('buildExplainPrompt', () => {
  it('包含上下文包并要求不臆造', () => {
    const prompt = buildExplainPrompt('# Tree\n- src/index.ts');
    expect(prompt).toContain('# Tree');
    expect(prompt).toContain('- src/index.ts');
    expect(prompt.toLowerCase()).toContain('never invent');
  });
});
