import { describe, expect, it } from 'vitest';
import { buildExplainPrompt } from '../../src/utils/aiClient';
import { normalizeConfig } from '../../src/utils/configStore';
import { DEFAULT_CONFIG, AI_TIERS, tierLimits, type AiConfig } from '../../src/types/config';

const pack = '# repo\n\n## 项目概览\n- 文件：3 个';

describe('buildExplainPrompt 档位', () => {
  it('默认走完整版：600 字上限、最多 3 次切片', () => {
    const p = buildExplainPrompt(pack, { expand: true });
    expect(p).toContain('under 600 words');
    expect(p).toContain('at most 3 slices');
    expect(p).toContain('path#symbol');
  });

  it('精简版：400 字、最多 2 次切片、地址说明更短', () => {
    const p = buildExplainPrompt(pack, { expand: true, brief: true });
    expect(p).toContain('under 400 words');
    expect(p).toContain('at most 2 slices');
    expect(p).not.toContain('at most 3 slices');
    // 小模型指令要短：精简版不再罗列全部地址形态
    expect(p).not.toContain('path#symbol');
    expect(p).toContain('path:line');
  });

  it('两档都把上下文包放在最后，且带分隔线', () => {
    for (const brief of [false, true]) {
      const p = buildExplainPrompt(pack, { expand: false, brief });
      expect(p.trimEnd().endsWith(pack)).toBe(true);
      expect(p).toContain('---');
    }
  });
});

describe('tierLimits', () => {
  it('三档的预算单调递增，小档最保守', () => {
    const small = tierLimits({ tier: 'small' } as AiConfig);
    const medium = tierLimits({ tier: 'medium' } as AiConfig);
    const large = tierLimits({ tier: 'large' } as AiConfig);
    expect(small.sliceBudget).toBeLessThan(medium.sliceBudget);
    expect(small.maxRounds).toBeLessThanOrEqual(medium.maxRounds);
    expect(small.brief).toBe(true);
    expect(medium.brief).toBe(false);
    // large 的切片预算交给「包的 2 倍」规则，这里用 0 表示
    expect(large.sliceBudget).toBe(0);
  });

  it('旧配置没有 tier 时按小档处理（本地优先）', () => {
    expect(tierLimits({} as AiConfig)).toEqual(tierLimits({ tier: 'small' } as AiConfig));
  });
});

describe('normalizeConfig 的 ai.tier', () => {
  it('缺省填 small，非法值回落', () => {
    expect(normalizeConfig({}).ai.tier).toBe('small');
    expect(normalizeConfig({ ai: { tier: 'huge' } }).ai.tier).toBe('small');
    expect(normalizeConfig({ ai: { tier: 'medium' } }).ai.tier).toBe('medium');
  });

  it('白名单来自 AI_TIERS，新增档位不会漏校验', () => {
    for (const tier of AI_TIERS) {
      expect(normalizeConfig({ ai: { tier } }).ai.tier).toBe(tier);
    }
    expect(DEFAULT_CONFIG.ai.tier).toBe('small');
  });
});
