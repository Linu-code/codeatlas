/**
 * ProjectTabs —— 多项目工作区的项目标签条（N5③）
 *
 * 一个窗口内可同时打开多个项目，此条在最上方（与浏览器标签一致），
 * 点击切换、× 关闭。仅在打开 ≥ 2 个项目时由 App 渲染。
 */

import { useTranslation } from 'react-i18next';
import type { ProjectEntry } from '../workspace/workspace';

interface Props {
  projects: ProjectEntry[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

const KIND_BADGE: Record<string, string> = {
  github: 'GH',
  zip: 'ZIP',
  local: 'DIR',
};

export default function ProjectTabs({ projects, activeId, onActivate, onClose }: Props) {
  const { t } = useTranslation('common');

  return (
    <div
      role="tablist"
      aria-label={t('projectTabs')}
      className="flex shrink-0 items-stretch overflow-x-auto border-b"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
      data-project-tabs
    >
      {projects.map((p) => {
        const active = p.id === activeId;
        const label = p.name ?? t('untitledProject');
        return (
          <div
            key={p.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            data-project-id={p.id}
            onClick={() => onActivate(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivate(p.id);
              }
            }}
            title={label}
            className="group flex max-w-[220px] cursor-pointer items-center gap-2 border-e px-3 py-1 text-xs"
            style={{
              borderColor: 'var(--c-border)',
              background: active ? 'var(--c-bg)' : 'transparent',
              color: active ? 'var(--c-text)' : 'var(--c-text-2)',
              borderTop: active ? '2px solid var(--c-primary)' : '2px solid transparent',
            }}
          >
            {p.loading && <span className="ca-spinner" aria-hidden />}
            {!p.loading && p.sourceKind && (
              <span
                className="shrink-0 rounded px-1 font-mono text-[9px] leading-4"
                style={{ background: 'var(--c-bg-3)', color: 'var(--c-primary)' }}
              >
                {KIND_BADGE[p.sourceKind] ?? p.sourceKind.toUpperCase()}
              </span>
            )}
            <span className="truncate">{label}</span>
            <button
              aria-label={t('closeProject')}
              title={t('closeProject')}
              onClick={(e) => {
                e.stopPropagation();
                onClose(p.id);
              }}
              className="rounded px-1 opacity-0 group-hover:opacity-100 hover:bg-[var(--c-bg-3)] focus-visible:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
