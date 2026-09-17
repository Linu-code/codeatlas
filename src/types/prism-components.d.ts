/**
 * Prism 语言包模块声明
 *
 * @types/prismjs 只为少数语言包提供了类型声明，其余（prism-go / prism-rust 等）
 * 在 TS 下会报 TS7016。语言包本身是自注册的副作用模块（import 即生效），
 * 无需类型信息，因此这里用通配符统一声明。
 */
declare module 'prismjs/components/*';
