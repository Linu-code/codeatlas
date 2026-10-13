/**
 * App —— VSCode 风格主布局 + 多窗口入口
 *
 *   ┌── TopBar（命令中心 / 主题语言 / 打开 ZIP）───────────────────────┐
 *   ├── ToolBar（调用图 / 度量 / 全局搜索 / 上下文包 / 刷新 / 设置）────┤
 *   │ FileTree │ EditorTabs + 面包屑                                  │
 *   │          │ MarkdownView / CodeView                               │
 *   │          │ 底部面板：调用图 / 度量 / 全局搜索 / 符号引用            │
 *   └── StatusBar ────────────────────────────────────────────────────┘
 *
 * 关键交互：
 *   · Ctrl/Cmd + 单击标识符 或 选中文本后 F12 → 转到定义（未找到则列引用）
 *   · Ctrl/Cmd + Shift + F → 全局正则搜索（Worker，10 秒超时）
 *   · ZIP 拖入 → 每个 ZIP 开独立窗口，原窗口状态不变
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopBar from './components/TopBar';
import ToolBar, { type BottomPanel } from './components/ToolBar';
import FileTree from './components/FileTree';
import EditorTabs from './components/EditorTabs';
import CodeView from './components/CodeView';
import MarkdownView from './components/MarkdownView';
import WelcomeScreen from './components/WelcomeScreen';
import CallGraphPanel from './components/CallGraphPanel';
import MetricsPanel from './components/MetricsPanel';
import SearchPanel from './components/SearchPanel';
import ReferencesPanel from './components/ReferencesPanel';
import ReadingPathPanel from './components/ReadingPathPanel';
import OutlinePanel from './components/OutlinePanel';
import ArchitecturePanel from './components/ArchitecturePanel';
import CommandPalette, { type PaletteItem } from './components/CommandPalette';
import ContextPackDialog from './components/ContextPackDialog';
import SettingsDialog from './components/SettingsDialog';
import DragOverlay from './components/DragOverlay';
import { useRepo } from './hooks/useRepo';
import { useCodeAnalysis } from './hooks/useCodeAnalysis';
import { useGlobalSearch } from './hooks/useGlobalSearch';
import { applyTheme, readSavedTheme, watchSystemTheme } from './theme/themes';
import { githubLinkBase, githubRawBase } from './utils/markdown';
import { flattenFiles } from './sources/tree';
import { formatSize } from './utils/format';
import { annotateDirectories } from './analysis/directories';
import { generateContextPack, type ContextPack } from './analysis/contextPack';
import { findSymbol, gotoDefinition, indexStats } from './analysis/scopeGraph';
import type { ZipSource } from './sources/zip';
import { DEFAULT_CONFIG, type AppConfig, type Language, type ThemeId } from './types/config';
import { loadConfig, loadToken, saveConfig } from './utils/configStore';
import { isTauri, onFileDrop, openZipWindow, readFileBytes, windowParams } from './utils/tauri';

export default function App() {
  const { t, i18n } = useTranslation(['common', 'viewer', 'analysis', 'errors']);

  // ---------- 配置 ----------
  const [config, setConfig] = useState<AppConfig>(() => ({
    ...DEFAULT_CONFIG,
    theme: readSavedTheme() ?? DEFAULT_CONFIG.theme,
    language: i18n.language as Language,
  }));
  const [token, setToken] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  // ---------- 项目 / 分析状态 ----------
  const repo = useRepo({ token, jsdelivrFallback: config.jsdelivrFallback });
  const analysis = useCodeAnalysis();
  const search = useGlobalSearch();

  const [panel, setPanel] = useState<BottomPanel>('none');
  const [refSymbol, setRefSymbol] = useState<string | null>(null);
  const [jumpTarget, setJumpTarget] = useState<{ file: string; line: number } | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  const [pack, setPack] = useState<ContextPack | null>(null);
  const [packGenerating, setPackGenerating] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dropInvalid, setDropInvalid] = useState(false);
  /** 命令面板（N2）：Ctrl+K 全量入口，Ctrl+T 只搜符号 */
  const [palette, setPalette] = useState<{ open: boolean; mode: 'all' | 'symbol' }>({
    open: false,
    mode: 'all',
  });

  const fs = repo.fs;
  const meta = fs?.meta;
  const active = repo.activeTabData;
  const fileCount = useMemo(
    () => (repo.tree.length ? flattenFiles(repo.tree).length : 0),
    [repo.tree],
  );

  /** 目录用途标注（供文件树图标与上下文包使用） */
  const dirPurposes = useMemo(() => annotateDirectories(repo.tree), [repo.tree]);

  /** 目录用途的本地化文案（文件树 / 阅读路线 / 架构分层共用同一份） */
  const dirPurposeLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const p of dirPurposes.values()) {
      labels[p.key] = t(`analysis:purpose.${p.key}` as never) as unknown as string;
    }
    return labels;
  }, [dirPurposes, t]);

  // 打开新项目时重置分析结果与面板
  useEffect(() => {
    analysis.reset();
    search.reset();
    setPanel('none');
    setPack(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs]);

  // ---------- 多窗口：按 zippath 加载 ----------
  const { zipPath: initialZipPath } = windowParams();
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current || !initialZipPath) return;
    bootstrappedRef.current = true;
    void (async () => {
      const bytes = await readFileBytes(initialZipPath);
      const name = initialZipPath.split(/[\\/]/).pop() ?? 'project.zip';
      if (bytes) await repo.loadZipBytes(bytes, name);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialZipPath]);

  // ---------- ZIP 拖入（Tauri 窗口级事件） ----------
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
        const zips = paths.filter((p) => p.toLowerCase().endsWith('.zip'));
        if (zips.length === 0) {
          setDropInvalid(true);
          setTimeout(() => setDropInvalid(false), 2500);
          return;
        }
        void (async () => {
          for (const p of zips) {
            const name = p.split(/[\\/]/).pop() ?? 'project.zip';
            await openZipWindow(p, `CodeAtlas — ${name}`);
          }
        })();
      },
    }).then((fn) => {
      dispose = fn;
    });
    return () => dispose?.();
  }, []);

  // ---------- 跳转：打开文件并定位行 ----------
  const openFileAt = useCallback(
    async (file: string, line: number) => {
      await repo.openFile(file);
      setJumpTarget({ file, line });
    },
    [repo],
  );

  /** 确保索引已建立（首次跳转/查找引用时按需分析），返回**最新**结果 */
  const ensureAnalysis = useCallback(async () => {
    if (!fs) return analysis.getState();
    const current = analysis.getState();
    if (current.index) return current;
    return analysis.analyze(fs, repo.tree);
  }, [analysis, fs, repo.tree]);

  /** 转到定义；未找到则展开引用面板 */
  const handleSymbol = useCallback(
    async (symbol: string) => {
      const name = symbol.replace(/[^A-Za-z0-9_$]/g, '');
      if (!name) return;
      // 注意：必须用 analyze() 的返回值 / getState()，不能读闭包里的旧 state
      const bundle = await ensureAnalysis();
      const def = bundle.index
        ? gotoDefinition(bundle.index, name, repo.activeTab ?? undefined)
        : null;
      if (def) {
        await openFileAt(def.file, def.line);
        return;
      }
      // 未找到定义 → 展示引用（通常也为空）并给出提示
      setRefSymbol(name);
      setPanel('references');
    },
    [ensureAnalysis, openFileAt, repo.activeTab],
  );

  // F12：选中文本 → 转到定义；Ctrl/Cmd+K 命令面板；Ctrl/Cmd+T 符号搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.preventDefault();
        const sel = window.getSelection()?.toString().trim();
        if (sel) void handleSymbol(sel);
        return;
      }
      // Ctrl/Cmd + Shift + F → 全局搜索
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (fs) {
          setPanel('search');
        }
        return;
      }
      // Ctrl/Cmd + K → 命令面板（文件 / 符号 / 命令统一入口）
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (fs) setPalette({ open: true, mode: 'all' });
        return;
      }
      // Ctrl/Cmd + T → 符号搜索（复用 scopeGraph 索引）
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        if (!fs) return;
        setPalette({ open: true, mode: 'symbol' });
        // 符号条目需要索引：没分析过就先跑一次，结果到达后条目会自动出现
        if (!analysis.getState().index) void analysis.analyze(fs, repo.tree);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [analysis, fs, handleSymbol, repo.tree]);

  // ---------- 面板切换 ----------
  const togglePanel = useCallback(
    async (target: Exclude<BottomPanel, 'none'>) => {
      if (panel === target) {
        setPanel('none');
        return;
      }
      setPanel(target);
      if (!fs) return;
      // 这些面板都依赖分析结果，首次打开时按需触发一次分析
      if (
        target === 'graph' ||
        target === 'metrics' ||
        target === 'references' ||
        target === 'reading' ||
        target === 'outline' ||
        target === 'architecture'
      ) {
        await analysis.analyze(fs, repo.tree);
      }
    },
    [analysis, fs, panel, repo.tree],
  );

  // ---------- AI 上下文包 ----------
  const generatePack = useCallback(async () => {
    if (!fs) return;
    setPackGenerating(true);
    try {
      // 用 analyze() 的返回值（权威结果），而不是可能过期的闭包 state
      const bundle = await analysis.analyze(fs, repo.tree);
      if (!bundle.index) return;
      setPack(
        generateContextPack({
          repoName: fs.meta.name,
          branch: fs.meta.branch,
          files: bundle.files,
          index: bundle.index,
          metrics: bundle.metrics,
          treePaths: flattenFiles(repo.tree),
          dirPurposes,
          purposeLabels: dirPurposeLabels,
          maxTokens: config.maxTokens,
          // N2：把建议阅读路线一并写入（已存在则写入，未分析则本次为空）
          readingPath: bundle.readingPath?.steps.map((s) => ({
            path: s.path,
            order: s.order,
            role: s.role,
          })),
        }),
      );
    } finally {
      setPackGenerating(false);
    }
  }, [analysis, config.maxTokens, dirPurposeLabels, dirPurposes, fs, repo.tree]);

  // ---------- 资源前缀 ----------
  const rawBase = useMemo(() => {
    if (!meta || meta.source !== 'github' || !meta.owner || !meta.repo || !meta.branch) return null;
    return githubRawBase(meta.owner, meta.repo, meta.branch);
  }, [meta]);

  const linkBase = useMemo(() => {
    if (!meta || meta.source !== 'github' || !meta.owner || !meta.repo || !meta.branch) return null;
    return githubLinkBase(meta.owner, meta.repo, meta.branch);
  }, [meta]);

  const resolveZipAsset = useCallback(
    async (src: string) => {
      if (!fs || fs.meta.source !== 'zip') return null;
      const readmeDir = repo.readme?.path.includes('/')
        ? repo.readme.path.slice(0, repo.readme.path.lastIndexOf('/') + 1)
        : '';
      try {
        const blob = await (fs as ZipSource).readBlob(readmeDir + src.replace(/^\.\//, ''));
        return URL.createObjectURL(blob);
      } catch {
        return null;
      }
    },
    [fs, repo.readme],
  );

  const refEntry = refSymbol && analysis.state.index ? findSymbol(analysis.state.index, refSymbol) : null;
  const stats = analysis.state.index ? indexStats(analysis.state.index) : null;

  /** 当前打开文件的分析结果（大纲面板用）；未纳入分析时为 null */
  const activeFileAnalysis = useMemo(
    () => analysis.state.files.find((f) => f.path === repo.activeTab) ?? null,
    [analysis.state.files, repo.activeTab],
  );

  // ---------- 命令面板条目（N2）----------
  // 三类条目统一入口：命令 / 文件 / 符号。条目自带 onRun，面板本身保持"哑"组件。
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    const addPanel = (panel: Exclude<BottomPanel, 'none'>, label: string, keywords: string) => {
      items.push({
        id: `cmd:${panel}`,
        section: 'command',
        label,
        keywords,
        onRun: () => void togglePanel(panel),
      });
    };

    if (fs) {
      addPanel('graph', t('analysis:callGraph'), 'call graph 调用关系图');
      addPanel('metrics', t('analysis:metrics'), 'metrics 度量');
      addPanel('reading', t('analysis:readingPath'), 'reading path 阅读路线');
      addPanel('architecture', t('analysis:architecture'), 'architecture 架构');
      addPanel('outline', t('analysis:outline'), 'outline 大纲');
      addPanel('search', t('analysis:globalSearch'), 'search grep 搜索');
      items.push({
        id: 'cmd:context-pack',
        section: 'command',
        label: t('analysis:contextPackGenerate'),
        keywords: 'context pack 上下文包',
        onRun: () => {
          setPackOpen(true);
          if (!pack) void generatePack();
        },
      });
      items.push({
        id: 'cmd:refresh',
        section: 'command',
        label: t('common:refresh'),
        keywords: 'refresh reload 刷新',
        onRun: () =>
          void (async () => {
            await repo.refresh();
            analysis.reset();
          })(),
      });
    }

    const themeLabels: Record<ThemeId, string> = {
      light: t('common:themeLight'),
      dark: t('common:themeDark'),
      system: t('common:themeSystem'),
      atlas: t('common:themeAtlas'),
    };
    for (const theme of ['light', 'dark', 'system', 'atlas'] as ThemeId[]) {
      items.push({
        id: `cmd:theme:${theme}`,
        section: 'command',
        label: `${t('common:theme')} · ${themeLabels[theme]}`,
        keywords: `theme ${theme} 主题`,
        onRun: () => {
          patchConfig({ theme });
          applyTheme(theme);
        },
      });
    }

    const langLabels: [Language, string][] = [
      ['zh', t('common:langZh')],
      ['en', t('common:langEn')],
      ['ja', t('common:langJa')],
    ];
    for (const [code, label] of langLabels) {
      items.push({
        id: `cmd:lang:${code}`,
        section: 'command',
        label: `${t('common:language')} · ${label}`,
        keywords: `language ${code} 语言`,
        onRun: () => {
          void i18n.changeLanguage(code);
          patchConfig({ language: code });
        },
      });
    }

    items.push({
      id: 'cmd:settings',
      section: 'command',
      label: t('common:settings'),
      keywords: 'settings preferences 设置',
      onRun: () => setSettingsOpen(true),
    });

    // 文件：label 用文件名，keywords 用完整路径（既能按名字也能按路径搜）
    if (fs) {
      for (const path of flattenFiles(repo.tree)) {
        items.push({
          id: `file:${path}`,
          section: 'file',
          label: path.split('/').pop() ?? path,
          hint: path,
          keywords: path,
          onRun: () => void repo.openFile(path),
        });
      }
    }

    // 符号：来自符号索引（未分析时为空，Ctrl+T 会先触发分析）
    const index = analysis.state.index;
    if (index) {
      for (const entry of index.symbols.values()) {
        const def = entry.definitions[0];
        if (!def) continue;
        items.push({
          id: `sym:${entry.name}`,
          section: 'symbol',
          label: entry.name,
          hint: `${def.file}:${def.line}`,
          keywords: `${entry.name} ${def.file}`,
          onRun: () => void openFileAt(def.file, def.line),
        });
      }
    }

    return items;
  }, [
    analysis,
    fs,
    generatePack,
    i18n,
    openFileAt,
    pack,
    patchConfig,
    repo,
    t,
    togglePanel,
  ]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        searchResults={repo.searchResults}
        searchLoading={repo.searchLoading}
        history={repo.history}
        onSubmit={repo.submit}
        onPickResult={(fullName) => void repo.submit(fullName)}
        onOpenZip={(file) => void repo.loadZip(file)}
        theme={config.theme}
        onThemeChange={(theme: ThemeId) => patchConfig({ theme })}
        language={config.language}
        onLanguageChange={(language: Language) => {
          void i18n.changeLanguage(language);
          patchConfig({ language });
        }}
      />

      <ToolBar
        hasProject={Boolean(fs)}
        panel={panel}
        analyzing={analysis.state.running}
        analyzingLabel={t('analysis:analyzing')}
        onTogglePanel={(p) => void togglePanel(p)}
        onToggleContextPack={() => {
          setPackOpen(true);
          if (!pack) void generatePack();
        }}
        onRefresh={() =>
          void (async () => {
            await repo.refresh();
            analysis.reset();
          })()
        }
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {repo.error && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-xs"
          style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)', color: 'var(--c-error)' }}
        >
          <span>
            <strong className="me-2">{t('errors:title')}:</strong>
            {t(`errors:${repo.error.code}`)}
          </span>
          <button onClick={repo.clearError} className="rounded px-2 py-1" style={{ color: 'var(--c-text-2)' }}>
            {t('common:close')}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {repo.tree.length > 0 && (
          <FileTree
            tree={repo.tree}
            activePath={repo.activeTab}
            onSelect={(p) => void repo.openFile(p)}
            orderByPath={analysis.state.readingPath?.orderByPath}
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <EditorTabs
            tabs={repo.tabs}
            activePath={repo.activeTab}
            onSelect={(p) => void repo.openFile(p)}
            onClose={repo.closeTab}
            onCloseAll={repo.closeAllTabs}
          />

          <div className="min-h-0 flex-1">
            {repo.loading && (
              <div className="grid h-full place-items-center text-xs" style={{ color: 'var(--c-text-2)' }}>
                <span className="flex items-center gap-2">
                  <span className="ca-spinner" aria-hidden />
                  {t('common:loading')}
                </span>
              </div>
            )}

            {!repo.loading && !active && <WelcomeScreen />}

            {!repo.loading && active?.error && (
              <div className="grid h-full place-items-center text-xs" style={{ color: 'var(--c-error)' }}>
                {t(`errors:${active.error.code}`)}
              </div>
            )}

            {!repo.loading && active?.kind === 'loading' && (
              <div className="grid h-full place-items-center text-xs" style={{ color: 'var(--c-text-2)' }}>
                {t('common:loading')}
              </div>
            )}

            {!repo.loading && active?.kind === 'markdown' && active.content !== null && (
              <MarkdownView
                content={active.content}
                baseUrl={rawBase}
                linkBase={linkBase}
                resolveAsset={meta?.source === 'zip' ? resolveZipAsset : undefined}
              />
            )}

            {!repo.loading && active?.kind === 'code' && active.content !== null && (
              <CodeView
                code={active.content}
                language={active.language}
                highlightLine={jumpTarget?.file === active.path ? jumpTarget.line : null}
                onSymbolClick={(token) => void handleSymbol(token)}
              />
            )}

            {!repo.loading && active?.kind === 'unsupported' && (
              <div className="grid h-full place-items-center text-xs" style={{ color: 'var(--c-text-2)' }}>
                {t('viewer:unsupportedPreview')}
              </div>
            )}

            {!repo.loading && active?.kind === 'binary' && (
              <div className="grid h-full place-items-center text-xs" style={{ color: 'var(--c-text-2)' }}>
                {t('viewer:binaryFile')}
              </div>
            )}
          </div>

          {panel === 'graph' && (
            <CallGraphPanel
              state={analysis.state}
              onAnalyze={() => fs && void analysis.analyze(fs, repo.tree, { force: true })}
              onClose={() => setPanel('none')}
              onOpenFile={(file, line) => void openFileAt(file, line)}
            />
          )}

          {panel === 'metrics' && (
            <MetricsPanel
              state={analysis.state}
              onClose={() => setPanel('none')}
              onOpenFile={(file, line) => void openFileAt(file, line)}
            />
          )}

          {panel === 'search' && (
            <SearchPanel
              state={search.state}
              hasProject={Boolean(fs)}
              onSearch={(pattern, flags) =>
                void (async () => {
                  if (!fs) return;
                  await search.search(fs, repo.tree, pattern, flags);
                })()
              }
              onClose={() => setPanel('none')}
              onOpenFile={(file, line) => void openFileAt(file, line)}
            />
          )}

          {panel === 'references' && (
            <ReferencesPanel
              symbol={refSymbol}
              entry={refEntry}
              indexed={Boolean(analysis.state.index)}
              onClose={() => setPanel('none')}
              onOpenFile={(file, line) => void openFileAt(file, line)}
            />
          )}

          {panel === 'reading' && (
            <ReadingPathPanel
              path={analysis.state.readingPath}
              running={analysis.state.running}
              onOpenFile={(file, line) => void openFileAt(file, line)}
              onAnalyze={() => fs && void analysis.analyze(fs, repo.tree, { force: true })}
              onClose={() => setPanel('none')}
              onWriteToContextPack={() => {
                setPackOpen(true);
                void generatePack();
              }}
              dirLabels={dirPurposeLabels}
            />
          )}

          {panel === 'outline' && (
            <OutlinePanel
              file={repo.activeTab}
              definitions={activeFileAnalysis?.definitions ?? null}
              running={analysis.state.running}
              onOpenFile={(file, line) => void openFileAt(file, line)}
              onAnalyze={() => fs && void analysis.analyze(fs, repo.tree, { force: true })}
              onClose={() => setPanel('none')}
            />
          )}

          {panel === 'architecture' && (
            <ArchitecturePanel
              graph={analysis.state.moduleGraph}
              cycles={analysis.state.cycles}
              classGraph={analysis.state.classGraph}
              layers={analysis.state.layers}
              moduleMermaid={analysis.state.moduleMermaid}
              classMermaid={analysis.state.classMermaid}
              running={analysis.state.running}
              onAnalyze={() => fs && void analysis.analyze(fs, repo.tree, { force: true })}
              onOpenFile={(file, line) => void openFileAt(file, line)}
              onClose={() => setPanel('none')}
              purposeLabels={dirPurposeLabels}
            />
          )}
        </main>
      </div>

      <footer
        className="flex h-6 shrink-0 items-center gap-4 border-t px-3 text-[11px]"
        style={{ background: 'var(--c-bg-2)', borderColor: 'var(--c-border)', color: 'var(--c-text-2)' }}
      >
        {meta ? (
          <>
            <span>
              {t('viewer:source')}: {meta.source === 'github' ? 'GitHub' : t('viewer:zipFile')}
            </span>
            <span>{meta.name}</span>
            {meta.branch && (
              <span>
                {t('viewer:branch')}: {meta.branch}
              </span>
            )}
            <span>
              {t('viewer:fileCount')}: {fileCount}
            </span>
            {stats && (
              <span>
                {t('analysis:indexStats', {
                  symbols: stats.symbols,
                  references: stats.references,
                  files: stats.files,
                })}
              </span>
            )}
            {!analysis.state.running && analysis.state.incremental.cached > 0 && (
              <span style={{ color: 'var(--c-success)' }}>
                {t('analysis:incrementalStats', {
                  cached: analysis.state.incremental.cached,
                  parsed: analysis.state.incremental.parsed,
                })}
              </span>
            )}
            {active && <span className="truncate">{active.path}</span>}
            {active?.content != null && (
              <span>
                {t('viewer:fileSize')}: {formatSize(new Blob([active.content]).size, i18n.language)}
              </span>
            )}
          </>
        ) : (
          <span>CodeAtlas v1.0.0</span>
        )}
      </footer>

      <ContextPackDialog
        open={packOpen}
        pack={pack}
        generating={packGenerating}
        budget={config.maxTokens}
        onGenerate={() => void generatePack()}
        onClose={() => setPackOpen(false)}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        onConfigChange={(patch) => {
          patchConfig(patch);
          if (patch.theme) applyTheme(patch.theme);
          if (patch.maxTokens !== undefined) setPack(null); // 预算变化后需重新生成
        }}
      />

      <DragOverlay active={dropping || dropInvalid} invalid={dropInvalid} />

      <CommandPalette
        open={palette.open}
        mode={palette.mode}
        items={paletteItems}
        onClose={() => setPalette((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}
