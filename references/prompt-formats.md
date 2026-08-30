# NovelAI 提示词格式规范（按模型版本）

**铁律：提示词格式必须匹配所选模型版本。** V3 与 V4/V5 语法互不兼容；V4/V5 之间细节也有差异。写之前先确认当前模型。

## 0. 通用原则：标签尽量按 Danbooru 来

NAI 全系模型都以 Danbooru 标签体系训练，**标签词汇优先使用 Danbooru 规范写法**（小写、空格分隔、Danbooru 惯用词），命中率最高：

- 用 `twintails` 不用 `two ponytails`；用 `cowboy shot` 不用 `upper body shot`；用 `silver hair` 不用 `grey-white hair`。
- 提示词以数量标签开头：`1girl` / `2girls` / `1boy` / `1other`。
- 拿不准确切 Danbooru 标签时，选最接近的常见标签，不要自造短语；标签表达不了的概念（V4.5/V5）再用自然语言句子补充。
- artist 标签仅当用户点名画风时使用，写 Danbooru 画师名；V4.5 建议放在提示词末尾。

**V5 虽然支持自然语言，但同样标签为主**，自然语言只用来补充标签覆盖不到的氛围、动作细节和光影描述。

### 翻译心法：把用户的中文描述拆成六层

1. 主体与数量（1girl / 2boys / 1other）
2. 角色身份（角色名 + 出处，仅当用户点名，如 `hatsune miku, vocaloid`）
3. 外貌（发色、发式、瞳色、体型、年龄感）
4. 服装与配饰
5. 动作 / 姿势 / 表情
6. 场景（地点、时间、天气、光线）→ 构图（cowboy shot / close-up / from above）→ 风格（用户点名时才加 artist 标签）

### 常用 Danbooru 标签速查

| 类别 | 常用规范标签 |
|---|---|
| 构图 | cowboy shot, upper body, full body, close-up, portrait, wide shot, from above, from below, dutch angle |
| 表情 | smile, open mouth, blush, crying, angry, surprised, :d, expressionless, half-closed eyes |
| 动作/姿势 | standing, sitting, lying, walking, arms up, hands together, looking at viewer, looking back, head tilt, leaning forward |
| 服装 | school uniform, kimono, dress, hoodie, thighhighs, pantyhose, frills, apron, bikini, maid, wide sleeves |
| 头发/瞳色 | long hair, short hair, twintails, ponytail, braid, ahoge, bangs, wavy hair; red eyes, blue eyes, heterochromia |
| 场景/光线 | outdoors, indoors, classroom, night, sunset, cherry blossoms, rain, city lights, forest, beach, lantern, backlighting, sunlight |
| 画风/媒体 | watercolor (medium), sketch, monochrome, flat color, retro artstyle, official style |

## 1. 权重语法对照（全版本）

| 语法 | 效果 | 可用版本 |
|---|---|---|
| `{tag}` / `[[tag]]` | 强调 ×1.05/层，弱化 ÷1.05/层 | 全部 |
| `1.5::rain, night ::` | 数字加权（0–1 区间为弱化） | **V4+** |
| `-1::hat ::` | 负权重：定向去除/反转概念 | **V4.5+** |

- 负权重典型用途：`-1::monochrome ::` 强制彩色；`-1::simple background ::` 摆脱空白背景。
- UC（负面提示词）里 `{}` 语义反转：`{tag}` = 更避开，`[tag]` = 更不避开。
- `::` 还能自动闭合未配平的括号。

## 2. V5（Full / Curated）格式

特点：自然语言 + 标签自由混合；长提示词；最多 22 个角色；自由定位；中日英文文字渲染。

模板（常规单人文生图）：

```
1girl, <角色/出处(可选)>, <外貌标签>, <服装>, <动作>, <表情>,
<场景>, <构图>, high complexity,
<自然语言补充句：氛围、细节、光影>
```

- 复杂度标签三选一：`high complexity`（默认推荐）/ `ultra complexity` / `low complexity`。
- 质量词由 Quality Tags 开关自动追加（Light: `very aesthetic, amazing quality, no text`；Standard: `very aesthetic, masterpiece, no text`），自己手写质量词时先关掉该开关。
- **多角色**：基础提示词里写数量标签（`2girls, outdoors`），用 `|` 分隔角色：`2girls, sunset | girl, blonde hair, source#waving | girl, black hair, target#waving`。角色段以裸 `girl`/`boy`/`other` 开头，不带数字；互动动作用 `source#`/`target#`/`mutual#` 前缀。注意：一旦 UI 里用了角色提示词框，`|` 语法就被禁用，二者只能选一种。脚本追加质量词时会插到第一个 `|` 之前，避免污染最后一个角色段。
- **文字渲染**：提示词里加 `text, english text`（或 `japanese text` / `chinese text`），提示词**最末**写 `Text: 要渲染的字`；多段文字用空行分隔。`Text:` 之后不能再有任何标签或句子。引号文本会自动生成 Text 块。
- **透明背景**：`transparent background, has alpha`，可加权 `2.1::transparent background::`。

实例 1（单人竖图）：
```
1girl, silver hair, long hair, red eyes, white kimono, wide sleeves, standing, cherry blossoms, night, lantern, cowboy shot, high complexity, petals drifting around her in a soft night breeze
```

实例 2（双角色）：
```
2girls, classroom, afternoon, high complexity | girl, twintails, blonde hair, school uniform, source#leaning on desk | girl, black hair, glasses, holding book, target#ignoring
```

实例 3（带中文文字）：
```
1girl, purple hair, speech bubble, text, chinese text, high complexity, she is cheerfully saying hello with a green handwritten speech bubble
Text: 你好，世界！
```

## 3. V4.5（Full / Curated）格式

- 结构同 V4：标签为主，可混自然语言；T5 分词器，**基础 + 角色提示词合计约 512 token**，长需求要做取舍。
- **不要用 `high complexity` 等复杂度标签**（V5 专属，实测确认）；V4.5 控制复杂度用负权重 `-1::flat color::` 等。
- 多角色上限高于 V4（角色框或 `|` 分隔，规则同 V5，数量标签只在基础提示词里）。
- `Text:` 仅英文，全文 ≤118 字符；写全大写可提高拼写准确率。
- 数字权重可用，负权重（V4.5+）也可用，如 `-1::flat color::, -1::simple background::` 控制画面复杂度。
- 质量词自动追加：Full 为 `, location, very aesthetic, masterpiece, no text`；Curated 为 `, location, masterpiece, no text, -0.8::feet::, rating:general`。
- 社区常用标签顺序：`1girl/1boy, 角色名/出处, 普通标签, 质量词, artist 标签放最后`。

## 4. V4（Full / Curated）格式

- 标签为主；数字权重可用，**负权重不可用**（要弱化用 `0.5::tag ::`，要去除写进 UC）。
- 多角色最多 6 个；`|` 仅用于多角色分隔（V4 无提示词混合）。
- `Text:` 仅英文；全大写更稳。
- 质量词自动追加：Full 为 `, no text, best quality, very aesthetic, absurdres`；Curated 为 `, rating:general, amazing quality, very aesthetic, absurdres`。

## 5. Anime V3 格式（与 V4/V5 完全不同）

- **纯 Danbooru 风格标签**，逗号分隔，没有角色框/`|`/自然语言句子。
- **禁用 `::` 数字权重语法**，只用 `{}`（×1.05）和 `[]`（÷1.05）。
- 质量词追加：`, best quality, amazing quality, very aesthetic, absurdres`。
- 默认 UC（V3 Full 惯用）：
  ```
  lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]
  ```
- 参数惯例：28 步、Guidance 11、`k_euler_ancestral`。
- 实例：
  ```
  1girl, silver hair, long hair, red eyes, {{{white kimono}}}, standing, night, {{{cherry blossoms}}}, lantern, cowboy shot
  ```

## 6. UC（负面提示词）指南

- **默认允许 NSFW**：不要把 `nsfw` 写进 UC。脚本默认 `ucPresetId: "none"`，质量词里也不加 `rating:general`（那是 Curated 模型自己的标签，Full 模型不要手加）。
- 用户明确说「不要 NSFW / 全年龄 / 安全」时，才把 `nsfw` 加进 UC，或改用 Curated 模型。
- 用户说「不要 XXX」→ 把 XXX 写进 UC。
- 默认 UC 只放画质类：`lowres, artistic error, jpeg artifacts, ...`，不含 `nsfw`。
- 想去掉某个默认行为时用负权重（V4.5+），如 `-1::speech bubble::` 防止莫名加对话框。

## 7. 自检清单（生成前过一遍）

- [ ] 标签尽量为 Danbooru 规范词汇（对照速查表，不自造短语）
- [ ] 权重语法与版本匹配（V3 无 `::`，V4 无负权重）
- [ ] 数量标签（1girl/2girls）只在基础提示词里，角色段用裸 girl/boy
- [ ] `Text:` 在提示词最末（V4+ 才支持；V4/V4.5 仅英文）
- [ ] Quality Tags 开关状态与是否手写质量词一致
- [ ] 没把用户没提的 artist 标签擅自加进去
