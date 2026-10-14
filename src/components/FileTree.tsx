/**
 * FileTree —— 左侧目录树
 *
 * 功能（对应提示词）：
 *   · 折叠 / 展开
 *   · 按文件名过滤（命中路径的祖先链自动展开）
 *   · 目录用途标注（来自 analysis/directories.ts 的确定性规则 + 启发式）
 *   · 目录在前、同级按名排序（与 buildTree 一致）
 *
 * 可访问性（键盘导航）：
 *   · 单一 Tab 停靠点（roving tabindex）：只有"当前项"tabIndex=0，其余 -1；
 *   · ↑↓ 在可见行间移动，Home/End 跳到首/尾；
 *   · →  展开目录（已展开则移动到首个子节点），← 折叠目录（叶子则回到父节点）；
 *   · Enter / Space 激活（文件 = 打开，目录 = 折叠切换）。
 *
 * 性能：使用 React.memo 的递归节点 + 展开状态由父级统一持有（Set<string>），
 * 中型项目（数千文件）足够；十万级超大仓库后续可换虚拟滚动。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileNode } from '../types/repo';
import { annotateDirectories, type DirPurpose } from '../analysis/directories';

interface FileTreeProps {
  tree: FileNode[];
  activePath: string | null;
  onSelect: (path: string) => void;
  /** 建议阅读路线的序号（N2）：文件 → 序号，命中即在树里显示角标 */
  orderByPath?: Map<string, number>;
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

/** 展平"当前可见行"（与渲染顺序一致），供键盘上下移动使用 */
function flattenVisible(
  nodes: FileNode[],
  expanded: Set<string>,
  acc: { node: FileNode; depth: number }[] = [],
  depth = 0,
): { node: FileNode; depth: number }[] {
  for (const n of nodes) {
    acc.push({ node: n, depth });
    if (n.type === 'dir' && expanded.has(n.path) && n.children) {
      flattenVisible(n.children, expanded, acc, depth + 1);
    }
  }
  return acc;
}

interface NodeProps {
  node: FileNode;
  depth: number;
  activePath: string | null;
  focusedPath: string | null;
  onFocusPath: (path: string) => void;
  expanded: Set<string>;
  toggle: (path: string) => void;
  onSelect: (path: string) => void;
  purposes: Map<string, DirPurpose>;
  orders?: Map<string, number>;
}

const TreeNode = memo(function TreeNode({
  node,
  depth,
  activePath,
  focusedPath,
  onFocusPath,
  expanded,
  toggle,
  onSelect,
  purposes,
  orders,
}: NodeProps) {
  const { t } = useTranslation(['viewer', 'analysis']);
  const name = node.path.split('/').pop() ?? node.path;
  const isDir = node.type === 'dir';
  const isOpen = expanded.has(node.path);
  const purpose = isDir ? purposes.get(node.path) : undefined;
  const order = isDir ? undefined : orders?.get(node.path);
  const isActive = !isDir && activePath === node.path;
  const isFocused = focusedPath === node.path;

  const activate = () => (isDir ? toggle(node.path) : onSelect(node.path));

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={isDir ? isOpen : undefined}
        aria-selected={!isDir ? isActive : undefined}
        aria-level={depth + 1}
        tabIndex={isFocused ? 0 : -1}
        data-path={node.path}
        data-tree-kind={isDir ? 'dir' : 'file'}
        onFocus={() => onFocusPath(node.path)}
        onClick={() => {
          onFocusPath(node.path);
          activate();
        }}
        title={purpose ? `${node.path} — ${t(`analysis:purpose.${purpose.key}`)}` : node.path}
        className="flex cursor-pointer items-center gap-1 rounded py-[3px] pe-2 text-[12.5px] outline-none hover:bg-[var(--c-bg-3)] focus-visible:ring-1 focus-visible:ring-[var(--c-primary)]"
        style={{
          paddingInlineStart: `${depth * 12 + 6}px`,
          background: isActive ? 'var(--c-bg-3)' : undefined,
        }}
      >
        <span className="w-3 shrink-0 text-center" aria-hidden style={{ color: 'var(--c-text-2)' }}>
          {isDir ? (isOpen ? '▾' : '▸') : ''}
        </span>
        {order !== undefined && (
          <span
            className="shrink-0 rounded px-1 font-mono text-[10px] leading-4"
            style={{ background: 'var(--c-bg-3)', color: 'var(--c-primary)' }}
            title={t('analysis:readingOrderBadge', { order })}
            data-reading-order={order}
          >
            {order}
          </span>
        )}
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
          focusedPath={focusedPath}
          onFocusPath={onFocusPath}
          expanded={expanded}
          toggle={toggle}
          onSelect={onSelect}
          purposes={purposes}
          orders={orders}
        />
      ))}
    </>
  );
});

export default function FileTree({ tree, activePath, onSelect, orderByPath }: FileTreeProps) {
  const { t } = useTranslation('viewer');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 用途标注：树变化时计算一次（纯函数，O(n)）
  const purposes = useMemo(() => annotateDirectories(tree), [tree]);
  const filtered = useMemo(() => filterTree(tree, query), [tree, query]);

  // 过滤状态下自动展开全部命中目录，否则保持用户手动态
  const effectiveExpanded = useMemo(() => {
    if (!query) return expanded;
    return new Set(collectDirPaths(filtered));
  }, [query, filtered, expanded]);

  // 当前可见行（与渲染顺序一致），键盘导航基于它
  const flat = useMemo(
    () => flattenVisible(filtered, effectiveExpanded),
    [filtered, effectiveExpanded],
  );

  // 保证 focusedPath 始终落在当前可见集合内（树/过滤变化后自动修正）
  useEffect(() => {
    setFocusedPath((prev) => {
      if (flat.length === 0) return null;
      if (prev && flat.some((f) => f.node.path === prev)) return prev;
      if (activePath && flat.some((f) => f.node.path === activePath)) return activePath;
      return flat[0].node.path;
    });
  }, [flat, activePath]);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** 把焦点移到某个可见行（同步更新 roving tabindex 并真正 focus DOM） */
  const focusNode = useCallback((path: string) => {
    setFocusedPath(path);
    const nodes = containerRef.current?.querySelectorAll<HTMLElement>('[data-path]');
    if (!nodes) return;
    for (const el of nodes) {
      if (el.dataset.path === path) {
        el.focus();
        break;
      }
    }
  }, []);

  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    if (flat.length === 0) return;
    let idx = flat.findIndex((f) => f.node.path === focusedPath);
    if (idx < 0) idx = 0;
    const cur = flat[idx];

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusNode(flat[Math.min(idx + 1, flat.length - 1)].node.path);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusNode(flat[Math.max(idx - 1, 0)].node.path);
        break;
      case 'Home':
        e.preventDefault();
        focusNode(flat[0].node.path);
        break;
      case 'End':
        e.preventDefault();
        focusNode(flat[flat.length - 1].node.path);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (cur.node.type === 'dir') {
          if (!effectiveExpanded.has(cur.node.path)) toggle(cur.node.path);
          else if (idx + 1 < flat.length) focusNode(flat[idx + 1].node.path);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (cur.node.type === 'dir' && effectiveExpanded.has(cur.node.path)) {
          toggle(cur.node.path);
        } else {
          const slash = cur.node.path.lastIndexOf('/');
          if (slash > 0) focusNode(cur.node.path.slice(0, slash));
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (cur.node.type === 'dir') toggle(cur.node.path);
        else onSelect(cur.node.path);
        break;
      default:
        break;
    }
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
          <button onClick={expandAll} title={t('expandAll')} aria-label={t('expandAll')} className="rounded px-1 text-xs hover:bg-[var(--c-bg-3)]">
            ⊞
          </button>
          <button onClick={collapseAll} title={t('collapseAll')} aria-label={t('collapseAll')} className="rounded px-1 text-xs hover:bg-[var(--c-bg-3)]">
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

      <div
        ref={containerRef}
        className="flex-1 overflow-auto pb-4"
        role="tree"
        aria-label={t('fileTree')}
        onKeyDown={onTreeKeyDown}
      >
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
              focusedPath={focusedPath}
              onFocusPath={setFocusedPath}
              expanded={effectiveExpanded}
              toggle={toggle}
              onSelect={onSelect}
              purposes={purposes}
              orders={orderByPath}
            />
          ))
        )}
      </div>
    </aside>
  );
}
