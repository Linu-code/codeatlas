/**
 * 主题与语言切换控件（顶栏右侧）
 *
 * 主题：light / dark / system / atlas —— 选择立即生效并持久化（M3 起写入配置文件）。
 * 语言：zh / en / ja —— 切换后 i18next 事件触发 <html lang>/<dir> 同步。
 */

import { useTranslation } from 'react-i18next';
import type { ThemeId, Language } from '../types/config';
import { THEME_OPTIONS, applyTheme, saveTheme } from '../theme/themes';
import { LANGUAGES, saveLanguage } from '../i18n';

interface Props {
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
}

const LANG_LABEL_KEY: Record<Language, string> = {
  zh: 'common.langZh',
  en: 'common.langEn',
  ja: 'common.langJa',
};

export default function ThemeLanguageControls({
  theme,
  onThemeChange,
  language,
  onLanguageChange,
}: Props) {
  const { t } = useTranslation('common');

  const changeTheme = (id: ThemeId) => {
    applyTheme(id); // 立即写入 CSS 变量，无需等待 React 重渲染
    saveTheme(id);
    onThemeChange(id);
  };

  const changeLanguage = (lang: Language) => {
    saveLanguage(lang);
    onLanguageChange(lang);
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      <select
        aria-label={t('theme')}
        title={t('theme')}
        value={theme}
        onChange={(e) => changeTheme(e.target.value as ThemeId)}
        className="h-8 rounded border px-2 text-xs"
        style={{ borderColor: 'var(--c-border)', background: 'var(--c-bg)', color: 'var(--c-text)' }}
      >
        {THEME_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {t(opt.labelKey.replace('common.', ''))}
          </option>
        ))}
      </select>

      <select
        aria-label={t('language')}
        title={t('language')}
        value={language}
        onChange={(e) => changeLanguage(e.target.value as Language)}
        className="h-8 rounded border px-2 text-xs"
        style={{ borderColor: 'var(--c-border)', background: 'var(--c-bg)', color: 'var(--c-text)' }}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {t(LANG_LABEL_KEY[lang].replace('common.', ''))}
          </option>
        ))}
      </select>
    </div>
  );
}
