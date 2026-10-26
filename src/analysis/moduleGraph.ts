/**
 * moduleGraph.ts —— 模块依赖图（N3）
 *
 * 与 `callgraph.ts` 的分工：
 *   · callgraph  —— 函数级，"谁调用了谁"，关注实现细节
 *   · moduleGraph —— 模块（目录）级，"哪个模块依赖哪个模块"，关注架构
 *
 * 做法：
 *   1. 文件级导入关系（`importResolver` 跨语言解析）作为依赖边；
 *   2. 把文件折叠到**顶层目录**得到模块节点与加权边；
 *   3. 用 `directories.ts` 的用途规则给模块打上用途标签（分层视图的数据源）。
 *
 * 为什么折叠到目录而不直接用文件：函数级/文件级图在真实仓库里节点太多，
 * 看不出架构；目录级才是"能一眼看懂"的粒度。文件级边仍会保留（供环检测下钻）。
 */

import type { FileAnalysis } from './symbols';
import type { DirPurpose } from './directories';
import { matchPurposeRule } from './directories';
import { buildImportEdges, buildResolveContext, type FileEdge } from './importResolver';

export interface ModuleNode {
  /** 目录路径；仓库根目录下的文件聚合为 `(root)` */
  id: string;
  /** 该目录下参与分析的文件数 */
  files: number;
  /** 用途 key（对齐 i18n `analysis:purpose.*`）；未识别为 `unknown` */
  purpose: string;
  /** 目录层级：顶层目录为 1，根目录聚合为 0 */
  depth: number;
}

export interface ModuleEdge {
  from: string;
  to: string;
  /** 文件级依赖条数 */
  weight: number;
}

export interface ModuleGraph {
  nodes: ModuleNode[];
  edges: ModuleEdge[];
  /** 文件级依赖边（供循环依赖检测与下钻展示） */
  fileEdges: FileEdge[];
  /** 目录 → 该目录下的文件（已排序） */
  filesByDir: Map<string, string[]>;
  /** 目录 → 出边明细（含具体文件对，供面板展开） */
  edgesByDir: Map<string, { to: string; weight: number; files: FileEdge[] }[]>;
  /** 参与分析的文件数 */
  parsedFiles: number;
}

export interface LayerGroup {
  /** 用途 key（i18n `analysis:purpose.*`） */
  key: string;
  /** 该层包含的目录 */
  dirs: string[];
  /** 该层的文件数 */
  files: number;
}

/**
 * 唯一的代码包裹层：绝大多数仓库把源码放在 `src/` 下，
 * 若照顶层目录聚合，整份代码会塌成一个节点，模块图/循环依赖全部失效。
 */
const WRAPPER_DIRS = new Set(['src']);

/**
 * monorepo 容器目录：`packages/<pkg>/src/x.ts` 的模块边界是 `packages/<pkg>`，
 * 只取第一段会让整个 monorepo（Vue 的 700 个文件、1200+ 条依赖）塌成一个节点。
 */
const PACKAGE_DIRS = new Set(['packages', 'libs', 'modules', 'apps']);

/**
 * 取文件所属模块。
 *
 * 规则（自上而下匹配）：
 *   · 顶层文件 → `(root)`
 *   · `packages/<pkg>/...` → `packages/<pkg>`
 *   · `src/<sub>/...` → `src/<sub>`
 *   · 其余 → 第一段目录
 */
export function moduleOf(path: string): string {
  const parts = path.split('/');
  if (parts.length === 1) return '(root)';

  const head = parts[0].toLowerCase();
  if (parts.length >= 3 && (PACKAGE_DIRS.has(head) || WRAPPER_DIRS.has(head))) {
    return `${parts[0]}/${parts[1]}`;
  }

  return parts[0];
}

/** 目录深度：顶层目录 1，根目录聚合 0 */
function depthOf(moduleId: string): number {
  if (moduleId === '(root)') return 0;
  return moduleId.split('/').length;
}

/** 目录的用途 key（先查调用方传入的标注，再退回规则表，最后 unknown） */
function purposeOf(moduleId: string, annotated?: Map<string, DirPurpose>): string {
  const fromMap = annotated?.get(moduleId)?.key;
  if (fromMap) return fromMap;
  const last = moduleId.split('/').pop() ?? moduleId;
  return matchPurposeRule(last) ?? matchPurposeRule(moduleId) ?? 'unknown';
}

/**
 * 构建模块依赖图。
 * @param files 已分析的源文件
 * @param dirPurposes 目录用途标注（来自 `annotateDirectories`，可选）
 */
export function buildModuleGraph(
  files: FileAnalysis[],
  dirPurposes?: Map<string, DirPurpose>,
): ModuleGraph {
  const paths = files.map((f) => f.path).sort();
  const ctx = buildResolveContext(paths);
  const fileEdges = buildImportEdges(files, ctx);

  const filesByDir = new Map<string, string[]>();
  for (const path of paths) {
    const mod = moduleOf(path);
    const list = filesByDir.get(mod);
    if (list) list.push(path);
    else filesByDir.set(mod, [path]);
  }

  // 文件级 → 目录级聚合（忽略目录内部依赖，那属于文件级细节）
  const edgeMap = new Map<string, { to: string; weight: number; files: FileEdge[] }[]>();
  const weightCounter = new Map<string, number>();
  for (const edge of fileEdges) {
    const from = moduleOf(edge.from);
    const to = moduleOf(edge.to);
    if (from === to) continue;
    weightCounter.set(`${from}\u0000${to}`, (weightCounter.get(`${from}\u0000${to}`) ?? 0) + 1);
    const list = edgeMap.get(from) ?? [];
    let entry = list.find((e) => e.to === to);
    if (!entry) {
      entry = { to, weight: 0, files: [] };
      list.push(entry);
    }
    entry.weight += 1;
    entry.files.push(edge);
    edgeMap.set(from, list);
  }
  for (const list of edgeMap.values()) {
    list.sort((a, b) => b.weight - a.weight || a.to.localeCompare(b.to));
    for (const entry of list) {
      entry.files.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    }
  }

  const nodes: ModuleNode[] = [...filesByDir.entries()]
    .map(([id, list]) => ({
      id,
      files: list.length,
      purpose: purposeOf(id, dirPurposes),
      depth: depthOf(id),
    }))
    .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

  const edges: ModuleEdge[] = [...weightCounter.entries()]
    .map(([key, weight]) => {
      const [from, to] = key.split('\u0000');
      return { from, to, weight };
    })
    .sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return {
    nodes,
    edges,
    fileEdges,
    filesByDir,
    edgesByDir: edgeMap,
    parsedFiles: paths.length,
  };
}

/**
 * 分层视图：按目录用途聚类。
 * 用途 key 就是天然的"层"（源代码 / 视图组件 / 工具 / 测试 / 文档 …），
 * 比按深度分层更能反映模块边界。
 */
export function groupByLayer(graph: ModuleGraph): LayerGroup[] {
  const map = new Map<string, LayerGroup>();
  for (const node of graph.nodes) {
    const group = map.get(node.purpose) ?? { key: node.purpose, dirs: [], files: 0 };
    group.dirs.push(node.id);
    group.files += node.files;
    map.set(node.purpose, group);
  }
  return [...map.values()]
    .map((g) => ({ ...g, dirs: g.dirs.sort() }))
    .sort((a, b) => b.files - a.files || a.key.localeCompare(b.key));
}
