# 安全政策

## 支持范围

| 版本 | 状态 |
|---|---|
| 1.x | ✅ 接受安全报告 |
| < 1.0 | ❌ 不再维护 |

## 报告漏洞

**请勿通过公开 Issue 报告安全问题。**

请使用 GitHub 的私密通道：

1. 打开仓库的 **Security** 标签页 → **Report a vulnerability**（GitHub Security Advisories）；
2. 或在新建 Issue 时选择「报告安全问题」模板（若已启用）。

请在报告中包含：

- 受影响版本
- 漏洞类型与影响面（例如：ZIP 解压可写出工作目录 / 绕过网络白名单）
- 最小复现步骤或 PoC
- 如可能，附上修复建议

**响应时限**：确认收到 ≤ 3 个工作日；评估结论 ≤ 7 个工作日。

## 设计层面的安全承诺

CodeAtlas 是**完全本地**工具，安全模型建立在以下硬性约束上（代码与 CI 双重保障）：

| 约束 | 实现位置 |
|---|---|
| **零上传**：不收集、不上传任何代码或数据 | 无遥测代码；`src/sources/http.ts` 为唯一网络出口 |
| **网络白名单**：默认仅 `api.github.com` 与 `raw.githubusercontent.com` | `src/sources/http.ts` 的 `assertAllowedUrl()` + `tauri.conf.json` 的 CSP + E2E `network-whitelist.spec.ts` 断言 |
| **ZIP 路径穿越防护**：拒绝 `../`、绝对路径、UNC、Windows 保留名 | `src/sources/zipSecurity.ts`（含专项单测） |
| **零 AI 调用**：不调用任何在线模型 API | 已列入 [CONTRIBUTING.md](CONTRIBUTING.md) 的红线；2.2 规划中的**本地 Ollama** 仅作为默认关闭的可选集成，且只访问 `127.0.0.1` |
| **凭据不落盘**：GitHub Token 仅存本机 `localStorage`，不入配置文件、不上传 | `src/utils/configStore.ts` |

## 已知的非安全问题（有意设计）

- **NTFS ADS 形态的 ZIP 条目**（`name:stream`）：按设计放行——解压内容只进内存 Map、不落盘，且 `:` 在 Linux/macOS 是合法文件名字符。详见 `src/sources/zipSecurity.ts` 注释与 `tests/unit/zipSecurity.test.ts`。
- **jsDelivr 兜底**：默认关闭，需用户在设置中显式开启；开启后会产生对 `cdn.jsdelivr.net` 的请求，属于用户自担的显式选择。

## 供应链

- 依赖更新由 Dependabot 跟踪（见 `.github/dependabot.yml`）。
- 发布产物附带 `SHA256SUMS.txt`（由 `.github/workflows/release.yml` 生成）。

---

感谢你帮助 CodeAtlas 保持安全。❤️
