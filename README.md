# CodeAtlas（码图）

> 为开发者绘制一张可交互的代码地图：**目录是地形，调用关系是道路，阅读路线是导航，AI 上下文包是给智能助手的旅行指南。**
>
> 完全本地运行 · 免费 · 轻量 · 安全 —— **不调用任何 AI/LLM，不收集任何数据，不上传任何文件。**

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[![CodeQL](../../actions/workflows/codeql.yml/badge.svg)](../../actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](../../actions/workflows/release.yml/badge.svg)](../../releases)
[![Docs](https://img.shields.io/badge/docs-online-4A6CF7.svg)](https://linu-code.github.io/codeatlas/)

![CodeAtlas 主界面](docs/screenshots/main.png)

## 它解决什么问题

读一个陌生仓库，通常要在浏览器、编辑器、搜索之间反复横跳。CodeAtlas 把"读懂一个项目"需要的几件事放进同一个窗口，并且**全部用确定性静态分析实现**（AST 解析 + 启发式规则 + 模板），因此离线可用、结果可复现、无需任何 API Key：

| 能力 | 说明 | 实现方式 |
|------|------|----------|
| 📁 **文件树导航** | 折叠/展开、按名过滤，**自动标注目录用途**（`src/` → 源代码、`.github/` → CI 配置…） | 30 条规则表 + 内容启发式 |
| 🧭 **阅读路线** | 自动给出「先读哪几个文件」：入口 → 枢纽 → 中间层 → 末端，文件树带序号角标 | 依赖图 PageRank + 入/出度角色判定 |
| ⌨️ **命令面板** | `Ctrl/Cmd+K` 统一入口（命令 / 文件 / 符号模糊搜索），`Ctrl/Cmd+T` 直达符号定义 | 自研子序列模糊匹配（30 行，零依赖） |
| 📋 **大纲视图** | 当前文件的符号树（类 → 方法嵌套），点击跳到对应行 | 行区间包含关系还原嵌套 |
| 🏛️ **架构视图** | 模块级依赖图（可导出）、**循环依赖检测**、类图（继承/实现）、按用途分层 | 目录聚合 + Tarjan 强连通分量 |
| 📊 **调用关系图** | 函数级调用图，按文件分组，可导出 SVG / PNG，可复制 Mermaid 代码 | web-tree-sitter AST + 去噪构图 + Mermaid |
| 🎯 **跨文件跳转** | `Ctrl/Cmd+单击` 或 `F12` 转到定义，一键列全部引用（文件:行号） | 自研 scope graph 符号索引 |
| 📈 **代码度量** | 圈复杂度（McCabe）、认知复杂度（SonarSource）、SLOC、健康评分 | **单次 AST 遍历**同时算出全部指标 |
| 🎒 **AI 上下文包** | 一键生成 token 预算内、按重要性排序的摘要：项目概览 / **构建与运行 + 技术栈**（读 `package.json`）/ **模块地图** / 阅读路线 / 核心符号签名 / 关键调用关系；对话框内置 **2k / 8k / 32k** 预算预设，JSON 文件清单限长以防撑爆上下文 | PageRank + 二分预算裁剪 |
| ⚡ **增量分析** | 分析结果按「文件内容哈希」持久化到 IndexedDB，二次打开同一仓库**跳过 AST 解析直接复用**（状态栏显示「缓存命中 N 个文件 · 重解析 M 个」） | FNV-1a 内容指纹 + 版本化缓存 |

## 截图

| 主界面（Atlas Blue 主题） | 调用关系图 |
|---|---|
| ![主界面](docs/screenshots/main.png) | ![调用图](docs/screenshots/callgraph.png) |

| 代码度量 | AI 上下文包 |
|---|---|
| ![度量](docs/screenshots/metrics.png) | ![上下文包](docs/screenshots/context-pack.png) |

| 阅读路线 | 架构视图（模块依赖） |
|---|---|
| ![阅读路线](docs/screenshots/reading-path.png) | ![架构](docs/screenshots/architecture-modules.png) |

> 截图由 E2E 测试自动生成：`npm run e2e` 会把界面截图写入 `docs/screenshots/`。

## 快速开始

### 方式一：直接运行（推荐给使用者）

下载 [Releases](../../releases) 中的 `CodeAtlas_*_x64-setup.exe` 安装，或使用免安装的绿色单文件 `CodeAtlas.exe`。**无需安装 Node.js 或 Rust。**

Windows 10（1803+）/ Windows 11 已内置 WebView2 运行时；更早的系统需装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。

**平台状态**：Windows 为官方发布平台（已验证）。macOS / Linux 的**代码层适配已完成**——快捷键同时接受 `Ctrl` 与 `Cmd`（提示文案在 macOS 上显示为 `⌘`）、字体栈覆盖 SF Mono / Menlo / DejaVu、路径统一走 POSIX 风格、Rust 侧无 Windows 专属 API；剩余工作仅为**打包与 CI 矩阵**（`.dmg` / `.deb` / `.AppImage`），见 `docs/PLAN-2.0.md` §4。

### 方式二：从源码运行

```bash
git clone https://github.com/Linu-code/codeatlas.git
cd codeatlas
npm install

# 浏览器模式（开发用，速度最快）
npm run dev

# 桌面模式（Tauri 窗口，需先装 Rust 工具链，见下）
npm run tauri dev
```

### 方式三：打包成 exe

前置环境（仅构建机需要，**最终用户不需要**）：

```powershell
# 1. Rust（选 MSVC 工具链）
winget install --id Rustlang.Rustup
# 或手动：https://rustup.rs
rustup default stable-x86_64-pc-windows-msvc

# 2. Microsoft C++ 生成工具 + Windows SDK
#    安装 Visual Studio 2022 生成工具，勾选"使用 C++ 的桌面开发"
#    https://visualstudio.microsoft.com/downloads/

# 3. 验证
cargo --version && rustc --version
```

打包：

```bash
npm install
npm run build:exe                      # 产出 exe + NSIS 安装包（推荐，自动注入 MSVC 环境）
npm run build:exe -- -NoBundle         # 只产出免安装绿色 exe（更快）
```

> `npm run build:exe` 会调用 `scripts/build-exe.ps1`：它自动探测 Visual Studio / Windows SDK
> 并注入 `PATH/INCLUDE/LIB`，最后把产物**复制到项目根目录**。直接跑 `npm run tauri build`
> 在本机 PowerShell 会话里会因缺少 `link.exe` 而失败（原因见 `docs/ACCEPTANCE.md`）。

产物位置（根目录下的两份是给用户直接用的，`target/` 里的是 Cargo 原始输出）：

```text
CodeAtlas.exe                              # 免安装绿色版，双击即用
CodeAtlas_<版本>_x64-setup.exe             # NSIS 安装包
src-tauri/target/release/codeatlas.exe                        # Cargo 原始输出（可清理）
src-tauri/target/release/bundle/nsis/*-setup.exe              # Cargo 原始输出（可清理）
```

> 根目录的 exe 已写入 `.gitignore`：二进制不入库，请通过 GitHub Release 分发
> （打 tag 后 `.github/workflows/release.yml` 会自动构建并上传）。

## 使用方式

顶栏命令中心支持三种输入，**输入后回车即可，无需点按钮**：

1. **完整网址**：`https://github.com/facebook/react`（也支持 `.../tree/branch/subdir`）
2. **owner/repo 简写**：`facebook/react`
3. **仓库名搜索**：`react` → 下拉前 10 条（★ 星标 / 描述 / 语言），方向键选择、回车确认、Esc 关闭

另外两种输入源：

- **本地 ZIP**：顶栏「打开」菜单 →「打开本地 ZIP」会在**当前窗口新增一个项目标签**；或直接把 `.zip` **拖入窗口** —— 每个拖入项打开一个**独立窗口**，原窗口状态不受影响；拖入非 ZIP 会提示错误。
- **本地目录**：顶栏「打开」菜单 →「打开本地目录」用系统原生对话框选文件夹（在当前窗口新增项目标签），或直接把**文件夹拖入窗口**（开独立窗口）—— 本地项目（含 git 工作区）直接在 App 内浏览与分析，**无需先打包成 zip**。浏览器模式下该菜单项自动隐藏（无文件系统权限）。
- **多项目工作区**：同一窗口内可同时打开多个项目，顶部出现**项目标签条**（点击切换 / × 关闭）；每个项目的打开标签、分析结果与搜索结果互不影响。**重启后自动恢复上次打开的 GitHub / 本地目录项目**（ZIP 无法还原）。仅单个项目时标签条自动隐藏，视觉与旧版一致。
- **导出报告**：仓库加载后按 `Ctrl/Cmd+K` 选「导出 HTML 报告」，一键生成**单文件离线 HTML**（架构概览 + 度量 + 图 + 阅读路线），双击即开、可直接分享。
- **URL 历史**：输入框为空时按 `↑` / `↓` 可调出最近 10 条记录。

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Enter` | 加载仓库 / 触发搜索（空输入无响应） |
| `↑` `↓` | 搜索结果导航；空输入时翻历史记录 |
| `Esc` | 关闭搜索下拉 / 关闭面板 |
| `Ctrl/Cmd + K` | 命令面板（命令 / 文件 / 符号统一搜索） |
| `Ctrl/Cmd + T` | 符号搜索（直接跳到定义） |
| `Ctrl/Cmd + 单击` 或 `F12` | 转到定义（选中文本后按 F12 亦可） |
| `Ctrl/Cmd + Shift + F` | 全局正则搜索（Web Worker 执行，10 秒超时自动终止） |

## 技术栈

| 层面 | 选型 | 理由 |
|------|------|------|
| 桌面框架 | **Tauri 2**（Rust + 系统 WebView2） | 体积约 3 MB，冷启动快，不用 Electron |
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS | 类型安全；分析层全为纯函数便于单测 |
| AST 解析 | **web-tree-sitter 0.25** + tree-sitter-wasms（WASM） | 浏览器内真实语法树，覆盖 12 种主流语言 |
| i18n | i18next + react-i18next | 命名空间组织，**10 种语言**（中/繁中/英/日/韩/西/法/德/葡/俄），RTL 已预留 |
| 代码高亮 | Prism（语言包按需动态加载） | 首屏只带 4 个核心语法，其余用时再拉 |
| 图表 | Mermaid（动态加载） | 调用图渲染 + SVG/PNG 导出 |
| 本地缓存 | IndexedDB（手写薄封装） | 二次打开秒开；断网回退旧缓存；**分析结果增量复用（N4）** |
| 并发 | Web Worker（AST 解析 / 全局搜索） | 主线程只做 I/O 与渲染；解析按 200 文件分块、25 文件分批投递，可回退主线程 |
| 测试 | Vitest（305 个单测）+ Playwright（34 个 E2E 用例，在线场景用本地 mock 驱动，无需真实联网） | 分析层纯函数全覆盖 |

> **版本锁定说明**：`web-tree-sitter` 必须与语法包 ABI 匹配。项目锁定 `web-tree-sitter@0.25.10` + `tree-sitter-wasms@0.1.13`（0.1.13 由 tree-sitter-cli 0.20.8 构建，ABI 13；0.25.x 是兼容下限）。**0.26+** 运行时改用新版 dylink 段，加载旧 ABI 语法包会报 `getDylinkMetadata` 失败（issue tree-sitter#5171），故切勿升到 0.26+（已通过 Dependabot 忽略）。
>
> **升级路径**：运行时与语法包必须**成对**升级。步骤：① 同时改 `package.json` 里的两个版本并 `npm install`；② 跑 `npm run check:tree-sitter`（会对 js/ts/tsx/python 四种语法包逐个真实解析并打印结果，任一失败即退出非零）；③ 确认 `scripts/copy-grammars.mjs` 里引用的 wasm 文件名仍存在（不同版本文件名不同）；④ 最后 `npm test` 复跑 `tests/unit/{symbols,callgraph,scopeGraph,metrics}.test.ts` 四个依赖真实 AST 的用例。

## 硬性约束（设计红线）

- 🚫 **零云端 AI**：不调用任何在线 LLM / AI API，"智能解读"全部来自确定性静态分析与模板（本地模型支持属于 2.2 规划，且默认关闭）
- 🔒 **零上传**：不收集数据、不上传文件，ZIP 解压前校验路径（拒绝 `../`、绝对路径、UNC、Windows 保留名），防路径穿越
- 🌐 **网络白名单**：默认只访问 `api.github.com` 与 `raw.githubusercontent.com`（CSP 与代码双层强制）；jsDelivr 兜底默认**关闭**，需用户在设置中显式开启
- 🔌 **离线可用**：上传本地 ZIP 后全部功能可用，适合完全断网的内网环境
- 💰 **零付费依赖**：不使用任何付费服务或私有后端

## 项目结构

```text
codeatlas/
├── src/
│   ├── analysis/          # 分析层（纯函数，Vitest 全覆盖）
│   │   ├── parser.ts      #   tree-sitter 解析器池（懒加载 + 降级）
│   │   ├── analysisCache.ts #  分析结果持久化（IndexedDB，N4 增量分析）
│   │   ├── langs/         #   语言规则：每语言一文件（js / python / go / rust / java / c / cpp / csharp / php / kotlin / swift / ruby）
│   │   ├── symbols.ts     #   单次 AST 遍历：定义 / 调用 / 引用 / 导入（零语言特判，全部下沉到 langs/）
│   │   ├── callgraph.ts   #   调用图（去噪、局部优先解析、截断）
│   │   ├── scopeGraph.ts  #   跨文件符号索引（转到定义 / 查找引用）
│   │   ├── metrics.ts     #   圈复杂度 / 认知复杂度 / SLOC / 健康评分（各语言节点集合集中在此）
│   │   ├── limits.ts      #   规模上限（文件数 / 单文件体积 / 图节点数）
│   │   ├── importResolver.ts #  跨语言 import 解析（相对路径 / 点号包名 / 斜杠模块路径 / 别名）
│   │   ├── readingPath.ts #   阅读路线（PageRank + 入/出度角色）
│   │   ├── outline.ts     #   符号大纲树（行区间包含还原嵌套）
│   │   ├── moduleGraph.ts #   模块（目录）依赖图 + 分层
│   │   ├── cycles.ts      #   循环依赖（Tarjan 强连通分量）
│   │   ├── classGraph.ts  #   类图（继承 / 实现）
│   │   ├── pagerank.ts    #   文件依赖图 PageRank
│   │   ├── contextPack.ts #   AI 上下文包（PageRank + token 二分裁剪）
│   │   ├── directories.ts #   目录用途标注规则表
│   │   └── mermaid.ts     #   调用图 → Mermaid 文本
│   ├── sources/           # 数据层（统一 RepoFS 接口）
│   │   ├── github.ts      #   GitHub API + raw 内容（可选 Token）
│   │   ├── zip.ts         #   本地 ZIP（JSZip，懒加载）
│   │   ├── cache.ts       #   IndexedDB 缓存
│   │   └── zipSecurity.ts #   ZIP 路径穿越防护
│   ├── components/        # UI：命令中心 / 文件树 / 标签页 / 各分析面板 / ProjectView / ProjectTabs
│   ├── hooks/             # 单项目状态：useRepo / useCodeAnalysis / useGlobalSearch / useLauncher / useFocusTrap
│   ├── workspace/         # 多项目工作区 store（项目列表 / 激活 / 打开 / 关闭）
│   ├── utils/             # 通用工具：hash.ts（FNV-1a 内容指纹）等
│   ├── workers/           # Web Worker：AST 解析（analysis）/ 全局正则搜索（search）
│   ├── i18n/              # 10 种语言（common / viewer / analysis / errors）
│   └── theme/             # 四主题（light / dark / system / Atlas Blue）
├── src-tauri/             # Rust 核心：多窗口、读 ZIP 字节、配置读写
├── tests/unit/            # Vitest 单测
├── tests/e2e/             # Playwright E2E
├── scripts/               # 图标生成、语法包复制、tree-sitter 自检
└── docs/                  # 文档站（GitHub Pages）+ 截图
```

## 主题

四套主题，均在「设置 → 外观」切换，选择持久化到 `~/.codeatlas/config.json`：

1. **浅色** 2. **深色** 3. **跟随系统**（实时响应系统主题变化） 4. **CodeAtlas 专属（Atlas Blue）**

Atlas Blue 色板：主色 `#4A6CF7`、强调色 `#7C9EFF`、深色底 `#1B1D23`、深色文字 `#E4E6EB`、浅色底 `#F8F9FB`、浅色文字 `#2C2F36`（不用纯黑纯白，降低长时间阅读疲劳；语法高亮 token 色随主题分别定义）。

## 配置与隐私

- 配置文件：`~/.codeatlas/config.json`（语言、主题、token 预算、jsDelivr 开关）
- GitHub Token：**仅存本机 localStorage，不写入配置文件、不上传**（可选，仅用于提高 API 限流额度）
- 缓存：IndexedDB，可在设置页查看用量并一键清除

## 开发

```bash
npm install          # 安装依赖（会自动把 tree-sitter wasm 复制到 public/grammars）
npm run dev          # 浏览器开发模式
npm test             # 单元测试（305 个）
npm run e2e          # E2E（Playwright，34 个用例，含截图生成；在线场景用本地 mock 驱动）
npm run build        # 生产构建
npm run build:exe    # 打包 exe（自动注入 MSVC 环境，产物复制到仓库根目录）
npm run check:tree-sitter   # tree-sitter 运行时与语法包兼容性自检
```

## 已知限制

- AST 解析支持 **JavaScript / TypeScript / TSX / Python / Go / Rust / Java / C / C++ / C# / PHP / Kotlin / Swift / Ruby**；其它语言可正常浏览与高亮，但不参与调用图/跳转/度量。语法包加载失败时会自动降级并提示，不影响其它功能。
- 未纳入的语言（语法包自身有缺陷，已实测记录在 `scripts/check-tree-sitter.cjs`）：**Lua**（与其它语法包共存时解析失败）、**Bash**（`case` 语句触发语法包异常）、**Scala**（无法识别 `while` / `for`）；**Dart / Elm / QL**（ABI 15，升级到 web-tree-sitter 0.25 后具备加载条件，待重新实测）。
- 单次分析上限：**5000 个文件、单文件 1 MB**（超限时按「核心目录 / 入口文件 / 非测试 / 非第三方」优先级选取，不再按字典序硬截断，避免整段模块漏掉）；调用图超过 120 个节点时按连接度截断。
- 调用图超过 60 个节点时按连接度截断为骨架图，界面会明确提示。
- GitHub 匿名 API 限流 60 次/小时；文件内容走 `raw.githubusercontent.com`（不计入 API 配额），文件树失败时若无法回退缓存会提示填入 Token。
- 拖入支持 `.zip` 文件与文件夹（文件夹需桌面端，浏览器模式仅支持 `.zip`）。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。欢迎提交 Issue 与 PR——动手前请先读过[硬性约束](#硬性约束设计红线)。

## 路线图

- **1.0**：Windows 桌面版；GitHub 与本地 ZIP 两种数据源；JS/TS/TSX/Python 分析。
- **2.0**（已发布 `v2.0.0`）：多语言（12 个语言族）与规模提升、阅读路线 / 命令面板 / 架构视图、分析结果持久化与增量分析、本地目录数据源（N5①）、HTML 报告导出（N5②）、多项目工作区（N5③）与质量收口（N6：依赖 ABI 升级 / 在线 E2E / 可访问性）。详见 [docs/PLAN-2.0.md](docs/PLAN-2.0.md)。
- **2.1**：多平台支持 —— 代码层适配（快捷键 Cmd/Ctrl、跨平台字体栈、路径处理）已完成；macOS / Linux 打包 + CI 矩阵待做。
- **2.2**：可选本地 AI（Ollama 本地模型，默认关闭）。

## 安全

安全模型与漏洞报告方式见 [SECURITY.md](SECURITY.md)。**请勿用公开 Issue 报告安全问题。**

## 更新日志

版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 行为准则

参与本项目即表示同意遵守[贡献者公约](CODE_OF_CONDUCT.md)。

## 许可证

[MIT](LICENSE) © CodeAtlas contributors
