# 货币母题 · 主体参考图规范（Subject Reference Spec）

> **用途**：为 Seedream 出图脚本 `tools/image_generator/generate_currency_tokens.py` 提供「图生图（ref_image）」的主体参考图来源。
> **性质**：这些是**母题真实主体**（动物 / 地标 / 风景 / 人物）的参考素材，**不是货币**；仅用于引导 AI 抓住「神韵」，生成的成品仍须符合风格化 / no-face / no-currency 护栏。
> **合规铁律**：游戏只 ship 风格化原创母题，**绝不出现真实钞币 / 硬币 / 国旗 / 真实人脸**。图生图参考图也**绝不能用真实钞币图样**。

---

## 0. 总览：8 个 ISO 的参考策略

| ISO | 币种 | 母题类别 | 图生图参考策略 |
|-----|------|----------|----------------|
| USD | 美元 | person（富兰克林） | ⛔ 禁人脸照 → 抽象奖章/纯文生图 |
| BRL | 巴西雷亚尔 | animal（绿翅金刚鹦鹉） | ✅ 真实鹦鹉照片 |
| EUR | 欧元 | landmark（文艺复兴窗拱桥） | ✅ 真实石拱桥照片 |
| GBP | 英镑 | person（透纳） | ⛔ 禁人脸照 → 抽象奖章/纯文生图 |
| CNY | 人民币 | person | ⛔ 禁人脸照 → 抽象奖章/纯文生图 |
| JPY | 日元 | landscape（富士山） | ✅ 真实富士山照片 |
| INR | 印度卢比 | person（甘地） | ⛔ 禁人脸照 → 抽象奖章/纯文生图 |
| ZAR | 南非兰特 | animal（白犀牛） | ✅ 真实犀牛照片 |

> 脚本约定：参考图放置于 `tools/image_generator/reference_subjects/<ISO>.png`（coin 与 note 同 ISO 共用一张）。
> 人物类 4 个 ISO **不要放参考图** → 脚本自动降级为纯文生图（合规最稳）。

---

## 1. 动物 / 地标 / 风景类（用真实主体照片当参考图）

### BRL · 绿翅金刚鹦鹉（Scarlet Macaw, *Ara macao*）
- **参考图**：真实金刚鹦鹉飞行/停栖照（红羽 + 蓝黄翼，色彩冲击强，正好对应签名色 `#C77B7B` 灰玫红）。
- **来源**：Wikimedia Commons（经 iNaturalist 上传，CC BY-SA）
  - 下载：`https://commons.wikimedia.org/wiki/Special:FilePath/Ara_Macao_(166522227).jpeg`
- **本地文件名**：`reference_subjects/BRL.png`
- **作用**：让 Seedream 锁定「长尾、红蓝黄三色、曲线剪影」的鹦鹉神韵，再风格化为极简负空间剪影。

### EUR · 文艺复兴石拱桥（参考查理大桥 / Charles Bridge, Prague）
- **参考图**：哥特/文艺复兴石拱桥 + 桥塔照片（多层半圆拱 + 塔楼，对应母题「窗拱桥几何剪影」）。
- **来源**：Wikimedia Commons（Quality Image，CC BY-SA 3.0）
  - 下载：`https://commons.wikimedia.org/wiki/Special:FilePath/CharlesBridgeMalaStranaPragueCzechRepublic.jpg`
- **本地文件名**：`reference_subjects/EUR.png`
- **作用**：提供「连续半圆拱 + 厚重石塔」的几何韵律，引导 Seedream 画出具建筑感的抽象拱桥，而非真实建筑照片。

### JPY · 富士山（Mount Fuji）
- **参考图**：富士山三角山形 + 雪顶 + 远景照片（对应母题「平三角山剪影 + 樱点点缀」）。
- **来源**：Wikimedia Commons（CC BY-SA 4.0）
  - 下载：`https://commons.wikimedia.org/wiki/Special:FilePath/Mount_Fuji_from_Lake_Kawaguchi_20170206.jpg`
- **本地文件名**：`reference_subjects/JPY.png`
- **作用**：锁定「对称三角 + 平缓雪线」的山形轮廓，风格化后保留一眼可辨的富士意象。

### ZAR · 白犀牛（White Rhinoceros, *Ceratotherium simum*）
- **参考图**：白犀牛侧影/停栖照（厚皮、双角、方吻，对应母题「负空间剪影」）。
- **来源**：Wikimedia Commons（CC BY-SA；备用 `Whiterhinoceros_Seoul.jpg` 同为 200 可用）
  - 下载：`https://commons.wikimedia.org/wiki/Special:FilePath/Waterberg_Nashorn2.jpg`
- **本地文件名**：`reference_subjects/ZAR.png`
- **作用**：让 Seedream 抓住「庞大、低首、双角」的犀牛体量感，再压成极简曲线剪影。

> 以上 4 条 URL 已于 2026-07-30 实测 `curl -IL` 返回 200，可直接下载。
> 参考图**不入游戏包**，仅作为 Seedream 输入；生成结果为全新风格化母题，原始参考图的版权风险不传导到成品。

---

## 2. 人物类（严禁真实人脸照 → 走风格化 / 纯文生图）

| ISO | 母题意图 | 合规处理 | 理由 |
|-----|----------|----------|------|
| USD | 同心奖章徽记 + 放射星徽 + 负空间字母，回避人脸 | 不放参考图，纯文生图；或仅放「新古典奖章/浮雕（无脸）」抽象参考 | 富兰克林为真人，人脸照会倒逼模型画出可辨识真人，违反 no-human-face 护栏且有真人肖像风险 |
| GBP | 抽象绘画感放射几何奖章，回避人脸 | 同上 | 透纳为真人画家，同理 |
| CNY | 同心奖章徽记 + 放射星徽，回避人脸 | 同上 | 同理 |
| INR | 同心莲纹奖章徽记，回避人脸（甘地） | 同上 | 甘地为现代公众人物，人脸照风险更高，务必回避 |

- **若想给人物母题一点视觉锚点**：可自行准备一张**不含可辨识人脸**的「奖章 / 浮雕 / 线刻」风格参考图（如硬币背面的几何纹章），存为 `reference_subjects/<ISO>.png`，脚本会以图生图锁定「奖章质感」而不触及人脸。
- **最简做法**：人物类 4 个 ISO 直接**不放置参考图**，脚本 `resolve_ref_path` 返回 `None`，自动降级为纯文生图（出图提示词已含 `no human face / no realistic portrait` 护栏）。

---

## 3. 一键下载参考图（动物/地标/风景 4 张）

```bash
cd /Users/albert/Documents/GameDream/tools/image_generator
mkdir -p reference_subjects
curl -sL -o reference_subjects/BRL.png "https://commons.wikimedia.org/wiki/Special:FilePath/Ara_Macao_(166522227).jpeg"
curl -sL -o reference_subjects/EUR.png "https://commons.wikimedia.org/wiki/Special:FilePath/CharlesBridgeMalaStranaPragueCzechRepublic.jpg"
curl -sL -o reference_subjects/JPY.png "https://commons.wikimedia.org/wiki/Special:FilePath/Mount_Fuji_from_Lake_Kawaguchi_20170206.jpg"
curl -sL -o reference_subjects/ZAR.png "https://commons.wikimedia.org/wiki/Special:FilePath/Waterberg_Nashorn2.jpg"
# 人物类 USD/GBP/CNY/INR 不下载，保持纯文生图
```

> 注意：源文件是 jpeg，但脚本只认 `<ISO>.png` 文件名；直接以 `.png` 扩展名保存即可（生成器按原始字节发给 Seedream，扩展名不影响）。

---

## 4. 运行出图

```bash
export ARK_API_KEY="你的火山方舟密钥"
cd /Users/albert/Documents/GameDream/tools/image_generator
python3 generate_currency_tokens.py --candidates 4   # 每图 4 候选，人工挑 1
# 或仅跑已备参考图的 4 个：python3 generate_currency_tokens.py --only BRL
```

- 有 `reference_subjects/<ISO>.png` → 走图生图（锁定主体）；缺图 → 纯文生图（已在脚本内自动降级）。
- `--no-ref` 可强制纯文生图做对照；`--selfcheck` 可不消耗 key 验证分支逻辑。

---

## 5. 缺口与待办
- **人物类 4 母题**：当前依赖纯文生图 + 强护栏，观感可能偏「抽象奖章」。若后续想要更明确的国别锚点，建议人工准备「无脸奖章/纹章」参考图（不紧急）。
- **历史版母题**：资料集 `design/content/currency-reference-dataset.md` 已含每面值 1–2 个历史版，但其母题暂未纳入出图清单；扩到历史版时再补对应参考图（届时同样守本规范）。
- **无 404 风险**：本规范所列 URL 均已实测可达；若未来链接失效，脚本会因 `resolve_ref_path` 找不到文件而降级纯文生图，不会中断。
