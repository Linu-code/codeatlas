/**
 * WelcomeScreen —— 初始空状态
 * 三种输入方式的引导，全部文案走 i18n。
 */

import { useTranslation } from 'react-i18next';

export default function WelcomeScreen() {
  const { t } = useTranslation('viewer');
  return (
    <div className="grid h-full place-items-center px-8" style={{ background: 'var(--c-bg)' }}>
      <div className="max-w-md text-center">
        <div
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-xl text-xl font-bold text-white"
          style={{ background: 'var(--c-primary)' }}
        >
          CA
        </div>
        <h2 className="mb-2 text-lg font-semibold">{t('welcomeTitle')}</h2>
        <p className="mb-4 text-xs leading-6" style={{ color: 'var(--c-text-2)' }}>
          {t('welcomeHint')}
        </p>
        <p className="text-xs leading-6" style={{ color: 'var(--c-text-2)' }}>
          {t('welcomeZipHint')}
        </p>
      </div>
    </div>
  );
}
