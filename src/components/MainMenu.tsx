/**
 * MainMenus —— 顶栏左侧的三个分组菜单（打开 / 项目 / 分析）
 *
 * 设计目标：默认界面只保留"品牌 + 三个分组入口 + 搜索 + 设置"，
 * 具体操作全部收进各自下拉菜单，降低首屏视觉噪音。
 * 分析类操作通过命令总线交给当前激活的 ProjectView 执行（见 workspace/commands.ts）。
 *
 * 交互：三个菜单互斥（同时只开一个）；点击外部 / Esc 关闭；菜单项 role=menuitem。
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

type MenuId = 'open' | 'project' | 'analysis';

const PANEL_ITEMS: { command: AppCommand; labelKey: string }[] = [
  { command: 'panel:graph', labelKey: 'callGraph' },
  { command: 'panel:metrics', labelKey: 'metrics' },
  { command: 'panel:reading', labelKey: 'readingPath' },
  { command: 'panel:architecture', labelKey: 'architecture' },
  { command: 'panel:outline', labelKey: 'outline' },
  { command: 'panel:search', labelKey: 'globalSearch' },
  { command: 'pack:open', labelKey: 'contextPack' },
];

const itemClass =
  'flex w-full items-center justify-between gap-3 whitespace-nowrap rounded px-2.5 py-1.5 text-start text-xs hover:bg-[var(--c-bg-3)] disabled:opacity-40 disabled:hover:bg-transparent';

export default function MainMenus({
  hasProject,
  canRefresh,
  onOpenZip,
  onOpenLocalDir,
  onCloseProject,
}: Props) {
  const { t } = useTranslation(['common', 'analysis']);
  const [openId, setOpenId] = useState<MenuId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return undefined;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenId(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openId]);

  /** 点击菜单项：先关菜单，再执行 */
  const run = (action: () => void) => () => {
    setOpenId(null);
    action();
  };

  const triggers: { id: MenuId; labelKey: string }[] = [
    { id: 'open', labelKey: 'common:openSection' },
    { id: 'project', labelKey: 'common:projectSection' },
    { id: 'analysis', labelKey: 'common:analysisSection' },
  ];

  const renderItems = (id: MenuId) => {
    if (id === 'open') {
      return (
        <>
          <button role="menuitem" className={itemClass} onClick={run(onOpenZip)}>
            {t('common:openZip')}
          </button>
          {onOpenLocalDir && (
            <button role="menuitem" className={itemClass} onClick={run(onOpenLocalDir)}>
              {t('common:openLocalDir')}
            </button>
          )}
        </>
      );
    }
    if (id === 'project') {
      return (
        <>
          <button
            role="menuitem"
            className={itemClass}
            disabled={!hasProject || !canRefresh}
            title={!canRefresh ? t('common:refreshUnavailable') : undefined}
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
        </>
      );
    }
    return (
      <>
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
      </>
    );
  };

  return (
    <div ref={rootRef} className="flex shrink-0 items-center gap-1">
      {triggers.map((trig) => {
        const isOpen = openId === trig.id;
        return (
          <div key={trig.id} className="relative">
            <button
              data-testid={`menu-${trig.id}`}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => setOpenId(isOpen ? null : trig.id)}
              className="flex h-8 items-center gap-1 rounded px-2.5 text-xs transition-colors hover:bg-[var(--c-bg-3)]"
              style={{
                background: isOpen ? 'var(--c-bg-3)' : 'transparent',
                color: isOpen ? 'var(--c-primary)' : 'var(--c-text)',
              }}
            >
              {t(trig.labelKey)}
              <svg
                width="8"
                height="8"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                aria-hidden
                style={{
                  opacity: 0.55,
                  transform: isOpen ? 'rotate(180deg)' : undefined,
                  transition: 'transform 120ms',
                }}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {isOpen && (
              <div
                role="menu"
                aria-label={t(trig.labelKey)}
                className="absolute start-0 top-9 z-40 min-w-[184px] rounded-lg border p-1 shadow-xl"
                style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
              >
                {renderItems(trig.id)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
