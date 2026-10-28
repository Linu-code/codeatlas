/**
 * aiExpand.ts —— 「AI 自己索取代码」的多轮循环。
 *
 * 索引包只给地址，模型想知道实现时输出一行 `@@expand 路径:行号`；
 * 这里捕获该标记 → 本地切片 → 作为新一轮输入回灌，模型接着写。
 * 用户看到的是干净的正文（标记行被过滤掉），外加「已展开 N 处」。
 *
 * 三条硬约束：
 *   1. **只走本地**：切片来自已分析文件，不新增任何网络请求，也不额外调用模型
 *      （除了模型自己多轮，轮数由 maxRounds 封顶）；
 *   2. **标记必须对用户不可见**：按行缓冲过滤，跨 chunk 拆开的标记也能识别；
 *   3. **地址取不到就不再重试**：记一轮失败并告知模型，避免死循环。
 */

import type { ChatMessage } from './aiClient';
import type { SliceOutcome } from '../analysis/slice';

/** 标记行的正则：允许前后空白与 Markdown 反引号 */
const MARKER_RE = /^\s*`{0,3}@@expand\s+([^\s`]+)`{0,3}\s*$/;

/**
 * 流式过滤器：把 `@@expand ...` 行吃掉，其余原样放行。
 *
 * 按行处理是关键——标记可能被拆在多个 chunk 里（`"@@exp"` + `"and src/a.ts:1\n"`），
 * 逐 chunk 做字符串替换会漏。
 */
export class ExpandMarkerFilter {
  private buffer = '';
  private found: string[] = [];

  /** 已识别到的地址（按出现顺序，可重复） */
  get markers(): string[] {
    return this.found;
  }

  push(chunk: string): string {
    this.buffer += chunk;
    let out = '';
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl === -1) break;
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const kept = this.consumeLine(line);
      if (kept !== null) out += `${kept}\n`;
    }
    return out;
  }

  /** 流结束时吐出残留（没有换行结尾的最后一行） */
  flush(): string {
    if (!this.buffer) return '';
    const rest = this.buffer;
    this.buffer = '';
    const kept = this.consumeLine(rest);
    return kept === null ? '' : kept;
  }

  private consumeLine(line: string): string | null {
    const m = MARKER_RE.exec(line);
    if (m) {
      this.found.push(m[1]);
      return null;
    }
    return line;
  }
}

export interface ExpandRound {
  address: string;
  ok: boolean;
  /** 切片 token 数（失败为 0） */
  tokens: number;
  reason?: string;
}

export interface ExpandingChatResult {
  /** 用户可见的正文（已剔除标记行） */
  text: string;
  rounds: ExpandRound[];
}

export interface ExpandingChatOptions {
  messages: ChatMessage[];
  /** 单轮对话（注入以便测试） */
  chat: (
    messages: ChatMessage[],
    handlers: { onDelta: (delta: string) => void; signal?: AbortSignal },
  ) => Promise<string>;
  resolve: (address: string) => Promise<SliceOutcome>;
  /** 最多展开几次（默认 3） */
  maxRounds?: number;
  onDelta: (text: string) => void;
  onRound?: (round: ExpandRound) => void;
  signal?: AbortSignal;
}

/** 把切片结果包装成下一轮的用户消息 */
function sliceMessage(address: string, slice: SliceOutcome): string {
  if (slice.kind !== 'ok') {
    return `Slice ${address} is unavailable (${slice.kind}). Continue without it and do not request it again.`;
  }
  return [
    `Code slice ${address}:`,
    '```',
    slice.text,
    '```',
    'Continue the walkthrough. Request another slice only if you still need implementation details.',
  ].join('\n');
}

/**
 * 跑完「回答 → 索取 → 切片 → 继续」的循环，返回拼接后的正文。
 * 模型没给标记时只调用一次，行为与单轮完全一致。
 */
export async function runExpandingChat(opts: ExpandingChatOptions): Promise<ExpandingChatResult> {
  const maxRounds = opts.maxRounds ?? 3;
  const messages: ChatMessage[] = [...opts.messages];
  const rounds: ExpandRound[] = [];
  const requested = new Set<string>();
  let text = '';

  for (let round = 0; ; round += 1) {
    const filter = new ExpandMarkerFilter();
    const raw = await opts.chat(messages, {
      signal: opts.signal,
      onDelta: (delta) => {
        const visible = filter.push(delta);
        if (!visible) return;
        text += visible;
        opts.onDelta(visible);
      },
    });
    const tail = filter.flush();
    if (tail) {
      text += tail;
      opts.onDelta(tail);
    }

    // 同一个地址只取一次：模型重复输出时不再浪费一次往返
    const address = filter.markers.find((a) => !requested.has(a));
    if (!address || round >= maxRounds) return { text, rounds };

    requested.add(address);
    let slice: SliceOutcome;
    try {
      slice = await opts.resolve(address);
    } catch {
      slice = { kind: 'invalid', reason: 'read-failed' };
    }

    const info: ExpandRound = {
      address,
      ok: slice.kind === 'ok',
      tokens: slice.kind === 'ok' ? slice.tokens : 0,
      // 失败原因要具体（not-found / read-failed / ambiguous），否则日志无法定位
      reason:
        slice.kind === 'ok'
          ? undefined
          : slice.kind === 'invalid'
            ? slice.reason
            : 'ambiguous',
    };
    rounds.push(info);
    opts.onRound?.(info);

    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: sliceMessage(address, slice) });
  }
}
