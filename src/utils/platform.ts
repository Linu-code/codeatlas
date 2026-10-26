/**
 * platform.ts —— 平台判断与**展示层**适配
 *
 * 为什么只改展示层：现有快捷键处理器已经同时接受 `ctrlKey || metaKey`
 * （Windows / Linux 用 Ctrl，macOS 用 Cmd），按键行为本来就跨平台；
 * 真正不跨平台的是**提示文案**——语言包里硬写了「Ctrl+K」。
 *
 * 文案替换而不是改 10 个语言包：德语用的是「Strg」，其它 9 种用「Ctrl」，
 * 一条正则两种都能覆盖，且不会让 10 个语言包再膨胀一轮占位符。
 */

/** 是否 macOS（WKWebView 里 navigator.platform 仍可用，UA 兜底） */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac/i.test(platform) || /Macintosh/i.test(nav.userAgent ?? '');
}

/**
 * 把提示文案里的 Ctrl / Strg 换成 macOS 的 ⌘。
 * @param mac 仅供测试注入；默认按当前平台判断
 */
export function platformizeShortcut(text: string, mac: boolean = isMac()): string {
  return mac ? text.replace(/\b(?:Ctrl|Strg)\b/g, '⌘') : text;
}

/**
 * 键盘事件的"修饰键"是否按下。
 *
 * macOS 用 ⌘，Windows / Linux 用 Ctrl —— 比 `ctrlKey || metaKey` 更符合平台习惯：
 * 后者会让 macOS 的 Ctrl+K、Windows 的 Win 键也触发快捷键。
 */
export function isModPressed(
  e: { ctrlKey: boolean; metaKey: boolean },
  mac: boolean = isMac(),
): boolean {
  return mac ? e.metaKey : e.ctrlKey;
}
