# NovelAI 生图模型清单与选择指南

> 信息截至 2026-08（来源：docs.novelai.net、NovelAI 官方 journal）。UI 下拉框里的实际名称以此为准，SPA 更新后以页面快照为准。

## 模型一览

> **API 模型 ID**（脚本 `--model` 键）：`v4.5-full` → `nai-diffusion-4-5-full`（2026-08-30 实测验证）。`v4.5-curated` / `v4-full` / `v4-curated` 按同一命名模式推断；`v5-full` / `v5-curated` → `nai-diffusion-5-full` / `nai-diffusion-5-curated`（推断，首次使用留意 404）。V3 不支持 V4 版载荷，脚本暂不覆盖，走 UI 流程。

| 模型（UI 名称） | 定位 | 提示词风格 | 多角色上限 | 文字渲染 | 备注 |
|---|---|---|---|---|---|
| **NAI Diffusion V5 Full** | 最新旗舰 | 自然语言 + 标签自由混合 | 22 | 英/日/中，最长 750 字符 | 支持自由定位（非网格）、Alpha 透明背景、多格漫画；Inpainting 可用；Vibe Transfer / Precise Reference 发布时尚未上线 |
| **NAI Diffusion V5 Curated** | V5 策展版 | 同 V5 | 22 | 英/日/中，最长 374 字符 | 语料策展、风格更收敛；发布时暂用 V4.5 Curated 的 inpainting |
| **NAI Diffusion V4.5 Full** | 上一代主力 | 标签为主 + 自然语言 | 高于 V4 | 仅英文，≤118 字符 | T5 分词器，基础+角色提示词合计约 512 token；支持负权重 |
| **NAI Diffusion V4.5 Curated** | 4.5 策展版 | 同上 | 同上 | 仅英文 | 自动质量词里含 `rating:general` |
| **NAI Diffusion V4 Full** | 旧旗舰 | 标签为主 | 6 | 仅英文 | 支持数字权重 `N::…::`，**不支持负权重** |
| **NAI Diffusion V4 Curated** | 旧策展 | 同上 | 6 | 仅英文 | — |
| **NAI Diffusion Anime V3**（Full/Curated） | 经典动漫 | 纯 Danbooru 标签 | 不支持角色框 | 不支持 | 只用 `{}` `[]` 权重；默认 28 步 / Guidance 11 / `k_euler_ancestral` |
| **Furry 系模型** | 兽人向 | 标签 | 按版本 | 按版本 | 用户明确要 furry/兽人风格时选 |

## 选择逻辑（按用户表述）

| 用户说 | 选 |
|---|---|
| "nai5" / "最新的" / "效果最好的" / "高质量" | V5 Full |
| "nai4" / "4.5"（未细说时） | V4.5 Full（明确说 4 才选 V4） |
| "免费跑" / "随便来一张" / 测试流程 | V4.5 Full 或 V5 Curated（以 Generate 按钮显示的 Anlas 费用为准） |
| furry / 兽人 | Furry 系模型 |
| 要透明背景 PNG | V5（`transparent background` / `has alpha`） |
| 图里要出现文字 | V5 优先（中日英文都能渲染）；V4/V4.5 仅英文 |

## 常用参数

- **尺寸**：竖 832×1216，横 1216×832，方 1024×1024。用户没说就按内容选：人物立绘/壁纸偏竖，风景/双人横构图偏横。
- **Guidance（提示词引导）**：V3 及以上官方推荐 **5–6**；V3 社区惯用 11。用户没要求就不动 UI 默认值。
- **Steps**：28 步以内、非批量、普通尺寸时 Opus 订阅通常免 Anlas（以 UI 实际显示为准）。
- **Sampler**：V3 用 `k_euler_ancestral`；V4/V5 保持 UI 默认。

## V5 新增能力速记（写提示词时用得上）

- 复杂度标签：`high complexity`（常规）、`ultra complexity`（华丽）、`low complexity`（简洁/风格化）。
- 自然语言理解大幅增强，可以直接写英文句子描述场景，与标签混用。
- 透明背景：`transparent background`、`has alpha`，可加权 `2.1::transparent background::`。
- 时代标签：`meta:novel era`、`meta:golden era`；新角色标签：`attractive male`；光影：`depthness`。
- 引号里的文本会自动生成 `Text:` 块（手动写 `Text:` 时该自动行为关闭）。
