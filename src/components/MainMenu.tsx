/**
 * MainMenu —— 顶栏右侧「⋯」主菜单
 *
 * 设计目标：默认界面只保留搜索与两个图标按钮，把"打开 / 项目 / 分析"全部收进菜单，
 * 降低首屏视觉噪音。分析类项通过命令总线交给当前激活的 ProjectView 执行（见 workspace/commands.ts）。
 *
 * 交互：点击外部 / Esc 关闭；菜单项为 role=menuitem；无项目时分析项禁用。
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { emitCommand, type AppCommand } from '../workspace/commands';

interface Props {
  hasProject: boolean;
  canRefresh: boolean;
  onOpenZip: () => void;
  onOpenLocalDir: (() => void) | null;
  onCloseProject: () => void;
}

const PANEL_ITEMS: { command: AppCommand; labelKey: string }[] = [
  { command: 'panel:graph', labelKey: 'callGraph' },
  { command: 'panel:metrics', labelKey: 'metrics' },
  { command: 'panel:reading', labelKey: 'readingPath' },
  { command: 'panel:architecture', labelKey: 'architecture' },
  { command: 'panel:outline', labelKey: 'outline' },
  { command: 'panel:search', labelKey: 'globalSearch' },
  { command: 'pack:open', labelKey: 'contextPack' },
];

export default function MainMenu({
  hasProject,
  canRefresh,
  onOpenZip,
  onOpenLocalDir,
  onCloseProject,
}: Props) {
  const { t } = useTranslation(['common', 'analysis']);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  /** 点击菜单项：先关菜单，再执行（避免焦点停在已卸载节点上） */
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const itemClass =
    'flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-start text-xs hover:bg-[var(--c-bg-3)] disabled:opacity-40 disabled:hover:bg-transparent';

  const sectionLabel = (key: string) => (
    <div
      className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider"
      style={{ color: 'var(--c-text-2)' }}
    >
      {t(key)}
    </div>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        data-testid="main-menu"
        aria-label={t('common:menu')}
        title={t('common:menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded border hover:bg-[var(--c-bg-3)]"
        style={{
          borderColor: open ? 'var(--c-primary)' : 'var(--c-border)',
          background: 'var(--c-bg)',
          color: open ? 'var(--c-primary)' : 'var(--c-text)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('common:menu')}
          className="absolute end-0 top-9 z-40 w-[220px] rounded-lg border p-1 shadow-xl"
          style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
        >
          {sectionLabel('common:openSection')}
          <button role="menuitem" className={itemClass} onClick={run(onOpenZip)}>
            {t('common:openZip')}
          </button>
          {onOpenLocalDir && (
            <button role="menuitem" className={itemClass} onClick={run(onOpenLocalDir)}>
              {t('common:openLocalDir')}
            </button>
          )}

          <div className="my-1 h-px" style={{ background: 'var(--c-border)' }} />
          {sectionLabel('common:projectSection')}
          <button
            role="menuitem"
            className={itemClass}
            disabled={!hasProject || !canRefresh}
            onClick={run(() => emitCommand('project:refresh'))}
          >
            {t('common:refresh')}
          </button>
          <button
            role="menuitem"
            className={itemClass}
            disabled={!hasProject}
            onClick={run(onCloseProject)}
          >
            {t('common:closeProject')}
          </button>

          <div className="my-1 h-px" style={{ background: 'var(--c-border)' }} />
          {sectionLabel('common:analysisSection')}
          {PANEL_ITEMS.map((p) => (
            <button
              key={p.command}
              role="menuitem"
              className={itemClass}
              disabled={!hasProject}
              onClick={run(() => emitCommand(p.command))}
            >
              {t(`analysis:${p.labelKey}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
