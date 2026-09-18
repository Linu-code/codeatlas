# 贡献指南

感谢参与 CodeAtlas！请在动手前花两分钟读完本文，可以让 PR 一次过。

## 项目红线（PR 会被直接拒绝的情况）

1. **引入在线 AI / 云端 LLM 调用**：不允许调用任何在线模型 API，也不允许引入"用云端模型生成摘要"这类逻辑。所有解读能力默认必须来自确定性静态分析、AST 解析、启发式规则或模板。
   > **唯一例外**：规划中的 2.2 **本地 Ollama 集成**——只能作为**默认关闭**的可选功能存在，且只允许访问 `127.0.0.1:11434`，不得新增任何外部域名。详见 [docs/PLAN-2.0.md](docs/PLAN-2.0.md) 第 5 节。在 2.2 落地之前，本红线按"零 AI 调用"严格执行。
2. **引入新的外部网络请求域名**：默认白名单只有 `api.github.com` 与 `raw.githubusercontent.com`（代码在 `src/sources/http.ts`，同时有 CSP 约束与 E2E 断言）。新增域名必须在 PR 中说明理由并默认关闭。
3. **降低 ZIP 安全性**：任何绕过 `src/sources/zipSecurity.ts` 校验的改动都不接受。
4. **上传/收集用户数据**：包括但不限于埋点、崩溃上报、遥测。

## 开发环境

```bash
npm install          # 会自动复制 tree-sitter wasm 到 public/grammars
npm run dev          # 浏览器模式（最快）
npm run tauri dev    # 桌面模式（需先装 Rust 工具链，见 README）
```

首次编写 Rust 侧代码前，请确认：

```bash
cargo --version      # 需要 Rust 1.77+（MSVC 工具链）
```

## 代码约定

- **分析层（`src/analysis/`）必须保持纯函数**：不依赖 React、不访问 DOM、不直接发网络请求。输入输出都是普通数据结构，这样才能被 Vitest 直接覆盖。
- **所有面向用户的字符串必须进 i18n**：新增文案请同时更新 `src/i18n/locales/{zh,en,ja}.ts` 三个文件——`tests/unit/i18n.test.ts` 会强制校验三语言键结构一致，漏一个就红。
- **间距用逻辑属性**：写 `ms-*` / `me-*` / `ps-*` / `pe-*`，不要写 `ml-*` / `mr-*`，以保持 RTL 能力。
- **性能敏感处的约定**：重依赖（JSZip、Mermaid、Prism 语言包、tree-sitter 运行时）必须动态 `import()`，避免拖累首屏（目标：冷启动 < 2 秒）。
- 关键算法请写清原理注释（例如"为什么这里不能按行切分高亮 HTML"），不要只描述代码在做什么。

## 提交前自检

```bash
npm test                     # 单元测试必须全绿
npm run build                # 构建必须零错误零警告
npm run check:tree-sitter    # 若改动了 tree-sitter 相关代码
npm run e2e                  # 涉及 UI 交互时
```

## 提交信息

采用 Conventional Commits：

```text
feat(analysis): 支持 Go 语言的调用图解析
fix(zip): 修正 UNC 路径未被拦截的问题
docs(readme): 补充打包步骤
```

## 分支与发布流程

### 分支策略

- `main` 是唯一长期分支，**始终保持可发布状态**；功能与修复走短生命周期分支。
- 分支命名：`feat/xxx`、`fix/xxx`、`ci/xxx`、`docs/xxx`、`chore/xxx`。
- 禁止在 `main` 上直接提交业务改动；版本号 / 文档类小改动可由维护者直推。

### PR 合入门槛

1. **CI 必须全绿**：类型检查 → 单测 → tree-sitter 自检 → 生产构建 → E2E → Rust 编译检查。
2. 走 PR 流程留痕（即使是单人维护期，也不直接推 `main`）。
3. 涉及 UI 的改动附改动前后截图。

### 发布流程

```text
main 上打 annotated tag（SemVer）→ push tag
        ↓
触发 release.yml：单测把关 → 构建 Windows exe + NSIS 安装包
        ↓
发布 GitHub Release（附 SHA256SUMS.txt + 自动生成 release notes）
```

- tag 格式：`v<major>.<minor>.<patch>`，**必须带 `v` 前缀**（workflow 只匹配 `v*`；写成 `1.0.0` 不会触发发布）。
- 预发布：tag 含 `-`（如 `v2.0.0-beta.1`）自动标记为 prerelease。
- 发布前同步更新 `CHANGELOG.md`，以及 `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` 三处版本号。

### 文档站

`pages.yml` 跟随 `main` 自动部署 `docs/` 到 GitHub Pages，与 tag 发布**解耦**。

> 不要把它挂回发布流程：`github-pages` environment 的 "Deployment branches and tags"
> 默认不允许 tag 部署，挂在 tag 上必然失败（并把整个 Release 拖红）。

### 自动化

- **Dependabot**：npm / cargo 每周、GitHub Actions 每月检查依赖更新并开 PR。
- 破坏性升级已配置忽略项，需走专项 PR 并写明迁移方案：
  - `web-tree-sitter` / `tree-sitter-wasms`（必须成对升级，见 README）
  - `react` / `react-dom` 的 major 升级

## PR 检查清单

- [ ] `npm test` 全绿，新增逻辑有对应单测
- [ ] 三语言文案同步更新
- [ ] 未引入 AI 调用 / 新域名 / 遥测
- [ ] 重依赖仍为动态加载
- [ ] 必要时更新 README 与 `docs/PLAN.md`

## 报告问题

请使用 [Issue 模板](.github/ISSUE_TEMPLATE/) 提交。报 bug 时请附上：

- 操作系统与 CodeAtlas 版本
- 输入（仓库地址或 ZIP 特征），**请勿上传含敏感信息的私有仓库内容**
- 复现步骤与预期/实际表现
- 截图或控制台报错（桌面版可按 `F12` 打开 DevTools）
