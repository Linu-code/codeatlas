/**
 * ToolBar —— 第二行工具条
 * 分析类操作（调用图 / 度量 / 全局搜索 / AI 上下文包）与项目级操作（刷新 / 设置 / 关闭窗口）。
 */

import { useTranslation } from 'react-i18next';
import { isTauri } from '../utils/tauri';

export type BottomPanel =
  | 'none'
  | 'graph'
  | 'metrics'
  | 'search'
  | 'references'
  // N2
  | 'reading'
  | 'outline'
  // N3
  | 'architecture';

interface Props {
  hasProject: boolean;
  /** 当前数据源是否支持刷新（ZIP 为不可变快照，刷新无意义） */
  canRefresh: boolean;
  panel: BottomPanel;
  analyzing: boolean;
  analyzingLabel: string;
  onTogglePanel: (panel: Exclude<BottomPanel, 'none'>) => void;
  onToggleContextPack: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export default function ToolBar({
  hasProject,
  canRefresh,
  panel,
  analyzing,
  analyzingLabel,
  onTogglePanel,
  onToggleContextPack,
  onRefresh,
  onOpenSettings,
}: Props) {
  const { t } = useTranslation(['analysis', 'common']);

  const closeWindow = async () => {
    const { invokeSafe } = await import('../utils/tauri');
    await invokeSafe('close_window');
  };

  const btn = (
    label: string,
    active: boolean,
    onClick: () => void,
    disabled = false,
    testId?: string,
  ) => (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="rounded border px-2 py-0.5 disabled:opacity-40"
      style={{
        borderColor: active ? 'var(--c-primary)' : 'var(--c-border)',
        color: active ? 'var(--c-primary)' : 'var(--c-text)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-[11px]"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)', color: 'var(--c-text-2)' }}
    >
      {btn(
        analyzing ? analyzingLabel : t('analysis:callGraph'),
        panel === 'graph',
        () => onTogglePanel('graph'),
        !hasProject,
      )}
      {btn(t('analysis:metrics'), panel === 'metrics', () => onTogglePanel('metrics'), !hasProject)}
      {btn(t('analysis:readingPath'), panel === 'reading', () => onTogglePanel('reading'), !hasProject)}
      {btn(
        t('analysis:architecture'),
        panel === 'architecture',
        () => onTogglePanel('architecture'),
        !hasProject,
      )}
      {btn(t('analysis:outline'), panel === 'outline', () => onTogglePanel('outline'), !hasProject)}
      {btn(
        t('analysis:globalSearch'),
        panel === 'search',
        () => onTogglePanel('search'),
        !hasProject,
      )}
      {btn(t('analysis:contextPack'), false, onToggleContextPack, !hasProject)}
      {btn(t('common:refresh'), false, onRefresh, !hasProject || !canRefresh)}

      <div className="ms-auto flex items-center gap-2">
        {btn(t('common:settings'), false, onOpenSettings, false, 'open-settings')}
        {isTauri() && btn(t('common:closeWindow'), false, () => void closeWindow())}
      </div>
    </div>
  );
}
