# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

## [Unreleased]

### 规划中

- **2.0**（核心升级）：多语言支持（Rust/Go/Java/C/C#）、阅读路线、命令面板、架构视图（模块依赖图/类图/循环依赖）、分析结果持久化与增量分析、HTML 报告导出、本地目录数据源。详见 [docs/PLAN-2.0.md](docs/PLAN-2.0.md)。
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
