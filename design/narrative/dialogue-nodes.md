# 对话节点（引擎可用 · 状态触发式）

> **格式说明**：本游戏无对话分支树。每个节点是"由游戏状态触发的一段独白/对白"。
> 字段约定（对应 TS 结构见文末）：
> - `id`：节点唯一标识
> - `trigger`：触发条件（状态 flag）
> - `speaker`：CECE / SYSTEM（玩家沉默不写）
> - `lines`：按序播出的文本；括号为舞台提示，可分离为 `stageDir`
> - `next`：下一节点或 `AUTO_CLOSE` / `GOTO_HUB` / `GOTO_CODEX` 等

---

## S1_HUB_FIRST_OPEN — 首次开启 Hub
```
trigger: firstLaunch && hubOpened
speaker: CECE
lines:
- "（书页轻轻翻动）哎哟，终于有人翻开我了。"
- "你是周爷爷说的'那个会有缘分的年轻人'吧？"
- "这行囊里原先装满了他走遍世界带回的钱币名片。可年头久了，好多都散成了单张——"
- "得靠你，一双一双，把它们配回来。"
next: GOTO_HUB
```

## S1_HUB_RETURN — 日常回访
```
trigger: returnVisit (任意非首次开启)
speaker: CECE
lines (按状态选 1 条):
- 基础:        "回来啦。今天也挺好，咱们慢慢来。"
- 连续≥3天:    "（书页雀跃）连续好几天都来了——周爷爷当年也是这样，走到哪儿都舍不得停。"
- 离开≥7天:    "（书页舒展）哟，去远门了？没事，世界又不会跑。"
next: GOTO_HUB
```

## MATCH_FIRST_TUTORIAL — 首次配对（叙事化教学）
```
trigger: firstMatchSession && firstFlipPair
speaker: CECE
lines:
- "来，翻两张看看。要是它们是一对——"
- "（翻出一对）看，纹样对上了！这就是'配回来'的意思。"
- "不用急，翻错也不要紧，它们又不会跑。"
next: AUTO_CLOSE
```
> 注：此处把"教学"藏在册册的邀请里，而非"教程第 1 步"提示。

## MATCH_SUCCESS_NEW — 配对成功·新发现（解锁图鉴）
```
trigger: pairMatched && iso not in discoveredSet
speaker: CECE
lines:
- "好眼力！这两张是一对【<ISO> <中文名>】。"
- "<discoveryLine>"        // 来自 currencies.ts，按币种给，见下
- "（发现动画）它进册子了——翻到图鉴那页，我给你讲讲背后的故事。"
next: DISCOVERY_UNLOCK
```

### discoveryLine 样例（喂给 currencies.ts 的 `discoveryLine` 字段）
- **USD** — "美元上这位，是本杰明·富兰克林。美钞上少有的'非总统'面孔——美国人把他印上去，是因为他既是发明家，也是开国元勋。"
- **JPY** — "日元背面这幅，是葛饰北斋的《神奈川冲浪里》。富士山是日本的圣山，而这朵浪，浪了快两百年还没退。"
- **BRL** — "巴西雷亚尔背面这只大鸟，是绿翅金刚鹦鹉。红身绿翅，是巴西生物多样性的一张名片。"
- **ZAR** — "南非兰特背面这头犀牛，是'五大兽'里的一员。正面那位，是纳尔逊·曼德拉——南非人叫他 Madiba。"
- **CNY** — "人民币百元红票，背面是人民大会堂。'人民币'这三个字的意思，就是'人民的货币'。"
- **EUR** — "欧元上的桥和窗是'画'出来的——刻意不用任何真实地标，好让每个成员国都不被偏心。"
- **GBP** — "英镑二十镑这位，是画家透纳，人称'光之画家'。他有一句被印在钞上的话：'光，因此就是色彩。'"
- **INR** — "印度卢比正面这位，是圣雄甘地，用非暴力带印度走向独立。反面那口阶梯井，叫 Rani ki Vav，有上千座雕像。"

> 合规自检：以上全为文化/历史事实，零金融建议、零投资措辞。

## MATCH_SUCCESS_REPEAT — 配对成功·已见过
```
trigger: pairMatched && iso in discoveredSet
speaker: CECE
lines (rotate 轮转，每次取 1)：
- "又是这对——你认得它们了。"
- "老朋友了，是吧？（笑）"
- "这对你翻得越来越快了，记性真好。"
- "（书页轻响）这两张我都快背下来了，你倒比我还准。"
- "同一对，第二回见面。头回是陌生人，这回就是熟人了。"
- "你瞧，纹样一对上，手比脑子还快——这就叫记住了。"
- "周爷爷当年也这样，同一张翻来覆去看，说每回都能看出点新的。"
- "（书页舒展）又碰上了。世界这么大，还是这对先来找你。"
next: AUTO_CLOSE
```
> 注：引擎对本节点做 rotate 轮转，8 条足够覆盖单局重复配对而不刷屏。
> 声线校验：夸记忆力 / 币种冷知识 / 偶尔自嘲，全部无「进度压力」与金融措辞。

## MATCH_MISS — 错配
```
trigger: pairMismatched
speaker: CECE
lines (rotate 轮转，每次取 1；引擎 cooldown：每局≤2 次)：
- "（轻轻摇头）不是一对。再看看——它们差在哪儿？"
- "差一点儿。不急，它们又不会跑。"
- "（书页翻了半页又停住）这两张不熟。换一张试试？"
- "颜色像，纹样不一样——你再瞧瞧那个小符号。"
- "没对上也好，多看一眼，就多记一点。"
- "哎哟，这回我也看走眼了。（笑）咱们一块儿再来。"
- "翻错不要紧，周爷爷当年在集市上还认错过钱呢。"
next: AUTO_CLOSE
```
> 注：本游戏无失败态。7 条全部为「轻提示 + 陪伴」，
> 绝无惩罚暗示、绝无说教、绝无「你输了 / 还剩几次」类措辞。

## MATCH_WIN_SESSION — 一局配对完成
```
trigger: sessionComplete
speaker: CECE
lines:
- "这一架钱币，都归位了。"
- "你看，世界是不是比想象的小一点？"
next: GOTO_HUB
```

## CODEX_OPEN — 翻开图鉴某币种（Tier 2：周爷爷纸条）
```
trigger: codexEntryOpened(iso)
speaker: CECE
lines:
- "翻开这一页——<ISO>。"
- "周爷爷在这儿夹了张纸条：'<grandpaNote>'"
```
### grandpaNote 样例（喂给 currencies.ts 的 `grandpaNote` 字段）
- **USD** — "自由钟他看了三次，说钟声里有个新国家的心跳。"
- **JPY** — "他在东京的画廊站了很久，说这朵浪比任何照片都懂海。"
- **BRL** — "说这只鹦鹉的蓝，是他在雨林里见过最不讲理的蓝。"
- **ZAR** — "他说曼德拉的笑，能让最硬的墙让路。"
- **CNY** — "人民大会堂他只在电视里见过，说那是'人民坐下来商量事'的地方。"
- **EUR** — "他说这座桥哪儿都不在，却让整块大陆走了进来。"
- **GBP** — "他念叨透纳那句'光就是色彩'，说画画和看世界是一回事。"
- **INR** — "他说甘地的眼睛里有整个印度的安静。"

## PROFILE_OPEN — 收藏家档案
```
trigger: profileOpened
speaker: CECE
lines:
- "你的收藏家档案。周爷爷当年可没这种东西——他全靠脑子里记，记了一辈子。"
next: AUTO_CLOSE
```

## PASSPORT_TEASER — 旅行护照（锁定 teaser）
```
trigger: passportSlotTapped
speaker: CECE
lines:
- "（翻到册子最后一页，有个空着的小本子图案）周爷爷还留了本'旅行护照'的位子。"
- "他说，等这册子填得差不多了，自然就给你开了。"
- "现在嘛——先不急，咱们先把眼前这些配对好。"
next: AUTO_CLOSE
```

## REGION_COMPLETE — 某区域书架集满
```
trigger: regionShelfFull(region)
speaker: CECE
lines:
- "（书页合拢又展开）这一架——<region名>——齐了。"
- "周爷爷要是看见，准得给你泡杯茶。（停顿）对了，有段'旅行见闻'你想瞧瞧吗？"
next: OFFER_THEMED_AD
```
> "旅行见闻"= 旅游主题广告位的叙事化包裹，可选、不卡进度。

## RATE_SNAPSHOT_NUDGE — 汇率快照提示（合规口径）
```
trigger: hubRateBarFirstViewed (仅首次轻提示)
speaker: CECE
lines:
- "顶上那行是今天的汇率快照——记得，这只是参考，不是建议。咱们是看故事，不是看盘。"
next: AUTO_CLOSE
```

---

## TS 落地结构建议（给程基岩）
```ts
type Speaker = 'CECE' | 'SYSTEM';
interface DialogueLine { speaker: Speaker; text: string; stageDir?: string; }
interface DialogueNode {
  id: string;
  trigger: string;                 // 状态 flag 表达式
  lines: DialogueLine[];
  linesByState?: Record<string, DialogueLine[]>; // 如日常回访的多态
  next?: string;                   // 下一节点 id / 特殊指令
}
// 文案与逻辑分离：所有文本进外部 JSON / i18n，便于本地化与 telemetry
```
- 文案与代码分离；`discoveryLine` / `grandpaNote` 直接挂在 `src/data/currencies.ts` 的币种对象上。
- 未来可做对话 telemetry：哪条 `discoveryLine` 被跳过最多 → 优化文案。
