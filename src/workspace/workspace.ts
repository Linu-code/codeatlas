/**
 * Workspace —— 多项目工作区（N5③）
 *
 * 目标：**在同一个窗口内同时打开多个仓库/目录，用项目标签切换**，
 * 而不是每个项目各开一个系统窗口（后者是拖拽入口的既有行为，保持不变）。
 *
 * 设计要点：
 *   · 每个项目 = 一个 ProjectEntry（含"如何加载"的 source 描述）；
 *   · 真正去加载数据、跑分析的是 `ProjectView`（它各自持有一套
 *     useRepo / useCodeAnalysis / useGlobalSearch，因此项目之间状态天然隔离）；
 *   · 本 store 只负责：项目列表、当前激活项、以及把"打开"翻译成
 *     「就地加载（当前是空项目）」或「新增一个项目标签」。
 *   · 采用极简的外部 store（subscribe/getSnapshot），配合 useSyncExternalStore
 *     让 React 订阅；不引入任何状态库。
 *
 * 空项目语义：首个项目是 kind:'none' 的空项目，用户第一次打开数据源时就地加载，
 * 视觉上与旧版单项目体验完全一致；之后再打开就追加为新的项目标签。
 */

import type { RepoMeta } from '../types/repo';

/** 打开某个项目所需的"加载描述"（由 ProjectView 在挂载/切换时执行） */
export type ProjectSource =
  | { kind: 'none' }
  | {
      kind: 'github';
      parsed: { owner: string; repo: string; branch: string | null; subDir: string | null };
    }
  | { kind: 'zip'; file: File }
  | { kind: 'zipBytes'; bytes: Uint8Array; name: string }
  | { kind: 'local'; rootPath: string };

/** 可打开的数据源（去掉"空项目"形态） */
type OpenableSource = Exclude<ProjectSource, { kind: 'none' }>;

export interface ProjectEntry {
  id: string;
  source: ProjectSource;
  /** 由 ProjectView 回报：仓库名（meta.name），未加载时为 null */
  name: string | null;
  /** 由 ProjectView 回报：数据源类型，未加载时为 null */
  sourceKind: RepoMeta['source'] | null;
  /** 由 ProjectView 回报：是否正在加载 */
  loading: boolean;
}

export interface WorkspaceSnapshot {
  projects: ProjectEntry[];
  activeId: string;
}

let seq = 0;
const newId = () => `p${++seq}`;

export class Workspace {
  private projects: ProjectEntry[];
  private activeId: string;
  private listeners = new Set<() => void>();
  private snapshot: WorkspaceSnapshot;

  constructor() {
    const first: ProjectEntry = {
      id: newId(),
      source: { kind: 'none' },
      name: null,
      sourceKind: null,
      loading: false,
    };
    this.projects = [first];
    this.activeId = first.id;
    this.snapshot = this.buildSnapshot();
  }

  private buildSnapshot(): WorkspaceSnapshot {
    return { projects: this.projects.map((p) => ({ ...p })), activeId: this.activeId };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  /** React 订阅入口（配合 useSyncExternalStore） */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): WorkspaceSnapshot => this.snapshot;

  isActiveEmpty(): boolean {
    const active = this.projects.find((p) => p.id === this.activeId);
    return !!active && active.source.kind === 'none' && active.name === null && !active.loading;
  }

  /**
   * 打开一个数据源。
   * 若当前激活项还是"空项目"（尚未加载任何东西）→ 就地加载它（视觉与旧版一致）；
   * 否则 → 追加为新的项目标签并激活。返回目标项目 id。
   */
  open(source: OpenableSource): string {
    const active = this.projects.find((p) => p.id === this.activeId);
    if (active && active.source.kind === 'none' && active.name === null && !active.loading) {
      active.source = source;
      active.loading = true;
      active.name = null;
      active.sourceKind = null;
      this.emit();
      return active.id;
    }
    const entry: ProjectEntry = {
      id: newId(),
      source,
      name: null,
      sourceKind: null,
      loading: true,
    };
    this.projects.push(entry);
    this.activeId = entry.id;
    this.emit();
    return entry.id;
  }

  openGithub(parsed: {
    owner: string;
    repo: string;
    branch: string | null;
    subDir: string | null;
  }): string {
    return this.open({ kind: 'github', parsed });
  }

  openZip(file: File): string {
    return this.open({ kind: 'zip', file });
  }

  openZipBytes(bytes: Uint8Array, name: string): string {
    return this.open({ kind: 'zipBytes', bytes, name });
  }

  openLocalDir(rootPath: string): string {
    return this.open({ kind: 'local', rootPath });
  }

  /** ProjectView 回报当前加载状态（用于项目标签的标题与 loading 指示） */
  report(
    id: string,
    patch: { name: string | null; sourceKind: RepoMeta['source'] | null; loading: boolean },
  ): void {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    if (p.name === patch.name && p.sourceKind === patch.sourceKind && p.loading === patch.loading) {
      return;
    }
    p.name = patch.name;
    p.sourceKind = patch.sourceKind;
    p.loading = patch.loading;
    this.emit();
  }

  activate(id: string): void {
    if (this.activeId === id || !this.projects.some((p) => p.id === id)) return;
    this.activeId = id;
    this.emit();
  }

  /** 关闭项目；若关掉最后一个，则自动补一个空项目（保证"永远有当前项目"） */
  close(id: string): void {
    const i = this.projects.findIndex((p) => p.id === id);
    if (i < 0) return;
    const wasActive = this.activeId === id;
    this.projects.splice(i, 1);

    if (this.projects.length === 0) {
      const fresh: ProjectEntry = {
        id: newId(),
        source: { kind: 'none' },
        name: null,
        sourceKind: null,
        loading: false,
      };
      this.projects.push(fresh);
      this.activeId = fresh.id;
    } else if (wasActive) {
      this.activeId = this.projects[Math.min(i, this.projects.length - 1)].id;
    }
    this.emit();
  }
}

/** 全局单例：一个窗口一份工作区 */
export const workspace = new Workspace();
