/**
 * OutlinePanel —— 当前文件的符号大纲（N2）
 *
 * 把 `analysis/outline.ts` 生成的嵌套符号树渲染成可点击列表：
 * 点击跳到对应行；`exported` 的符号带公开标记。
 *
 * 数据来自已经跑过的分析结果（`AnalysisState.files`），因此不需要额外解析；
 * 若当前文件尚未纳入分析（例如超出规模上限），提示用户重新分析。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { buildOutline, type OutlineNode } from '../analysis/outline';
import type { SymbolDef } from '../analysis/langs/types';

interface Props {
  /** 当前打开的文件路径 */
  file: string | null;
  /** 该文件的符号定义（未分析时为 null）；嵌套树在本组件内构建 */
  definitions: SymbolDef[] | null;
  running: boolean;
  onOpenFile: (file: string, line: number) => void;
  onAnalyze: () => void;
  onClose: () => void;
}

/** 符号种类 → 单字母图标（避免引入图标库） */
const KIND_ICON: Record<string, string> = {
  class: 'C',
  function: 'ƒ',
  method: 'm',
  variable: 'v',
};

function Row({
  node,
  depth,
  file,
  onOpenFile,
}: {
  node: OutlineNode;
  depth: number;
  file: string;
  onOpenFile: (file: string, line: number) => void;
}) {
  const { t } = useTranslation('analysis');
  return (
    <>
      <button
        onClick={() => onOpenFile(file, node.line)}
        data-outline-node={node.name}
        title={`${node.name} — ${t('outlineLine', { line: node.line })}`}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-[var(--c-bg-3)]"
        style={{ paddingInlineStart: `${depth * 14 + 8}px` }}
      >
        <span
          className="w-3 shrink-0 text-center font-mono text-[10px]"
          style={{ color: node.exported ? 'var(--c-primary)' : 'var(--c-text-2)' }}
        >
          {KIND_ICON[node.kind] ?? '·'}
        </span>
        <span className="truncate" style={{ color: 'var(--c-text)' }}>
          {node.name}
        </span>
        <span className="ms-auto shrink-0 font-mono text-[10px]" style={{ color: 'var(--c-text-2)' }}>
          {node.line}
        </span>
      </button>
      {node.children.map((child) => (
        <Row key={`${child.name}:${child.line}`} node={child} depth={depth + 1} file={file} onOpenFile={onOpenFile} />
      ))}
    </>
  );
}

export default function OutlinePanel({ file, definitions, running, onOpenFile, onAnalyze, onClose }: Props) {
  const { t } = useTranslation(['analysis', 'common']);

  const roots = useMemo(() => (definitions ? buildOutline(definitions) : []), [definitions]);

  return (
    <section
      className="flex h-80 shrink-0 flex-col border-t"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
      aria-label={t('analysis:outline')}
    >
      <header className="flex shrink-0 items-center gap-3 px-3 py-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--c-text)' }}>
          {t('analysis:outline')}
        </span>
        {file && (
          <span className="truncate text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {file}
          </span>
        )}

        <div className="ms-auto flex items-center gap-2">
          <button
            onClick={onAnalyze}
            disabled={running || !file}
            className="rounded border px-2 py-1 text-[11px] disabled:opacity-40"
            style={{ borderColor: 'var(--c-border)' }}
          >
            {running ? t('analysis:analyzing') : t('analysis:analyze')}
          </button>
          <button onClick={onClose} className="rounded px-2 py-1 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('common:close')}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {!file && (
          <p className="px-1 text-xs" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:outlineNoFile')}
          </p>
        )}
        {file && !definitions && (
          <p className="px-1 text-xs" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:outlineNotAnalyzed')}
          </p>
        )}
        {file && definitions && roots.length === 0 && (
          <p className="px-1 text-xs" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:outlineEmpty')}
          </p>
        )}
        {file &&
          roots.map((node) => (
            <Row key={`${node.name}:${node.line}`} node={node} depth={0} file={file} onOpenFile={onOpenFile} />
          ))}
      </div>
    </section>
  );
}
