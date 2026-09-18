/**
 * ReadingPathPanel —— 建议阅读路线（N2）
 *
 * 回答的问题：「刚拿到这个仓库，先看哪几个文件？」
 * 数据来自 `analysis/readingPath.ts`：依赖图 PageRank + 入/出度角色判定，
 * 全程确定性计算，不含任何 AI 推断。
 *
 * 交互：点击任一步 → 打开该文件；「写入 AI 上下文包」把路线并入上下文包。
 */

import { useTranslation } from 'react-i18next';
import type { ReadingPath, ReadingRole } from '../analysis/readingPath';

interface Props {
  path: ReadingPath | null;
  running: boolean;
  onOpenFile: (file: string, line: number) => void;
  onAnalyze: () => void;
  onClose: () => void;
  onWriteToContextPack: () => void;
  /** 目录用途译文（来自 i18n analysis:purpose.*） */
  dirLabels: Record<string, string>;
}

/** 角色 → CSS 变量色 */
const ROLE_COLOR: Record<ReadingRole, string> = {
  entry: 'var(--c-success, #3fb950)',
  core: 'var(--c-primary)',
  support: 'var(--c-text-2)',
  leaf: 'var(--c-text-2)',
};

export default function ReadingPathPanel({
  path,
  running,
  onOpenFile,
  onAnalyze,
  onClose,
  onWriteToContextPack,
  dirLabels,
}: Props) {
  const { t } = useTranslation(['analysis', 'common']);

  const roleLabel = (role: ReadingRole) => t(`analysis:readingRole_${role}` as never);

  return (
    <section
      className="flex h-80 shrink-0 flex-col border-t"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
      aria-label={t('analysis:readingPath')}
    >
      <header className="flex shrink-0 items-center gap-3 px-3 py-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--c-text)' }}>
          {t('analysis:readingPath')}
        </span>
        {path && (
          <span className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:readingPathStats', { total: path.totalFiles, shown: path.steps.length })}
          </span>
        )}
        {path && path.groups.length > 0 && (
          <span className="truncate text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:readingPathDirs', {
              dirs: path.groups
                .slice(0, 6)
                .map((g) => `${g.dir === '(root)' ? '.' : g.dir}${dirLabels[g.dir] ? `（${dirLabels[g.dir]}）` : ''}`)
                .join(' · '),
            })}
          </span>
        )}

        <div className="ms-auto flex items-center gap-2">
          <button
            onClick={onWriteToContextPack}
            disabled={!path || path.steps.length === 0}
            className="rounded border px-2 py-1 text-[11px] disabled:opacity-40"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {t('analysis:readingPathToPack')}
          </button>
          <button
            onClick={onAnalyze}
            disabled={running}
            className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {running ? t('analysis:analyzing') : t('analysis:analyze')}
          </button>
          <button onClick={onClose} className="rounded px-2 py-1 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('common:close')}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {running && !path && (
          <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:analyzing')}
          </p>
        )}

        {path && path.steps.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:noGraph')}
          </p>
        )}

        {path && path.steps.length > 0 && (
          <>
            <p className="mb-1 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
              {t('analysis:readingPathHint')}
            </p>
            <ol className="flex flex-col gap-[2px]">
              {path.steps.map((step) => (
                <li key={step.path}>
                  <button
                    onClick={() => onOpenFile(step.path, 1)}
                    data-reading-step={step.order}
                    title={t('analysis:readingPathDegree', {
                      in: step.inDegree,
                      out: step.outDegree,
                    })}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-[var(--c-bg-3)]"
                  >
                    <span
                      className="w-7 shrink-0 text-right font-mono text-[11px]"
                      style={{ color: 'var(--c-text-2)' }}
                    >
                      {step.order}
                    </span>
                    <span
                      className="shrink-0 rounded px-1.5 py-[1px] text-[10px] leading-4"
                      style={{ background: 'var(--c-bg-3)', color: ROLE_COLOR[step.role] }}
                    >
                      {roleLabel(step.role)}
                    </span>
                    <span className="truncate" style={{ color: 'var(--c-text)' }}>
                      {step.path}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {path.omitted > 0 && (
              <p className="mt-2 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
                {t('analysis:readingPathOmitted', { count: path.omitted })}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
