/**
 * commands.ts —— 顶栏主菜单 → 当前项目视图 的命令通道
 *
 * 为什么需要：面板状态（调用图 / 度量 / 阅读路线 …）属于 ProjectView，
 * 而主菜单在 TopBar。用一条极小的订阅式总线把"菜单点击"转成"当前激活项目执行"，
 * 避免把面板状态提升到 App，也避免引入全局状态库。
 *
 * 只有激活的 ProjectView 会响应（见 ProjectView 的订阅）。
 */

export type AppCommand =
  | 'panel:graph'
  | 'panel:metrics'
  | 'panel:search'
  | 'panel:reading'
  | 'panel:outline'
  | 'panel:architecture'
  | 'pack:open'
  | 'project:refresh';

type Listener = (command: AppCommand) => void;

const listeners = new Set<Listener>();

export function onCommand(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitCommand(command: AppCommand): void {
  for (const listener of [...listeners]) listener(command);
}
