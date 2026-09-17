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

截图逻辑见 `tests/e2e/helpers.ts` 的 `saveScreenshot()`。
