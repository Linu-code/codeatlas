/**
 * useWorkspace —— 订阅工作区（项目列表 + 当前激活项）
 *
 * 仅做 `useSyncExternalStore` 绑定；所有变更方法直接调用 `workspace` 单例
 * （方法内部保持稳定引用，避免闭包捕获过期的 activeId）。
 */

import { useSyncExternalStore } from 'react';
import { workspace, type WorkspaceSnapshot } from '../workspace/workspace';

export function useWorkspace(): WorkspaceSnapshot {
  return useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
}
