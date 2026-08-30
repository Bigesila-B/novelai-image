# WebUI 自动化细节、Cookie 注入与直连 API 兜底

> novelai.net/image 是一个持续更新的 SPA。以下元素名称是导航参考，**一切以当前页面 domSnapshot() 的实际结果为准**，不要硬编码选择器，不要凭记忆猜元素。

## 1. 页面结构速览

生成器页面（/image）大致布局：

- **顶部**：模型下拉框（如 "NAI Diffusion V5 Full"）、账号/订阅入口。
- **左侧面板**：
  - Prompt 大输入框（正面提示词）；底部有 **Quality Tags 开关**（默认开）。
  - Undesired Content（负面提示词，可能折叠在 "Advanced" 或类似入口里）。
  - **Character Prompts 区**：`+` 按钮添加角色提示词框（V4+ 模型才有），每个框有自己的 UC 字段。
  - 参数区：尺寸（Aspect Ratio/Size）、Steps、Guidance/Scale、Sampler、Variety+、Decrisper 等。
- **右侧画布**：生成结果显示区，**Generate 按钮**（费用会显示在按钮上），下载/收藏按钮在图片附近或悬停出现。
- 生成信息（seed、完整提示词、参数）通常在图片下方或信息面板里，取 seed 时从这里读。

## 2. 登录态与登录入口

- 未登录标志：页面有 "Log in" / "Sign up" 按钮，或被重定向到登录页。
- 登录表单：email + password 输入框 + 登录按钮。
- 已登录标志：右上角用户头像/账号菜单、订阅标识；生成器可直接使用。

## 3. Cookie / Token 注入（登录方式二）

用户提供两种东西之一：**persistent-session Cookie 值**，或 **Persistent API Token**（NovelAI 官方为第三方工具提供的令牌，入口：网页右上角 Account → Get Persistent API Token）。

注入步骤：

1. 先导航到 `https://novelai.net`（同域才能用 document.cookie 设置）。
2. Cookie 方式，在页面上下文执行：
   ```js
   document.cookie = "persistent-session=" + encodeURIComponent(value) + "; domain=.novelai.net; path=/; secure";
   ```
   然后导航到 `/image` 并 reload，重新快照验证登录态。
3. Cookie 注入无效时（可能 httpOnly 冲突或值不完整）：改请用户在**自动化打开的那个浏览器窗口里**手动登录一次（方式一），或改用账密代填。
4. 安全要求：token/cookie 值绝不回显、不写日志、不存盘；注入用的临时变量随调用结束丢弃。

## 4. 取图与保存

按优先级尝试（第 1 条已于 2026-08-29 实测通过）：

1. **blob 读取（推荐，已验证）**：生成的图是 `getByRole("img", { name: /<提示词开头>/ })` 的 `<img>` 元素，src 为 `blob:` URL。流程：`getAttribute("src")` → 页面内 `evaluate` 里 `fetch(src)` → 分块转 base64 返回 → Node 侧 `Buffer.from(b64,"base64")` 写盘 → 校验 PNG 魔数（`\x89PNG`）。832×1216 约 1.8MB，在 evaluate 3 秒预算内可完成。
2. **downloadMedia**：对 img 元素用 `locator.downloadMedia()`；文件落到浏览器默认下载目录，需要再定位文件。
3. 都失败时：对画布 `screenshot()` 截图作为最后手段（质量降级，需告知用户）。

完成信号：生成结束后 `button "Use the seed of the displayed image"` 从 `[disabled]` 变为可用，且快照中出现以 seed 数字为名的按钮；生成中的图会以提示词为 accessible name 出现 `img` 元素。

保存路径约定：`<当前工作目录>/nai-output/NAI_{模型简称}_{yyyymmdd_hhmmss}.png`，用 `node:fs` 创建目录。

## 5. 直连 API（脚本已实现，本节是原理与实测记录）

`scripts/generate.mjs` 已实现完整直连生成（含重试、解包、台账），日常用脚本即可。本节记录 2026-08-30 抓包验证的事实，端点或格式变更时对照更新。

### 5.1 会话令牌提取

登录后，令牌在 `localStorage["session"]`（JSON 字符串）里：

```js
// 页面上下文：取值（不打印）；node 侧 fs 写临时文件，0600，回合结束删除
const s = JSON.parse(localStorage["session"]);
// s.auth_token → JWT（"eyJ" 开头，约 205 字符）
// s.encryption_key → 与生图无关，不要外传
```

### 5.2 端点与载荷（2026-08-30 实测）

- **网页端**用 `POST https://image.novelai.net/ai/generate-image-stream`，body 是 **multipart FormData，单字段 `request`**，值为完整 JSON 字符串；`parameters.stream: "msgpack"`。
- **经典端点仍然可用（脚本采用）**：`POST https://image.novelai.net/ai/generate-image`，`Content-Type: application/json`，body 就是那个 JSON（**不要带 `stream` 字段**）。备用地址 `https://api.novelai.net/ai/generate-image`（部分地区网络不可达；脚本给它单独 8 秒短超时，避免空等）。主端点默认 120 秒超时，每 5 秒打一次心跳。
- 请求头：`Authorization: Bearer <auth_token>`。
- **模型 ID 已验证**：`nai-diffusion-4-5-full`。V5 推断为 `nai-diffusion-5-full` / `nai-diffusion-5-curated`（首次使用留意 404）。
- 载荷关键字段（V4+，实测值）：
  - `parameters.params_version: 4`（旧资料写 3，已过时）
  - `ucPresetId`：脚本默认 `"none"`（不注入 Heavy 里的 `nsfw` 限制）。网页 UI 若显示 `UC Preset: Heavy`，点成 **None**。`"heavy"` / `"light"` / `"none"` 是字符串 ID。
  - `qualityPresetId: "standard"`
  - `v4_prompt` / `v4_negative_prompt`：`{ caption: { base_caption, char_captions: [] }, use_coords: false, use_order: true }`；`input` 与 `v4_prompt.caption.base_caption` 内容相同（质量词已拼在末尾）
  - 旧字段 `negative_prompt`（字符串）与 `v4_negative_prompt` 同时存在，内容一致
  - `image_format: "png"`、`prefer_brownian: true`、`deliberate_euler_ancestral_bug: false`、`noise_schedule: "karras"`
  - V4.5 Full Heavy UC（实测）：`nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page`
  - Quality Tags: Standard 给 V4.5 Full 实际追加的是 `, very aesthetic, masterpiece, no text`（与文档略有出入，以抓包为准）

### 5.3 响应与解包

- 成功：HTTP 200，`content-type: binary/octet-stream`，body 是 **ZIP**（`PK` 魔数），内含 `image_0.png`。
- **ZIP 里的 PNG 是 DEFLATE 压缩（method 8）**，不是老资料说的 store——直接扫 PNG 签名会失败，必须真解压（`zlib.inflateRawSync`，脚本已实现）。
- 失败码：401 令牌失效；402 Anlas 不足；403 内容政策；429 并发限制（1 秒间隔重试 ≥5 次）。
- API 生成与 UI 消耗相同的 Anlas 规则。

### 5.4 抓包方法（载荷变更时复现）

1. 页面上下文包一层 `window.fetch`，把 URL 含 `generate-image` 的请求克隆出来（注意 body 可能是 FormData/Blob，要逐字段 `await v.text()`）。
2. UI 点一次 Generate，从捕获里读真实端点、载荷与响应格式。

## 6. UI 操作通用守则

- 每个逻辑操作批次开始前，先 `browser.tabs.list()` 确认目标标签页，再 `tabs.get(id)` 激活。
- 定位元素只用快照里证实过的角色/名称/占位符；定位失败就重新快照，不要重试猜测的 locator。
- SPA 的折叠面板（Advanced、UC、角色提示词）可能需要点击展开后才出现在快照里。
- 生成等待：用快照观察按钮/进度状态变化，或定向等待新 `<img>` 出现，不要盲 sleep。

## 7. 实测锚点（2026-08-29，1280×720 视口，IAB 浏览器）

以下均已实测验证；坐标依赖视口尺寸，换视口后以快照+截图重新定位为准。

- **提示词输入**：`locator.fill()/type()` 对 NAI 自定义编辑器**必定失败**（报 clipboard/"Active element" 错误）。正确做法：`cua.click` 输入框坐标（约 200,225）→ `cua.keypress({keys:["Control","a"]})` 全选覆盖 → `cua.type({text})`，同一 JS 批次内完成防焦点丢失；用 `getByRole("paragraph").innerText()` 校验字符数一致。
- **模型切换**：原生 `combobox "Select the Model"` 在视口外点不到。点可见控件（左上角当前模型名，约 126,92）→ 快照出现 `listbox` → `getByRole("option", { name: /NAI Diffusion V4\.5 Full/ })` 点击。选项全名带描述后缀，用正则匹配。
- **Generate**：左下角按钮（约 194,688），名称含费用（如 "Generate 1 Image 0 Anlas"）。
- **费用观察**：V5 Curated 832×1216/23 步收 26 Anlas；V4.5 Full 同参数 **0 Anlas**（Opus 免费）。切模型后部分参数会重置（Guidance 7→5）。
- **付费墙**：弹窗文案 "The paint's run dry. You need a subscription or to purchase Anlas to continue."（Anlas 不足/订阅过期）。检测关键词 `paint's run dry`、`purchase anlas`。
- **顶部状态**：Anlas 余额在顶栏；"0% of Opus Generations remaining" 是 Opus 生成额度指示。
- **登录表单**：有 reCAPTCHA 和 Google 登录入口；自动化点表单内按钮可能被遮挡（force 也超时），登录环节优先让用户手动。
- **模型列表（下拉实测）**：V5 Curated（默认）/ V5 Full / V4.5 Curated / V4.5 Full / V4 Curated / V4 Full / Anime V3 / Furry V3，旧模型标 "No longer recommended"。
