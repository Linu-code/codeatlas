/**
 * DragOverlay —— ZIP 拖入视觉反馈
 * 拖入时全屏高亮边框 + 提示文案（i18n），松开后由 App 决定开新窗口还是报错。
 */

import { useTranslation } from 'react-i18next';

interface Props {
  active: boolean;
  /** 拖入内容包含非 ZIP 文件时展示错误态提示 */
  invalid?: boolean;
}

export default function DragOverlay({ active, invalid = false }: Props) {
  const { t } = useTranslation('viewer');
  if (!active) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[100] grid place-items-center"
      style={{ background: 'rgba(27,29,35,0.72)' }}
    >
      <div
        className="rounded-xl border-2 border-dashed px-10 py-8 text-center"
        style={{
          borderColor: invalid ? 'var(--c-error)' : 'var(--c-primary)',
          background: 'var(--c-bg-2)',
          color: invalid ? 'var(--c-error)' : 'var(--c-text)',
        }}
      >
        <p className="text-sm font-semibold">{invalid ? t('dropInvalid') : t('dropHint')}</p>
        {!invalid && (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            .zip
          </p>
        )}
      </div>
    </div>
  );
}
