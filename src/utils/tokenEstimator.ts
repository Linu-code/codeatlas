/**
 * tokenEstimator.ts —— token 数估算
 *
 * 为什么不用真正的 BPE 分词器：本项目禁止任何模型/网络依赖，
 * 而估算只需要"足够准的相对量级"来控制预算，因此采用经验公式：
 *   英文/代码：≈ 4 字符 / token
 *   CJK 汉字/假名：≈ 1.5 字符 / token（更"贵"）
 *
 * 该估算与主流 BPE 分词器在代码文本上的偏差通常在 ±15% 以内，
 * 对"二分裁剪到预算内"这一用途足够（另有 5% 安全余量）。
 */

/** 单个字符串的 token 估算 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (isCJK(code)) cjk++;
    else other++;
  }
  return Math.ceil(other / 4 + cjk / 1.5);
}

function isCJK(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一汉字
    (code >= 0x3040 && code <= 0x30ff) || // 平假名 / 片假名
    (code >= 0xac00 && code <= 0xd7af) || // 谚文
    (code >= 0x3000 && code <= 0x303f)    // CJK 标点
  );
}

/** 预算校验：留 5% 安全余量，防止估算偏差导致超限 */
export function fitsBudget(text: string, budget: number): boolean {
  return estimateTokens(text) <= budget * 0.95;
}
