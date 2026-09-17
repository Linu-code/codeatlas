# CodeAtlas（码图）项目计划 v1.0 —— 已全部实现

> **实施状态（2026-09-15）**：M1–M7 全部完成。
> 单元测试 12 个文件 / 115 个用例全绿（实际数量以 `npm test` 输出为准）；E2E 4 个 spec / 13 个用例（12 通过 + 1 联网自动跳过）；Windows exe 已打包并实测可启动。
> 验收逐条证据见 [ACCEPTANCE.md](ACCEPTANCE.md)，界面截图见 `docs/screenshots/`。
> 实施过程中的偏差与新增决策已在文末「实施记录」列出。

> 本地优先的代码理解与导航工具。目录是地形，调用关系是道路，阅读路线是导航，
> AI 上下文包是给智能助手的旅行指南。完全本地、免费、轻量、安全。
>
> **项目根目录**：仓库根目录（即 clone 后的 `codeatlas/` 目录）

---

## 1. 总体架构

```text
┌────────────────── Tauri 2 窗口（可多开） ──────────────────┐
│                 React UI（VSCode 风格布局）                 │
│  顶栏命令中心 │ 目录树 │ 多标签编辑器 │ 度量/调用图/搜索面板   │
└───────────────┬──────────────────────────┬────────────────┘
                │ invoke (Tauri IPC)       │ fetch (白名单)
┌───────────────▼──────────┐   ┌───────────▼──────────────┐
│  Rust 核心（少量职责）      │   │  前端分析层（TypeScript）   │
│  · 读 ZIP 字节 / 配置文件   │   │  · tree-sitter 解析器池    │
│  · ~/.codeatlas/config.json│  │  · scope graph / 调用图    │
│  · 多窗口创建 / 窗口标签    │   │  · 度量 / PageRank / 搜索  │
└──────────────────────────┘   └──────────────────────────┘
```

设计原则：

1. **Rust 只做前端做不到的事**（文件系统、多窗口、配置目录），所有分析逻辑留在 TypeScript 纯函数层——可被 Vitest 直接单测，浏览器 dev 模式也能跑。
2. **窗口 = 项目实例**：主窗口与 ZIP 拖入的新窗口加载同一前端（`index.html?win=<label>`），每个窗口启动时按 query 参数加载自己的项目状态，互不干扰。
3. **网络白名单**：默认仅 `api.github.com` 与 `raw.githubusercontent.com`（均为 GitHub 域），满足"除 GitHub API 外零网络请求"约束。jsDelivr 兜底做成**默认关闭的设置开关**（开启后违反白名单约束，需用户自担）。

## 2. 技术限制说明（按你的要求主动交代）

| 提示词中的风险点 | 实际情况与方案 |
|---|---|
| **Tauri 多窗口 + ZIP 拖入** | Tauri 2 的 `WebviewWindow` 与 `onDragDropEvent` 均已稳定支持。**一个限制**：拖拽事件只给文件**路径**（WebView2 的 HTML5 dataTransfer 拿不到文件内容），因此由 Rust 读 ZIP 字节 → IPC 传给前端 JSZip 解压。拖**文件夹**第一期不支持，只支持 .zip 文件，非 ZIP 拖入按需求显示错误提示。**无需 tab 降级方案。** |
| **tree-sitter WASM 解析失败** | 三级降级：① wasm 语法加载失败 → 该语言标记"暂不支持"，UI 走 i18n 提示；② 单文件解析超时（1s）→ 跳过该文件并计入"解析失败"列表；③ 全部 AST 功能不可用时，符号提取退化为正则粗匹配（仅保证调用图/搜索可用性，标注为低精度模式）。 |
| **"先用 ripgrep 定位候选文件"** | 不捆绑 ripgrep 二进制（多 2MB 体积 + 外置进程管理）。**替代方案**：Web Worker 内先做 JS 子串预过滤（对文件名 + 文件内容做小写规范化匹配，候选集通常 <50 文件），再用 tree-sitter 精确解析。中型项目实测此策略足够快；若未来超大仓库吃紧，可选 sidecar 方式引入真 ripgrep（架构已预留）。 |
| **PageRank / token 裁剪性能** | 文件级依赖图 power iteration，O(E)/轮 × 20 轮，几千节点毫秒级完成，无瓶颈。token 裁剪：先按 PageRank 降序排序，再对"前缀长度"二分搜索（token 估算 `ascii/4 + cjk×1.5`），O(n log n)。 |
| **exe 打包 Rust 工具链** | 构建机一次性安装：`winget install Rustlang.Rustup` + Visual Studio 2022 Build Tools（勾选 C++ 桌面开发）。之后 `npm run build:exe` 产出 NSIS 安装包并把产物复制到仓库根目录；加 `-- -NoBundle` 产出免安装单文件 exe。**最终用户零依赖**（Win10 1803+ 自带 WebView2）。CI 用 GitHub Actions `windows-latest` 免费构建。 |

## 3. 文件结构

```text
CodeAtlas/
├── src/                            # React 前端
│   ├── main.tsx                    # 入口：按 ?win= 参数区分多窗口
│   ├── App.tsx                     # 布局：顶栏 + 左树 + 右编辑器 + 底部面板
│   ├── types/
│   │   ├── repo.ts                 # RepoFS/FileNode/SymbolInfo/CallGraph 等核心类型
│   │   └── config.ts               # 用户配置类型（语言/主题/缓存开关）
│   ├── sources/                    # 数据层
│   │   ├── github.ts               #   文件树(git/trees) + 内容(raw) + Search API
│   │   ├── zip.ts                  #   JSZip 解压（防路径穿越）+ 内存 FS
│   │   ├── cache.ts                #   IndexedDB 缓存层（树+内容，手动刷新）
│   │   └── factory.ts
│   ├── analysis/                   # 分析层（全部纯函数，Vitest 覆盖）
│   │   ├── parser.ts               #   tree-sitter 懒加载解析器池（js/ts/py）
│   │   ├── symbols.ts              #   符号提取（定义+签名，忽略函数体）
│   │   ├── scopeGraph.ts           #   作用域图：转到定义/查找引用
│   │   ├── callgraph.ts            #   文件间调用关系
│   │   ├── metrics.ts              #   圈复杂度+认知复杂度+SLOC（单次遍历）
│   │   ├── pagerank.ts             #   依赖图 PageRank（power iteration）
│   │   ├── contextPack.ts          #   AI 上下文包：排序+token 预算二分裁剪+格式化
│   │   └── directories.ts          #   目录用途标注规则表
│   ├── workers/
│   │   └── search.worker.ts        #   全局正则搜索（超时自终止）
│   ├── components/
│   │   ├── TopBar.tsx              #   命令中心输入框（URL/搜索/历史/下拉）
│   │   ├── FileTree.tsx            #   目录树（折叠/过滤/用途标注）
│   │   ├── EditorTabs.tsx          #   多标签 + 面包屑
│   │   ├── CodeView.tsx            #   语法高亮 + 行号 + F12/Ctrl+Click 跳转
│   │   ├── MarkdownView.tsx
│   │   ├── CallGraphPanel.tsx      #   Mermaid 渲染 + SVG/PNG 导出 + 复制按钮
│   │   ├── MetricsPanel.tsx        #   度量概览 + 函数复杂度排序
│   │   ├── SearchPanel.tsx         #   全局搜索结果
│   │   ├── SettingsDialog.tsx      #   语言/主题/清缓存
│   │   ├── ContextPackButton.tsx   #   生成 AI 上下文包
│   │   └── DragOverlay.tsx         #   拖入视觉反馈（i18n 提示）
│   ├── theme/
│   │   ├── themes.ts               #   light/dark/system/atlas-blue 四主题
│   │   └── atlas.css               #   CSS 变量（完整色板见提示词）+ RTL 预留
│   ├── i18n/
│   │   ├── index.ts                #   首启检测系统语言，之后读配置
│   │   └── locales/{zh,en,ja}/{common,viewer,analysis,errors}.json
│   └── utils/
│       ├── githubUrl.ts            #   URL 解析 + 短名判定（是否像仓库名）
│       ├── tokenEstimator.ts       #   token 估算（ascii/4, cjk×1.5）
│       └── format.ts               #   Intl 日期数字
├── src-tauri/                      # Rust 核心
│   ├── src/main.rs                 #   多窗口命令、读 ZIP 字节、配置读写
│   ├── tauri.conf.json             #   窗口配置/打包 NSIS/白名单
│   ├── capabilities/               #   Tauri 2 权限（fs:config 范围）
│   └── icons/
├── tests/
│   ├── unit/                       #   分析层纯函数全覆盖
│   └── e2e/                        #   Playwright：19 条验收标准映射
├── .github/workflows/
│   ├── ci.yml                      #   test + build
│   └── release.yml                 #   windows-latest 构建 exe → GitHub Release
├── docs/                           #   文档站（GitHub Pages）
├── package.json / vite.config.ts / tailwind.config.js / tsconfig.json
├── README.md / LICENSE (MIT) / CONTRIBUTING.md
└── .github/ISSUE_TEMPLATE/
```

## 4. 核心模块设计要点

### 4.1 顶栏命令中心（验收 2/3/9）
- 单一输入框，回车触发；空输入回车无响应（`value.trim()` 后判断）。
- 判定逻辑：匹配 `github.com/...` → 直接加载；否则视为搜索关键词 → `GET /search/repositories?q={kw}&per_page=10&sort=stars`。
- 下拉列表：star 数（Intl 格式化）、描述、语言；↑↓ 选择、Esc 关闭；加载中 spinner 走 i18n。
- 历史记录 10 条存配置文件，↑↓ 在空输入时调出。

### 4.2 Scope Graph 跨文件跳转（验收 13）
- 一次全量 AST 遍历建立 `符号 → 定义位置 / 引用位置` 索引（含 import/export 解析，作用域嵌套用父子链表示）。
- F12 / Ctrl+Click：当前光标标识符 → 索引查询 → 跳定义；右键菜单"查找引用"列全部引用（文件:行号）。
- 按需策略：索引构建懒触发（首次跳转时后台构建 + 进度提示），预过滤同 4.4。

### 4.3 代码度量（验收 14）
- **单次 AST 遍历**同时累计：圈复杂度（分支节点计数 +1 规则）、认知复杂度（SonarSource 规则：嵌套加权 +1/+2/+3，break/continue/goto +1）、SLOC（非空非注释行）。
- 面板：文件概览卡 + 函数复杂度降序表（超阈值标红，阈值 15）+ 项目健康分（0-100，加权归一化）。

### 4.4 AI 上下文包（验收 17/18/19）
```text
符号提取(签名级) → 文件依赖图 → PageRank 排序 → token 预算二分裁剪 → Markdown/JSON
```
- 输出 `.codeatlas/context.md`：项目概览 → 文件树（带一句话说明）→ 核心签名列表（PageRank 序，含路径:行号）→ 关键调用关系摘要。
- `--max-tokens` 等价的 UI 设置项，默认 1000，上限 2000；5 秒内完成（实测毫秒级）。

### 4.5 多窗口 ZIP 拖入（验收 8）
- Tauri `onDragDropEvent` 拿到路径 → Rust `read_file` 字节 → base64 IPC → JSZip。
- 每个ZIP：`new WebviewWindow(label, { url: index.html?win=label&source=zip:<id> })`；ZIP 字节先写临时文件（`%TEMP%/codeatlas/<id>.zip`），新窗口自行读取，窗口间零耦合。
- 拖入反馈遮罩 + 非 ZIP 错误提示，文案全走 i18n。

### 4.6 缓存（IndexedDB）
- 首次加载仓库：文件树 + 已读文件内容写入 IDB（key: `owner/repo@branch`）。
- 下次秒开；顶栏刷新按钮强制重新拉取；设置页可清缓存。断网时命中缓存即全功能可用（企业内网场景，配合 ZIP 模式）。

### 4.7 主题（验收 10/11）
- CSS 变量驱动，完整采用提示词色板（#4A6CF7 主色、#1B1D23 深底、#E4E6EB 主文字等），四主题：light / dark / system / atlas-blue。
- `matchMedia('(prefers-color-scheme)')` 监听实现"跟随系统"实时切换；选择持久化到配置文件。
- 语法高亮配色按主题分别定义（Prism 自定义 token 色，AA 对比度校验）。

## 5. i18n（验收 6/7）
- 命名空间：common / viewer / analysis / errors；zh / en / ja 三语言 JSON。
- 首启 `Intl` 检测系统语言 → 写入配置；之后只读配置。
- RTL 预留：`<html dir>` 动态 + Tailwind 逻辑属性类（`ms-*`/`me-*`）。
- 所有错误提示（仓库不存在/无权限/超时/限流/ZIP 损坏/解析失败）走 `errors` 命名空间，错误码在 `RepoError.code` 上定义。

## 6. 里程碑（对应 16 个开发步骤，合并为 7 个）

| # | 里程碑 | 覆盖开发步骤 | 对应验收 |
|---|--------|------------|---------|
| M1 | Tauri 脚手架 + 三种数据源（URL/搜索/ZIP）+ RepoFS | 1,2,3 | 2,3,4,9 |
| M2 | VSCode 风格 UI（树/多标签/高亮/README）+ i18n 脚手架 + 主题变量 | 4,7 | 1,2,6 |
| M3 | 多窗口 + ZIP 拖入 + 设置页/配置持久化 + IndexedDB 缓存 | 5,8,9 | 7,8,11 |
| M4 | tree-sitter 集成：调用图 + Mermaid + SVG/PNG 导出 | 6,12 | 5,15 |
| M5 | Scope graph 跳转 + 全局搜索（Worker） | 10,13 | 13,16 |
| M6 | 度量面板 + AI 上下文包（PageRank + token 裁剪） | 11,14 | 14,17,18,19 |
| M7 | exe 打包 + CI/Release + README/LICENSE | 15,16 | 全量回归 |

每个里程碑交付该模块**全部完整文件**（非片段）+ 可复制运行的验证命令。

## 7. 测试与安全
- **单测**：分析层 7 个模块纯函数全覆盖（构造 fixture 仓库断言调用图边、度量数值、PageRank 序、裁剪后 token 上限、路径穿越拦截等）。
- **E2E**：19 条验收标准逐条映射；其中验收 12（网络白名单）用请求拦截断言实现——除 `api.github.com`/`raw.githubusercontent.com` 外出现任何请求即失败。
- **ZIP 安全**：解压前对每条 entry 做规范化路径校验（拒绝 `..`、绝对路径、盘符），防路径穿越攻击。

## 8. 冷启动 < 2 秒保障
Tauri 二进制冷启动本身 <500ms；UI 首屏只渲染布局骨架，tree-sitter wasm、Mermaid、语法高亮主题全部懒加载；缓存命中时目录树直接从 IDB 渲染。

---

## 实施记录（M1–M7 完成后的复盘）

### 里程碑交付

| 里程碑 | 内容 | 验证 |
|--------|------|------|
| M1 | Tauri 脚手架 + 三种数据源（URL / 搜索 / ZIP）+ RepoFS + ZIP 安全校验 | 单测通过 |
| M2 | VSCode 风格 UI（文件树 / 多标签 / Prism 高亮 / README）+ i18n + 四主题 | 单测 + E2E |
| M3 | 多窗口 + ZIP 拖入（Rust 读字节）+ 设置与配置持久化 + IndexedDB 缓存 | 代码就绪，桌面拖拽需人工验证 |
| M4 | tree-sitter 调用图 + Mermaid 渲染 + SVG/PNG 导出 | E2E（真实 SVG 与节点断言） |
| M5 | scope graph 跳转 + Web Worker 全局搜索（10s 超时） | E2E + 单测 |
| M6 | 度量面板（McCabe / 认知复杂度 / SLOC）+ PageRank AI 上下文包 | E2E + 单测（含精确数值断言） |
| M7 | exe 打包 + CI/Release + README/LICENSE + 19 条验收 E2E | exe 实测启动；E2E 12 通过 1 跳过 |

### 与原计划的偏差（均为主动决策）

1. **合并分析入口**：原计划 `useCallGraph` 独立存在，实施时为避免同一文件被读取/解析三遍，合并为 `useCodeAnalysis`（一次遍历产出 metrics + index + graph）。
2. **不引入 `regexp-worker` 依赖**：按"零多余依赖"原则自研等价实现（Worker 内正则 + 主线程 10 秒 `terminate`）。
3. **不捆绑 ripgrep**：候选文件预过滤改为 Worker 内的 JS 子串筛选 + tree-sitter 精析。
4. **Prism 语言包按需加载**：全量静态导入会让首屏 +350 kB，改为动态 import + 依赖链自动解析。
5. **上下文包降级策略**：极小预算下固定段落无法收敛（实测预算 60 时输出 160 tokens），改为三级降级（树+符号 → 仅符号 → 仅概览）并暴露 `minTokens`。
6. **打包脚本**：新增 `scripts/build-exe.ps1` 手动注入 MSVC/SDK 环境（`Enter-VsDevShell` 在本环境报环境变量大小写冲突）。

### 必须锁定的版本与配置

| 项 | 取值 | 原因 |
|----|------|------|
| `web-tree-sitter` | `0.22.6` | 0.25+ 使用新版 dylink 段，与 `tree-sitter-wasms@0.1.13` 的旧 ABI 语法包不兼容（`getDylinkMetadata` 失败）；可用 `npm run check:tree-sitter` 自检 |
| Tauri CSP `script-src` | 必须含 `'unsafe-eval'` | tree-sitter 的 emscripten 运行时使用 eval；缺失会导致打包后白屏（浏览器模式不暴露该问题） |
| `bundle.windows.nsis.installMode` | `currentUser` | Tauri 2 取值；写成 `perUser` 会导致打包直接失败 |

### 未在此环境验证的部分

- 在线加载 GitHub 仓库（本机网络受限，E2E 自动跳过）
- 桌面端 ZIP 拖入 + 多窗口（Tauri 窗口级能力，需 `npm run tauri dev` 或 exe 中人工验证）
- 导出 SVG/PNG 的文件落地（E2E 只断言按钮可用态）
