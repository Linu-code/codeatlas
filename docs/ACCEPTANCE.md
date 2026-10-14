# 验收对照表（19 项）

每一项都标注**验证方式**与**当前结果**。命令均可直接复制运行。

图例：✅ 已通过 ｜ ⏭️ 本机环境跳过（需联网/图形界面）｜ 📄 代码位置

| # | 验收标准 | 验证方式 | 结果 |
|---|----------|----------|------|
| 1 | 双击 exe 能启动，界面正常显示 | `npm run build:exe` 后双击 `src-tauri/target/release/codeatlas.exe`；已实测进程启动、窗口标题 `CodeAtlas`、内存 ~37 MB | ✅ |
| 2 | 输入 `https://github.com/facebook/react` 能加载文件树和 README | 应用内操作；对应实现见 📄 `src/sources/github.ts`、`src/hooks/useRepo.ts` | ⏭️ 需联网（本机 E2E 环境无法访问 GitHub，用例自动跳过） |
| 3 | 输入 `react` 能显示搜索结果列表 | 同上，📄 `src/utils/githubUrl.ts`（输入三分判定）+ `searchRepositories()` | ⏭️ 需联网 |
| 4 | 上传本地 ZIP 后能浏览文件和代码 | E2E `tests/e2e/zip-offline.spec.ts`（2 个用例） | ✅ |
| 5 | 点击 JS/TS/Python 文件后能生成调用关系图 | E2E `tests/e2e/analysis-panels.spec.ts`（Mermaid SVG + 节点断言） | ✅ |
| 6 | 切换中/英/日，所有 UI 文本实时变化 | E2E `tests/e2e/i18n-theme.spec.ts`（中→英→日，含 `<html lang>` 断言）；单测 `tests/unit/i18n.test.ts` 强制三语言键结构一致 | ✅ |
| 7 | 关闭后重新打开，语言设置保持不变 | E2E 同上（刷新后仍为日文，偏好写入 localStorage；桌面版写入 `~/.codeatlas/config.json`） | ✅ |
| 8 | 拖入 ZIP 后新窗口打开项目，原窗口不变 | 📄 `src-tauri/src/lib.rs` 的 `open_zip_window` + `src/utils/tauri.ts`；每个 ZIP 独立 `WebviewWindow(label, url?zippath=)`，窗口间零共享 | ⏭️ 需桌面 GUI（Tauri 窗口级拖拽事件在浏览器中不存在） |
| 9 | 顶栏输入仓库名回车直接出结果，无需点按钮 | E2E 覆盖回车提交路径；📄 `TopBar.tsx` 的 `onKeyDown`（空输入无响应） | ✅ |
| 10 | 切到 CodeAtlas 专属主题后配色明显区别于普通深色 | E2E 断言 `data-theme` 为 `atlas-dark` 且 `--c-bg` 为 `#1b1d23`（普通深色为 `#1e1e1e`） | ✅ |
| 11 | 系统主题切换时，"跟随系统"实时变化 | E2E 用 `colorScheme: dark/light` 两个上下文分别断言 `dark` / `atlas-light` | ✅ |
| 12 | 除 GitHub API 外无任何外部请求 | E2E `tests/e2e/network-whitelist.spec.ts`：离线全流程断言零外部域名；在线流程断言仅 GitHub 域；另含 AI 域名黑名单。第三层为 Tauri CSP（`tauri.conf.json`）与代码级 `assertAllowedUrl()` | ✅（离线部分）/ ⏭️（在线部分需联网） |
| 13 | 右键或 F12 能跳转到跨文件函数定义 | E2E `符号跳转：Ctrl+单击标识符跳到定义文件`（断言跳到 `src/util.ts`）；📄 `src/analysis/scopeGraph.ts` | ✅ |
| 14 | 度量面板显示圈复杂度与认知复杂度并按复杂度排序 | E2E `代码度量：健康评分 + 复杂度表格`；单测 `tests/unit/metrics.test.ts` 断言精确数值（如嵌套加权认知复杂度 = 6） | ✅ |
| 15 | 调用图可导出 SVG 与 PNG，导出清晰 | 📄 `CallGraphPanel.tsx`：SVG 走 Blob 下载；PNG 走 SVG→Image→Canvas **2 倍缩放**→`toBlob`；E2E 断言导出按钮在渲染完成后可用 | ✅（导出按钮态由 E2E 断言，文件落地需人工点击） |
| 16 | `Cmd/Ctrl+Shift+F` 全局搜索支持正则且不卡顿 | E2E `全局搜索：Ctrl+Shift+F 打开，Worker 正则搜索可跳转`；📄 `src/workers/search.worker.ts`（Worker 内执行 + 10 秒超时 terminate） | ✅ |
| 17 | 点击生成 AI 上下文包，5 秒内生成不超过 2000 token 的文件 | E2E 实测生成耗时 < 1 秒；单测断言预算（200/1000/2000）均不超限 | ✅ |
| 18 | 上下文文件包含项目概览、文件树、核心符号签名、调用关系摘要 | E2E 断言四个章节标题 + `src/util.ts:<行号>` 存在；实际输出见 E2E 报告 | ✅ |
| 19 | 该文件能被 WorkBuddy/Trae 等工具直接读取并理解项目结构 | 输出为纯 Markdown（人机双读）+ 结构化 JSON（`codeatlas-context.json`）；E2E 断言 JSON 含 `generator/repo/symbols/calls` 字段 | ✅ |

## 2.0 增补验收（N1 / N2 / N3 / N4）

2.0 的六个里程碑已完成（N1–N4、N5①、N5②，`[Unreleased]`，尚未发布）。验收项与验证方式如下：

| 里程碑 | 验收标准 | 验证方式 | 结果 |
|---|---|---|---|
| **N1** 多语言与规模 | 12 个语言族的定义 / 跳转 / 调用图 / 度量可用 | 单测 `tests/unit/langs.test.ts`（41 例，含 9 种语言真实 AST 断言）；`npm run check:tree-sitter` 逐一解析 14 个语法包 + 共存复解析 | ✅ 14/14 |
| N1 规模提升 | 2000 文件 / 1 MB / 调用图 120 节点 | 📄 `src/analysis/limits.ts`（上限集中定义） | ✅ |
| N1 语法包适配 | 不可用语言必须有实测结论，不能静默失败 | 📄 `scripts/check-tree-sitter.cjs` 的 `EXCLUDED`（Lua / Bash / Scala / Dart / Elm / QL 及原因） | ✅ |
| **N2** 阅读路线 | 顺序确定可复现，入口优先 | 单测 `tests/unit/readingPath.test.ts`（9 例：角色判定、排序、编号、目录分组、确定性）；E2E `阅读路线：自动排序 + 入口标注 + 点击跳转` | ✅ |
| N2 命令面板 / 符号搜索 | `Ctrl+K` / `Ctrl+T` 可用且能跳转 | E2E `navigation-panels.spec.ts` 前 3 例；模糊匹配单测 `fuzzy.test.ts`（11 例） | ✅ |
| N2 大纲视图 | 类 → 方法嵌套，点击跳转 | 单测 `outline.test.ts`（6 例）；E2E `大纲：当前文件的符号树` | ✅ |
| **N3** 模块依赖图 | 目录级依赖边正确、可渲染 | 单测 `moduleGraph.test.ts`（8 例）；E2E `架构视图：模块依赖图` 断言 SVG 渲染 | ✅ |
| N3 循环依赖 | 全部环被发现，长链不爆栈 | 单测 `cycles.test.ts`（12 例，含 5000 节点链）；E2E 断言「未发现循环依赖 ✓」 | ✅ |
| N3 类图 | 继承 / 实现分边，歧义不连线 | 单测 `classGraph.test.ts`（18 例，含 9 种语言真实 AST）；E2E `类图（继承/实现）` 断言渲染 | ✅ |
| N3 分层视图 | 按目录用途聚类 | E2E 断言 `[data-layer="source"]` 行包含 `src` | ✅ |
| 导入解析正确性 | 跨语言解析不产生错误依赖边 | 单测 `importResolver.test.ts`（14 例：相对 / 点号 / 斜杠 / 别名 / 歧义返回 null / 自环防护） | ✅ |
| **N4** 内容哈希指纹 | FNV-1a 32 位确定性：空串 `811c9dc5`、内容变化指纹变化、中英混合稳定 | 单测 `tests/unit/hash.test.ts`（6 例） | ✅ |
| N4 缓存记录三重校验 | `v / hash / path` 任一不符即视为未命中，metrics 缺失兼容旧记录 | 单测 `tests/unit/analysisCache.test.ts`（10 例） | ✅ |
| N4 缓存键命名空间 | github 源 `owner/repo@branch`、zip 源 `meta.name`，不同仓库互不串缓存 | 单测 `analysisCache.test.ts` 的键拼接用例 | ✅ |
| N4 无环境降级 | IndexedDB 不可用时读写返回 null，主流程照常全量分析 | 单测 `analysisCache.test.ts`（Node 环境安全返回 null） | ✅ |
| N4 增量分析 | 冷缓存不显示提示；二次打开命中缓存，状态栏「缓存命中 5 个文件 · 重解析 0 个」，符号跳转不退化 | E2E `tests/e2e/incremental-analysis.spec.ts`（1 例）；全量 E2E 23/24（含 N5① 降级、N5② 导出命令入口，1 个联网用例自动跳过） | ✅ |
| **N5①** 本地目录数据源 | 点「打开本地目录」用系统对话框选文件夹后，文件树/README/分析可用；浏览器模式按钮隐藏；拖入文件夹打开独立新窗口 | 📄 `src/sources/local.ts`（`LocalDirSource` 实现 `RepoFS`）、`src-tauri/src/lib.rs`（`read_dir`/`read_text_file`/`select_dir`）；单测 `tests/unit/localDir.test.ts`（4 例：非 Tauri 抛 not-found-dir / 空目录抛 empty-zip / 正常打开 + 路径穿越拦截）；E2E `tests/e2e/local-dir-degrade.spec.ts`（2 例：默认语言 + 三语言切换下按钮隐藏） | ✅（单测 + E2E 降级 + Rust 编译）/ ⏭️（桌面端真实加载需 GUI） |
| N5① 防爆与缓存隔离 | `MAX_SCAN_ENTRIES=200_000` 静默截断、`MAX_DEPTH=24` 防符号链接环、跳过 12 个构建/依赖目录；缓存 `local:<绝对路径去尾>` 命名空间防同名串缓存 | 📄 `src/sources/local.ts`（`read_dir` 防爆 + `cacheNs`）、`src-tauri/src/lib.rs`（`walk_dir` 深度优先 + `SKIP_DIRS`） | ✅（单测 + 代码审查） |
| **N5②** HTML 报告导出 | 命令面板「导出 HTML 报告」生成单文件离线 HTML（架构概览 + 度量 + 图 + 阅读路线），可分享可归档；零外部请求、双击即开 | 📄 `src/report/buildReport.ts`（`buildReportModel` 纯聚合 + `renderReportHtml` 自包含 HTML）、`src/report/exportReport.ts`（Mermaid→SVG 内联 + Blob 下载）；单测 `tests/unit/report.test.ts`（8 例）；E2E `tests/e2e/report-export.spec.ts`（1 例，命令入口可见） | ✅（单测 + E2E 入口 + 类型检查）/ ⏭️（实际下载落地需人工点击） |
| N5② 离线与 XSS | 报告内联 CSS、无 `http(s)://` 外链；文件名特殊字符被转义 | 单测 `report.test.ts` 断言产物不含外链、`<script>` 被转义 | ✅ |
| **N6** 版本号 2.0.0 | package.json / Cargo.toml / Cargo.lock（codeatlas 包）/ tauri.conf.json / App.tsx 状态栏全部对齐 2.0.0 | 代码审查 + grep 五处 `1.0.0` → `2.0.0`；`npm run check:tree-sitter` 与 `tsc -b` 仍绿 | ✅ |
| **N6** ABI 升级（web-tree-sitter 0.22 → 0.25） | 运行时与 14 个语法包 ABI 兼容，解析正常、共存复解析正常；前端 / Worker / Rust 编译全绿 | `npm run check:tree-sitter`（14 个语法包 + 共存复解析全绿，LANGUAGE_VERSION=15）；`tsc -b` 绿；单测 262/262；E2E 23/24（1 个联网用例自动跳过）；`npm run build:exe` 产出 CodeAtlas.exe（10.4 MB）+ CodeAtlas_2.0.0_x64-setup.exe（4.8 MB） | ✅ |

> 说明：C# / C++ 的语法树不区分类与接口，Kotlin 靠 `Base()` 括号区分，Ruby 的 `include` 不算继承 ——
> 这些差异都写在对应 LangHandler 的注释里，面板统计行也会如实标注（不给"看起来很对"的假信息）。

## 复现命令

```bash
# 单元测试（262 个用例，实际数量以 npm test 输出为准）
npm test

# E2E（8 个 spec / 24 个用例，含 1 个联网自动跳过；截图生成到 docs/screenshots/）
npm run build && npm run e2e

# tree-sitter 语法包自检（14 个语法包逐一解析 + 共存复解析）
npm run check:tree-sitter

# 打包 Windows exe（绿色版 + NSIS 安装包，产物复制到仓库根目录）
npm run build:exe
```

## 环境相关说明（诚实记录）

- **验收 2/3/8/12（在线部分）** 依赖真实 GitHub 网络或桌面 GUI：
  - 本机 E2E 运行环境访问 GitHub 受限，网络类用例设计为**自动跳过**（`test.skip` 并在报告中标注原因），不会伪装成通过；
  - 拖拽与多窗口是 Tauri 窗口级能力，浏览器模式下不存在，需在 `npm run tauri dev` 或 exe 中人工验证。
- **验收 1/8 的桌面部分** 已通过实际启动 exe 验证（进程 + 窗口标题 + 内存占用），拖拽多窗口建议按 README 步骤人工过一遍。

## 已修复的真实缺陷（由本轮验收发现）

| 缺陷 | 影响 | 修复 |
|------|------|------|
| **文件树目录重复**（用户报告：加载 `ollama/ollama` 后顶级 `types`/`model`/`syncmap`/`version`/`x` 各出现两次） | 左树结构混乱，无法正常浏览大型仓库 | 📄 `src/sources/tree.ts`：GitHub `/git/trees?recursive=1` 会**同时返回目录条目（tree）与文件条目（blob）**，旧实现只为「父路径段」建目录节点，显式目录条目被当作普通节点直接挂载、未登记进 `dirIndex`，随后处理其子文件时又新建同名目录 → 重复。现改为幂等的 `ensureDir()`（路径 → 节点唯一真相来源），目录条目只登记不挂载，并补充路径归一（尾斜杠 / `./` / 反斜杠）与文件去重。回归测试见 `tests/unit/buildTree.test.ts`（10 个用例，含 ollama 结构模拟） |
| 树缓存沿用旧结构 | 即使修复代码，用户仍会看到旧的重复结构（IndexedDB 里存的是错误快照），误以为没修好 | 📄 `src/sources/cache.ts`：文件树缓存加**格式版本号**（`TREE_FORMAT_VERSION = 2`），版本不匹配或旧格式（无版本号）一律视为失效并自动重新拉取，无需用户手动清缓存 |
| `analyze()` 为异步，调用方在 `await` 后从闭包读取 `state`，拿到的是更新前的快照 | 符号跳转与上下文包在"刚分析完"时失效（E2E 用例暴露） | `useCodeAnalysis` 增加 `stateRef` 镜像并让 `analyze()` 返回权威结果，调用方一律使用返回值 / `getState()` |
| E2E：Playwright worker 在页面残留挂起请求时无法退出 | 一次失败会让整个 E2E 卡住十余分钟 | 网络类用例在 `finally` 中显式 `page.close()` |
| 打包脚本直接跑 `cargo build` 会报 `link.exe not found` | 普通 PowerShell 会话无法打包 | 新增 `scripts/build-exe.ps1`：自动探测 MSVC/SDK 并注入 `PATH/INCLUDE/LIB`（不依赖 `Enter-VsDevShell`，规避其环境变量大小写冲突问题） |
| `tauri.conf.json` 中 `nsis.installMode` 写成 `perUser` | 打包直接失败 | 改为 Tauri 2 正确取值 `currentUser` |
| 打包时报 `LNK1104: cannot open file '...deps\codeatlas.exe'` | 影响重复打包 | 原因是上一次启动的应用实例仍占用输出文件；结束残留进程后重试（已写入打包脚本使用说明） |
| 文档中的测试数（102）与打包命令（`npm run tauri build`）过期 | 读者会照抄失败命令、或怀疑文档可信度 | 统一改为 `npm run build:exe`；测试数改为「12 个文件 / 115 个用例（以 `npm test` 输出为准）」，涉及 README、ACCEPTANCE、PLAN、docs/index.html 四处 |
| ZIP 安全策略缺一条明确的"有意放行"记录 | NTFS ADS 形态（`name:stream`）未拦，后来者可能误以为是漏判 | 📄 `src/sources/zipSecurity.ts` 增加注释说明放行理由（内容只进内存 Map 不落盘；`:` 在 Linux/macOS 是合法文件名字符），并在 `tests/unit/zipSecurity.test.ts` 用测试固化该行为 |
