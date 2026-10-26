/**
 * Tauri 平台能力封装（浏览器 dev 模式安全降级）
 *
 * 原则：所有 @tauri-apps/api 调用都走动态 import，浏览器里不会执行到，
 * 因此 `npm run dev` + 浏览器预览依然可用（M2 的预览就是这么工作的）。
 *
 * 用到三类能力：
 *   · core.invoke      —— 读 ZIP 字节、读写配置文件
 *   · webview          —— 拖拽事件（Tauri 2 只在窗口级提供文件路径）
 *   · webviewWindow    —— 多窗口（每个 ZIP 一个独立窗口）
 */

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

/** 安全调用 Rust 命令；非 Tauri 环境返回 null（调用方决定降级行为） */
export async function invokeSafe<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/** 读取本地文件字节（拖入 ZIP 场景：Tauri 只给路径，需要 Rust 帮忙读） */
export async function readFileBytes(path: string): Promise<Uint8Array | null> {
  const base64 = await invokeSafe<string>('read_file_base64', { path });
  if (!base64) return null;
  // base64 → Uint8Array
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * N5①：弹原生目录选择对话框（rfd）。
 * 用户取消 / 非 Tauri 环境返回 null。
 */
export async function selectLocalDir(): Promise<string | null> {
  return invokeSafe<string>('select_dir');
}

/**
 * 监听窗口拖拽事件（Tauri 2 内置事件：enter / over / drop / leave）。
 * 浏览器里直接返回空订阅函数。
 */
export async function onFileDrop(
  handlers: {
    onEnter?: () => void;
    onLeave?: () => void;
    onDrop?: (paths: string[]) => void;
  },
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  const webview = getCurrentWebview();
  return webview.onDragDropEvent((event) => {
    const payload = event.payload as
      | { type: 'enter'; paths: string[] }
      | { type: 'over'; position: { x: number; y: number } }
      | { type: 'drop'; paths: string[] }
      | { type: 'leave' };
    if (payload.type === 'enter') handlers.onEnter?.();
    else if (payload.type === 'leave') handlers.onLeave?.();
    else if (payload.type === 'drop') handlers.onDrop?.(payload.paths ?? []);
  });
}

/**
 * 为 ZIP 打开一个独立窗口（验收 8：原窗口状态不变）。
 * 新窗口通过 URL 参数 zippath 告知自己要加载哪个文件。
 */
export async function openZipWindow(zipPath: string, title: string): Promise<boolean> {
  return openProjectWindow(zipPath, 'zippath', title);
}

/**
 * N5①：为本地目录打开一个独立窗口（与 ZIP 行为一致：原窗口状态不变）。
 * 新窗口通过 URL 参数 localdir 告知自己要加载哪个目录。
 */
export async function openLocalDirWindow(dirPath: string, title: string): Promise<boolean> {
  return openProjectWindow(dirPath, 'localdir', title);
}

async function openProjectWindow(target: string, param: 'zippath' | 'localdir', title: string): Promise<boolean> {
  if (!isTauri()) return false;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const url = `index.html?win=${label}&${param}=${encodeURIComponent(target)}`;
  try {
    const win = new WebviewWindow(label, {
      url,
      title,
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
    });
    // 创建失败（重名等）时兜底
    const ok = await new Promise<boolean>((resolve) => {
      win.once('tauri://created', () => resolve(true));
      win.once('tauri://error', () => resolve(false));
    });
    return ok;
  } catch {
    return false;
  }
}

/** 当前窗口标签与启动参数（多窗口入口用） */
export function windowParams(): { label: string | null; zipPath: string | null; localDir: string | null } {
  if (typeof window === 'undefined') return { label: null, zipPath: null, localDir: null };
  const params = new URLSearchParams(window.location.search);
  return { label: params.get('win'), zipPath: params.get('zippath'), localDir: params.get('localdir') };
}
