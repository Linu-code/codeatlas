/**
 * scopeGraph.ts —— 跨文件符号索引（转到定义 / 查找引用）
 *
 * 数据结构：
 *   Map<符号名, { kind, definitions[], references[] }>
 *   定义与引用都带 文件 + 行号 + 列号，点击即可跳转。
 *
 * 构建策略（对应提示词"先用 ripgrep 定位候选文件，再用 tree-sitter 解析"）：
 *   这里把"候选定位"交给 Worker 内的 JS 预过滤（见 workers/search.worker.ts）——
 *   不捆绑 ripgrep 二进制（省体积、免外置进程），效果等价：先粗筛文件，再精确 AST 解析。
 *
 * 去重规则：定义处的标识符同样会出现在 references 中，建索引时按 (行,列) 剔除，
 * 避免"定义"和"引用"列表里出现同一位置。
 */

import type { FileAnalysis, RefSite, SymbolDef, SymbolKind } from './symbols';

export interface SymbolLocation {
  file: string;
  line: number;
  column: number;
}

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  definitions: SymbolLocation[];
  references: SymbolLocation[];
  /** 出现该符号的文件数（引用+定义去重） */
  fileCount: number;
}

export interface ScopeIndex {
  symbols: Map<string, SymbolEntry>;
  /** 文件 → 导入的模块说明符（跨文件解析线索） */
  importsByFile: Map<string, string[]>;
  parsedFiles: number;
  failedFiles: string[];
  definitionCount: number;
  referenceCount: number;
}

/** 构建全局符号索引（纯函数，可单测） */
export function buildScopeIndex(files: FileAnalysis[]): ScopeIndex {
  const symbols = new Map<string, SymbolEntry>();
  const importsByFile = new Map<string, string[]>();
  const failedFiles: string[] = [];
  let definitionCount = 0;
  let referenceCount = 0;

  const ensure = (name: string, kind: SymbolKind): SymbolEntry => {
    let entry = symbols.get(name);
    if (!entry) {
      entry = { name, kind, definitions: [], references: [], fileCount: 0 };
      symbols.set(name, entry);
    }
    return entry;
  };

  for (const file of files) {
    if (file.hasError) failedFiles.push(file.path);
    importsByFile.set(file.path, file.imports);

    // ① 定义
    const defPositions = new Set<string>();
    for (const def of file.definitions) {
      const entry = ensure(def.name, def.kind);
      const loc: SymbolLocation = { file: file.path, line: def.line, column: 1 };
      entry.definitions.push(loc);
      defPositions.add(`${def.line}:1`);
      definitionCount++;
    }

    // ② 引用（剔除定义自身位置）
    for (const ref of file.references) {
      const key = `${ref.line}:${ref.column}`;
      // 定义名所在行：列可能不是 1（如 `export function foo`），这里用"名称匹配+定义行"粗排
      const defOnSameLine = file.definitions.some(
        (d: SymbolDef) => d.line === ref.line && d.name === ref.name,
      );
      if (defOnSameLine && !defPositions.has(`${key}`)) {
        // 同一行且名字与定义一致 → 视为定义位置，跳过
        continue;
      }
      const entry = ensure(ref.name, 'function');
      entry.references.push({ file: file.path, line: ref.line, column: ref.column });
      referenceCount++;
    }
  }

  // ③ 文件数统计
  for (const entry of symbols.values()) {
    const set = new Set<string>();
    for (const d of entry.definitions) set.add(d.file);
    for (const r of entry.references) set.add(r.file);
    entry.fileCount = set.size;
  }

  return {
    symbols,
    importsByFile,
    parsedFiles: files.length,
    failedFiles,
    definitionCount,
    referenceCount,
  };
}

/** 精确查找符号（大小写敏感，与编辑器一致） */
export function findSymbol(index: ScopeIndex, name: string): SymbolEntry | null {
  return index.symbols.get(name) ?? null;
}

/** 转到定义：返回第一个定义位置（同文件优先由调用方传入 currentFile 决定） */
export function gotoDefinition(
  index: ScopeIndex,
  name: string,
  currentFile?: string,
): SymbolLocation | null {
  const entry = index.symbols.get(name);
  if (!entry || entry.definitions.length === 0) return null;
  if (currentFile) {
    const local = entry.definitions.find((d) => d.file === currentFile);
    if (local) return local;
  }
  return [...entry.definitions].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)[0];
}

/** 查找引用：全部引用位置（稳定排序，便于展示与测试） */
export function findReferences(index: ScopeIndex, name: string): SymbolLocation[] {
  const entry = index.symbols.get(name);
  if (!entry) return [];
  return [...entry.references].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** 前缀补全（符号搜索建议） */
export function suggestSymbols(index: ScopeIndex, prefix: string, limit = 20): SymbolEntry[] {
  if (!prefix) return [];
  const lower = prefix.toLowerCase();
  const out: SymbolEntry[] = [];
  for (const entry of index.symbols.values()) {
    if (entry.name.toLowerCase().startsWith(lower)) out.push(entry);
    if (out.length >= limit * 4) break; // 早停，避免超大仓库全量扫描
  }
  return out
    .sort((a, b) => b.references.length - a.references.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** 索引规模概览（面板展示） */
export function indexStats(index: ScopeIndex): {
  symbols: number;
  definitions: number;
  references: number;
  files: number;
} {
  return {
    symbols: index.symbols.size,
    definitions: index.definitionCount,
    references: index.referenceCount,
    files: index.parsedFiles,
  };
}

export type { RefSite };
