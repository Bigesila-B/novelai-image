# novelai-image

供 ZCode / AI agent 使用的 NovelAI 生图技能：浏览器登录 novelai.net，按模型版本撰写 Danbooru 风格提示词，通过直连 API 脚本生成图片并交付。

## 功能

- **登录方式**：Persistent API Token（推荐）/ 浏览器已有会话 / Cookie / 账密代填 / 手动登录
- **凭据持久化**：首次配置后把令牌保存到 `credentials/api-token.txt`，之后免登录直接生成，不会再出现"连接不上账号/没登录"
- **模型**：V5 Full/Curated、V4.5 Full/Curated、V4 Full/Curated（Anime V3 走 UI 流程）
- **提示词**：按模型版本匹配专属格式（V5 自然语言+标签自由混合；V4/V4.5 标签为主+数字权重；V3 纯 Danbooru 标签）
- **直连 API 生成**：不依赖页面 UI；自动解包 ZIP、随机/固定 seed、429 并发锁指数退避重试、生成台账 `manifest.jsonl`
- **安全内置**：仅允许 novelai.net 系主机、DNS 解析后拒绝内网/保留地址、不打印令牌

## 安装

克隆或解压本仓库到 agent 的技能目录（例如 ZCode 的 `~/.agents/skills/`），目录名保持 `novelai-image`。

## 首次使用

1. 对 agent 说要跑图，agent 会按 `SKILL.md` 的「阶段零」向你索要登录方式。
2. 推荐：在 NovelAI 网页右上角菜单 → **Account Settings → Account → Get Persistent API Token** 获取令牌（`pst-` 开头）发给 agent。
3. agent 运行下面的命令保存凭据后，以后直接说"画什么"即可出图：

```bash
node scripts/generate.mjs --token-file <令牌文件> --save-credential
```

## 生成示例

```bash
node scripts/generate.mjs \
  --prompt "1girl, silver hair, long hair, red eyes, white kimono, cherry blossoms, night" \
  --model v4.5-full --out ./nai-output
```

常用参数：`--negative`、`--width/--height`（默认 832×1216）、`--steps`（默认 23）、`--seed`、`--n`、`--prompts-file`、`--concurrency`、`--block-nsfw`（仅用户明确要全年龄时加）。

## 安全说明

- 令牌只保存在本地 `credentials/api-token.txt`（0600），已被 `.gitignore` 排除，不会进入 git 历史。
- 分享或打包本技能前删除 `credentials/` 目录。
- 脚本只向 `image.novelai.net` / `api.novelai.net` 发请求，并校验 DNS 解析结果不是内网地址。
- Anlas 计费与网页端一致：V4.5 Full 普通尺寸 + ≤28 步对 Opus 订阅免费。
- NovelAI 同时只允许一枚 Persistent API Token，重新生成会使旧的失效。
