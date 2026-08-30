---
name: novelai-image
description: 控制 NovelAI（novelai.net/image）浏览器会话进行 AI 跑图/生图：登录（手动/账密/Cookie/Persistent API Token）、首次使用后把令牌保存进技能目录实现下次免登录直连、按需求选择 NAI 模型（V5/V4.5/V4/V3）、按模型版本撰写专属格式提示词（Danbooru 标签优先）、通过直连 API 脚本生成并保存图片交付给用户，含并发失败自动重试与生成台账。只要用户提到 NovelAI/NAI、要在 novelai.net 跑图/生图/画图、提供 NovelAI Cookie 或 Token，或者上下文已确定用 NovelAI 出图时都使用本技能——即使用户只说"跑一张图"。
---

# NovelAI 跑图（浏览器登录 + 直连 API 生成）

流程：首次使用先配置并保存凭据（阶段零）→ 需要时浏览器登录 novelai.net → 按需求选模型、按版本写提示词 → 脚本直连 API 生成 → 图片存盘并交付。凭据已保存时跳过登录，直接生成。

浏览器操作使用本会话的 Browser Use 工具（control-browser），由主 agent 亲自执行，不得委托给子 agent。

## 硬性规则（先读）

- **凭证安全**：用户提供的账号、密码、Cookie 只用于本次登录。会话令牌允许写入仅本回合使用的临时文件（0600 权限，回合结束即删除）。**唯一允许的长期存储位置**是技能目录下 `credentials/`（`api-token.txt` 存令牌，0600，文件里只有令牌本身；`settings.json` 存代理地址等非机密设置）；除此之外不回显完整值、不写日志/台账/源码/示例、不发送到 novelai.net 以外的任何地址。打包或分享技能前必须删除 `credentials/` 目录。
- **请求白名单**：任何请求只发往 `https://` + `image.novelai.net` / `api.novelai.net` / `novelai.net`。发请求前校验 host，拒绝 localhost、环回、私有和保留地址（脚本已内置该校验）。
- **并发限制重试**：遇到并发限制（HTTP 429 或 "user concurrency limit exceeded"）时，等待 1 秒重试，至少重复 5 次（脚本默认行为）。
- **默认允许 NSFW**：不要把 `nsfw` 写进负面提示词（UC），不要主动加 `rating:general` 来压成人向。API 默认 `ucPresetId: "none"`。只有用户明确说「不要 NSFW / 全年龄」时才加限制。服务器 403 内容政策拒绝时如实告知，不改提示词反复撞墙。
- **Anlas 保护**：V5 系列、加大尺寸或加步数可能消耗 Anlas。V4.5 Full 普通尺寸（832×1216 等）+ ≤28 步免费。生成前确认参数不会意外烧 Anlas。
- **只用脚本直连**：生成一律走 `scripts/generate.mjs`。不要自写 Python/其他 HTTP 客户端、不要修改请求载荷结构（脚本载荷 2026-08-30 抓包实测对齐，改了必 500）。排查令牌/网络用 `--check`；429 并发锁由脚本自动指数退避，无需人工干预。

## 阶段零：首次使用 / 引导配置（问答 → 测试 → 保存）

目标：首次使用时向用户**一次性**问清「登录方式 + 是否需要代理」，测试连通后把令牌和代理写入技能目录（`credentials/`），之后**新开对话也自动生效**，直接生成。

1. **先查已存配置**：`credentials/api-token.txt` 存在且非空 → 配置已完成，直接进阶段三（脚本自动读取令牌和代理，无需任何参数）。`pst-` 开头是长期有效的 Persistent API Token；`eyJ` 开头是会话 JWT，会过期（401 时回本阶段刷新）。
2. **没有配置时，向用户一次性提问**（一条消息问完，不要挤牙膏）：
   - 「**登录方式选哪种？**推荐 Persistent API Token：网页右上角菜单 → Account Settings → Account → Get Persistent API Token（`pst-` 开头，**完整复制一整行**，无引号无换行；注意重新生成会使旧令牌失效）。也可以用浏览器已登录会话 / Cookie / 账密 / 手动登录。」
   - 「**这台机器访问 NovelAI 需要代理吗？需要的话端口是多少？**（Clash 常见 7897 或 7890；不确定就说不知道，我帮你测）」
3. **测试连通**（不保存、不耗 Anlas）：
   ```bash
   node <技能目录>/scripts/generate.mjs --check --token-file <令牌文件> --proxy http://127.0.0.1:<端口>
   ```
   - 输出 `ok: true` + 订阅档位 → 通过，进入第 4 步；用户说不用代理就省略 `--proxy`。
   - network error → 换端口再试（7897 / 7890 / 7899…）、确认代理客户端开着，或让代理开 TUN 模式；401 → 令牌复制不完整或已失效，让用户重新提供。
4. **保存配置**（一条命令同时存令牌和代理）：
   ```bash
   node <技能目录>/scripts/generate.mjs --token-file <令牌临时文件> --proxy http://127.0.0.1:<端口> --save-credential
   ```
   不需要代理就省略 `--proxy`；用浏览器会话提取的令牌同理。保存后删除令牌临时文件，不回显令牌内容。以后改代理：`--save-proxy http://127.0.0.1:<新端口>`（清除用 `--save-proxy none`）。
5. **端到端验证**：裸跑 `--check`（无任何参数，确认脚本自动读到了全部配置），再跑一张 v4.5-full 免费图；两步都成功才算配置完成。
6. **代理说明**：脚本走 HTTP CONNECT 隧道，代理优先级 `--proxy` 参数 > 环境变量 `NAI_PROXY` > `credentials/settings.json`；TUN/系统代理模式下无需任何参数。**不要**自写 Python/其他客户端重写请求，**不要**把 novelai.net 加进代理的 DIRECT 直连规则（直连会被 Cloudflare 1010 拦截）。

## 阶段一：登录

优先级：已存储凭据（阶段零命中即跳过本阶段）> 浏览器已有会话 > Cookie/Token > 账密代填 > 手动登录。

1. 打开 `https://novelai.net/image`，`waitForLoadState("domcontentloaded")` 后做一次 `domSnapshot()`。
2. 判断登录态：快照里找 "Log in" / "Sign up" 入口（= 未登录），或用户头像、订阅标识、可用的 Generate 按钮（= 已登录）。
3. 未登录时，按用户提供的方式处理：
   - **Cookie/Token 方式**：见 `references/webui-and-api.md` 的注入步骤。注入后 reload 页面并重新验证登录态。
   - **账密代填**：进入登录表单，填入 email + password 并提交。一旦出现验证码（reCAPTCHA）或两步验证，立即改让用户手动完成，不要反复尝试。
   - **手动登录**：告诉用户"浏览器窗口已打开 NovelAI，请登录你的账号"，然后每 10 秒重新快照检查一次，最多等 5 分钟。
4. 登录成功标准：快照中不再有 Log in 入口，Generate 按钮可用（会显示 Anlas 费用）。

## 阶段二：选模型 + 写提示词

1. 按 `references/models.md` 确定模型：用户点名的优先（"nai5" → V5，"nai4" → V4.5，除非明确说 V4）；没点名时按内容推断；免费优先时选 v4.5-full。
2. 按 `references/prompt-formats.md` 生成与**所选模型版本匹配**的提示词。V3 和 V4/V5 语法互不兼容，绝不混用。标签词汇尽量遵循 Danbooru 规范。
3. 首次生成或批量任务开始前，向用户展示将使用的「模型 + 正面提示词 + 负面提示词(UC)」；同一任务的连续迭代可直接跑。

## 阶段三：生成（脚本直连 API，优先）

前提：有可用令牌（已存凭据 / 用户提供的令牌 / 浏览器会话提取），生成走 `scripts/generate.mjs`，不依赖页面 UI。

1. **确定令牌**（按优先级，不要每张图都重抽）：
   - 已存凭据 `credentials/api-token.txt` 存在 → 什么都不用做，脚本自动读取；
   - 用户直接提供了令牌/Cookie → 用 `--token-file`（Cookie 方式见 `references/webui-and-api.md`）；
   - 都没有才从浏览器提取：在已登录页面上下文执行 `JSON.parse(localStorage["session"]).auth_token`，用 node 侧 `fs` 写入临时文件（`os.tmpdir()/nai-session-token.txt`，0600）。完整步骤见 `references/webui-and-api.md` §5。**首次登录后顺手执行 `--save-credential` 把令牌存进技能目录**（见阶段零第 3 步），下次免登录。
2. **跑脚本**（凭据已保存时不带任何令牌参数；未保存时用 `NAI_TOKEN_FILE` 指向临时令牌文件）：
   ```bash
   node <技能目录>/scripts/generate.mjs \
     --prompt "1girl, silver hair, ..." --model v4.5-full --out <工作目录>/nai-output
   ```
   - 模型键：`v5-full` / `v5-curated` / `v4.5-full` / `v4.5-curated` / `v4-full` / `v4-curated`
   - 可选参数：`--negative`、`--width/--height`（默认 832×1216）、`--steps`、`--scale`、`--sampler`、`--seed`、`--n`（同一提示词张数）、`--prompts-file`（每行一条提示词）、`--concurrency`（并行路数，默认 1）、`--timeout-ms`（单次请求超时，默认 120000）、`--attempts`（并发重试上限，默认 5）、`--no-quality`、`--block-nsfw`（仅当用户明确要求全年龄时才加）；工具型参数：`--save-credential`（只保存凭据后退出）、`--check`（只验证令牌后退出）、`--proxy http://127.0.0.1:7897`（走本地代理，或环境变量 `NAI_PROXY`）
   - 脚本自动：质量词插到第一个 `|` 之前（多角色不污染角色段）、Heavy UC、随机 seed、心跳日志（每 5 秒打印已等待秒数）、429 按 1 秒重试、解包 ZIP、写台账
   - **批量策略**：这个账号实测同时只能跑 1 张（429 `Concurrent generation is locked`）。默认 `--concurrency 1` 串行；不要盲目开 2。等待超过 5 秒会打心跳。429 用指数退避（1s/2s/4s/8s）等上一张完成，而不是每秒狂打。
3. **读结果**：脚本 stdout 输出 JSON（`files` / `manifest` / `records`，含 seed 与端点），stderr 首行会显示令牌来源。失败时 stderr 有明确错误：401 令牌失效 → 凭据过期/被吊销，回阶段零重新获取并 `--save-credential` 刷新；402 Anlas 不足 → 换 v4.5-full 或降参数；403 内容政策 → 告知用户；429 重试耗尽 → 告知用户稍后再试。
4. **令牌清理**：回合结束前删除临时令牌文件。

## 阶段四：交付

1. 脚本已把图存到 `--out` 目录（默认 `<当前工作目录>/nai-output/`），命名 `NAI_{模型}_{yyyymmdd_hhmmss}.png`。
2. 用 markdown 文件链接把图发给用户，多张用列表。建议同时展示 seed（复现要用）。
3. 台账 `nai-output/manifest.jsonl` 每次生成追加一条记录（提示词、模型、seed、全部参数、文件路径）。「同图微调」= 取旧记录的 seed 加 `--seed`，改提示词重跑。
4. UI 兜底：脚本失败（端点/载荷变更、令牌异常）时改走 UI 点击流程，见 `references/webui-and-api.md`。

## 出错速查

| 现象 | 处理 |
|---|---|
| 429 / "user concurrency limit exceeded" | 脚本自动 1 秒间隔重试 ≥5 次；仍失败告知用户稍后再试 |
| 401 令牌失效 | 先跑 `--check` 定位：401 = 令牌无效（复制不完整/被重新生成吊销）→ 回阶段零重新获取并 `--save-credential` 刷新 |
| 500 / 531 / 551 等网关错误 | 多为代理链路问题或载荷被改坏：先用 `--check` 验证令牌，再用**原脚本**直连重试；仍 500 换网络节点，不要改脚本载荷 |
| 本机无法直连 NovelAI | 加 `--proxy http://127.0.0.1:7897`（Clash/v2Ray 的 HTTP/混合端口，或环境变量 `NAI_PROXY`）走 CONNECT 隧道；或代理开 TUN/系统代理模式。不要给 novelai.net 加 DIRECT 规则（直连被 Cloudflare 1010 拦截），不要自写 Python 客户端 |
| 402 Anlas 不足 | 建议改用 v4.5-full（普通尺寸免费）或充值/降参数 |
| 403 内容政策拒绝 | 告知用户，不绕过 |
| "The paint's run dry" 弹窗（UI 流） | Anlas 不足/订阅过期：告知用户，不重复点击 |
| 脚本报"no PNG data"/端点变更 | 读 `references/webui-and-api.md`，必要时回退 UI 流程 |
| 会话过期 / 未登录 | 回阶段零查凭据、阶段一重新登录 |

## 参考资料

- 选模型 → `references/models.md`
- 写提示词 → `references/prompt-formats.md`（每个版本都有模板和完整实例）
- 生成脚本 → `scripts/generate.mjs`（直连 API，无依赖，Node 18+；`--check` 验令牌、`--save-credential` 存凭据+代理、`--save-proxy` 改代理、`--proxy` 临时走代理）
- Token 提取 / UI 细节 / Cookie 注入 / API 载荷实测记录 → `references/webui-and-api.md`
