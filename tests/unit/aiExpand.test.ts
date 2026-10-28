import { describe, expect, it } from 'vitest';
import { ExpandMarkerFilter, runExpandingChat } from '../../src/utils/aiExpand';
import { buildExplainPrompt, type ChatMessage } from '../../src/utils/aiClient';
import type { SliceOutcome } from '../../src/analysis/slice';

/** 假 chat：按脚本逐轮返回，可选把每轮文本拆成多块喂给 onDelta */
function scriptedChat(rounds: string[], chunkSize = 7) {
  const calls: ChatMessage[][] = [];
  const chat = async (messages: ChatMessage[], h: { onDelta: (d: string) => void }) => {
    calls.push(messages.map((m) => ({ ...m })));
    const text = rounds[Math.min(calls.length - 1, rounds.length - 1)] ?? '';
    for (let i = 0; i < text.length; i += chunkSize) h.onDelta(text.slice(i, i + chunkSize));
    return text;
  };
  return { chat, calls };
}

const okSlice = (text = '  5 | const x = 1'): SliceOutcome => ({ kind: 'ok', text, tokens: 42, truncated: false });

describe('ExpandMarkerFilter', () => {
  it('剔除标记行，正文原样放行', () => {
    const f = new ExpandMarkerFilter();
    const visible = f.push('第一段\n@@expand src/a.ts:10\n第二段\n');
    expect(visible).toBe('第一段\n第二段\n');
    expect(f.markers).toEqual(['src/a.ts:10']);
  });

  it('标记被拆在多个 chunk 里也能识别', () => {
    const f = new ExpandMarkerFilter();
    let visible = '';
    for (const chunk of ['看这里\n@@exp', 'and src/a.ts:1', '0-20\n继续']) visible += f.push(chunk);
    visible += f.flush();
    expect(f.markers).toEqual(['src/a.ts:10-20']);
    expect(visible).toBe('看这里\n继续');
  });

  it('容忍反引号与前后空白', () => {
    const f = new ExpandMarkerFilter();
    expect(f.push('  `@@expand  src/b.ts#build`  \n')).toBe('');
    expect(f.markers).toEqual(['src/b.ts#build']);
  });

  it('行内提及（不是独立行）保留原样', () => {
    const f = new ExpandMarkerFilter();
    expect(f.push('比如可以写 @@expand src/a.ts:1 这样的行\n')).toContain('比如可以写');
    expect(f.markers).toEqual([]);
  });
});

describe('runExpandingChat', () => {
  it('没有标记时只调用一次，正文原样返回', async () => {
    const { chat, calls } = scriptedChat(['这是一个项目。\n']);
    const out: string[] = [];
    const r = await runExpandingChat({
      messages: [{ role: 'user', content: 'p' }],
      chat,
      resolve: async () => okSlice(),
      onDelta: (d) => out.push(d),
    });
    expect(calls).toHaveLength(1);
    expect(r.rounds).toEqual([]);
    expect(out.join('')).toBe('这是一个项目。\n');
  });

  it('捕获标记 → 切片 → 回灌，第二轮继续', async () => {
    const { chat, calls } = scriptedChat(['先看入口。\n@@expand src/core.ts:5\n', '完成了。\n'], 3);
    const resolved: string[] = [];
    const r = await runExpandingChat({
      messages: [{ role: 'user', content: 'p' }],
      chat,
      resolve: async (addr) => {
        resolved.push(addr);
        return okSlice();
      },
      onDelta: () => undefined,
    });

    expect(calls).toHaveLength(2);
    expect(resolved).toEqual(['src/core.ts:5']);
    // 用户看到的正文里没有标记
    expect(r.text).toBe('先看入口。\n完成了。\n');
    expect(r.rounds).toEqual([{ address: 'src/core.ts:5', ok: true, tokens: 42, reason: undefined }]);
    // 第二轮请求里带上了切片内容
    const second = calls[1];
    expect(second[second.length - 1].content).toContain('const x = 1');
    expect(second.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('同一地址重复请求只展开一次', async () => {
    const { chat, calls } = scriptedChat([
      '@@expand src/core.ts:5\n',
      '@@expand src/core.ts:5\n再要一次同样的\n',
    ]);
    const r = await runExpandingChat({
      messages: [{ role: 'user', content: 'p' }],
      chat,
      resolve: async () => okSlice(),
      onDelta: () => undefined,
    });
    expect(r.rounds).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('地址取不到时记录失败并告知模型，不无限重试', async () => {
    const { chat, calls } = scriptedChat(['@@expand nope.ts:1\n', '好吧。\n']);
    const r = await runExpandingChat({
      messages: [{ role: 'user', content: 'p' }],
      chat,
      resolve: async () => ({ kind: 'invalid', reason: 'not-found' }),
      onDelta: () => undefined,
    });
    expect(r.rounds).toEqual([{ address: 'nope.ts:1', ok: false, tokens: 0, reason: 'not-found' }]);
    expect(calls).toHaveLength(2);
    expect(calls[1][calls[1].length - 1].content).toContain('unavailable');
  });

  it('resolve 抛错也不会中断整轮对话', async () => {
    const { chat } = scriptedChat(['@@expand src/a.ts:1\n', '继续。\n']);
    const r = await runExpandingChat({
      messages: [{ role: 'user', content: 'p' }],
      chat,
      resolve: async () => {
        throw new Error('boom');
      },
      onDelta: () => undefined,
    });
    expect(r.rounds[0]).toMatchObject({ ok: false, reason: 'read-failed' });
    expect(r.text).toContain('继续');
  });

  it('maxRounds 封顶（最多 3 次展开）', async () => {
    const script = Array.from({ length: 6 }, (_, i) => `@@expand src/f${i}.ts:1\n`);
    const { chat, calls } = scriptedChat(script);
    const r = await runExpandingChat({
      messages: [{ role: 'user', content: 'p' }],
      chat,
      resolve: async () => okSlice(),
      onDelta: () => undefined,
    });
    expect(r.rounds).toHaveLength(3);
    expect(calls).toHaveLength(4);
  });
});

describe('buildExplainPrompt（展开协议）', () => {
  it('开启 expand 时写入协议，关闭时不出现', () => {
    expect(buildExplainPrompt('PACK', { expand: true })).toContain('@@expand');
    expect(buildExplainPrompt('PACK')).not.toContain('@@expand');
  });

  it('协议要求标记对用户不可见，并限制轮数', () => {
    const p = buildExplainPrompt('PACK', { expand: true });
    expect(p).toContain('invisible to the user');
    expect(p).toContain('at most 3 slices');
  });
});
