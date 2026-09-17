/**
 * FileTree —— 左侧目录树
 *
 * 功能（对应提示词）：
 *   · 折叠 / 展开
 *   · 按文件名过滤（命中路径的祖先链自动展开）
 *   · 目录用途标注（来自 analysis/directories.ts 的确定性规则 + 启发式）
 *   · 目录在前、同级按名排序（与 buildTree 一致）
 *
 * 性能：使用 React.memo 的递归节点 + 展开状态由父级统一持有（Set<string>），
 * 中型项目（数千文件）足够；十万级超大仓库后续可换虚拟滚动。
 */

import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileNode } from '../types/repo';
import { annotateDirectories, type DirPurpose } from '../analysis/directories';

interface FileTreeProps {
  tree: FileNode[];
  activePath: string | null;
  onSelect: (path: string) => void;
}

/** 过滤：保留命中节点及其全部祖先 */
function filterTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  const walk = (list: FileNode[]): FileNode[] => {
    const out: FileNode[] = [];
    for (const node of list) {
      const selfHit = node.path.toLowerCase().includes(q);
      if (node.type === 'file') {
        if (selfHit) out.push(node);
      } else {
        const kids = node.children ? walk(node.children) : [];
        if (selfHit || kids.length > 0) out.push({ ...node, children: selfHit && kids.length === 0 ? node.children : kids });
      }
    }
    return out;
  };
  return walk(nodes);
}

/** 收集过滤结果中所有目录路径，用于自动展开 */
function collectDirPaths(nodes: FileNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'dir') {
      acc.push(n.path);
      if (n.children) collectDirPaths(n.children, acc);
    }
  }
  return acc;
}

interface NodeProps {
  node: FileNode;
  depth: number;
  activePath: string | null;
  expanded: Set<string>;
  toggle: (path: string) => void;
  onSelect: (path: string) => void;
  purposes: Map<string, DirPurpose>;
}

const TreeNode = memo(function TreeNode({
  node,
  depth,
  activePath,
  expanded,
  toggle,
  onSelect,
  purposes,
}: NodeProps) {
  const { t } = useTranslation(['viewer', 'analysis']);
  const name = node.path.split('/').pop() ?? node.path;
  const isDir = node.type === 'dir';
  const isOpen = expanded.has(node.path);
  const purpose = isDir ? purposes.get(node.path) : undefined;

  return (
    <>
      <div
        role={isDir ? 'treeitem' : 'option'}
        aria-expanded={isDir ? isOpen : undefined}
        aria-selected={!isDir && activePath === node.path}
        onClick={() => (isDir ? toggle(node.path) : onSelect(node.path))}
        title={purpose ? `${node.path} — ${t(`analysis:purpose.${purpose.key}`)}` : node.path}
        className="flex cursor-pointer items-center gap-1 rounded py-[3px] pe-2 text-[12.5px] hover:bg-[var(--c-bg-3)]"
        style={{
          paddingInlineStart: `${depth * 12 + 6}px`,
          background: !isDir && activePath === node.path ? 'var(--c-bg-3)' : undefined,
        }}
      >
        <span className="w-3 shrink-0 text-center" style={{ color: 'var(--c-text-2)' }}>
          {isDir ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="truncate" style={{ color: isDir ? 'var(--c-text)' : 'var(--c-text-2)' }}>
          {name}
        </span>
        {purpose && (
          <span
            className="ms-1 shrink-0 rounded px-1.5 py-[1px] text-[10px] leading-4"
            style={{ background: 'var(--c-bg-3)', color: 'var(--c-primary)' }}
          >
            {t(`analysis:purpose.${purpose.key}`)}
          </span>
        )}
      </div>
      {isDir && isOpen && node.children?.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          activePath={activePath}
          expanded={expanded}
          toggle={toggle}
          onSelect={onSelect}
          purposes={purposes}
        />
      ))}
    </>
  );
});

export default function FileTree({ tree, activePath, onSelect }: FileTreeProps) {
  const { t } = useTranslation('viewer');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // 用途标注：树变化时计算一次（纯函数，O(n)）
  const purposes = useMemo(() => annotateDirectories(tree), [tree]);
  const filtered = useMemo(() => filterTree(tree, query), [tree, query]);

  // 过滤状态下自动展开全部命中目录，否则保持用户手动态
  const effectiveExpanded = useMemo(() => {
    if (!query) return expanded;
    return new Set(collectDirPaths(filtered));
  }, [query, filtered, expanded]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(collectDirPaths(tree)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <aside
      className="flex h-full w-72 shrink-0 flex-col border-e"
      style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)' }}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--c-text-2)' }}>
          {t('fileTree')}
        </span>
        <div className="flex gap-1">
          <button onClick={expandAll} title={t('expandAll')} className="rounded px-1 text-xs hover:bg-[var(--c-bg-3)]">
            ⊞
          </button>
          <button onClick={collapseAll} title={t('collapseAll')} className="rounded px-1 text-xs hover:bg-[var(--c-bg-3)]">
            ⊟
          </button>
        </div>
      </div>

      <div className="px-2 pb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('filterPlaceholder')}
          aria-label={t('filterPlaceholder')}
          className="h-7 w-full rounded border px-2 text-xs outline-none"
          style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
        />
      </div>

      <div className="flex-1 overflow-auto pb-4" role="tree">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs" style={{ color: 'var(--c-text-2)' }}>
            {t('noFiles')}
          </p>
        ) : (
          filtered.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              activePath={activePath}
              expanded={effectiveExpanded}
              toggle={toggle}
              onSelect={onSelect}
              purposes={purposes}
            />
          ))
        )}
      </div>
    </aside>
  );
}
