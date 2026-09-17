/**
 * 共享树构建：平铺路径列表 → 嵌套 FileNode[]。
 * GitHubSource 与 ZipSource 共用。
 *
 * 输入形态说明（这是曾经出 bug 的地方）：
 *   · GitHub `/git/trees?recursive=1` 返回的既有 **目录条目**（type: 'tree' → 'dir'）
 *     也有文件条目（'blob' → 'file'），目录条目是"显式声明"；
 *   · ZIP 源只产出文件条目，目录靠路径前缀隐式推导；
 *   · jsDelivr 清单同样只产出文件条目。
 *
 * 因此必须保证：**目录节点的创建是幂等的** ——
 * 无论是"显式目录条目"还是"某个文件的祖先路径"，同一个路径只能产生一个节点。
 *
 * 历史 bug 复现：旧实现只为「父路径段」建目录（循环到 parts.length - 1），
 * 显式目录条目（单段路径，如 types）循环体不执行，被当作普通节点直接挂到根；
 * 之后处理 types/errtypes/errtypes.go 时 dirIndex 里没有 types → 又新建一个，
 * 于是顶级目录出现两份（ollama/ollama 仓库的 types/model/syncmap/version/x 全部重复）。
 */

import { FileNode } from '../types/repo';

/** 去尾斜杠 + 去掉多余的 './' 前缀，保证同一目录/文件只有一种字符串表示 */
function normalizePath(path: string): string {
  let p = path.replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/\/+$/, '');
  return p;
}

export function buildTree(entries: FileNode[]): FileNode[] {
  const root: FileNode[] = [];
  /** 路径 → 已创建的目录节点（唯一真相来源，保证幂等） */
  const dirIndex = new Map<string, FileNode>();
  const fileSeen = new Set<string>();

  /**
   * 幂等创建目录（含所有祖先），返回该目录节点。
   * 已存在时直接复用，不重复挂载 —— 这是修复重复目录的关键。
   */
  const ensureDir = (dirPath: string): FileNode => {
    const existing = dirIndex.get(dirPath);
    if (existing) return existing;

    const node: FileNode = { path: dirPath, type: 'dir', children: [] };
    dirIndex.set(dirPath, node);

    const slash = dirPath.lastIndexOf('/');
    if (slash === -1) {
      root.push(node);
    } else {
      // 先确保父目录存在（递归），再把自己挂进去
      ensureDir(dirPath.slice(0, slash)).children!.push(node);
    }
    return node;
  };

  // 排序保证输出稳定（同路径条目相邻，也便于目录先于其内容被处理）
  const sorted = [...entries]
    .map((e) => ({ ...e, path: normalizePath(e.path) }))
    .filter((e) => e.path.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path));

  for (const entry of sorted) {
    if (entry.type === 'dir') {
      // 显式目录条目：只登记/确保存在，绝不重复挂载
      ensureDir(entry.path);
      continue;
    }

    // 文件条目：同一路径只挂载一次（防御 API 重复返回或调用方重复传入）
    if (fileSeen.has(entry.path)) continue;
    fileSeen.add(entry.path);

    const slash = entry.path.lastIndexOf('/');
    if (slash === -1) {
      root.push(entry);
    } else {
      ensureDir(entry.path.slice(0, slash)).children!.push(entry);
    }
  }

  return sortTree(root);
}

/** 目录在前、同类型按末段名字排序（GitHub 风格，输出稳定利于测试与缓存） */
function sortTree(nodes: FileNode[]): FileNode[] {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return lastName(a.path).localeCompare(lastName(b.path));
  });
  for (const n of nodes) if (n.children) sortTree(n.children);
  return nodes;
}

export function lastName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** 深度优先展开全部文件路径（README 检测等场景） */
export function flattenFiles(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (list: FileNode[]) => {
    for (const n of list) {
      if (n.type === 'file') out.push(n.path);
      else if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** 校验用：深度优先收集全部目录路径（测试断言"无重复"时使用） */
export function flattenDirs(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (list: FileNode[]) => {
    for (const n of list) {
      if (n.type === 'dir') {
        out.push(n.path);
        if (n.children) walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}
