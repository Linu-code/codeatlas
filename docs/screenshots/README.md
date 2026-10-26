# 截图目录

本目录的界面截图由 **E2E 测试自动生成**（不手工截图，避免与代码不同步）：

```bash
npm run build     # 先构建
npm run e2e       # 运行 E2E，截图自动写入本目录
```

生成的文件：

| 文件 | 对应界面 |
|------|----------|
| `main.png` | 本地 ZIP 项目加载后的主界面（文件树 + README 渲染） |
| `code-view.png` | 代码视图（Prism 语法高亮 + 行号） |
| `callgraph.png` | 调用关系图（Mermaid 渲染） |
| `metrics.png` | 代码度量面板（健康评分 + 复杂度表格） |
| `search.png` | 全局正则搜索结果 |
| `context-pack.png` | AI 上下文包对话框 |
| `command-palette.png` | 命令面板（`Ctrl/Cmd+K` 模糊搜索） |
| `reading-path.png` | 建议阅读路线面板（入口 → 枢纽 → 中间层 → 末端） |
| `architecture-modules.png` | 架构视图 · 模块依赖图（Mermaid） |
| `architecture-layers.png` | 架构视图 · 按用途分层 |
| `architecture-classes.png` | 架构视图 · 类图（继承 / 实现） |
| `workspace-tabs.png` | 多项目工作区（顶部项目标签条，N5③） |

> 以上截图对应 **CodeAtlas 2.0.0** 构建（web-tree-sitter 0.25.10 运行时），由 E2E 自动生成，反映当前功能形态。

截图逻辑见 `tests/e2e/helpers.ts` 的 `saveScreenshot()`；用例见
`tests/e2e/analysis-panels.spec.ts`、`i18n-theme.spec.ts`、`navigation-panels.spec.ts`、`zip-offline.spec.ts`、
`incremental-analysis.spec.ts`（N4 增量分析，断言状态栏缓存命中，不产截图）、
`local-dir-degrade.spec.ts`（N5① 浏览器降级，断言本地目录菜单项在多语言下隐藏，不产截图）、
`report-export.spec.ts`（N5② 导出命令入口，断言命令面板可见，不产截图）、
`workspace.spec.ts`（N5③ 多项目工作区，产 `workspace-tabs.png`）。
