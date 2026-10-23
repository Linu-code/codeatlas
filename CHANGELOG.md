# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

## [Unreleased]

### 新增

- **多语言支持（N1 完成）**：AST 分析从 6 种扩展到 **12 个主流语言族**（JavaScript / TypeScript / TSX / Python / Go / Rust / Java / C / C++ / C# / PHP / Kotlin / Swift / Ruby），调用图、跨文件跳转、代码度量与 AI 上下文包全部覆盖，语法高亮与文件预览同步跟进。
  - 语言规则按「每种语言一个文件」组织：`src/analysis/langs/*.ts`，各自实现统一的 `LangHandler` 契约；`symbols.ts` 保持零语言特判，新增语言只需加一个文件并在注册表登记。
  - 导出规则按语言语义实现：JS 看 `export`、Python 看顶层非 `_` 前缀、Go 看首字母大写、Rust 看 `pub`、Java/C#/Kotlin/Swift 看可见性修饰符、PHP 默认 public（接口成员隐式 public）、C/C++ 看 `static` 与 `public:/private:` 区段、Ruby 看裸 `private`。
  - 调用形态覆盖各语言差异：Java 的 `new` 与构造器调用、C++ 的 `ns::fn()` 与 `new`、C# 的 member access、PHP 的四种调用节点、Ruby 的 `require` 识别为导入且不污染调用图。
  - 各语言的分支/循环/异常节点集合逐一实测后写入 `metrics.ts`（例如 Kotlin 与 Swift 的 `&&` 是独立节点类型、Ruby 的 `and`/`or` 是 `binary` 的运算符字段）。
- **规模上限提升**：单次分析 400 → **5000** 个文件（N1 先到 2000，2.0 收口再提到 5000）、单文件 256 KB → **1 MB**；调用图截断阈值 60 → **120** 节点；全局搜索 600 → **5000** 个文件。上限集中定义在 `src/analysis/limits.ts`。超限时不再按字典序硬截断，改由 `src/analysis/targets.ts` 按「核心目录 / 入口 / 非测试 / 非第三方」优先级选取（结果确定），避免整段模块被漏掉。
- **tree-sitter 自检升级**：`npm run check:tree-sitter` 现在逐一验证全部 14 个语法包，并额外执行「多语法包共存后复解析」检查，可提前发现上游语法包回归。
- **阅读路线（N2）**：基于依赖图 PageRank + 入/出度角色判定，自动给出「入口 → 枢纽 → 中间层 → 末端」的建议阅读顺序；文件树显示序号角标，面板可一键把路线写入 AI 上下文包。
- **命令面板（N2）**：`Ctrl/Cmd+K` 统一入口（命令 / 文件 / 符号三类模糊搜索），`Ctrl/Cmd+T` 直达符号定义；模糊匹配自研（子序列 + 连续/词边界加权），零新依赖。
- **大纲视图（N2）**：当前文件的符号树（类 → 方法嵌套），点击跳到对应行；嵌套由行区间包含关系还原，12 种语言通用。
- **架构视图（N3）**：四类视图 ——
  - **模块依赖图**：把文件折叠到顶层目录得到模块级依赖图（比文件级更可读），支持 Mermaid 渲染与 SVG/PNG 导出；
  - **循环依赖**：Tarjan 强连通分量一次找出全部环（迭代实现，5000 节点链不爆栈），并给出跨目录汇总；
  - **类图**：9 种 OOP 语言的继承 / 实现关系（注意：C#/C++ 语法树不区分类与接口，Kotlin 靠 `Base()` 括号区分，Ruby 的 `include` 不算继承）；
  - **分层视图**：按目录用途聚类，展示模块边界与体量。
- **跨语言导入解析**：新增 `importResolver`，统一处理相对路径、点号包名（Java/C#/PHP）、斜杠模块路径（Go/Rust）与打包器别名（`@/`、`~/`）。策略是"宁可少连不可乱连"：歧义与外部依赖一律不建边，避免误导 PageRank 与环检测。
- **语法包适配记录**：Lua（多语言共存时解析失败）、Bash（`case` 语句触发异常）、Scala（无法识别 `while`/`for`）因语法包自身缺陷暂未纳入，结论与复现方式记录在自检脚本内，便于上游修复后重新评估；Dart / Elm / QL（ABI 15）在升级到 web-tree-sitter 0.25 后具备加载条件，待重新实测。
- **分析结果持久化 + 增量分析（N4 完成）**：符号索引与度量结果按「文件内容哈希」指纹写入 IndexedDB（DB `codeatlas` v2，新增 `analysis` store），同一仓库再次打开时**跳过 AST 解析、直接复用缓存**——大仓库二次打开分析耗时从"全量重算"变为"纯内存重建派生图"。
  - 指纹用零依赖的 **FNV-1a 32 位**（`src/utils/hash.ts`），内容一致即命中，改动单文件只重解析该文件；
  - 缓存带 `v / hash / path` 三重校验，`ANALYSIS_FORMAT_VERSION` 递增即令全部旧缓存失效（沿用 `TREE_FORMAT_VERSION` 模式）；
  - 派生分析（调用图 / 符号索引 / 阅读路线 / 模块图 / 循环依赖 / 类图）保持毫秒级纯函数**每次重建**，不持久化，避免格式版本爆炸；
  - 缓存键按仓库命名空间隔离：github 源 `owner/repo@branch`，zip 源用文件名；
  - 状态栏显示增量统计「缓存命中 N 个文件 · 重解析 M 个」；设置页可一键清空分析缓存；
  - IndexedDB 不可用时（Node 单测 / 隐私模式）静默降级为全量分析，主流程不受影响。
- **本地目录 / 本地 Git 仓库数据源（N5① 完成）**：彻底摆脱"必须先打包 zip"——桌面端点顶栏「打开本地目录」用系统原生对话框选文件夹后，直接在 App 内浏览与分析本地文件夹（含 git 工作区）。
  - **Rust 极薄层**：新增 `read_dir` / `read_text_file` / `select_dir` 三个命令（`src-tauri/src/lib.rs`），`select_dir` 用 `rfd 0.15` 直接调系统原生对话框，避开 Tauri 2 的 capabilities 权限清单；
  - **前端 `LocalDirSource`**：实现 `RepoFS` 契约（`src/sources/local.ts`），上层 `useRepo` / `useCodeAnalysis` **零感知**地复用同一套挂载、缓存、分析编排；文本走 `read_text_file` 免 base64，二进制走 `read_file_base64`；
  - **防爆策略**：`MAX_SCAN_ENTRIES=200_000` 静默截断、`MAX_DEPTH=24` 防符号链接环、无权限子目录跳过不中断、跳过 12 个典型构建/依赖目录（`.git/node_modules/dist/build/out/target/.next/.nuxt/.venv/venv/__pycache__/.idea`，大小写不敏感）；
  - **缓存命名空间扩展**：`cacheNs` 新增 `local:<绝对路径去尾>` 形态（github 仍 `owner/repo@branch`、zip 仍 `name`），同名目录互不串缓存；
  - **浏览器降级**：非 Tauri 环境（纯 `vite preview`）下 `invokeSafe` 返回 null，`TopBar` 的「打开本地目录」按钮自动隐藏，拖入文件夹不会触发崩溃；E2E `tests/e2e/local-dir-degrade.spec.ts` 覆盖默认语言 + 中/英/日切换三态；
  - **多窗口一致性**：拖入文件/目录时每个目标打开**独立窗口**（`openProjectWindow` 统一 `zippath/localdir` 参数），当前窗口不被"吃掉"（验收 8 延伸）；
  - **路径安全**：前端 `absPath()` 拒绝 `../` / 绝对路径 / `C:` 盘符穿越并抛 `zip-insecure`；Rust 跳过非 UTF-8 文件名；新增错误码 `not-found-dir`；单测 `tests/unit/localDir.test.ts`（4 例）固化上述行为。
- **HTML 报告导出（N5② 完成）**：一键把当前分析导出为**单文件离线 HTML**（内联 CSS，零外部请求，双击即开），适合分享与归档。
  - **架构**：`buildReportModel` 把 `AnalysisState` 聚合成可序列化 `ReportModel`（纯函数，Vitest 覆盖 8 例），`renderReportHtml` 产出自包含 HTML；真正的 Mermaid→SVG 渲染在 `exportReport.ts` 用 `mermaid.render` 内联，渲染失败则退化展示 Mermaid 源码。
  - **内容**：概览卡片（健康评分 / 文件数 / SLOC / 函数数 / 平均复杂度）、语言分布、热点文件与最复杂函数 Top 20、建议阅读路线、循环依赖、分层（按目录用途）、调用关系图 / 模块依赖图 / 类图（SVG 内联）。
  - **入口**：命令面板 `Ctrl/Cmd+K` →「导出 HTML 报告」（仓库已加载时出现），浏览器与 Tauri 均通过 Blob 下载。
  - 单测 `tests/unit/report.test.ts`（8 例：聚合正确性 + 离线 HTML 输出 + XSS 转义）；E2E `tests/e2e/report-export.spec.ts` 覆盖命令入口。
- **多项目工作区（N5③ 完成）**：一个窗口内可同时打开多个项目，顶部出现**项目标签条**（点击切换 / × 关闭），彻底告别"每个项目一个系统窗口"。
  - **架构**：新增 `src/workspace/workspace.ts`（纯逻辑 store：项目列表 / 激活 / 打开 / 关闭，零依赖）+ `src/hooks/useWorkspace.ts`（`useSyncExternalStore` 订阅）；每个项目由 `src/components/ProjectView.tsx` 承载，**各自持有一套 `useRepo` / `useCodeAnalysis` / `useGlobalSearch`**，因此浏览标签、分析结果、搜索结果在项目之间天然隔离，切换时完整保留。
  - **职责拆分**：`App.tsx` 收敛为全局外壳（配置 / 主题 / 顶栏命令中心 / 项目标签 / 设置对话框 / 拖拽）；顶栏的搜索与历史从 `useRepo` 上移为 `src/hooks/useLauncher.ts`，`useRepo` 只负责单项目的数据源加载与浏览。
  - **打开语义**：首个（空）项目就地加载，视觉与旧版单项目完全一致；已有项目时再打开则**追加新标签并激活**；加载中的项目不会被后续打开抢占。
  - 单测 `tests/unit/workspace.test.ts`（8 例：就地加载 / 追加 / 加载中不抢占 / 报告去重 / 激活 / 关闭接管 / 订阅）；E2E `tests/e2e/workspace.spec.ts`（两个 ZIP → 标签切换 → 关闭）。
  - 既有行为保持不变：拖入 ZIP / 目录仍各开独立窗口（验收 8）；单项目时不渲染标签条。
- **AI 上下文包增强（面向超大项目）**：大幅提升"帮助 AI 在有限上下文理解巨大项目"的可用性。
  - **模块地图**：不再平铺 60 个文件，改为按顶层目录聚合（模块 → 文件数 → 关键文件），信息密度与项目规模无关；关键文件按 PageRank 排序。
  - **构建与运行 + 技术栈**：读取仓库根 `package.json`，输出包名/入口/常用脚本/包管理器（pnpm/yarn/bun/npm）与运行时/开发依赖，让 AI 知道"怎么跑、用什么"。
  - **入口文件**：自动识别 `main|index|app|server|cli…` 常见入口并写入概览与 JSON。
  - **JSON 限长**：`files` 由全量 `treePaths`（超大项目可达上万 token）改为最多 400 条 + `filesTotal`，避免架空 token 预算。
  - **预算预设**：上下文包对话框新增 2k / 8k / 32k 一键切换（持久化到配置并立即按新预算重生成），无需进设置页。
  - 新增 4 个单测（模块地图 / manifest 解析 / 入口文件 / JSON 限长），四要素章节与既有验收断言保持不变。
- **超大项目适配（数万行 / 数千文件）**：
  - **分析上限 2000 → 5000**（全局搜索同步 5000）；超限时由 `src/analysis/targets.ts` 按「核心目录 / 入口文件 / 非测试 / 非第三方」优先级选取，**不再按文件树字典序硬截断**（旧行为会整块漏掉后半段模块），结果确定可复现。
  - **进度回调节流**：数千文件时不再每解析一个文件就 `setState`（旧实现会触发数千次渲染），改为按 2% 粒度更新。
  - 上下文包：新增 **64k** 预算预设；模块地图上限 30 → **60** 个模块、关键文件 40 → **80** 个；概览标注「仓库文件 N 个（本次分析 M 个）」，超大项目可直接看出覆盖率。
  - 单测 `tests/unit/targets.test.ts`（6 例：未超上限原样返回 / 排除第三方 / 核心与入口优先 / 不欠采样 / 确定性 / 打分单调）。
- **可访问性（N6 完成）**：键盘导航 / ARIA / 对比度三项系统性补齐。
  - **对话框焦点陷阱**：新增 `useFocusTrap` hook，套用到设置 / 上下文包 / 命令面板三处 —— 打开时焦点移入并落在首个可聚焦元素，`Tab`/`Shift+Tab` 在对话框内循环不逃逸，`Esc` 关闭，关闭后焦点**归还**到打开前的元素；
  - **ARIA 语义**：命令面板补 `aria-modal` 与 `listbox`/`option`/`aria-activedescendant`；顶栏搜索框标注 `role="combobox"` + `aria-expanded`/`aria-controls`/`aria-activedescendant`；文件树改为规范 `tree`/`treeitem` + `aria-level`/`aria-selected`/`aria-expanded`；加载指示器加 `role="status"` 实时播报；
  - **文件树键盘导航**：采用 roving tabindex（单一 Tab 停靠点），支持 `↑↓` 行间移动、`Home/End` 首尾、`→` 展开（已展开则进入子节点）、`←` 折叠（叶子则回到父节点）、`Enter/Space` 激活；
  - **对比度**：浅色 / atlas-light 主题的次级文本色由 `#6b7280` 调整为 `#5f6670`，在 `--c-bg-2` 上由 4.36:1 提升到 5.2:1，满足 WCAG AA 4.5:1；
  - 新增 E2E `tests/e2e/a11y.spec.ts`：断言对话框焦点陷阱与焦点归还、命令面板 `aria-activedescendant` 随 `↑↓` 变化、文件树 roving 焦点与 `tree` 语义、四套主题次要文本对比度 ≥ 4.5:1。

### 变更（工程 / CI）

- **发布流程解耦**：文档站部署拆为独立 `pages.yml`（跟随 `main` 部署），不再挂在 tag 发布上
  —— 原先挂在 tag 上会被 `github-pages` environment 的 "Deployment branches and tags"
  保护规则拒绝，导致每次发版必失败。
- **`release.yml`**：移除 Pages 部署；发布动作限定为 tag 触发；`draft: false`（tag 即发布意图），
  形如 `v2.0.0-beta.1` 的预发布 tag 自动标记为 prerelease。
- **最小权限**：`ci.yml` / `release.yml` / `pages.yml` 统一按 job 声明所需权限。
- **依赖自动化**：新增 Dependabot（npm / cargo / GitHub Actions）；忽略破坏性升级
  —— `web-tree-sitter` 与 `tree-sitter-wasms` 必须成对升级、React major 需专项适配。
- **安全扫描**：新增 CodeQL（javascript-typescript）静态扫描。
- **版本号升 2.0.0**：`package.json` / `Cargo.toml` / `tauri.conf.json` / `App` 状态栏 / `Cargo.lock` 对齐 `2.0.0`（N6 收口，尚未正式打 tag 发布）。
- **tree-sitter 运行时升级（N6 完成）**：`web-tree-sitter` 由 `0.22.6` 升级到 `0.25.10`（ABI 13–15，与 `tree-sitter-wasms@0.1.13` 语法包配对兼容；14 个语法包 + 共存复解析经 `npm run check:tree-sitter` 验证全绿）。0.26+ 因 dylink 段变更与旧 ABI 语法包不兼容，已通过 Dependabot 忽略。**适配要点**：`parser.ts` 改用 0.25 命名导出（`Language` 不再挂在 `Parser` 静态上，改为 `import('web-tree-sitter').Language`）；新增 `src/web-tree-sitter-aug.d.ts` 把 0.22 的 `SyntaxNode` 兼容别名回贴为宽松节点接口，整套分析代码（langs / metrics / symbols / parser）零改动、`tsc` 与 262 个单测全绿。
- **工程规范**：补 `.editorconfig`；提交身份改用 GitHub noreply 邮箱。
- **在线场景 E2E（N6 完成）**：新增 `tests/e2e/github-online.spec.ts`，用 Playwright `page.route` 拦截 `api.github.com` / `raw.githubusercontent.com` 并返回仿真响应，**真实跑通在线代码路径**（顶栏解析 → 分支探测 → 拉树 → 找 README → 读文件 → 搜索），无需真实联网。原先 `test.skip` 的「在线流程只访问 GitHub 域名」用例改为本地 mock 驱动、稳定运行并在 `network-whitelist.spec.ts` 内断言域名白名单与 AI 域名黑名单；验收 2 / 3 / 12（在线部分）由 ⏭️ 转为 ✅。

### 规划中

- **2.0**（核心升级，代码已完成，待打 tag 发布）：多语言（12 个语言族）与规模提升、阅读路线 / 命令面板 / 架构视图、分析结果持久化与增量分析、本地目录数据源（N5①）、HTML 报告导出（N5②）、多项目工作区（N5③）、质量与工程债收口（N6：依赖 ABI 升级 / 在线 E2E / 可访问性）均已在 `[Unreleased]` 完成。详见 [docs/PLAN-2.0.md](docs/PLAN-2.0.md)。
- **2.1**：多平台支持（macOS / Linux 打包 + CI 矩阵）。
- **2.2**：可选本地 AI（Ollama 本地模型，默认关闭）。

## [1.0.0] - 2026-09-17

首个正式版本。本地优先的代码理解与导航工具——目录是地形，调用关系是道路，阅读路线是导航，AI 上下文包是给智能助手的旅行指南。

### 新增

- **数据源**：GitHub 完整 URL / `owner/repo` 简写 / 仓库名搜索（含下拉结果与前 10 条历史）、本地 ZIP（文件选择 + 拖入）。
- **浏览**：文件树（折叠、按名过滤、**目录用途自动标注**）、多标签编辑器与面包屑、Prism 语法高亮、README/Markdown 渲染。
- **分析**：
  - 函数级**调用关系图**（Mermaid 渲染，可导出 SVG / PNG，可复制 Mermaid 源码）
  - **跨文件跳转**：`Ctrl/Cmd+单击` 或 `F12` 转到定义，可列出全部引用
  - **代码度量**：圈复杂度（McCabe）、认知复杂度（SonarSource）、SLOC、项目健康评分，**单次 AST 遍历**同时算出
  - **全局正则搜索**：Web Worker 内执行，10 秒超时自动终止
  - **AI 上下文包**：PageRank 排序 + token 预算二分裁剪，输出 Markdown 与结构化 JSON
- **多窗口**：拖入 ZIP 时每个 ZIP 打开独立窗口，窗口间零耦合。
- **界面**：四套主题（浅色 / 深色 / 跟随系统 / Atlas Blue）、中英日三语言（含 RTL 预留）。
- **缓存**：IndexedDB 缓存文件树与内容，二次打开秒开，断网可回退。
- **分发**：Windows 免安装绿色 exe + NSIS 安装包；CI（类型检查·单测·构建·E2E·Rust 编译检查）与 Release（自动打包 + 校验和 + GitHub Pages 部署）。

### 安全

- **ZIP 路径穿越防护**：解压前校验每条 entry，拒绝 `..`、绝对路径、UNC、Windows 保留名。
- **网络白名单**：默认仅 `api.github.com` 与 `raw.githubusercontent.com`，由代码断言 + CSP + E2E 三层强制；jsDelivr 兜底默认关闭。
- **零上传 / 零遥测**：不收集数据、不上传文件；GitHub Token 仅存本机 `localStorage`。

### 修复

- **文件树目录重复**：`/git/trees?recursive=1` 同时返回目录与文件条目，旧实现导致显式目录条目被重复挂载。改为幂等的 `ensureDir()`（路径 → 节点唯一真相来源），并补路径归一与文件去重。
- **旧结构缓存误导**：文件树缓存加入格式版本号（`TREE_FORMAT_VERSION = 2`），版本不匹配自动失效，无需用户手动清缓存。
- **分析结果闭包快照**：`analyze()` 为异步，调用方在 `await` 后读到的是更新前的 `state`，导致刚分析完时符号跳转与上下文包失效。改为以返回值 / `getState()` 为准。
- **E2E 挂起**：Playwright worker 在页面残留请求时无法退出，改为在 `finally` 中显式 `page.close()`。
- **打包脚本 `link.exe not found`**：新增 `scripts/build-exe.ps1` 自动探测并注入 MSVC / Windows SDK 环境变量。
- **`nsis.installMode` 取值错误**：`perUser` 改为 Tauri 2 正确的 `currentUser`。
- **重复打包 `LNK1104`**：上一次启动的应用实例占用输出文件，结束残留进程后重试。
- **文档过期**：测试数与打包命令统一为 `npm run build:exe`（README / ACCEPTANCE / PLAN / docs 四处）。
- **ZIP 安全策略缺注释**：补充 ADS（`name:stream`）形态的"有意放行"说明，并用单测固化该行为。

### 变更

- **版本号统一为 `1.0.0`**：此前 `package.json` 为 `0.1.0` 而 git tag 为 `1.0`，现全部对齐（`package.json` / `Cargo.toml` / `tauri.conf.json` / `Cargo.lock` / 状态栏 / CI 模板）。
- 打包与发布统一使用 `npm run build:exe`（自动注入 MSVC 环境并复制产物到仓库根目录）。

[Unreleased]: https://github.com/Linu-code/codeatlas/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Linu-code/codeatlas/releases/tag/v1.0.0
