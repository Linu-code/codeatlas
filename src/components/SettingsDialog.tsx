/**
 * SettingsDialog —— 设置页
 *
 * 内容（对应提示词"可手动切换语言、主题、清除缓存"）：
 *   · 语言 / 主题（与顶栏切换器共享同一状态）
 *   · GitHub Token（可选，仅提高限流；存 localStorage，不写配置文件）
 *   · AI 上下文包 token 预算（M6 使用）
 *   · jsDelivr 兜底开关（默认关，满足"仅 GitHub 域"约束）
 *   · 缓存用量 + 清除缓存
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfig, Language, ThemeId } from '../types/config';
import { LANGUAGES, saveLanguage } from '../i18n';
import { THEME_OPTIONS, applyTheme, saveTheme } from '../theme/themes';
import { cacheStats, clearAllCache } from '../sources/cache';
import { loadToken, saveToken } from '../utils/configStore';

interface Props {
  open: boolean;
  onClose: () => void;
  config: AppConfig;
  onConfigChange: (patch: Partial<AppConfig>) => void;
}

export default function SettingsDialog({ open, onClose, config, onConfigChange }: Props) {
  const { t, i18n } = useTranslation(['common']);
  const [token, setToken] = useState('');
  const [stats, setStats] = useState({ trees: 0, files: 0 });
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (!open) return;
    setToken(loadToken());
    setCleared(false);
    void cacheStats().then(setStats);
  }, [open]);

  const changeLanguage = useCallback(
    (lang: Language) => {
      saveLanguage(lang);
      void i18n.changeLanguage(lang);
      onConfigChange({ language: lang });
    },
    [i18n, onConfigChange],
  );

  const changeTheme = useCallback(
    (theme: ThemeId) => {
      applyTheme(theme);
      saveTheme(theme);
      onConfigChange({ theme });
    },
    [onConfigChange],
  );

  const handleClearCache = useCallback(async () => {
    await clearAllCache();
    setStats(await cacheStats());
    setCleared(true);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={t('settingsTitle')}
    >
      <div
        className="w-[520px] max-w-[92vw] rounded-lg border p-5 text-xs shadow-2xl"
        style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold">{t('settingsTitle')}</h2>

        {/* 语言 */}
        <label className="mb-3 flex items-center justify-between gap-4">
          <span style={{ color: 'var(--c-text-2)' }}>{t('language')}</span>
          <select
            value={config.language}
            onChange={(e) => changeLanguage(e.target.value as Language)}
            className="h-7 rounded border px-2"
            style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {t(`lang${l === 'zh' ? 'Zh' : l === 'en' ? 'En' : 'Ja'}`)}
              </option>
            ))}
          </select>
        </label>

        {/* 主题 */}
        <label className="mb-3 flex items-center justify-between gap-4">
          <span style={{ color: 'var(--c-text-2)' }}>{t('theme')}</span>
          <select
            value={config.theme}
            onChange={(e) => changeTheme(e.target.value as ThemeId)}
            className="h-7 rounded border px-2"
            style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
          >
            {THEME_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {t(o.labelKey.replace('common.', ''))}
              </option>
            ))}
          </select>
        </label>

        {/* Token */}
        <div className="mb-3">
          <label className="mb-1 block" style={{ color: 'var(--c-text-2)' }}>
            {t('githubToken')}
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_..."
            className="h-7 w-full rounded border px-2 font-mono"
            style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
          />
          <p className="mt-1 text-[10px] leading-4" style={{ color: 'var(--c-text-2)' }}>
            {t('githubTokenHint')}
          </p>
        </div>

        {/* token 预算 */}
        <label className="mb-3 flex items-center justify-between gap-4">
          <span style={{ color: 'var(--c-text-2)' }}>{t('maxTokens')}</span>
          <input
            type="number"
            min={200}
            max={100000}
            step={100}
            value={config.maxTokens}
            onChange={(e) => onConfigChange({ maxTokens: Number(e.target.value) || config.maxTokens })}
            className="h-7 w-28 rounded border px-2"
            style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
          />
        </label>

        {/* jsDelivr 兜底 */}
        <label className="mb-4 flex items-start gap-2">
          <input
            type="checkbox"
            checked={config.jsdelivrFallback}
            onChange={(e) => onConfigChange({ jsdelivrFallback: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="block">{t('jsdelivrFallback')}</span>
            <span className="block text-[10px] leading-4" style={{ color: 'var(--c-text-2)' }}>
              {t('jsdelivrFallbackHint')}
            </span>
          </span>
        </label>

        {/* 缓存 */}
        <div
          className="mb-4 flex items-center justify-between gap-3 rounded border px-3 py-2"
          style={{ borderColor: 'var(--c-border)' }}
        >
          <span style={{ color: 'var(--c-text-2)' }}>
            {t('cacheUsage', { trees: stats.trees, files: stats.files })}
            {cleared && <span style={{ color: 'var(--c-success)' }}> · {t('cacheCleared')}</span>}
          </span>
          <button
            onClick={() => void handleClearCache()}
            className="rounded border px-2 py-1"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {t('clearCache')}
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border px-3 py-1"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {t('close')}
          </button>
          <button
            onClick={() => {
              saveToken(token.trim());
              onClose();
            }}
            className="rounded px-3 py-1 text-white"
            style={{ background: 'var(--c-primary)' }}
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
