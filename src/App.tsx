/**
 * App —— 全局外壳 + 多项目工作区（N5③）
 *
 *   ┌── TopBar（全局命令中心 / 主题语言 / 打开 ZIP / 打开目录）───────────┐
 *   ├── ProjectTabs（打开 ≥2 个项目时出现，点击切换 / × 关闭）───────────┤
 *   │ ProjectView × N（每个项目独占一套 useRepo/useCodeAnalysis/useGlobalSearch）
 *   └───────────────────────────────────────────────────────────────────┘
 *
 * 全局职责（本文件）：
 *   · 配置（主题 / 语言 / Token / 预算 / jsDelivr 开关）
 *   · 顶栏命令中心（搜索 / 打开项目）—— useLauncher
 *   · 项目列表（打开 / 激活 / 关闭）—— workspace store
 *   · 设置对话框、拖拽遮罩、Tauri 拖入开新窗口
 *
 * 项目内部（ProjectView）：文件树、标签、代码/Markdown、各分析面板、状态栏。
 *
 * 关键交互（保持 1.0 行为）：
 *   · 顶栏回车打开仓库；输入关键词出搜索结果下拉
 *   · 拖入 ZIP / 目录 → 每个开独立窗口（验收 8）
 *   · 第一个项目就地加载（视觉与旧版单项目一致），之后打开的项目追加为标签
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopBar from './components/TopBar';
import ProjectTabs from './components/ProjectTabs';
import ProjectView from './components/ProjectView';
import SettingsDialog from './components/SettingsDialog';
import DragOverlay from './components/DragOverlay';
import ErrorBanner from './components/ErrorBanner';
import { useLauncher } from './hooks/useLauncher';
import { useWorkspace } from './hooks/useWorkspace';
import { workspace } from './workspace/workspace';
import { loadWorkspace, saveWorkspace, serializeWorkspace } from './workspace/persistence';
import { applyTheme, readSavedTheme, watchSystemTheme } from './theme/themes';
import { DEFAULT_CONFIG, type AppConfig, type Language, type ThemeId } from './types/config';
import { loadConfig, loadToken, saveConfig } from './utils/configStore';
import {
  isTauri,
  onFileDrop,
  openLocalDirWindow,
  openZipWindow,
  readFileBytes,
  selectLocalDir,
  windowParams,
} from './utils/tauri';

export default function App() {
  const { i18n } = useTranslation();

  // ---------- 配置（全局） ----------
  const [config, setConfig] = useState<AppConfig>(() => ({
    ...DEFAULT_CONFIG,
    theme: readSavedTheme() ?? DEFAULT_CONFIG.theme,
    language: i18n.language as Language,
  }));
  const [token, setToken] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dropInvalid, setDropInvalid] = useState(false);
  const configLoadedRef = useRef(false);

  useEffect(() => {
    void (async () => {
      const cfg = await loadConfig();
      const tk = loadToken();
      configLoadedRef.current = true;
      setConfig((prev) => ({ ...prev, ...cfg }));
      setToken(tk);
      applyTheme(cfg.theme);
      if (cfg.language !== i18n.language) void i18n.changeLanguage(cfg.language);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchConfig = useCallback((patch: Partial<AppConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      if (configLoadedRef.current) void saveConfig(next);
      return next;
    });
  }, []);

  useEffect(() => {
    applyTheme(config.theme);
    if (config.theme === 'system' || config.theme === 'atlas') {
      return watchSystemTheme(() => applyTheme(config.theme));
    }
    return undefined;
  }, [config.theme]);

  const changeLanguage = useCallback(
    (language: Language) => {
      void i18n.changeLanguage(language);
      patchConfig({ language });
    },
    [i18n, patchConfig],
  );

  // ---------- 全局：顶栏命令中心 ----------
  const launcher = useLauncher(token);

  // ---------- 全局：项目工作区 ----------
  const { projects, activeId } = useWorkspace();

  /** N5①：原生目录选择 → 作为新项目打开（仅 Tauri 桌面端） */
  const handleOpenLocalDir = useCallback(() => {
    void (async () => {
      const dir = await selectLocalDir();
      if (dir) workspace.openLocalDir(dir);
    })();
  }, []);

  // ---------- 多窗口：按 zippath / localdir 加载（本窗口的首个项目） ----------
  const { zipPath: initialZipPath, localDir: initialLocalDir } = windowParams();
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current) return;
    if (!initialZipPath && !initialLocalDir) return;
    bootstrappedRef.current = true;
    void (async () => {
      if (initialLocalDir) {
        workspace.openLocalDir(initialLocalDir);
        return;
      }
      const bytes = initialZipPath ? await readFileBytes(initialZipPath) : null;
      const name = initialZipPath?.split(/[\\/]/).pop() ?? 'project.zip';
      if (bytes) workspace.openZipBytes(bytes, name);
    })();
  }, [initialZipPath, initialLocalDir]);

  // ---------- 工作区持久化：普通启动时恢复上次打开的项目 ----------
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    // 拖入 ZIP/目录打开的多窗口：不恢复（它是独立会话）
    if (initialZipPath || initialLocalDir) return;
    const saved = loadWorkspace();
    if (!saved || saved.projects.length === 0) return;

    const ids: string[] = [];
    for (const p of saved.projects) {
      if (p.kind === 'github' && p.parsed) ids.push(workspace.openGithub(p.parsed));
      else if (p.kind === 'local' && p.rootPath) ids.push(workspace.openLocalDir(p.rootPath));
    }
    if (ids.length > 0) {
      const idx = Math.min(Math.max(saved.activeIndex, 0), ids.length - 1);
      workspace.activate(ids[idx]);
    }
  }, [initialZipPath, initialLocalDir]);

  // ---------- 工作区持久化：变化后防抖写入（首帧的 [] 会被随后的重渲染取消） ----------
  useEffect(() => {
    if (initialZipPath || initialLocalDir) return;
    const timer = setTimeout(() => {
      saveWorkspace(serializeWorkspace(projects, activeId));
    }, 400);
    return () => clearTimeout(timer);
  }, [projects, activeId, initialZipPath, initialLocalDir]);

  // ---------- 拖入（Tauri 窗口级事件）：ZIP 与目录都开新窗口，原窗口状态不变 ----------
  useEffect(() => {
    if (!isTauri()) return undefined;
    let dispose: (() => void) | undefined;
    void onFileDrop({
      onEnter: () => {
        setDropInvalid(false);
        setDropping(true);
      },
      onLeave: () => setDropping(false),
      onDrop: (paths) => {
        setDropping(false);
        if (paths.length === 0) {
          setDropInvalid(true);
          setTimeout(() => setDropInvalid(false), 2500);
          return;
        }
        void (async () => {
          for (const p of paths) {
            const name = p.split(/[\\/]/).pop() ?? 'project';
            if (p.toLowerCase().endsWith('.zip')) {
              await openZipWindow(p, `CodeAtlas — ${name}`);
            } else {
              await openLocalDirWindow(p, `CodeAtlas — ${name}`);
            }
          }
        })();
      },
    }).then((fn) => {
      dispose = fn;
    });
    return () => dispose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        searchResults={launcher.searchResults}
        searchLoading={launcher.searchLoading}
        history={launcher.history}
        onSubmit={(raw) => void launcher.submit(raw)}
        onPickResult={(fullName) => launcher.pickResult(fullName)}
        onOpenZip={(file) => void workspace.openZip(file)}
        onOpenLocalDir={isTauri() ? handleOpenLocalDir : null}
        theme={config.theme}
        onThemeChange={(theme: ThemeId) => patchConfig({ theme })}
        language={config.language}
        onLanguageChange={changeLanguage}
      />

      {launcher.error && <ErrorBanner error={launcher.error} onClose={launcher.clearError} />}

      {projects.length >= 2 && (
        <ProjectTabs
          projects={projects}
          activeId={activeId}
          onActivate={(id) => workspace.activate(id)}
          onClose={(id) => workspace.close(id)}
        />
      )}

      <div className="min-h-0 flex-1">
        {projects.map((p) => (
          <div key={p.id} className={p.id === activeId ? 'h-full' : 'hidden'}>
            <ProjectView
              entry={p}
              isActive={p.id === activeId}
              config={config}
              token={token}
              onConfigChange={patchConfig}
              onLanguageChange={changeLanguage}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
        ))}
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        onConfigChange={(patch) => {
          patchConfig(patch);
          if (patch.theme) applyTheme(patch.theme);
        }}
      />

      <DragOverlay active={dropping || dropInvalid} invalid={dropInvalid} />
    </div>
  );
}
