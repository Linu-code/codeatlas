/**
 * SettingsDialog —— 设置页
 *
 * 结构：左侧分类（外观 / 分析 / 数据 / 高级）+ 右侧内容。
 * 交互约定：**同一设置项有多个候选项时用下拉框**，不平铺按钮——选项一多就变成一墙色块。
 *
 * 生效方式：主题 / 语言 / token 预算 / jsDelivr 均即时生效并持久化；
 * 只有 GitHub Token 需要点「保存」（避免每敲一个字符就写一次存储）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_DEFAULTS, type AiProvider, type AppConfig, type Language, type ThemeId } from '../types/config';
import { LANGUAGES, saveLanguage } from '../i18n';
import { THEME_OPTIONS, applyTheme, saveTheme } from '../theme/themes';
import { cacheStats, clearAllCache } from '../sources/cache';
import { analysisCacheStats, clearAllAnalysisCache } from '../analysis/analysisCache';
import { loadAiKey, loadToken, saveAiKey, saveToken } from '../utils/configStore';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface Props {
  open: boolean;
  onClose: () => void;
  config: AppConfig;
  onConfigChange: (patch: Partial<AppConfig>) => void;
}

type Section = 'appearance' | 'analysis' | 'ai' | 'data' | 'advanced';

const SECTIONS: { id: Section; labelKey: string }[] = [
  { id: 'appearance', labelKey: 'navAppearance' },
  { id: 'analysis', labelKey: 'analysisSection' },
  { id: 'ai', labelKey: 'aiSection' },
  { id: 'data', labelKey: 'navData' },
  { id: 'advanced', labelKey: 'navAdvanced' },
];

/** 语言 → 文案键（新增语言时此处会被 Record<Language,…> 强制补齐） */
const LANG_LABEL_KEY: Record<Language, string> = {
  zh: 'langZh',
  'zh-TW': 'langZhTw',
  en: 'langEn',
  ja: 'langJa',
  ko: 'langKo',
  es: 'langEs',
  fr: 'langFr',
  de: 'langDe',
  pt: 'langPt',
  ru: 'langRu',
};

const fieldStyle = {
  background: 'var(--c-bg)',
  borderColor: 'var(--c-border)',
  color: 'var(--c-text)',
};

const selectClass = 'h-8 w-[184px] rounded border px-2 text-xs';

/** 一行设置：左侧标签，右侧控件 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <span style={{ color: 'var(--c-text-2)' }}>{label}</span>
      {children}
    </div>
  );
}

export default function SettingsDialog({ open, onClose, config, onConfigChange }: Props) {
  const { t, i18n } = useTranslation(['common']);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open, onClose);

  const [section, setSection] = useState<Section>('appearance');
  const [token, setToken] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);
  const [aiKey, setAiKey] = useState('');
  const [aiKeySaved, setAiKeySaved] = useState(false);
  const [stats, setStats] = useState({ trees: 0, files: 0, analysis: 0 });
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (!open) return;
    setToken(loadToken());
    setTokenSaved(false);
    setAiKey(loadAiKey());
    setAiKeySaved(false);
    setCleared(false);
    void (async () => {
      const s = await cacheStats();
      setStats({ ...s, analysis: await analysisCacheStats() });
    })();
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
    await clearAllAnalysisCache();
    const s = await cacheStats();
    setStats({ ...s, analysis: await analysisCacheStats() });
    setCleared(true);
  }, []);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={t('settingsTitle')}
    >
      <div
        className="flex h-[520px] w-[720px] max-h-[86vh] max-w-[94vw] overflow-hidden rounded-lg border text-xs shadow-2xl"
        style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左侧分类 */}
        <nav
          className="w-[152px] shrink-0 border-e p-2"
          style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)' }}
        >
          <h2 className="px-2 pb-2 pt-1 text-sm font-semibold">{t('settingsTitle')}</h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id}
              className="mb-0.5 block w-full rounded px-2 py-1.5 text-start"
              style={{
                background: section === s.id ? 'var(--c-bg-3)' : 'transparent',
                color: section === s.id ? 'var(--c-primary)' : 'var(--c-text)',
              }}
            >
              {t(s.labelKey)}
            </button>
          ))}
        </nav>

        {/* 右侧内容 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {section === 'appearance' && (
              <>
                <Row label={t('theme')}>
                  <select
                    data-theme-select
                    aria-label={t('theme')}
                    value={config.theme}
                    onChange={(e) => changeTheme(e.target.value as ThemeId)}
                    className={selectClass}
                    style={fieldStyle}
                  >
                    {THEME_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {t(o.labelKey.replace('common.', ''))}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row label={t('language')}>
                  <select
                    data-language-select
                    aria-label={t('language')}
                    value={config.language}
                    onChange={(e) => changeLanguage(e.target.value as Language)}
                    className={selectClass}
                    style={fieldStyle}
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang} value={lang}>
                        {t(LANG_LABEL_KEY[lang])}
                      </option>
                    ))}
                  </select>
                </Row>
              </>
            )}

            {section === 'analysis' && (
              <>
                <h3 className="mb-1 text-[13px] font-semibold">{t('maxTokens')}</h3>
                <p className="mb-3 text-[11px] leading-5" style={{ color: 'var(--c-text-2)' }}>
                  {t('maxTokensHint')}
                </p>
                <input
                  type="number"
                  min={200}
                  max={100000}
                  step={100}
                  value={config.maxTokens}
                  onChange={(e) =>
                    onConfigChange({ maxTokens: Number(e.target.value) || config.maxTokens })
                  }
                  className="h-8 w-32 rounded border px-2 font-mono"
                  style={fieldStyle}
                />
              </>
            )}

            {section === 'ai' && (
              <>
                <Row label={t('aiProvider')}>
                  <select
                    data-ai-provider
                    value={config.ai.provider}
                    onChange={(e) =>
                      onConfigChange({ ai: { ...config.ai, provider: e.target.value as AiProvider } })
                    }
                    className={selectClass}
                    style={fieldStyle}
                  >
                    <option value="off">{t('aiProviderOff')}</option>
                    <option value="ollama">{t('aiProviderOllama')}</option>
                    <option value="openai">{t('aiProviderOpenai')}</option>
                  </select>
                </Row>

                {config.ai.provider === 'off' ? (
                  <p className="text-[11px] leading-5" style={{ color: 'var(--c-text-2)' }}>
                    {t('aiOffHint')}
                  </p>
                ) : (
                  <>
                    <Row label={t('aiBaseUrl')}>
                      <input
                        data-ai-base-url
                        value={config.ai.baseUrl}
                        onChange={(e) => onConfigChange({ ai: { ...config.ai, baseUrl: e.target.value } })}
                        placeholder={AI_DEFAULTS[config.ai.provider].baseUrl}
                        className="h-8 w-[300px] rounded border px-2 font-mono text-xs"
                        style={fieldStyle}
                      />
                    </Row>
                    <Row label={t('aiModel')}>
                      <input
                        data-ai-model
                        value={config.ai.model}
                        onChange={(e) => onConfigChange({ ai: { ...config.ai, model: e.target.value } })}
                        placeholder={AI_DEFAULTS[config.ai.provider].model}
                        className="h-8 w-[300px] rounded border px-2 font-mono text-xs"
                        style={fieldStyle}
                      />
                    </Row>

                    {config.ai.provider === 'openai' && (
                      <>
                        <h3 className="mb-1 text-[13px] font-semibold">{t('aiApiKey')}</h3>
                        <div className="mb-4 flex items-center gap-2">
                          <input
                            data-ai-key
                            type="password"
                            value={aiKey}
                            onChange={(e) => {
                              setAiKey(e.target.value);
                              setAiKeySaved(false);
                            }}
                            placeholder="sk-..."
                            className="h-8 min-w-0 flex-1 rounded border px-2 font-mono"
                            style={fieldStyle}
                          />
                          <button
                            onClick={() => {
                              saveAiKey(aiKey.trim());
                              setAiKeySaved(true);
                            }}
                            className="rounded px-3 py-1.5 text-white"
                            style={{ background: 'var(--c-primary)' }}
                          >
                            {aiKeySaved ? t('saved') : t('save')}
                          </button>
                        </div>
                      </>
                    )}

                    <p className="text-[11px] leading-5" style={{ color: 'var(--c-text-2)' }}>
                      {t('aiPrivacy')}
                    </p>
                  </>
                )}
              </>
            )}

            {section === 'data' && (
              <>
                <h3 className="mb-1 text-[13px] font-semibold">{t('githubToken')}</h3>
                <div className="mb-1 flex items-center gap-2">
                  <input
                    data-testid="github-token"
                    type="password"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      setTokenSaved(false);
                    }}
                    placeholder="ghp_..."
                    className="h-8 min-w-0 flex-1 rounded border px-2 font-mono"
                    style={fieldStyle}
                  />
                  <button
                    onClick={() => {
                      saveToken(token.trim());
                      setTokenSaved(true);
                    }}
                    className="rounded px-3 py-1.5 text-white"
                    style={{ background: 'var(--c-primary)' }}
                  >
                    {tokenSaved ? t('saved') : t('save')}
                  </button>
                </div>
                <p className="mb-6 text-[10px] leading-4" style={{ color: 'var(--c-text-2)' }}>
                  {t('githubTokenHint')}
                </p>

                <h3 className="mb-2 text-[13px] font-semibold">{t('clearCache')}</h3>
                <div
                  className="flex items-center justify-between gap-3 rounded border px-3 py-2"
                  style={{ borderColor: 'var(--c-border)' }}
                >
                  <span style={{ color: 'var(--c-text-2)' }}>
                    {t('cacheUsage', {
                      trees: stats.trees,
                      files: stats.files,
                      analysis: stats.analysis,
                    })}
                    {cleared && (
                      <span style={{ color: 'var(--c-success)' }}> · {t('cacheCleared')}</span>
                    )}
                  </span>
                  <button
                    onClick={() => void handleClearCache()}
                    className="shrink-0 rounded border px-2 py-1"
                    style={{ borderColor: 'var(--c-border)' }}
                  >
                    {t('clearCache')}
                  </button>
                </div>
              </>
            )}

            {section === 'advanced' && (
              <>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={config.jsdelivrFallback}
                    onChange={(e) => onConfigChange({ jsdelivrFallback: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block">{t('jsdelivrFallback')}</span>
                    <span
                      className="block text-[10px] leading-4"
                      style={{ color: 'var(--c-text-2)' }}
                    >
                      {t('jsdelivrFallbackHint')}
                    </span>
                  </span>
                </label>

                <p className="mt-8 text-[10px]" style={{ color: 'var(--c-text-2)' }}>
                  CodeAtlas v2.0.0 · web-tree-sitter 0.25.10
                </p>
              </>
            )}
          </div>

          <div
            className="flex justify-end gap-2 border-t p-3"
            style={{ borderColor: 'var(--c-border)' }}
          >
            <button
              onClick={onClose}
              className="rounded px-3 py-1 text-white"
              style={{ background: 'var(--c-primary)' }}
            >
              {t('close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
