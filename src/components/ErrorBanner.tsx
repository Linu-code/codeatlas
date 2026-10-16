/**
 * ErrorBanner —— 顶部错误横幅
 *
 * 全局启动器错误（搜索失败）与单个项目加载错误共用同一形态，抽成组件避免重复。
 * 用 role="alert" 让屏幕阅读器即时播报。
 */

import { useTranslation } from 'react-i18next';
import type { RepoError } from '../types/repo';

interface Props {
  error: RepoError;
  onClose: () => void;
}

export default function ErrorBanner({ error, onClose }: Props) {
  const { t } = useTranslation(['common', 'errors']);
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-xs"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)', color: 'var(--c-error)' }}
    >
      <span>
        <strong className="me-2">{t('errors:title')}:</strong>
        {t(`errors:${error.code}`)}
      </span>
      <button onClick={onClose} className="rounded px-2 py-1" style={{ color: 'var(--c-text-2)' }}>
        {t('common:close')}
      </button>
    </div>
  );
}
