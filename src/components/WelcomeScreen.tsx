/**
 * WelcomeScreen —— 初始空状态
 *
 * 目标：默认界面"零项目"时给一个明确的主操作，而不是只读说明。
 * 打开本地目录属于工作区级操作（会新增项目），统一放在顶栏「⋯」菜单里。
 */

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  onOpenZip: (file: File) => void;
}

export default function WelcomeScreen({ onOpenZip }: Props) {
  const { t } = useTranslation(['viewer', 'common']);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="grid h-full place-items-center px-8" style={{ background: 'var(--c-bg)' }}>
      <div className="max-w-md text-center">
        <div
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-xl text-xl font-bold text-white"
          style={{ background: 'var(--c-primary)' }}
        >
          CA
        </div>
        <h2 className="mb-2 text-lg font-semibold">{t('viewer:welcomeTitle')}</h2>
        <p className="mb-5 text-xs leading-6" style={{ color: 'var(--c-text-2)' }}>
          {t('viewer:welcomeHint')}
        </p>

        <button
          onClick={() => fileRef.current?.click()}
          className="rounded px-4 py-1.5 text-xs text-white"
          style={{ background: 'var(--c-primary)' }}
        >
          {t('common:openZip')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onOpenZip(file);
            e.target.value = '';
          }}
        />

        <p className="mt-4 text-[11px] leading-5" style={{ color: 'var(--c-text-2)' }}>
          {t('viewer:welcomeZipHint')}
        </p>
      </div>
    </div>
  );
}
