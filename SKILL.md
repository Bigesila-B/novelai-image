---
name: novelai-image
description: 控制 NovelAI（novelai.net/image）浏览器会话进行 AI 跑图/生图：登录（手动/账密/Cookie/Persistent API Token）、首次使用后把令牌保存进技能目录实现下次免登录直连、按需求选择 NAI 模型（V5/V4.5/V4/V3）、按模型版本撰写专属格式提示词（Danbooru 标签优先；V5 集成 nai5-prompting 深度方法——构思+写法两层）、通过直连 API 脚本生成并保存图片交付给用户，含并发失败自动重试与生成台账。只要用户提到 NovelAI/NAI、要在 novelai.net 跑图/生图/画图、提供 NovelAI Cookie 或 Token，或者上下文已确定用 NovelAI 出图时都使用本技能——即使用户只说"跑一张图"。
---

# NovelAI 跑图（浏览器登录 + 直连 API 生成）

流程：首次使用先配置并保存凭据（阶段零）→ 需要时浏览器登录 novelai.net → 按需求选模型、按版本写提示词 → 脚本直连 API 生成 → 图片存盘并交付。凭据已保存时跳过登录，直接生成。

浏览器操作使用本会话的 Browser Use 工具（control-browser），由主 agent 亲自执行，不得委托给子 agent。

## 硬性规则（先读）

- **凭证安全**：用户提供的账号、密码、Cookie 只用于本次登录。会话令牌允许写入仅本回合使用的临时文件（0600 权限，回合结束即删除）。**唯一允许的长期存储位置**是技能目录下 `credentials/`（`api-token.txt` 存令牌，0600，文件里只有令牌本身；`settings.json` 存代理地址等非机密设置）；除此之外不回显完整值、不写日志/台账/源码/示例、不发送到 novelai.net 以外的任何地址。打包或分享技能前必须删除 `credentials/` 目录。
- **请求白名单**：生图/登录/浏览器操作只发往 `https://` + `image.novelai.net` / `api.novelai.net` / `novelai.net`；**只读标签核对**额外放行 `https://danbooru.donmai.us`（含 dapi 备份，`scripts/check-tag.mjs`，不携带任何凭据，UA 固定 `curl/8.7.1` 以过 Cloudflare 挑战）。所有请求发前校验 host，拒绝 localhost、环回、私有和保留地址（脚本已内置）。
- **并发限制重试**：遇到并发限制（HTTP 429 或 "user concurrency limit exceeded"）时，等待 1 秒重试，至少重复 5 次（脚本默认行为）。
- **默认允许 NSFW**：不要把 `nsfw` 写进负面提示词（UC），不要主动加 `rating:general` 来压成人向。API 默认 `ucPresetId: "none"`。只有用户明确说「不要 NSFW / 全年龄」时才加限制。服务器 403 内容政策拒绝时如实告知，不改提示词反复撞墙。
- **Anlas 保护**：V5 系列、加大尺寸或加步数可能消耗 Anlas。V4.5 Full 普通尺寸（832×1216 等）+ ≤28 步免费。生成前确认参数不会意外烧 Anlas。
- **默认优先免费分辨率**：用户未指定尺寸时一律用免费档分辨率——肖像 `832×1216` / 风景 `1216×832` / 方形 `1024×1024`，搭配 ≤28 步、不开 `highres`/upscaler（V3/V4/V4.5/V5 在这些基础尺寸免费、不扣 Anlas）。脚本默认 `--width 832 --height 1216` 已是免费档，**不要无故改大**。只有用户明确要更大画幅（1536×1536、2K/4K、wallpaper 大尺寸等）或显式开 `--quality highres`/放大选项时才超出免费档，且生成前必须先告知"会扣 Anlas"并等用户确认；用户只说"横图/竖图/方图"时映射到对应免费档（1216×832 / 832×1216 / 1024×1024），不擅自放大。
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
2. **写提示词按版本分流**：
   - **V5** → 用集成的 nai5-prompting 方法（`references/通用构思.md` 管"想画什么"，`references/通用写法.md` 管"怎么写"）：需求模糊时先构思（需求分档 A–D、编剧→监督→原画→摄影四工序、版权角色先查档案），落笔按写法篇（字段模板、顺序、词组/句子判据、多角色绑定、漫画分格）。与 prompt-formats.md 冲突处以写法篇为准；适配脚本模式的差异见下节「V5 桥接要点」。
   - **V4.5 / V4 / V3** → 仍按 `references/prompt-formats.md` 生成与所选模型版本匹配的提示词。V3 和 V4/V5 语法互不兼容，绝不混用。
3. **标签核对（每次生成前必做；具名角色必查）**：跑 `node <技能目录>/scripts/check-tag.mjs --tag "<danbooru写法>" [--tag "…"]`（代理优先级同生成脚本：`--proxy` > `NAI_PROXY` > `credentials/settings.json`——什么都没配过才需要传 `--proxy`；本机已存代理会自动读取）。核对三点：**写法是否存在、post 量量级、类别**（character/copyright/general/artist…）。据结果定写法（写法篇 §3.7）：
   - 命中且 post ≥ 1000 → 名字直触（版权角色不列外貌）；post < 1000 → 名字照写，输出末尾提醒"该角色激活力可能不足：一致性差、多人同框易被盖过，必要时加权或单独出"；
   - 0 命中或全是 0 post 别名 → 读脚本通配候选改写法；仍无 → 中间档：名字照写（拼法拿不准加半角括号+作品名）+ 2–3 个**结构性**外观词兜底 + 输出末尾一行风险提示（构思篇「知识库时限」）；
   - **核对失败（网络/Cloudflare 挑战重试耗尽）** → 这是"查不了"，不是"查无此名"：回退保守写法（只写名字/作品名、不列外貌、不补不确定职能），下次生成再核。
   拿不准的普通标签在同一调用里一并核对（多个 `--tag`），尤其是写法篇 §3.5 的服装状态词：`loose socks`=堆堆袜、`single thighhigh`=只穿一只，语义≠字面。
4. 标签词汇尽量遵循 Danbooru 规范；V5 下拿不准的 tag 用写法篇 §2–§4 的判据决定词组还是句子。
5. 首次生成或批量任务开始前，向用户展示将使用的「模型 + 正面提示词 + 负面提示词(UC)」；同一任务的连续迭代可直接跑。

## V5 桥接要点（集成自 nai5-prompting，来源 Miint-Sunny/nai5-prompting，GPL-3.0）

方法文件本身来自 `github.com/Miint-Sunny/nai5-prompting`，原样保留，只在这里声明脚本模式的适配规则。继承它随文件带进来的三条铁律：**① 质量词不手写**（前端预设/脚本自动附加，写了=重复注入）；**② 版权角色只写 `girl/boy, 角色名`**，不再列发色/发型/眼睛（名字自带设定）；**③ 画师串只用用户给的**，没有就留 `<画师串：自己贴>` 或整行省略，绝不自编。

与脚本模式（`scripts/generate.mjs`）的匹配关系——方法文件里没有、用脚本时必须记住的：

- **无角色栏**：API 载荷的 `char_captions`/`characterPrompts` 为空，写法篇的 `Character N` 栏和 Custom position 在脚本模式**不存在**。多角色（含版权角色）改为在主提示词用 `|` 分隔角色段（见 prompt-formats.md V5 多角色写法）：写法篇里该进角色栏的外貌写进对应角色段，动作/归属写进句子并指明是哪一段。真实多角色交互（`source#`/`target#` 框内写法）或需要前后景层次的图，走 UI 流程（webui-and-api.md），脚本模式退而求其次。单人且外貌简单时把外貌直接写进主提示词（写法篇 §0：作者B 90% 的图这么写），这是脚本模式的常态。
- **质量词**：脚本 `--quality` 默认自动追加质量词（等于前端预设），提示词里**不要**写 `very aesthetic`/`masterpiece`/`no text`；用户明确要更高完成度时用 `--no-quality` + 手写（放提示词末尾）。
- **复杂度默认不加**：`high complexity` 等是功能开关不是质量尾（写法篇 §3.10），prompt-formats.md 里 V5「默认推荐 high complexity」的写法在 V5 下不用；按写法篇判据需要时才加。
- **UC 两档**：不传 `--negative` 时脚本注入默认画质 UC（相当于"默认预设"）；有明确排除项时用 `--negative` 只写排除项本身，不抄预设串。
- **标签核对（新增必做步骤）**：阶段二第 3 步 `scripts/check-tag.mjs`。原因：版权角色知识库有边界、凭印象补外观实测错误率高（写法篇 §3.7：一次补 14 个属性错 9 个）。核对完按"直触 / 中间档 / 保守"三档落笔；核对失败≠查无此名，一律回退保守写法。
- **公开版缺口**：构思篇/写法篇引用的「群偏好」池子、群频次表、个人-X 技能不在包内（作者已在文末注明），引用处按常识取材；写法篇 §10 的统计与实测结论、§8 排查表、§9 检查表均可用。
- V5 出图交付前过一遍写法篇 §9 检查表；排查出图问题用写法篇 §8。

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
| 标签核对失败（网络/Cloudflare 403 重试耗尽） | 回退保守写法（只写名字/作品名、不列外貌、不补不确定职能），稍后再核——这是"查不了"，不是"查无此名" |
| "The paint's run dry" 弹窗（UI 流） | Anlas 不足/订阅过期：告知用户，不重复点击 |
| 脚本报"no PNG data"/端点变更 | 读 `references/webui-and-api.md`，必要时回退 UI 流程 |
| 会话过期 / 未登录 | 回阶段零查凭据、阶段一重新登录 |

## 参考资料

- 选模型 → `references/models.md`
- 写提示词（V4.5 / V4 / V3）→ `references/prompt-formats.md`（每个版本都有模板和完整实例）
- 写提示词（V5 构思层 → 想画什么）→ `references/通用构思.md`（需求分档 A–D、编剧→监督→原画→摄影分镜管线、版权角色查档、方案差异化）
- 写提示词（V5 写法层 → 怎么写）→ `references/通用写法.md`（字段模板、内容顺序、词组/句子实测判据、`source#`/`target#`/`mutual#` 多角色绑定、漫画分格、§8 排查表、§9 发布前检查表、§10 实测依据与局限）
- 生成脚本 → `scripts/generate.mjs`（直连 API，无依赖，Node 18+；`--check` 验令牌、`--save-credential` 存凭据+代理、`--save-proxy` 改代理、`--proxy` 临时走代理）
- 标签核对 → `scripts/check-tag.mjs`（只读 danbooru tags.json，无凭据；`--tag` 可多个、`--proxy` / `NAI_PROXY` / 已存代理；exact 0 贴或 0 命中时自动列通配候选写法）
- Token 提取 / UI 细节 / Cookie 注入 / API 载荷实测记录 → `references/webui-and-api.md`
- V5 提示词方法原始出处 → `github.com/Miint-Sunny/nai5-prompting`（GPL-3.0；含完整版与分析工具的独立仓库）
