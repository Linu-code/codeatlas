/**
 * classGraph.ts —— 类图 / 继承·实现关系（N3）
 *
 * 数据源：各语言 LangHandler 的 `superTypes()`（由 `extractFile` 收集到
 * `FileAnalysis.classRelations`）。未实现该能力的语言（Go / Rust / C）不参与类图 ——
 * 这是有意的：与其用启发式猜出错误的关系，不如明确不显示。
 *
 * 名字解析策略（关键）：
 *   · 优先解析到**同一个文件**内的同名类（局部优先，符合各语言的词法作用域直觉）
 *   · 否则要求全局唯一 —— 多个同名类时**不建边**并记入 `ambiguous`，
 *     因为跨文件重名（尤其 Java/Kotlin 的 `Builder`、`Config`）连错比不连更糟
 *   · 都找不到则视为外部依赖（`NSObject`、`React.Component` 等），保留为虚线节点，
 *     让"外部基类"这件事本身也可见
 */

import type { FileAnalysis } from './symbols';
import { normalizeTypeName } from './langs/types';

export interface ClassNode {
  /** `${file}#${name}`；外部类型为 `ext:${name}` */
  id: string;
  name: string;
  file: string;
  line: number;
  /** 类型定义不在本仓库内 */
  external: boolean;
}

export interface ClassEdge {
  from: string;
  /** 子类 id */
  to: string;
  kind: 'extends' | 'implements';
}

export interface ClassGraph {
  nodes: ClassNode[];
  edges: ClassEdge[];
  /** 未解析到本仓库的外部类型名（去重排序） */
  external: string[];
  /** 因跨文件重名而未建边的类型名（去重排序） */
  ambiguous: string[];
  /** 本仓库内的类/接口数（不含外部节点） */
  classCount: number;
  /** 节点数超过上限被截断 */
  truncated: boolean;
}

/** 类图节点上限：超过后 Mermaid 渲染会明显变慢，且图已不可读 */
export const MAX_CLASS_NODES = 120;

export function buildClassGraph(files: FileAnalysis[]): ClassGraph {
  // ---------- 1. 收集类节点（含没有任何关系的孤立类） ----------
  const nodes = new Map<string, ClassNode>();
  const classNodesByName = new Map<string, string[]>();

  for (const file of files) {
    for (const def of file.definitions) {
      if (def.kind !== 'class') continue;
      const id = `${file.path}#${def.name}`;
      if (nodes.has(id)) continue;
      nodes.set(id, { id, name: def.name, file: file.path, line: def.line, external: false });
      const list = classNodesByName.get(def.name);
      if (list) list.push(id);
      else classNodesByName.set(def.name, [id]);
    }
  }
  for (const list of classNodesByName.values()) list.sort();

  // ---------- 2. 解析父子关系 ----------
  const edges: ClassEdge[] = [];
  const edgeKeys = new Set<string>();
  const externalNames = new Set<string>();
  const ambiguousNames = new Set<string>();

  const resolve = (rawName: string, fromFile: string): string | null => {
    const name = normalizeTypeName(rawName);
    if (!name) return null;
    const candidates = classNodesByName.get(name);
    if (!candidates || candidates.length === 0) {
      // 外部依赖：保留为外部节点
      const id = `ext:${name}`;
      if (!nodes.has(id)) {
        nodes.set(id, { id, name, file: '', line: 0, external: true });
      }
      externalNames.add(name);
      return id;
    }
    const sameFile = candidates.find((id) => id.startsWith(`${fromFile}#`));
    if (sameFile) return sameFile;
    if (candidates.length === 1) return candidates[0];
    ambiguousNames.add(name);
    return null;
  };

  const pushEdge = (from: string, to: string, kind: 'extends' | 'implements') => {
    if (from === to) return;
    const key = `${from}\u0000${to}\u0000${kind}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, kind });
  };

  for (const file of files) {
    for (const rel of file.classRelations ?? []) {
      const from = `${file.path}#${rel.name}`;
      if (!nodes.has(from)) continue;
      for (const parent of rel.extends) {
        const target = resolve(parent, file.path);
        if (target) pushEdge(from, target, 'extends');
      }
      for (const iface of rel.implements) {
        const target = resolve(iface, file.path);
        if (target) pushEdge(from, target, 'implements');
      }
    }
  }

  // ---------- 3. 截断：优先保留有关系的类 ----------
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.from);
    connected.add(e.to);
  }
  const allNodes = [...nodes.values()].sort((a, b) => {
    const aC = connected.has(a.id) ? 0 : 1;
    const bC = connected.has(b.id) ? 0 : 1;
    return aC - bC || a.name.localeCompare(b.name) || a.file.localeCompare(b.file);
  });

  const kept = allNodes.slice(0, MAX_CLASS_NODES);
  const keptIds = new Set(kept.map((n) => n.id));

  return {
    nodes: kept,
    edges: edges
      .filter((e) => keptIds.has(e.from) && keptIds.has(e.to))
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind)),
    external: [...externalNames].sort(),
    ambiguous: [...ambiguousNames].sort(),
    classCount: kept.filter((n) => !n.external).length,
    truncated: allNodes.length > kept.length,
  };
}
