/**
 * EditorTabs —— 多标签 + 面包屑路径
 * 标签可关闭，右键/中键之外提供"关闭全部"；M5 的跳转会在切换标签时定位行号。
 */

import { useTranslation } from 'react-i18next';
import type { OpenTab } from '../hooks/useRepo';

interface Props {
  tabs: OpenTab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onCloseAll: () => void;
}

export default function EditorTabs({ tabs, activePath, onSelect, onClose, onCloseAll }: Props) {
  const { t } = useTranslation('viewer');

  if (tabs.length === 0) return null;

  return (
    <div style={{ background: 'var(--c-bg-2)' }}>
      <div className="flex items-stretch overflow-x-auto border-b" style={{ borderColor: 'var(--c-border)' }}>
        {tabs.map((tab) => {
          const name = tab.path.split('/').pop() ?? tab.path;
          const active = tab.path === activePath;
          return (
            <div
              key={tab.path}
              onClick={() => onSelect(tab.path)}
              className="group flex cursor-pointer items-center gap-2 border-e px-3 py-1.5 text-xs"
              style={{
                borderColor: 'var(--c-border)',
                background: active ? 'var(--c-bg)' : 'transparent',
                color: active ? 'var(--c-text)' : 'var(--c-text-2)',
                borderTop: active ? '2px solid var(--c-primary)' : '2px solid transparent',
              }}
              title={tab.path}
            >
              <span className="whitespace-nowrap">{name}</span>
              <button
                aria-label={t('closeTab')}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.path);
                }}
                className="rounded px-1 opacity-0 group-hover:opacity-100 hover:bg-[var(--c-bg-3)]"
              >
                ×
              </button>
            </div>
          );
        })}
        <div className="ms-auto flex items-center px-2">
          <button
            onClick={onCloseAll}
            className="rounded px-2 text-xs"
            style={{ color: 'var(--c-text-2)' }}
          >
            {t('closeAllTabs')}
          </button>
        </div>
      </div>

      {/* 面包屑：路径分段，最后一段为主色 */}
      {activePath && (
        <nav
          aria-label="breadcrumb"
          className="flex items-center gap-1 overflow-x-auto px-4 py-1 text-[11px]"
          style={{ color: 'var(--c-text-2)' }}
        >
          {activePath.split('/').map((seg, i, arr) => (
            <span key={i} className="flex items-center gap-1 whitespace-nowrap">
              <span style={i === arr.length - 1 ? { color: 'var(--c-text)' } : undefined}>{seg}</span>
              {i < arr.length - 1 && <span>›</span>}
            </span>
          ))}
        </nav>
      )}
    </div>
  );
}
