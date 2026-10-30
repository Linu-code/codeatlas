# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

## [5.0.0] - 2026-10-30

> 主题：**上下文引擎**——分级寻址 + 会话预算调度 + 可验证的账本。
> 产品第一次既能"走进任意代码"，又能**证明自己省了多少**。

### 一、分级寻址（索引从"样本"变成"地图"）

**问题（实测）**：索引包永远是抽样。2000 预算下随机抽 150 个符号：
express 覆盖 94/129、tsup 48/150、Vue **1/150（0.7%）**。模型要的符号不在包里时，无处可去。

**四级地址**（每级都便宜且完整）：

| 地址 | 返回 | 实测体积 |
|---|---|---|
| `目录/` | 子目录 + 文件 + 各自符号数 + 3 个关键符号地址 | 60~700 token |
| `index:路径/文件.ts` | 该文件**全部**符号及地址（不抽样） | p50 ~100 |
| `路径:行号` | 代码片段（4.4 起自动扩展到整个函数） | p50 68~124 |
| `./` | 仓库根摘要 | 同目录摘要 |

- 新增 `analysis/hierarchy.ts`；索引包新增**模块地图**章节，保证每个模块都可被寻址。
- **实测（修复后）**：三级可达 express 129/129、tsup 150/150、Vue 150/150；三次请求 890~1365 token。

### 二、会话预算调度（展开不再无限膨胀）

展开逐个都很便宜，但会话会累积：8k 包 + 3×1500 片段足以把 16k 窗口撑爆，而且模型不会说自己记不住了。

- 新增 `analysis/session.ts`：`planEviction` / `computeLedger`（纯函数）。
- 规则：片段总量超过「包的 2 倍」时，按「被引用次数 → 新旧」淘汰；**最新一条永不淘汰**（丢了等于让模型失去刚看过的内容）。
- 被淘汰的片段在历史里替换成一句「Slice X was moved out of the context window…」——**如实告知**，否则模型会基于自以为还记得的内容推理。
- 重复索取同一地址不再重新取回，但会提高该片段的保留优先级。

### 三、上下文账本（把"省了多少"变成可见事实）

- AI 页签实时显示：`会话 1.2k token · 已展开 3 处 · 相比整份读入省 18×`（`data-ai-ledger`）。
- 分母是**不切片的话真读多少**：`fileTokens` 由切片时顺手算出（整份文件估算），同一文件只算一次。
- 目录摘要 / 文件清单不计入"整份读入"（它们本来就不是整文件）。

### 四、一句话直达（少点三次）

原来要「选用途 → 生成 → 点 AI 解读 → 等」四步。现在：输入任务 → 点「直接回答」——
有任务描述自动选**任务焦点包**，没输入自动用**符号索引**，生成后立刻追问并自动展开。

- 对话框常驻任务输入框（`data-pack-focus`）+ 新按钮 `data-ai-ask`。
- `ProjectView.generatePack` 现在返回生成的包，供「直接回答」拿到新包后立即提问。

### 测试

- 单测 **432**（+10 `session.test.ts`、+3 `aiExpand` 淘汰/账本、+9 `hierarchy`、+2 地址形态、+1 模块地图）
- E2E **43**（+2）：分级下钻、直接回答（断言账本出现、自动选对包形态、请求里带了切片）



## [4.4.0] - 2026-10-30

> 主题：把「按需展开」从"能给"做到"给对"——所有改动都先量化，再决定要不要留。

### 修复（单行地址只回 ±6 行，模型拿到半截函数）

索引里给的地址就是 `路径:行号`，而 `路径:行号` 原来只返回该行 **+ 后 6 行**。60 行的函数只能看到开头，模型要么再要一次（多一轮往返），要么基于半截代码下结论（更糟）。

现在：单行地址若落在某个符号内部，**按符号边界扩展**（嵌套时取最内层）；显式行段 `a-b` 不扩展——用户已经划定范围，不替他做主。

实测（三个真实仓库，取每个函数体的中间行，共 1621 个样本）：

| 仓库 | 完整覆盖（旧 → 新） | token p50（旧 → 新） | token 均值（旧 → 新） |
|---|---|---|---|
| express | 0% → **100%** | 90 → **61** | 87 → 80 |
| tsup | 1.7% → **85%** | 88 → 127 | 88 → 275 |
| Vue | 2.4% → **96.3%** | 108 → **92** | 110 → 168 |

平均多花 50%，但**中位数反而更低**（小函数不再被 7 行窗口浪费），且换到的是完整函数。

### 修复（索引使用说明里的示例地址是编的）

使用说明写的是「例如 `src/core.ts:42`」——真实仓库里没有这个地址。实测三个仓库各出现 **1 次解析失败**：模型照着示例要了个不存在的文件。

现在示例地址取自**包内第一条真实条目**，并额外给出 `路径#符号名` 形式。端到端复测：三个仓库各 120 条地址，**360/360 全部解析成功**，其中全部按符号边界扩展，截断 0 / 3 / 1 条。

### 变更（用途选择不再每次重置）

对话框自己存一份 `intent`，而包由 ProjectView 生成：重开对话框后下拉显示「理解项目」、内容却是索引包，两边不一致；每次重开都要重新选一次。

- 用途状态上移到 ProjectView，对话框改为受控；选择写入 `localStorage['codeatlas.packIntent']`，跨会话记住。
- 白名单抽出 `PACK_INTENTS`（`PackIntent` 由它派生），校验不再手抄一份。

### 验证后仍保留 / 放弃的判断

- **保留**：符号边界扩展（覆盖率提升 85~100 个百分点，成本中位数更低）
- **保留**：120 条地址的端到端复测（这是唯一能证明"展开链路真的能用"的东西）
- **不做**：把展开上限从 3 轮提高——扩展后每次拿到的是完整函数，3 轮足够；盲目加轮次只会放大 token 成本

### 测试

- 单测 **407**（+6）：`slice.test.ts` 覆盖嵌套取内层、行段不扩展、符号外行号不扩展；`contextPack.test.ts` 覆盖示例地址可解析
- E2E **41**（+1）：单行地址落函数内部 → 展开到整个函数（断言能拿到 `return total`）；用途跨开关保持

## [4.3.0] - 2026-10-28

> 主题：把检索闭环交给模型——AI 自己索取代码。

4.2 的「按需展开」还需要人把地址贴给工具。4.3 让模型自己在回答中输出 `@@expand 路径:行号`，工具捕获后切片回灌，模型继续写。**用户看到的是干净正文**，标记行被过滤。

### 新增

- **多轮对话传输**（`aiClient.streamChatMessages`）：原 `streamChat` 只能传单条 prompt，多轮展开需要保留历史。`streamChat` 保持原签名，内部改为委托。
- **展开协议**（`buildExplainPrompt(pack, { expand: true })`）：告诉模型可索取、只认包内路径、最多 3 次、标记对用户不可见。不开启时不出现任何相关文字。
- **标记过滤器**（`aiExpand.ExpandMarkerFilter`）：**按行缓冲**，跨 chunk 拆开的标记（`"@@exp"` + `"and src/a.ts:1"`）也能识别；行内顺带提到的不算标记。这是必须的——逐 chunk 做字符串替换会漏，且会把半截标记吐给用户。
- **循环**（`runExpandingChat`）：同一地址只取一次；地址取不到时记录失败并明确告知模型"别再要"；`resolve` 抛异常也不会中断整轮；`maxRounds` 默认 3。
- UI：AI 页签显示「已按需展开 N 处（约 M tokens）」，悬停可见具体地址（`data-ai-rounds`）。

### 变更（切片预算按请求类型自适应）

实测 400 个符号的切片体积：express p50 65 / p90 187；Vue p50 135 / p90 627；tsup p50 114 / p90 703。**固定 800 会从中间截断 6.8%~8.6% 的函数**，而读到半截函数的模型会得出错误结论。

- 精确地址（`path#sym` / `path:start-end`）→ **1500**：截断率降到 3.3% / 2.5%
- 整文件 → 800：那是"大概看看"，不是"我要这个函数"

### 实测（成本对比）

Vue（526 文件 / 5055 符号）：

| 方案 | 成本 |
|---|---|
| overview 包一次交付 | 8000 token |
| 索引包 2000（实测 1881 / 64 条）+ 2 次按需展开（p50 135） | ≈ 2150 token（**27%**） |

### 验证后**否决**的优化

- **索引按文件分组**（`### path` + 行内只写 `:12`）：实测只省 1.2 token/条（7%），却牺牲地址可读性（模型要自己拼路径、用户复制不出来）。不划算，不做。

### 已知局限（必须说清）

索引是**最重要符号的样本，不是完整地图**。Vue 2000 预算只列 64 / 5055 条，模型想问的符号不一定在包里——这时它能做的只有改用包里已有的符号。要真正覆盖全量，需要更大的预算，或按模块分段生成索引（未做）。

### 测试

- 单测 **401**（+12）：`aiExpand.test.ts` 覆盖无标记透传、跨 chunk 标记、反引号容错、重复地址去重、取不到不重试、resolve 抛错、maxRounds 封顶、协议注入
- E2E **40**（+1）：用本地 mock 的 OpenAI 兼容 SSE 跑真实两轮——第一轮索取、第二轮拿到代码；断言页面上**不出现** `@@expand`、第二轮请求体里确实带上了切片

## [4.2.0] - 2026-10-27

> 主题：从「一次性摘要」到「可寻址索引 + 按需展开」。

### 新增（符号索引：只给地址，不给实现）

第五种用途 **符号索引（index）**。前四种都是"一次交付"：给多少就只能看多少。索引改成**可寻址**——包里每条都是 `路径:行号 — 类型 — 名称`，AI 知道"有什么、在哪"，需要实现时再按地址要。

- **索引行不带签名**。实测签名平均占一条索引的七成 token（30+ / 40），而索引的职责只是定位。砍掉签名后同样预算能装的条目翻倍。
- **轮转取用，而不是一个文件倒到底**。按文件顺序连续铺开会出事：预算 1000 时 Vue 只装下 17 条，**全部来自同一个文件**（PageRank 第一名恰好有 17 个方法），索引退化成"一个文件的符号表"。改成跨文件轮转后，同样预算覆盖 17 个文件。
- **使用说明单独成章、可降级**：它有一百多 token，预算紧张时先丢说明、保住条目；且只在能装下 ≥5 条索引时才带（否则预算全花在"教怎么用"上）。
- 实测：express / tsup 在 4000 预算下能装下**全部符号**（129 / 197）；Vue 5055 个符号装 152 条，覆盖全部 16 个模块。

### 新增（按需展开：把地址变成代码）

`analysis/slice.ts` —— 上下文包的另一半。包负责"在哪"，它负责"给我看"。

- **四种地址写法**：`src/a.ts`（整文件）/ `src/a.ts:42`（单行，自动带上下文）/ `src/a.ts:42-80`（行段）/ `src/a.ts#build`（按符号，自动取到该函数的真实结束行）；裸符号名在**全仓唯一**时才解析。
- **多义不猜**：后缀匹配到多个文件、或同名符号有多个定义时，返回候选列表让用户点选（与 importResolver / callgraph 同一原则）。
- **带行号输出**：`  42 | const x = 1`，直接贴回对话即可引用。
- **按 token 预算裁剪**：默认 800，超出从尾部收缩（保留函数开头的声明与签名）并标注"已截断，完整范围 …"。
- **容错**：反引号、中文标点（从 Markdown 里复制常带上）自动剥离；二进制 / 超大文件报「读取失败」而不是「符号不存在」。
- UI：上下文包对话框新增「按需展开」页签（`data-slice-address` / `data-slice-run`），候选可点选，结果可复制。

实测往返：从 Vue 的索引里取一条 `packages/reactivity/src/arrayInstrumentations.ts:22` → 展开 7 行 / 131 token；tsup 同类 77 token。**一次往返的花费，比把整个文件塞进上下文低一个量级。**

### 测试

- 单测 **389**（+15）：`slice.test.ts` 13 例（四种地址、多义候选、路径后缀、容错、预算截断、越界夹紧）+ 索引 3 例
- E2E **39**（+1）：切到符号索引 → 地址展开 → 行号与内容校验 → 查不到时提示

## [4.1.0] - 2026-10-27

> 主题：从「一份摘要」到「按任务取用」。

### 新增（任务焦点包）

`overview` 回答的是"这个项目是什么"，但用户的任务是具体的（"加一个自定义指令"、"改登录鉴权"）。把整个项目摘要丢给 AI，模型仍要靠猜。新增第四种用途 **任务焦点（focus）**：输入关键词，只给相关的那一块。

- **纯启发式检索**（`analysis/focus.ts`，零模型 / 零 embedding）
  - 查询切词：驼峰 / 下划线 / 标点 / 连续大写都切开，丢弃虚词
  - 词 → 符号名（精确 6 / 前缀 4 / 包含 2.5）、文件路径（整段 5 / 子串 2）、签名
  - 命中文件作为种子，沿文件依赖边**双向**扩散 2 跳（每跳衰减 0.35）
  - 输出 12 个相关文件 + 命中依据 + 这些文件之间的依赖边
- **包里解释"为什么选它"**：每个文件后面列出命中依据（`符号 \`createRenderer\` 含 \`renderer\``），结论可核查，不是黑箱。
- **测试文件不抢位置**：测试 / 示例路径权重 ×0.3，且**实现文件永远排在它们前面**。若直接命中全部落在测试里，包内会显式提示"实现代码没有词面匹配，下表是测试引用扩散得到的，请当作可能相关"。
- **查不到就如实说**：不静默退回全量，而是提示改用模块名 / 文件名 / 英文标识符。
- 实测：Vue 查 `renderer` → 首条 `packages/runtime-core/src/renderer.ts`（37 分，10 条符号命中）；tsup 查 `dts rollup` → `src/rollup.ts` / `src/api-extractor.ts` / `src/utils.ts` 全部命中真实实现。
- UI：用途下拉新增「任务焦点」，选中后出现关键词输入框，回车或点「生成」即可（`data-pack-focus` / `data-pack-focus-run`）。

### 测试

- 单测 **374**（+20）：`focus.test.ts` 13 例（切词、打分、扩散、测试文件降权、空查询）+ 上下文包 6 例（章节、扩散标注、未命中、预算）
- E2E **38**（+1）：切到任务焦点 → 关键词 → 章节切换 → 未命中提示

## [4.0.0] - 2026-10-27

> 主题：把「压缩上下文」从手艺变成可验证的工程。

### 新增（按用途裁剪上下文包）

「一次生成、所有场景共用」让包变成大杂烩：想了解架构的人被迫读复杂度表，想评估代码质量的人被迫读完 200 条符号签名。现在可以选**用途**，同样预算下信息密度更高：

- **理解项目**（overview，默认）：概览 / 构建 / 技术栈 / 目录 / 阅读路线 / 符号 / 调用关系。
- **代码健康**（health，新增）：概览 + 复杂度 Top 10 / 循环依赖 / 超大文件。这些数据早就分析出来了，但一直没进包 —— 而 AI 想帮忙改代码时，最需要知道"哪块是雷区"。
- **对外接口**（api，新增）：概览 + 构建 / 技术栈 + 模块地图 + **只列导出符号**（内部符号不进包）。

实测（同样 8000 预算）：Vue 5000+ 符号的项目，overview 装 74 条、health 装 137 条、api 装 157 条 —— 砍掉无关章节后能多装 85%~112%。

- UI：上下文包对话框新增用途下拉，切换即重新生成（`data-pack-intent`）。
- 实现：`ContextPackInput.intent` + `cycles`；health / api 的章节结构固定，降级阶梯退化为单一档位，只对符号数做二分。

### 修复（同一份"模块聚合"被抄了两遍）

- `contextPack.ts` 自带一份 `moduleOf`（只取路径第一段），与 `moduleGraph.ts` 里已升级的实现（`src/` 与 `packages/<pkg>` 各下钻一层）不是同一个。
- 后果：同一份 Vue 代码，架构视图里是 16 个模块，上下文包的模块地图里只有 **4 个**（`(root) / packages / packages-private / scripts`）—— 模块地图等于废掉。
- 改为从 `moduleGraph` 导入，模块名展示抽成 `displayModule()` 统一处理根目录文案。修复后上下文包与架构视图的模块数一致。

### 变更（上下文包：任何预算下都必须是可用的）

- **token 估算改为按字符四类加权**（原来 `字符数 / 4` 一刀切）
  - 用 6 个真实仓库 × 4 档预算、cl100k BPE 对照实测：原实现**系统性低估 15%~37%**，且方向恒为低估。预算 1000 实际塞 1450 token —— 用户以为在安全区内，实际已经溢出。
  - 新系数由语料标定：标识符 0.25 / 空白 0.26 / 标点 0.62 / CJK 1.02（token per char）。平均绝对偏差从约 25% 降到 5.9%。
  - 二分裁剪额外留 5% 余量。复测 24 个组合，真实占用落在预算的 **80%~100%**，无一超限。
- **分层打包 + 五档降级阶梯**（`analysis/contextPack.ts`）
  - 旧降级链是「完整树 + 符号 → 仅符号 → 仅头部」。预算 1000 的大项目会直接掉到最后一档，产出一份只有「项目概览 + 40 个依赖名」的 **198 token 空包** —— 有元信息，没有任何代码结构。
  - 新增**骨架层**（模块地图 Top 12 + 关键文件 Top 6），降级顺序改为：完整树 → 骨架 → 去阅读路线 → 去调用关系 → 无结构。原则是**先降目录粒度、再降符号**：没有文件清单，AI 连"该要求看哪个文件"都做不到。
  - 实测 Vue（526 文件）1000 预算：**198 → 1181 token**，从空包变成可用的骨架 + 符号。
- **新增「本次裁剪说明」章节**
  - 明确告知读者与 AI：符号已列出多少 / 共多少、模块覆盖几成、哪些章节被省略，并声明「未覆盖 ≠ 不存在」。
  - 一个知道自己盲区的模型不会编造"本项目没有 X 模块"。
- **技术栈依赖截断**：依赖清单只列前 8 个 + 总数。原先 40 个 `@types/*` 会挤掉真正重要的代码结构。
- **极小预算裁剪头部**：连骨架都放不下时，按章节从后往前砍到装得下，并显式标注「已裁剪到最小」，不再静默返回空文档。

### 测试

- 单测 **354**（+15）：新增 120 文件 / 12 模块合成项目在 500 / 1000 / 2000 / 8000 / 32000 五档预算下的可用性回归，锁死"不出现空包"与"不超预算"两条底线。

## [3.0.0] - 2026-10-27

### 新增（AI 解读）

把 AI 上下文包直接交给模型，流式输出项目导读。**默认关闭，不配置就一条请求都不发** —— 「零后台外部请求」的约束没有改变。

- **双通道**（`src/utils/aiClient.ts`，零 SDK 依赖，安装包体积不变）：
  - **本地 Ollama**：默认 `127.0.0.1:11434` + `qwen2.5-coder`，代码不出本机，断网可用；协议为 `POST /api/chat` 的 NDJSON 流。
  - **OpenAI 兼容 API**：`POST {base}/chat/completions` 的 SSE 流，baseURL / 模型名可配，OpenAI、DeepSeek、自建网关通用。
  - 两者都是手写 `ReadableStream` 解析：跨 chunk 的半行 JSON 会留在缓冲区，不会切坏；`[DONE]` 与心跳注释忽略。
- **输出结构固定**：项目做什么 / 模块分工 / 新人阅读顺序（5–8 个文件 + 理由）/ 风险点。指令明确要求**不得编造上下文里没有的文件与依赖**。
- **UI**：设置页新增「AI 助手」分区（提供方下拉、服务地址、模型、API Key、隐私说明）；上下文包对话框新增 `AI` 页签与「AI 解读」按钮，流式增量上屏，可随时停止。
- **安全**：`baseUrl` 必须是 `http`/`https`，其它协议直接拒绝；API Key 只存 `localStorage`（与 GitHub Token 同策略），不写入 `config.json`。
- **错误分类**：`not-configured` / `invalid-url` / `network` / `http` / `empty` / `aborted`，每类都给出可操作提示。
- 单测 +13（`tests/unit/aiClient.test.ts`，覆盖两种协议、跨 chunk 拼接、错误分类与取消）；E2E +2（默认关闭时不发任何外部请求、设置页可切换提供方并回填默认值）。

### 变更

- **平台范围收紧为仅 Windows**：README 不再宣称「macOS / Linux 代码层适配已完成」。源码里保留的跨平台写法（`Ctrl`/`Cmd` 双认、跨平台字体栈、POSIX 路径）如实标注为「未经打包与运行验证」，不构成支持承诺；多平台移出路线图。
- **版本号单一来源**：状态栏的 `CodeAtlas vX.Y.Z` 改为 Vite `define` 注入的 `__APP_VERSION__`（取自 `package.json`），不再手写一份。

### 修复（格式与预览的区域/覆盖缺口）

- **十种语言里八种的数字格式错用 en-US**（`utils/format.ts`）：`localeOf` 只判断 `zh` / `ja`，`de` / `fr` / `es` / `pt` / `ru` / `ko` 全部落到 `en-US`。德语该显示 `1.234,5` 却显示 `1,234.5`。改为表驱动映射，且 `zh-TW` / `zh-HK` / `zh-Hant` 排在 `zh` 之前（否则被简体抢先匹配）。`formatSize` 的 KB/MB 小数分隔符原来硬编码 `.`，一并改为跟随区域（德语 `1,5 KB`）；非有限值或负数返回 `—` 而不是 `NaN`。
- **7 种能高亮的扩展名被挡在预览之外**（`theme/themes.ts`）：`PREVIEWABLE_EXTS` 是手抄的独立列表，漏了 `sql` / `ini` / `xml` / `svg` / `vue` / `sh` / `bash` 等——这些在 `EXT_TO_PRISM` 里明明有语法包，打开却提示「不支持预览」。改为由 `EXT_TO_PRISM` 派生，杜绝两份列表脱节。
- **状态栏文件大小每次渲染都重算**（`components/ProjectView.tsx`）：`new Blob([content]).size` 会复制整段文本，而分析进度每 N 个文件就触发一次重渲染，大文件被反复复制几十次。改为 `useMemo` 按文件内容缓存。
- **主题白名单三处各抄一份**（`types/config.ts`）：新增 `THEME_IDS` 常量作为单一来源，`normalizeConfig` 与 `readSavedTheme` 改为引用它（原先各写一遍 `['light','dark','system','atlas']`，加主题必漏）。

### 清理（死代码与冗余）

对全仓做了一次可达性 + 引用计数审计（106 个源文件 / 313 个导出 / 232 个 i18n 叶子键），删掉从未接线的部分：

- **11 个死导出**（全仓零引用，含本文件零使用）：
  - `analysis/analysisCache.ts`：`clearRepoAnalysisCache` 与它专用的 `deleteByPrefix`
  - `analysis/parser.ts`：`isRuntimeLoaded` / `isLanguageSupported` / `disposeParsers`，以及只被 `isRuntimeLoaded` 读的模块级 `runtime`
  - `utils/format.ts`：`formatDate`
  - `utils/githubUrl.ts`：`parsedOrThrow`（连带移除已无用的 `RepoError` 导入）
  - `utils/markdown.ts`：`renderMarkdown` + `RenderOptions`（签名收 `options` 却完全忽略，属误导性 API）
  - `utils/tauri.ts`：`listLocalDir` / `readLocalText` / `DropEventPayload`（`LocalDirSource` 直接调 `invokeSafe`，这两个是同功能重复封装）
  - `workspace/persistence.ts`：`clearWorkspace`
- **18 个死 i18n 键 × 10 语言 = 180 行**：`appName` / `tagline` / `cancel` / `clear` / `stars` / `viewOnGitHub` / `closeWindow` / `emptyFile` / `copiedPath` / `copyPath` / `searchResults` / `localZip` / `linePrefix` / `openedInNewWindow` / `currentWindow` / `directories` / `purposeLabel` / `jumpedTo`。
  - 保留 `errors:unsupportedLanguage`——语法包缺失时本应提示用户，属「该接未接」而非废弃。
- **2 个死 CSS 变量**：`--c-primary-hover`（4 套主题各定义一次）与 `--c-accent`（2 套），全仓无 `var()` 引用。
- **Rust 死命令**：`close_window`（前端从未调用），连同 `generate_handler!` 里的注册一并删除。

**审计未发现问题的部分**：无注释掉的代码块、无 TODO/FIXME 遗留、无孤儿资源（screenshots / assets 全部被引用）、无未使用依赖（`autoprefixer`/`postcss` 在 `postcss.config.js` 里以裸 key 引用，`@types/*` 与 `@tauri-apps/cli` 属工具链必需）、Prism 的 18 个 token 类由运行时生成不可删、`docs/index.html` 由 GitHub Pages 工作流部署。

**有意保留**：另有 66 个导出「仅本文件使用」，多为接口/类型契约（`GraphNode`、`ReportModel` 等）。去掉 `export` 不减少产物体积（tree-shaking 已处理），却会削弱模块边界表达，判定为不值得改。

### 修复（真实仓库泛用性测试暴露的问题）

用 8 个真实 GitHub 仓库（express / flask / chalk / tsup / vuejs/core / gin / sindresorhus-is / octocat-Hello-World，共约 1400 个源文件）跑完整分析管线，定位并修掉 6 个会导致结果错误或功能失效的缺陷：

- **CommonJS 依赖完全不被识别**（`src/analysis/langs/javascript.ts`）：`importNodes` / `importPaths` 原来只处理 ESM 的 `import_statement`，`require('./x')` 既不产生依赖边、又被当成普通函数调用。实测 express 的 `fileEdges` 为 **0**（65 个源文件的依赖图全空），循环依赖检测恒为空。现在 `require()` 与动态 `import()` 都计入依赖；`symbols.ts` 的调用提取增加 `!nowInImport` 守卫，「require 进调用图」的污染一并消除。修复后 express `fileEdges` 0 → **65**，并检出 2 个真实文件级循环。
- **模块图对标准项目完全塌陷**（`src/analysis/moduleGraph.ts`）：`moduleOf()` 只取路径第一段，`src/api/client.ts` 与 `src/pages/Dashboard.tsx` 归为同一个 `src` 节点。实测 4 个标准结构仓库全部塌成 4 个节点，`from === to` 的边被丢弃（本项目的通用样例：45 条真实依赖只剩 1 条）。现在 `src/<sub>/...` 与 `packages/<pkg>/...` 会下钻一层。修复后 Vue monorepo 4 → **16 节点**、4 → **22 条边**（1266 条文件边不再被丢弃）。
- **嵌套闭包被重复计入圈复杂度**（`src/analysis/metrics.ts`）：`measureFunction` 遍历函数体时没有在嵌套函数处剪枝，外层函数把内层所有分支也算进自己的复杂度，文件级总和更是「外层含内层 + 内层再算一遍」的双重累加。实测 Vue 的 `baseCreateRenderer` 被算成 **407**（实际由几十个内层渲染函数贡献）。现在遇到函数节点即停止下钻。修复后该文件最大值降到 **207**（`compileScript`），express 的排行榜也从「测试里的匿名回调」回到真实热点 `lib/response.js#send`。
- **jsDelivr 兜底路径全不可用**（`src/sources/tree.ts` / `github.ts`）：jsDelivr 的 `?structure=flat` 清单返回带前导 `/` 的绝对路径，`normalizePath` 不剥离会造出 `path: ''` 的空名目录，整棵树多一层、文件名带斜杠、读取全部 404；且子目录过滤在剥斜杠前做，`subDir` 永远匹配不上。现已归一化并调整过滤顺序。
- **超大树被静默截断**（`src/sources/github.ts`）：`git/trees?recursive=1` 返回的 `truncated` 字段原本被解构后丢弃，大仓库只加载前 10 万条却毫无提示，后续所有分析都基于残缺数据。新增错误码 `truncated` 与 10 语言提示，明确建议「打开具体子目录或用 ZIP 加载」。
- **git 子模块被当成普通文件**（`src/sources/github.ts`）：`type: 'commit'`（mode 160000）的条目没有内容可读，点击必然 404。现于建树前按 blob/tree 过滤。

### 修复（第二轮：依赖解析与调用图消歧）

上一轮修完「能不能连上」之后，继续量了「连得对不对」，又发现 4 个问题：

- **monorepo 包名解析缺失**（`importResolver.ts`）：`import { x } from '@vue/shared'` 在仓库内没有 `node_modules`，按文件名 stem 匹配永远找不到目标；Vue 有 **453 条**这类引用被静默丢弃。新增「包名 → 入口文件」索引（`packages|libs|modules|apps/<pkg>/(src/)?index.*`）。Vue 的 import 解析率 **65.2% → 87.5%**，导入边 1266 → 1689，模块边 **22 → 65**。
- **目录级解析缺失**（`importResolver.ts`）：Go 的 `github.com/o/r/binding`、Python 的 `from flask import X`、Java 的 `com.example.user` 都是「路径段 ↔ 目录」语义，按文件名匹配全部失败。新增目录后缀索引（`src/flask` 同时登记为 `src/flask` 与 `flask`，同后缀多目录视为歧义不猜），入口优先取「与目录同名文件」再取 `index/__init__/mod`。顺带修掉一个提前 return 导致目录匹配永远执行不到的问题，以及目录匹配可能命中自身造成的自环。
- **Python 相对导入不被识别**（`importResolver.ts`）：`from .sansio import x` 的 `.sansio` 被当成「名字里带点的目录」而非层级，flask 有 164 条相对导入全部失败。现在 `.x` / `..x` / `.` 按层级转换为 `./x` / `../x` / `./`。flask 解析率 **19.1% → 45.1%**，导入边 71 → **169**，并检出 2 个此前看不到的文件级循环。
- **调用边对多义符号「随便挑一个」**：`callgraph.ts` 与 `buildCallEdges`（阅读路线）遇到同名符号时，前者取行号最靠前的、后者取按路径排序第一个，与该模块头部「宁可少连，不可乱连」的原则自相矛盾。通用名（`get` / `map` / `helper`）在大型仓库能匹配到几十个定义，实测多义率：Vue 38.0%、gin 39.9%、flask 30.0%。现在改为「全局唯一定义 → 连；多义时只有本文件 import 的目标里恰好只有一个定义点才连；否则放弃」。Vue 调用图边 390 → **292**、gin 305 → **203**、flask 228 → **145**，剔掉的都是假边。

### 新增

- **2.1 平台适配（代码层，打包仍待做）**
  - **快捷键提示平台化**：`src/utils/platform.ts` 新增 `isMac()` / `platformizeShortcut()`；命令面板与引用面板的「Ctrl+K / Ctrl+单击」在 macOS 上显示为「⌘+K / ⌘+单击」。德语 `Strg` 也一并覆盖。
  - **修饰键按平台判定**：新增 `isModPressed()`，macOS 只认 `⌘`、Windows/Linux 只认 `Ctrl`（原来的 `ctrlKey || metaKey` 会让 macOS 的 Ctrl+K、Windows 的 Win 键误触发快捷键）；命令面板 / 符号搜索 / 全局搜索 / 代码区 Ctrl+单击跳转统一改用它。
  - **跨平台字体栈**：等宽字体改为 `ui-monospace → SF Mono → Menlo → Consolas → Cascadia Mono → DejaVu Sans Mono`（原来首位是 Consolas，macOS 会掉到 Courier New）；正文补充 `PingFang SC` / `Hiragino Sans GB` / `Noto Sans CJK SC`，Linux 中文字体不再回退到默认衬线。
  - 审计结论：`LocalDirSource` 路径拼接已是 POSIX 风格、Rust 侧无 `#[cfg(windows)]`、主题跟随与拖拽事件均跨平台——**剩余工作只有打包与 CI 矩阵**（`.dmg` / `.deb` / `.AppImage` + 三平台矩阵），见 `docs/PLAN-2.0.md` §4。
  - 单测 +3（`tests/unit/platform.test.ts`）。

- **界面语言扩展到 10 种**：新增 **繁體中文 / 한국어 / Español / Français / Deutsch / Português / Русский**（原有 中 / 英 / 日），共 10 种，全部 LTR。
  - 每个语言包 282 个键、四个命名空间（common / viewer / analysis / errors），共 **2,820 条**用户可见文案；
  - `Language` 联合类型 + `LANGUAGES` 数组 + `RESOURCES: Record<Language, …>` 三重约束，新增语言漏配会被 TypeScript 拦下；
  - 设置页语言区改为可换行按钮组（10 项），每项显示**母语名称**；
  - `detectSystemLanguage` 支持按前缀映射（zh-TW / zh-HK / zh-Hant 优先匹配繁体，其余按 `es-ES` → `es` 降级）；
  - **修复**：`normalizeConfig` 的语言白名单原先硬编码为 `zh/en/ja`，保存其他语言会在下次启动被重置；现取自 `LANGUAGES` 单一来源；
  - 单测 `i18n.test.ts` 升级为 10 语言全量校验，并新增**插值占位符一致性**断言（防止 `{{count}}` 被翻译掉）；E2E 新增 10 语言抽样用例。

- **AST 解析迁入 Web Worker**：主线程只负责读文件 / 查增量缓存 / 汇总，tree-sitter 解析与度量在 `src/workers/analysis.worker.ts` 中执行。按 **200 文件**分块读取、**25 文件**分批投递，内存峰值可控且进度更新更细；结果按路径排序，派生分析（调用图 / 阅读路径 / 模块图）输出更稳定。Worker 创建失败 / 运行时报错 / 120s 超时都会**自动回退主线程**，功能不降级（Worker 只加速）。配套：`vite.config.ts` 设 `worker.format = 'es'`（worker 内有动态 import）；grammar 目录由主线程换算成**绝对 URL** 下发（`base: './'` 时相对路径会相对 worker 脚本解析而 404）。E2E 新增 `analysis-worker.spec.ts`，断言 Worker 确实被创建且完成解析。
- **工作区持久化**：重启 / 刷新后自动恢复上次打开的 **GitHub 与本地目录**项目（ZIP 是内存快照，无法还原，不持久化）；拖入 ZIP/目录打开的多窗口既不恢复也不写入，避免多窗口互相覆盖。存储于 `localStorage`（键 `codeatlas.workspace.v1`），读取前做结构校验，损坏时静默忽略。单测 +5、E2E +1（刷新后自动恢复）。
- **TypeScript 类型声明提取**：新增 `interface` / `type` 别名 / `enum` 三类符号（此前只认 `class`），`abstract class` 也归入 `class`。符号种类扩展后，大纲图标（I / T / E）、上下文包 `(interface|type|enum)` 标签同步；C/Go/Rust 的 struct/interface 仍按 `class` 收录，不影响既有类图与度量语义。单测 +3（`tests/unit/langs.test.ts`）。

### 变更 / 修复

- **设置页多选项改为下拉框**：主题（4 项）与语言（10 项）不再是平铺按钮组，统一为「左侧标签 + 右侧下拉」的行式布局；token 预算移除 2k/8k/32k/64k 预设按钮，只保留数字输入（预设仍可在 AI 上下文包对话框一键切换）。E2E 辅助函数改用 `selectOption`（`data-theme-select` / `data-language-select`）。

- **界面重构：默认界面更简洁**
  - **移除第二行工具条**：调用图 / 度量 / 阅读路线 / 架构 / 大纲 / 全局搜索 / AI 上下文包 / 刷新，全部收进顶栏的三个分组菜单 —— **打开**（本地 ZIP / 本地目录）、**项目**（刷新 / 关闭项目）、**分析**（7 个面板）；无项目时分析项自动禁用，三个菜单互斥、点外部或 Esc 关闭。
  - **顶栏布局**：左侧「品牌 + 打开 / 项目 / 分析」，中间搜索栏在剩余空间内居中，最右为设置按钮。移除顶栏的主题 / 语言下拉（低频操作，统一到设置页）。
  - **设置页改为「左侧分类 + 右侧内容」**：外观 / 分析 / 数据 / 高级。主题用四宫格、语言用分段按钮、token 预算带 2k/8k/32k/64k 预设；Token 与缓存归入「数据」，jsDelivr 兜底归入「高级」。
  - 面板状态属于 ProjectView，主菜单通过轻量命令通道（`src/workspace/commands.ts`）下发到**激活项目**，未引入全局状态库。
  - 状态栏补「分析中 N/M」进度（工具条移除后原本的进度标签消失）。
  - 顺带修复：本地目录项目在状态栏「来源」被错误显示为 ZIP。
  - 删除 `ToolBar.tsx` / `ThemeLanguageControls.tsx`；E2E 的 `clickToolbar` 改为「开菜单 → 点菜单项」，主题/语言改为走设置页（`data-*` 定位），新增 `setTheme` / `setLanguage` 辅助。

- **上下文包可用性打磨**：
  - **JSON `files` 改为关键文件优先**：先按 PageRank 放已分析文件，再用其余路径补满 400 条（此前按文件树字母序截断，前 400 条可能全落在某个目录）。
  - **新增「公共接口（导出符号）」摘要**：一行逗号分隔的导出符号名（最多 60 个），token 极省，方便 AI 快速判断对外契约。
  - **修复**：ZIP 项目的「刷新」按钮此前点击无效（ZIP 为不可变快照），现按数据源能力禁用；GitHub / 本地目录仍可刷新。

## [2.0.0] - 2026-10-23

> **2.0 亮点**：12 个语言族 / 5000 文件规模、阅读路线与命令面板、架构视图（模块依赖 · 循环依赖 · 类图 · 分层）、
> 增量分析缓存、本地目录数据源、HTML 报告导出、多项目工作区、在线 E2E 与可访问性收口；
> AI 上下文包新增模块地图 / 构建与技术栈 / 覆盖率，适配数万行系统级项目。

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

- **2.0**（核心升级，已发布 `v2.0.0`）：多语言（12 个语言族）与规模提升、阅读路线 / 命令面板 / 架构视图、分析结果持久化与增量分析、本地目录数据源（N5①）、HTML 报告导出（N5②）、多项目工作区（N5③）、质量与工程债收口（N6：依赖 ABI 升级 / 在线 E2E / 可访问性）均已随 2.0.0 发布。详见 [docs/PLAN-2.0.md](docs/PLAN-2.0.md)。
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

[Unreleased]: https://github.com/Linu-code/codeatlas/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Linu-code/codeatlas/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/Linu-code/codeatlas/releases/tag/v1.0.0
