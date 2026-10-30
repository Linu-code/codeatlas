/**
 * ProjectView —— 单个项目的完整视图（N5③ 多项目工作区）
 *
 * 每个 ProjectView 各自持有一套 useRepo / useCodeAnalysis / useGlobalSearch，
 * 因此"项目之间的浏览标签、分析结果、搜索结果"天然隔离；工作区把多个
 * ProjectView 同时挂载，只显示当前激活的那个（其余 display:none 保留状态）。
 *
 * 全局的东西（配置 / 主题 / 顶栏命令中心 / 设置对话框 / 拖拽 / 项目标签）
 * 都在 App 里；本组件只关心"一个项目内部"。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { onCommand, type AppCommand } from '../workspace/commands';
import { isModPressed } from '../utils/platform';
import FileTree from './FileTree';
import EditorTabs from './EditorTabs';
import CodeView from './CodeView';
import MarkdownView from './MarkdownView';
import WelcomeScreen from './WelcomeScreen';
import CallGraphPanel from './CallGraphPanel';
import MetricsPanel from './MetricsPanel';
import SearchPanel from './SearchPanel';
import ReferencesPanel from './ReferencesPanel';
import ReadingPathPanel from './ReadingPathPanel';
import OutlinePanel from './OutlinePanel';
import ArchitecturePanel from './ArchitecturePanel';
import CommandPalette, { type PaletteItem } from './CommandPalette';
import ContextPackDialog from './ContextPackDialog';
import ErrorBanner from './ErrorBanner';
import { useRepo } from '../hooks/useRepo';
import { useCodeAnalysis } from '../hooks/useCodeAnalysis';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { exportHtmlReport } from '../report/exportReport';
import { githubLinkBase, githubRawBase } from '../utils/markdown';
import { flattenFiles } from '../sources/tree';
import { formatSize } from '../utils/format';
import { annotateDirectories } from '../analysis/directories';
import {
  generateContextPack,
  PACK_INTENTS,
  type ContextPack,
  type PackIntent,
} from '../analysis/contextPack';
import { formatSlice, resolveAddress, type SliceOutcome } from '../analysis/slice';
import { buildDirectoryDigest, buildFileSymbolIndex } from '../analysis/hierarchy';
import { estimateTokens } from '../utils/tokenEstimator';

const PACK_INTENT_KEY = 'codeatlas.packIntent';

/** 读上次使用的用途；白名单来自 PACK_INTENTS，新增用途不会漏校验 */
function readSavedIntent(): PackIntent {
  try {
    const saved = localStorage.getItem(PACK_INTENT_KEY);
    return PACK_INTENTS.includes(saved as PackIntent) ? (saved as PackIntent) : 'overview';
  } catch {
    return 'overview';
  }
}
import { findSymbol, gotoDefinition, indexStats } from '../analysis/scopeGraph';
import type { AppConfig, Language, ThemeId } from '../types/config';
import { workspace, type ProjectEntry } from '../workspace/workspace';

interface Props {
  entry: ProjectEntry;
  /** 是否为当前激活项目（非激活时不响应全局快捷键与顶栏菜单命令） */
  isActive: boolean;
  config: AppConfig;
  token: string;
  onConfigChange: (patch: Partial<AppConfig>) => void;
  onLanguageChange: (lang: Language) => void;
  onOpenSettings: () => void;
}

/** 底部面板种类（原 ToolBar 导出；工具条移除后就近定义） */
type BottomPanel =
  | 'none'
  | 'graph'
  | 'metrics'
  | 'search'
  | 'references'
  | 'reading'
  | 'outline'
  | 'architecture';

export default function ProjectView({
  entry,
  isActive,
  config,
  token,
  onConfigChange,
  onLanguageChange,
  onOpenSettings,
}: Props) {
  const { t, i18n } = useTranslation(['common', 'viewer', 'analysis', 'errors']);

  const repo = useRepo({ token, jsdelivrFallback: config.jsdelivrFallback });
  const analysis = useCodeAnalysis();
  const search = useGlobalSearch();

  const [panel, setPanel] = useState<BottomPanel>('none');
  const [refSymbol, setRefSymbol] = useState<string | null>(null);
  const [jumpTarget, setJumpTarget] = useState<{ file: string; line: number } | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  const [pack, setPack] = useState<ContextPack | null>(null);
  const [packGenerating, setPackGenerating] = useState(false);
  // 用途由本视图持有：既保证与"已生成的包"一致（原来对话框自己存一份，
  // 重开后下拉显示 overview、内容却是索引包），也让选择能跨会话记住。
  const [packIntent, setPackIntent] = useState<PackIntent>(readSavedIntent);
  const changePackIntent = useCallback((next: PackIntent) => {
    setPackIntent(next);
    try {
      localStorage.setItem(PACK_INTENT_KEY, next);
    } catch {
      // 隐私模式下写不进去，不影响使用
    }
  }, []);
  /** 当前上下文包是按哪个 token 预算生成的（用于预算变更时判断是否失效） */
  const lastPackBudgetRef = useRef<number | null>(null);
  /** 命令面板（N2）：Ctrl+K 全量入口，Ctrl+T 只搜符号 */
  const [palette, setPalette] = useState<{ open: boolean; mode: 'all' | 'symbol' }>({
    open: false,
    mode: 'all',
  });

  // ---------- 按 source 加载数据源（挂载时 / 空项目被"就地加载"时） ----------
  const loadedSourceRef = useRef<unknown>(null);
  useEffect(() => {
    const src = entry.source;
    if (src.kind === 'none') return;
    if (loadedSourceRef.current === src) return;
    loadedSourceRef.current = src;
    // 分支在 effect 体（而非嵌套闭包）内完成，确保联合类型窄化生效
    const task =
      src.kind === 'github'
        ? repo.loadGithub(src.parsed)
        : src.kind === 'zip'
          ? repo.loadZip(src.file)
          : src.kind === 'zipBytes'
            ? repo.loadZipBytes(src.bytes, src.name)
            : repo.loadLocalDir(src.rootPath);
    void task;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.source]);

  // ---------- 回报加载状态给工作区（项目标签的标题 / loading 指示） ----------
  useEffect(() => {
    workspace.report(entry.id, {
      name: repo.fs?.meta.name ?? null,
      sourceKind: repo.fs?.meta.source ?? null,
      loading: repo.loading,
    });
  }, [entry.id, repo.fs, repo.loading]);

  const fs = repo.fs;
  const meta = fs?.meta;
  const activeTab = repo.activeTab;
  const active = repo.activeTabData;
  const fileCount = useMemo(
    () => (repo.tree.length ? flattenFiles(repo.tree).length : 0),
    [repo.tree],
  );

  /**
   * 当前文件字节数。
   * 必须 memo：`new Blob([content])` 会复制整段文本，而本组件在分析进度更新时
   * 会高频重渲染（每 progressStep 个文件一次），大文件会被反复复制几十次。
   */
  const activeSize = useMemo(
    () => (active?.content != null ? new Blob([active.content]).size : null),
    [active?.path, active?.content],
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

  // 打开/刷新项目时重置面板与上下文包
  useEffect(() => {
    setPanel('none');
    setPack(null);
    lastPackBudgetRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs]);

  /**
   * 预算变化时让旧包失效；但预设按钮会"改预算 + 立即按新预算重生成"，
   * 这两步存在时序竞争，因此用 ref 记录当前包是按哪个预算生成的，避免误清。
   */
  useEffect(() => {
    if (lastPackBudgetRef.current !== null && lastPackBudgetRef.current !== config.maxTokens) {
      setPack(null);
      lastPackBudgetRef.current = null;
    }
  }, [config.maxTokens]);

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
      const bundle = await ensureAnalysis();
      const def = bundle.index
        ? gotoDefinition(bundle.index, name, repo.activeTab ?? undefined)
        : null;
      if (def) {
        await openFileAt(def.file, def.line);
        return;
      }
      setRefSymbol(name);
      setPanel('references');
    },
    [ensureAnalysis, openFileAt, repo.activeTab],
  );

  // F12 / Ctrl+Shift+F / Ctrl+K / Ctrl+T —— 仅激活项目响应
  useEffect(() => {
    if (!isActive) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.preventDefault();
        const sel = window.getSelection()?.toString().trim();
        if (sel) void handleSymbol(sel);
        return;
      }
      if (isModPressed(e) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (fs) setPanel('search');
        return;
      }
      if (isModPressed(e) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (fs) setPalette({ open: true, mode: 'all' });
        return;
      }
      if (isModPressed(e) && !e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        if (!fs) return;
        setPalette({ open: true, mode: 'symbol' });
        if (!analysis.getState().index) void analysis.analyze(fs, repo.tree);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive, analysis, fs, handleSymbol, repo.tree]);

  // ---------- 面板切换 ----------
  const togglePanel = useCallback(
    async (target: Exclude<BottomPanel, 'none'>) => {
      if (panel === target) {
        setPanel('none');
        return;
      }
      setPanel(target);
      if (!fs) return;
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
  const generatePack = useCallback(
    async (budgetOverride?: number, intentOverride?: PackIntent, focusOverride?: string) => {
      if (!fs) return null;
      const usedIntent = intentOverride ?? packIntent;
      if (usedIntent !== packIntent) changePackIntent(usedIntent);
      setPackGenerating(true);
      try {
        const bundle = await analysis.analyze(fs, repo.tree);
        if (!bundle.index) return null;
        const treePaths = flattenFiles(repo.tree);
        const usedBudget = budgetOverride ?? config.maxTokens;
        // package.json：把「怎么跑 / 用什么」带进上下文包（读失败不影响生成）
        let manifestText: string | undefined;
        if (treePaths.includes('package.json')) {
          try {
            manifestText = await fs.readFile('package.json');
          } catch {
            manifestText = undefined;
          }
        }
        const result = generateContextPack({
          repoName: fs.meta.name,
          branch: fs.meta.branch,
          intent: usedIntent,
          focusQuery: focusOverride,
          fileEdges: bundle.moduleGraph?.fileEdges,
          cycles: bundle.cycles ?? undefined,
          files: bundle.files,
          index: bundle.index,
          metrics: bundle.metrics,
          treePaths,
          totalFiles: treePaths.length,
          dirPurposes,
          purposeLabels: dirPurposeLabels,
          maxTokens: usedBudget,
          manifestText,
          readingPath: bundle.readingPath?.steps.map((s) => ({
            path: s.path,
            order: s.order,
            role: s.role,
          })),
        });
        lastPackBudgetRef.current = usedBudget;
        setPack(result);
        return result;
      } finally {
        setPackGenerating(false);
      }
    },
    [analysis, changePackIntent, config.maxTokens, dirPurposeLabels, dirPurposes, fs, packIntent, repo.tree],
  );

  /**
   * 按需展开：把 `路径:行号` / `路径#符号` 解析成带行号的代码片段。
   * 与上下文包互补——包给"有什么、在哪"，这里按地址取实现，只花几百 token。
   */
  const sliceFromAddress = useCallback(
    async (address: string): Promise<SliceOutcome> => {
      if (!fs) return { kind: 'invalid', reason: 'not-found' };
      const bundle = await analysis.analyze(fs, repo.tree);
      const resolved = resolveAddress(address, {
        files: bundle.files,
        paths: flattenFiles(repo.tree),
      });
      // 分级寻址：`dir/` 给目录摘要，`index:path` 给文件符号清单。
      // 这两种都不是代码，而是**下一级地址入口**——它们是"索引包覆盖不到"的解药。
      if (resolved.kind === 'digest') {
        const digest = buildDirectoryDigest(resolved.dir, bundle.files, { maxTokens: 1200 });
        return { kind: 'digest', text: digest.text, tokens: estimateTokens(digest.text) };
      }
      if (resolved.kind === 'fileIndex') {
        const index = buildFileSymbolIndex(resolved.path, bundle.files);
        if (!index) return { kind: 'invalid', reason: 'not-found' };
        return { kind: 'fileIndex', text: index.text, tokens: estimateTokens(index.text) };
      }
      if (resolved.kind !== 'ok') return resolved;

      let source: string;
      try {
        source = await fs.readFile(resolved.target.path);
      } catch {
        // 二进制 / 超大文件 / 读取失败：明确区分，不要把错误当成"符号不存在"
        return { kind: 'invalid', reason: 'read-failed' };
      }
      // 精确地址（符号 / 行段）给更大预算：实测 800 时 6.8%~8.6% 的函数被从中间截断，
      // 读到半截函数的 AI 会得出错误结论；1500 把截断率降到 3.3%~2.5%。
      // 整文件请求仍按 800——那是"我想大概看看"，不是"我要这个函数"。
      const precise = resolved.target.label !== resolved.target.path;
      const slice = formatSlice(source, resolved.target, { maxTokens: precise ? 1500 : 800 });
      return {
        kind: 'ok',
        text: slice.text,
        tokens: slice.tokens,
        truncated: slice.truncated,
        // 账本要回答"不切片的话要读多少"——整份文件的估算就是那个数
        fileTokens: estimateTokens(source),
      };
    },
    [analysis, fs, repo.tree],
  );

  /**
   * 顶栏主菜单 → 本视图命令。
   * 仅激活项目响应；面板用"打开"语义（重复点同一项不关闭）。
   */
  const commandRef = useRef<(command: AppCommand) => void>(() => {});
  commandRef.current = (command) => {
    if (command === 'pack:open') {
      setPackOpen(true);
      if (!pack) void generatePack();
      return;
    }
    if (command === 'project:refresh') {
      void (async () => {
        await repo.refresh();
        analysis.reset();
      })();
      return;
    }
    const target = command.slice('panel:'.length) as Exclude<BottomPanel, 'none'>;
    setPanel(target);
    if (fs && target !== 'search' && target !== 'references') {
      void analysis.analyze(fs, repo.tree);
    }
  };

  useEffect(
    () =>
      onCommand((command) => {
        if (isActive) commandRef.current(command);
      }),
    [isActive],
  );

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
      if (!fs || (fs.meta.source !== 'zip' && fs.meta.source !== 'local')) return null;
      const readmeDir = repo.readme?.path.includes('/')
        ? repo.readme.path.slice(0, repo.readme.path.lastIndexOf('/') + 1)
        : '';
      try {
        const blob = await fs.readBlob(readmeDir + src.replace(/^\.\//, ''));
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

  // ---------- 命令面板条目 ----------
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    const addPanel = (p: Exclude<BottomPanel, 'none'>, label: string, keywords: string) => {
      items.push({ id: `cmd:${p}`, section: 'command', label, keywords, onRun: () => void togglePanel(p) });
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
        id: 'cmd:export-report',
        section: 'command',
        label: t('analysis:exportReport'),
        keywords: 'export report html 报告 导出',
        onRun: () => void exportHtmlReport(fs.meta, analysis.getState()),
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
        onRun: () => onConfigChange({ theme }),
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
        onRun: () => onLanguageChange(code),
      });
    }

    items.push({
      id: 'cmd:settings',
      section: 'command',
      label: t('common:settings'),
      keywords: 'settings preferences 设置',
      onRun: () => onOpenSettings(),
    });

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

    const index = analysis.state.index;
    if (index) {
      for (const e of index.symbols.values()) {
        const def = e.definitions[0];
        if (!def) continue;
        items.push({
          id: `sym:${e.name}`,
          section: 'symbol',
          label: e.name,
          hint: `${def.file}:${def.line}`,
          keywords: `${e.name} ${def.file}`,
          onRun: () => void openFileAt(def.file, def.line),
        });
      }
    }

    return items;
  }, [
    analysis,
    fs,
    generatePack,
    onConfigChange,
    onLanguageChange,
    onOpenSettings,
    openFileAt,
    pack,
    repo,
    t,
    togglePanel,
  ]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {repo.error && <ErrorBanner error={repo.error} onClose={repo.clearError} />}

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
              <div
                className="grid h-full place-items-center text-xs"
                style={{ color: 'var(--c-text-2)' }}
                role="status"
                aria-live="polite"
              >
                <span className="flex items-center gap-2">
                  <span className="ca-spinner" aria-hidden />
                  {t('common:loading')}
                </span>
              </div>
            )}

            {!repo.loading && !active && (
              <WelcomeScreen onOpenZip={(file) => void repo.loadZip(file)} />
            )}

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
                resolveAsset={meta?.source === 'zip' || meta?.source === 'local' ? resolveZipAsset : undefined}
              />
            )}

            {!repo.loading && active?.kind === 'code' && active.content !== null && (
              <CodeView
                code={active.content}
                language={active.language}
                highlightLine={jumpTarget?.file === active.path ? jumpTarget.line : null}
                onSymbolClick={(tok) => void handleSymbol(tok)}
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
              file={activeTab}
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
              {t('viewer:source')}:{' '}
              {meta.source === 'github'
                ? 'GitHub'
                : meta.source === 'local'
                  ? t('viewer:localDir')
                  : t('viewer:zipFile')}
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
            {analysis.state.running && (
              <span style={{ color: 'var(--c-primary)' }}>
                {t('analysis:analyzing')} {analysis.state.progress.parsed}/
                {analysis.state.progress.total}
              </span>
            )}
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
            {activeSize !== null && (
              <span>
                {t('viewer:fileSize')}: {formatSize(activeSize, i18n.language)}
              </span>
            )}
          </>
        ) : (
          <span>CodeAtlas v{__APP_VERSION__}</span>
        )}
      </footer>

      <ContextPackDialog
        open={packOpen}
        pack={pack}
        generating={packGenerating}
        budget={config.maxTokens}
        ai={config.ai}
        onGenerate={(budget, intent, focusQuery) => void generatePack(budget, intent, focusQuery)}
        onBudgetChange={(maxTokens) => onConfigChange({ maxTokens })}
        onSlice={sliceFromAddress}
        onBuildPack={async (i, q) => (await generatePack(undefined, i, q)) ?? null}
        intent={packIntent}
        onIntentChange={changePackIntent}
        onClose={() => setPackOpen(false)}
      />

      <CommandPalette
        open={palette.open}
        mode={palette.mode}
        items={paletteItems}
        onClose={() => setPalette((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}
