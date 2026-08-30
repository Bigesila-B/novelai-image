# novelai-image

供 ZCode / AI agent 使用的 NovelAI 生图技能：浏览器登录 novelai.net，按模型版本撰写 Danbooru 风格提示词，通过直连 API 脚本生成图片并交付。

## 功能

- **登录方式**：Persistent API Token（推荐）/ 浏览器已有会话 / Cookie / 账密代填 / 手动登录
- **首次引导配置**：agent 一次性问清登录方式和代理端口，测试连通后一条命令保存；令牌 + 代理设置持久化在本地 `credentials/`，**新开对话自动生效**
- **模型**：V5 Full/Curated、V4.5 Full/Curated、V4 Full/Curated（Anime V3 走 UI 流程）
- **提示词**：按模型版本匹配专属格式（V5 自然语言+标签自由混合；V4/V4.5 标签为主+数字权重；V3 纯 Danbooru 标签）
- **直连 API 生成**：不依赖页面 UI；自动解包 ZIP、随机/固定 seed、429 并发锁指数退避重试、生成台账 `manifest.jsonl`
- **安全内置**：仅允许 novelai.net 系主机、DNS 解析后拒绝内网/保留地址、不打印令牌

## 安装

克隆或解压本仓库到 agent 的技能目录（例如 ZCode 的 `~/.agents/skills/`），目录名保持 `novelai-image`。

## 首次使用（引导配置）

1. 对 agent 说要跑图，agent 会按 `SKILL.md` 的「阶段零」**一次性**问你两个问题：**登录方式**（推荐 Persistent API Token）和**是否需要代理**（需要的话端口是多少）。
2. agent 先用 `--check` 测试连通（秒回、不耗 Anlas），确认可用后一条命令把令牌和代理一起保存：

```bash
node scripts/generate.mjs --token-file <令牌文件> --proxy http://127.0.0.1:7897 --save-credential
```

3. 配置存在本地 `credentials/`（令牌 + 代理设置），之后**新开对话**直接说"画什么"即可出图，脚本自动读取，不再出现"没登录/连不上"。以后改代理：`--save-proxy http://127.0.0.1:<新端口>`（清除用 `--save-proxy none`）。

## 代理 / 网络受限环境

本机无法直连 novelai.net 时（表现：fetch failed / 连接超时 / Cloudflare 1010），三种方式任选：

1. **保存代理到配置（推荐）**：`node scripts/generate.mjs --save-proxy http://127.0.0.1:7897`，之后所有命令自动走代理，无需再传参数；
2. **命令级临时代理**：加 `--proxy http://127.0.0.1:7897`（或环境变量 `NAI_PROXY`）；
3. **TUN / 系统代理模式**：在代理客户端全局接管流量，脚本不加任何参数直接用。

脚本通过 HTTP CONNECT 隧道转发，零依赖，Windows/macOS/Linux 均可用，已在 Clash Verge 混合端口实测。注意：**不要**把 novelai.net 加进代理的 DIRECT（直连）规则——直连会被 Cloudflare 拦截（1010 错误）；也**不要**改用其他语言重写请求——脚本的载荷结构是抓包实测对齐的，改写后会出现 500/参数错误。

## 生成示例

```bash
node scripts/generate.mjs \
  --prompt "1girl, silver hair, long hair, red eyes, white kimono, cherry blossoms, night" \
  --model v4.5-full --out ./nai-output
```

常用参数：`--negative`、`--width/--height`（默认 832×1216）、`--steps`（默认 23）、`--seed`、`--n`、`--prompts-file`、`--concurrency`、`--check`（只验证令牌）、`--save-credential`（存令牌+代理）、`--save-proxy`（只存代理）、`--proxy`（临时走代理）、`--block-nsfw`（仅用户明确要全年龄时加）。

## 安全说明

- 令牌和用户设置只保存在本地 `credentials/`（`api-token.txt` + `settings.json`，0600），已被 `.gitignore` 排除，不会进入 git 历史。
- 分享或打包本技能前删除 `credentials/` 目录。
- 脚本只向 `image.novelai.net` / `api.novelai.net` 发请求，并校验 DNS 解析结果不是内网地址。
- Anlas 计费与网页端一致：V4.5 Full 普通尺寸 + ≤28 步对 Opus 订阅免费。
- NovelAI 同时只允许一枚 Persistent API Token，重新生成会使旧的失效。
