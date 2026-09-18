/**
 * ArchitecturePanel —— 架构视图（N3）
 *
 * 四个页签，回答四个不同层次的问题：
 *   模块  哪个模块依赖哪个模块？（目录级依赖图，Mermaid 可导出）
 *   循环  哪里存在循环依赖？（Tarjan 强连通分量，含目录级汇总）
 *   类图  类的继承与实现关系（OOP 语言）
 *   分层  按目录用途聚类，看模块边界与体量分布
 *
 * 数据全部来自 `moduleGraph` / `cycles` / `classGraph`，确定性计算，不含 AI。
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClassGraph } from '../analysis/classGraph';
import type { CycleReport } from '../analysis/cycles';
import { classDiagramId } from '../analysis/mermaid';
import type { LayerGroup, ModuleGraph } from '../analysis/moduleGraph';
import MermaidView from './MermaidView';

type Tab = 'modules' | 'cycles' | 'classes' | 'layers';

interface Props {
  graph: ModuleGraph | null;
  cycles: CycleReport | null;
  classGraph: ClassGraph | null;
  layers: LayerGroup[];
  moduleMermaid: string;
  classMermaid: string;
  running: boolean;
  onAnalyze: () => void;
  onOpenFile: (file: string, line: number) => void;
  onClose: () => void;
  /** 目录用途译文（i18n analysis:purpose.*） */
  purposeLabels: Record<string, string>;
}

export default function ArchitecturePanel({
  graph,
  cycles,
  classGraph,
  layers,
  moduleMermaid,
  classMermaid,
  running,
  onAnalyze,
  onOpenFile,
  onClose,
  purposeLabels,
}: Props) {
  const { t } = useTranslation(['analysis', 'common']);
  const [tab, setTab] = useState<Tab>('modules');

  /** 类图节点 id → 文件，用于点击跳转（与 mermaid.ts 使用同一套 id 生成算法） */
  const classIdToNode = useMemo(() => {
    const map = new Map<string, { file: string; line: number }>();
    for (const node of classGraph?.nodes ?? []) {
      if (node.external || !node.file) continue;
      map.set(classDiagramId(node), { file: node.file, line: node.line });
    }
    return map;
  }, [classGraph]);

  const tabBtn = (key: Tab, label: string, badge?: number) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      data-arch-tab={key}
      className="rounded border px-2 py-0.5"
      style={{
        borderColor: tab === key ? 'var(--c-primary)' : 'var(--c-border)',
        color: tab === key ? 'var(--c-primary)' : 'var(--c-text)',
      }}
    >
      {label}
      {badge !== undefined && badge > 0 ? ` ${badge}` : ''}
    </button>
  );

  /** 模块图点击：标签形如 `src (12)` → 打开该目录下第一个文件 */
  const handleModuleClick = (label: string) => {
    if (!graph) return;
    const clean = label.replace(/\s*\(\d+\)\s*$/, '').trim();
    const id = clean === '.' ? '(root)' : clean;
    const files = graph.filesByDir.get(id);
    if (files && files.length > 0) onOpenFile(files[0], 1);
  };

  const handleClassClick = (label: string) => {
    const hit = classIdToNode.get(label.trim());
    if (hit) onOpenFile(hit.file, hit.line);
  };

  const topEdges = useMemo(() => (graph?.edges ?? []).slice(0, 30), [graph]);
  const cycleCount = cycles?.cycles.length ?? 0;

  return (
    <section
      className="flex h-80 shrink-0 flex-col border-t"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
      aria-label={t('analysis:architecture')}
    >
      <header className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--c-text)' }}>
          {t('analysis:architecture')}
        </span>

        {tabBtn('modules', t('analysis:archModules'), graph?.nodes.length)}
        {tabBtn('cycles', t('analysis:archCycles'), cycleCount)}
        {tabBtn('classes', t('analysis:archClasses'), classGraph?.classCount)}
        {tabBtn('layers', t('analysis:archLayers'), layers.length)}

        <div className="ms-auto flex items-center gap-2">
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

      {running && !graph && (
        <p className="px-3 text-xs" style={{ color: 'var(--c-text-2)' }}>
          {t('analysis:analyzing')}
        </p>
      )}

      {/* ---------- 模块依赖图 ---------- */}
      {tab === 'modules' && graph && (
        <>
          <p className="shrink-0 px-3 pb-1 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:archModulesStats', {
              modules: graph.nodes.length,
              edges: graph.edges.length,
              files: graph.parsedFiles,
            })}
          </p>
          {moduleMermaid ? (
            <MermaidView code={moduleMermaid} onNodeClick={handleModuleClick} exportName="codeatlas-modules" />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
              <p className="mb-2 text-[11px]" style={{ color: 'var(--c-warning)' }}>
                {t('analysis:archTooManyModules', { count: graph.nodes.length })}
              </p>
              <table className="w-full text-[11px]">
                <thead>
                  <tr style={{ color: 'var(--c-text-2)' }}>
                    <th className="py-1 text-left font-normal">{t('analysis:archEdgeFrom')}</th>
                    <th className="py-1 text-left font-normal">{t('analysis:archEdgeTo')}</th>
                    <th className="py-1 text-right font-normal">{t('analysis:archEdgeWeight')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topEdges.map((e) => (
                    <tr key={`${e.from}->${e.to}`}>
                      <td className="py-[3px]">{e.from}</td>
                      <td className="py-[3px]">{e.to}</td>
                      <td className="py-[3px] text-right">{e.weight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ---------- 循环依赖 ---------- */}
      {tab === 'cycles' && cycles && (
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          {cycleCount === 0 ? (
            <p className="text-xs" style={{ color: 'var(--c-success, #3fb950)' }}>
              {t('analysis:archNoCycles')}
            </p>
          ) : (
            <>
              <p className="mb-2 text-[11px]" style={{ color: 'var(--c-warning)' }}>
                {t('analysis:archCycleStats', {
                  cycles: cycleCount,
                  files: cycles.involvedFiles,
                  dirs: cycles.dirCycles.length,
                })}
              </p>
              <ol className="flex flex-col gap-2">
                {cycles.cycles.slice(0, 20).map((cycle) => (
                  <li key={cycle.join('>')} data-cycle={cycle.length}>
                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      {cycle.map((file, i) => (
                        <span key={file} className="flex items-center gap-1">
                          {i > 0 && <span style={{ color: 'var(--c-text-2)' }}>→</span>}
                          <button
                            onClick={() => onOpenFile(file, 1)}
                            className="rounded px-1.5 py-[1px] hover:bg-[var(--c-bg-3)]"
                            style={{ background: 'var(--c-bg-3)', color: 'var(--c-text)' }}
                          >
                            {file}
                          </button>
                        </span>
                      ))}
                      <span style={{ color: 'var(--c-text-2)' }}>→</span>
                      <button
                        onClick={() => onOpenFile(cycle[0], 1)}
                        className="rounded px-1.5 py-[1px] hover:bg-[var(--c-bg-3)]"
                        style={{ background: 'var(--c-bg-3)', color: 'var(--c-text)' }}
                      >
                        {cycle[0]}
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              {cycles.dirCycles.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-[11px] font-semibold" style={{ color: 'var(--c-text-2)' }}>
                    {t('analysis:archDirCycles')}
                  </p>
                  <ul className="flex flex-col gap-1 text-[11px]">
                    {cycles.dirCycles.map((dirs) => (
                      <li key={dirs.join('>')} style={{ color: 'var(--c-text)' }}>
                        {dirs.join(' → ')} → {dirs[0]}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------- 类图 ---------- */}
      {tab === 'classes' && classGraph && (
        <>
          <p className="shrink-0 px-3 pb-1 text-[11px]" style={{ color: 'var(--c-text-2)' }}>
            {t('analysis:archClassStats', {
              classes: classGraph.classCount,
              relations: classGraph.edges.length,
              external: classGraph.external.length,
            })}
            {classGraph.ambiguous.length > 0 && ` · ${t('analysis:archAmbiguous', { count: classGraph.ambiguous.length })}`}
            {classGraph.truncated && ` · ${t('analysis:archTruncated')}`}
          </p>
          {classMermaid ? (
            <MermaidView code={classMermaid} onNodeClick={handleClassClick} exportName="codeatlas-classes" />
          ) : (
            <p className="px-3 text-xs" style={{ color: 'var(--c-text-2)' }}>
              {t('analysis:archNoClasses')}
            </p>
          )}
        </>
      )}

      {/* ---------- 分层 ---------- */}
      {tab === 'layers' && (
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          {layers.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>
              {t('analysis:noGraph')}
            </p>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr style={{ color: 'var(--c-text-2)' }}>
                  <th className="py-1 text-left font-normal">{t('analysis:archLayerPurpose')}</th>
                  <th className="py-1 text-left font-normal">{t('analysis:archLayerDirs')}</th>
                  <th className="py-1 text-right font-normal">{t('analysis:archLayerFiles')}</th>
                </tr>
              </thead>
              <tbody>
                {layers.map((layer) => (
                  <tr key={layer.key} data-layer={layer.key}>
                    <td className="py-[3px]" style={{ color: 'var(--c-primary)' }}>
                      {purposeLabels[layer.key] ?? layer.key}
                    </td>
                    <td className="py-[3px]">
                      {layer.dirs.slice(0, 8).map((dir) => (
                        <button
                          key={dir}
                          onClick={() => {
                            const files = graph?.filesByDir.get(dir);
                            if (files && files.length > 0) onOpenFile(files[0], 1);
                          }}
                          className="me-2 rounded px-1 hover:bg-[var(--c-bg-3)]"
                        >
                          {dir}
                        </button>
                      ))}
                      {layer.dirs.length > 8 && <span style={{ color: 'var(--c-text-2)' }}>…</span>}
                    </td>
                    <td className="py-[3px] text-right">{layer.files}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
