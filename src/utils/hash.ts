/**
 * hash.ts —— 内容哈希（增量分析的指纹）
 *
 * 用于「文件内容 → 短指纹」：指纹一致即认为内容未变，可安全复用缓存的分析结果。
 *
 * 实现说明：
 *   · 采用 FNV-1a（64 位折叠到 32 位）—— 纯位运算、零依赖、确定性强，
 *     与 crypto.subtle（异步、需 secure context）相比在 Node 单测与 WebWorker 中都无需特判。
 *   · 我们不依赖密码学强度：指纹只用于「内容是否变化」的快速判断，
 *     碰撞概率在 2^32 量级，配合文件级缓存粒度（每个文件独立判断）完全够用。
 *   · 对 1 MB 上限的单文件，FNV-1a 约在微秒级完成，可安全地逐个文件计算。
 */

/** FNV-1a 32 位哈希，输出 8 位十六进制字符串（确定性，跨环境一致） */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 别名：语义化入口名（后续若换更强的哈希实现，调用方无需改动） */
export function hashText(text: string): string {
  return fnv1a(text);
}
