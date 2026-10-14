/**
 * useFocusTrap —— 对话框可达性辅助
 *
 * 解决三件事（对应可访问性审计要求）：
 *   1. 打开时把焦点移入对话框，落在首个可聚焦元素上；
 *   2. Tab / Shift+Tab 在对话框内循环，不会"逃"到背景按钮；
 *   3. Esc 关闭对话框，关闭后焦点归还到打开前的元素。
 *
 * 用法：把返回的 ref 挂到遮罩层（需带 tabIndex={-1}），open/onClose 由调用方控制。
 */

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),' +
  'select:not([disabled]),textarea:not([disabled]),iframe,object,embed,' +
  '[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose?: () => void,
): void {
  // 用 ref 持有最新 onClose，避免 effect 因函数 identity 变化而反复重跑（导致反复抢焦点）
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || !ref.current) return;
    const container = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
      );

    // 初始聚焦：首个可聚焦元素，没有则聚焦容器本身
    const focusables = getFocusable();
    (focusables[0] ?? container).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = getFocusable();
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // 关闭后把焦点归还给打开前聚焦的元素
      previouslyFocused?.focus?.();
    };
  }, [ref, open]);
}
