/**
 * currencies.ts — 货币主数据（移植自 mvp/data.js，已应用签名色/面值/母题修正）
 * 修正依据：design/content/real-world-anchors.md §3 签名色修正表 + design/art/seedream-pipeline.md §3。
 *
 * 关键修正（与原 mvp/data.js 占位相比）：
 *  - BRL 占位绿 → #C77B7B 灰玫红（锚定绯红），母题=绿翅金刚鹦鹉
 *  - EUR denom 50→20，签名 #4A6E8A 蓝（锚 €20）保留
 *  - GBP denom 10→20，签名 #6A5B8A 紫（锚 £20 透纳）保留
 *  - INR 占位橙红 → #B08FB5 柔薰衣草；motif architecture→portrait（甘地）
 *  - ZAR 占位蓝灰 → #6E9B7E 灰绿；母题实例=白犀牛（非跳羚）
 *  - USD/CNY/JPY 签名与原占位一致，保留
 * 合规：绝不引用真实钞币图；region 用区域双编码（形状+色）。
 *
 * ===== 2026-08-03 图鉴文案补全（design/content/codex-copy-completion.md）=====
 * 新增 frontMotif / backMotif / historyNote 三字段，18/18 币种全部填齐；
 * discoveryLine 按 §3 扩写、grandpaNote 按 §3 润色。并修正三处既有事实错误：
 *  - F-1 EUR.anchor：「文艺复兴式」→「哥特式」（€20 是哥特，€50 才是文艺复兴；
 *        原 anchor 与同条 flashSecondary 自相矛盾，flashSecondary 是对的）
 *  - F-2 CLP.grandpaNote：摩艾绝大多数**背对**大海、面朝村落，仅阿胡阿基维 7 尊面向海；
 *        原句「这些石头望着海」会教出错误认知
 *  - F-3 ZAR.flashSecondary：11 种官方语言是**整套钞票轮流分担**，非每张都印全
 * 合规自检：全部为可公开查证的文化/历史事实，零投资/交易/增值/收藏价格措辞。
 */

import { Currency, FormFactor, Region, RegionStyle, MotifCategory, GlyphKind } from '../core/types';

/**
 * flashPrimary / flashSecondary：现实锚闪现文案（Phase1 §1.5 定稿，逐条照抄）。
 * primary = 该 iso 首个形态解锁时显示（母题锚）；secondary = 第二个形态解锁时显示（冷知识）。
 * 合规自检：无真实钞币图样引用、无国旗、无投资/收藏增值措辞，纯文化事实。
 *
 * frontMotif / backMotif = Tier1（isCollected 可见）；historyNote = Tier2（isComplete 双形态齐全才可见）。
 */
export const CURRENCIES: Currency[] = [
  { iso: 'USD', name: '美元',       region: 'amer',     signature: '#4E7A6B', motif: 'portrait',     motifLabel: '人像圆章',     glyph: 'ring',     denom: '100',  denomSymbol: '$',  anchor: '真钞主导色：绿（海绿 greenback）｜中央母题：本杰明·富兰克林人像（非总统）',
    flashPrimary: '母题是富兰克林——美钞上唯一非总统头像', flashSecondary: '绰号 greenback 源自背面的绿色油墨',
    frontMotif: '本杰明·富兰克林——美钞高面额上唯一的「非总统」面孔，一个印刷工出身的发明家兼外交家，等于宣告这个国家最敬重「造东西的人」。',
    backMotif: '费城独立厅——《独立宣言》与宪法都在那间屋子里被逐条吵出来，是「一个国家如何被谈出来」的现场。',
    historyNote: '1996 年改版把居中的小幅人像放大并左移、留出水印窗；2013 年现行版在正面加了一条会变色的蓝色 3D 安全带，带内自由钟与「100」交替浮现。',
    discoveryLine: '美元上这位，是本杰明·富兰克林。美钞上少有的「非总统」面孔——美国人把他印上去，是因为他既是发明家，也是开国元勋。背面画的是费城的独立厅，《独立宣言》就在那间屋子里被逐条吵了出来。至于「greenback」这个绰号，来自 1861 年南北战争时期那批背面印满绿色油墨的钞票——绿色从此就留下了。',
    grandpaNote: '他在费城的自由钟前站过三次，说那道裂缝比钟声还诚实。' },
  { iso: 'BRL', name: '巴西雷亚尔', region: 'amer',     signature: '#C77B7B', motif: 'animal',      motifLabel: '极简动物剪影', glyph: 'triangle', denom: '10',   denomSymbol: 'R$', anchor: '真钞主导色：灰玫红｜中央母题：绿翅金刚鹦鹉（Arara）',
    flashPrimary: '母题是绿翅金刚鹦鹉，巴西生物多样性象征', flashSecondary: 'real 在葡语中意为「皇家／真实」',
    frontMotif: '共和国女神（Efígie da República）——头戴月桂的拟人形象；巴西选择让「共和国」这个理念本身上钞，而不是某一位具体的人。',
    backMotif: '绿翅金刚鹦鹉——红身绿翅的大型鹦鹉，是巴西生物多样性的活招牌；整套雷亚尔的背面都归本土动物所有。',
    historyNote: '雷亚尔 1994 年随「雷亚尔计划」启用，用于终结恶性通胀；2010 年起的第二套按面额递增票幅、放大数字并加触感标记；2020 年补发的 200 雷亚尔画的是鬃狼。',
    discoveryLine: '巴西雷亚尔背面这只大鸟，是绿翅金刚鹦鹉。红身绿翅，是巴西生物多样性的一张名片。整套雷亚尔的背面都归动物所有——鹦鹉、美洲豹、海龟、鬃狼，一国的钞票像一本小小的物种名录。而 real 这个词在葡语里既是「皇家」，也是「真实」。',
    grandpaNote: '他在雨林里追着这只鹦鹉走了半条河，说那种蓝，不讲道理。' },
  { iso: 'EUR', name: '欧元',       region: 'euro',     signature: '#4A6E8A', motif: 'architecture', motifLabel: '几何桥梁剪影', glyph: 'arch',     denom: '20',   denomSymbol: '€',  anchor: '真钞主导色：蓝（€20）｜中央母题：哥特式窗/门与桥（虚构建筑）',
    flashPrimary: '母题是虚构的桥与窗，以保持成员国中立', flashSecondary: '每个面额对应一个建筑时代，€20 是哥特',
    frontMotif: '窗与门——象征欧洲对外的开放；刻意画成不存在的建筑，谁也认不出是哪一国。',
    backMotif: '桥——象征欧洲内部以及欧洲与世界的连接；同样是虚构的桥，不指向任何真实地标。',
    historyNote: '每个面额对应一个建筑年代（€5 古典 / €10 罗马式 / €20 哥特 / €50 文艺复兴 / €100 巴洛克与洛可可 / €200 钢铁玻璃时代）；2013 年起的「欧罗巴系列」在水印与全息中加入欧罗巴女神头像；€500 已于 2019 年停止发行。',
    discoveryLine: '欧元上的桥和窗是「画」出来的——刻意不用任何真实地标，好让每个成员国都不被偏心。窗与门朝外，是开放；桥朝内，是彼此连接。六种面额各配一个建筑年代，二十欧这一张，走的是哥特式。',
    grandpaNote: '他说这座桥哪儿都不在，可他从西班牙一路走到波兰，觉得自己一直在桥上。' },
  { iso: 'GBP', name: '英镑',       region: 'euro',     signature: '#6A5B8A', motif: 'portrait',     motifLabel: '人像圆章',     glyph: 'square',   denom: '20',   denomSymbol: '£',  anchor: '真钞主导色：紫（£20）｜中央母题：画家透纳（J.M.W. Turner）人像',
    flashPrimary: '母题是画家透纳，「光即色彩」印上钞面', flashSecondary: '聚合物钞寿命约是纸钞的 2.5 倍',
    frontMotif: '在位君主肖像——英镑正面始终是君主，钞面本身就是一部王权更迭的年表。',
    backMotif: '画家透纳与他的《被拖去解体的战舰无畏号》，配上他 1818 年讲课时那句「光，因此就是色彩」。',
    historyNote: '2020 年的聚合物透纳版取代了 2007 年的纸质亚当·斯密版，旧版 20 镑纸钞已于 2022 年 9 月 30 日退出流通；2024 年 6 月起，印有查尔斯三世肖像的新钞开始与伊丽莎白二世版本并行流通。',
    discoveryLine: '英镑二十镑这位，是画家透纳，人称「光之画家」。他有一句被印在钞上的话：「光，因此就是色彩。」他旁边那艘船，是《被拖去解体的战舰无畏号》——一艘打完仗的旧军舰，正被小拖船拉去拆掉，天边烧着一整片夕阳。',
    grandpaNote: '他念叨透纳那句「光就是色彩」，说那艘被拖走的老船，是他见过最体面的告别。' },
  { iso: 'CNY', name: '人民币',     region: 'asia_afr', signature: '#C75D4F', motif: 'portrait',     motifLabel: '人像圆章',     glyph: 'plus',     denom: '100',  denomSymbol: '¥',  anchor: '真钞主导色：红（红票）｜中央母题：人物头像',
    flashPrimary: '「红票」是最具代表性的高面额红色纸币', flashSecondary: '人民币意为「人民的货币」',
    frontMotif: '第五套人民币各面额统一采用的领袖人像，取代了此前按面额分印不同民族人物与劳动者的做法，让整套票面有了一致的面孔。',
    backMotif: '人民大会堂——人民代表聚在一起商议国事的地方。第五套各面额背面连起来是一趟山河之旅：人民大会堂、布达拉宫、桂林山水、长江三峡、泰山、西湖。',
    historyNote: '第五套人民币自 1999 年版起，历经 2005 年版与 2015 年版两次改版；2015 年版 100 元把面额数字改为「光彩光变」（不同角度金绿变换）并换上开窗安全线；2019 年版更新了 50、20、10、1 元与硬币，100 元仍沿用 2015 年版。',
    discoveryLine: '人民币百元红票，背面是人民大会堂。「人民币」这三个字的意思，就是「人民的货币」。把第五套的背面连起来看，是一趟山河之旅——人民大会堂、布达拉宫、桂林山水、长江三峡、泰山、西湖，六张纸装下了半个中国。',
    grandpaNote: '人民大会堂他只在电视里见过；倒是背面那几处山水，他一处一处替我们走过了。' },
  { iso: 'JPY', name: '日元',       region: 'asia_afr', signature: '#6E97A3', motif: 'landscape',    motifLabel: '富士山三角+樱花点', glyph: 'wave',     denom: '1000', denomSymbol: '¥', anchor: '真钞主导色：蓝（空色）｜中央母题：人物头像',
    flashPrimary: '母题是富士山与樱花，锚定蓝色千元钞', flashSecondary: '日元创设于 1871 年，最新版首次印英文',
    frontMotif: '现行 F 券一千日元正面是细菌学家北里柴三郎——破伤风与鼠疫研究的先驱。日本把科学家而不是政治人物，放在了钞面最前。',
    backMotif: '葛饰北斋《富岳三十六景·神奈川冲浪里》——爪子一样的巨浪、浪谷里的小船，远处的富士山小得像一粒米。',
    historyNote: '2004 年的 E 券一千元正面是细菌学家野口英世，背面是本栖湖倒映的富士山与樱花；2024 年 7 月 3 日发行的 F 券换成北里柴三郎与《神奈川冲浪里》，并采用 3D 全息肖像与更大的阿拉伯数字。',
    discoveryLine: '日元背面这幅，是葛饰北斋的《神奈川冲浪里》。富士山是日本的圣山，而这朵浪，浪了快两百年还没退。上一代千元钞的背面还是本栖湖里那座安静的富士山、配一圈樱花；2024 年换版，日本人把最静的山，换成了最动的浪。',
    grandpaNote: '他在东京的画廊前站到闭馆，说这朵浪，比他见过的任何一张海的照片都懂海。' },
  { iso: 'INR', name: '印度卢比',   region: 'asia_afr', signature: '#B08FB5', motif: 'portrait',     motifLabel: '人像圆章',     glyph: 'flower',   denom: '100',  denomSymbol: '₹',  anchor: '真钞主导色：薰衣草紫（₹100 新系列）｜中央母题：圣雄甘地人像',
    flashPrimary: '母题是圣雄甘地，现行卢比钞的共同肖像', flashSecondary: '印度钞面印有 15 种以上语言',
    frontMotif: '圣雄甘地——以非暴力不合作带领印度走向独立；现行「甘地新系列」所有面额共用这一张面孔。',
    backMotif: '拉尼·基·瓦夫（Rani ki Vav），古吉拉特邦帕坦的十一世纪阶梯井——一座「倒过来盖」的神庙，越往下走越深，主雕像五百余尊、大小造像上千。',
    historyNote: '2016 年废钞后启用「甘地新系列」，把背面统一换成世界遗产与国家工程（₹100 阶梯井、₹200 桑吉大塔、₹500 红堡、₹50 亨比战车）；₹2000 面额已于 2023 年退出流通。',
    discoveryLine: '印度卢比正面这位，是圣雄甘地，用非暴力带印度走向独立。反面那口阶梯井，叫 Rani ki Vav——一座倒着盖的神庙，你不是抬头看它，是一级一级走下去看它，主雕像五百多尊。钞票侧面还有一块语言板，用十五种文字重复同一个面额。',
    grandpaNote: '他在那口井里一级一级往下走，说印度把最好的东西，藏在了地底下。' },
  { iso: 'ZAR', name: '南非兰特',   region: 'asia_afr', signature: '#6E9B7E', motif: 'animal',       motifLabel: '极简动物剪影', glyph: 'pentagon', denom: '10',   denomSymbol: 'R',   anchor: '真钞主导色：灰绿（sage）｜中央母题：白犀牛（rhinoceros，R10 纸币背面）',
    flashPrimary: '母题是白犀牛，南非「五大兽」之一', flashSecondary: '一整套兰特轮流用尽 11 种官方语言',
    frontMotif: '纳尔逊·曼德拉，南非人叫他 Madiba——2012 年起，这张笑脸出现在所有面额的正面。',
    backMotif: '白犀牛——「五大兽」之一；整套兰特的背面凑齐犀牛、大象、狮子、水牛与豹，一套钞票等于一趟草原点名。',
    historyNote: '2012 年之前，五大兽在正面、没有人像；2012 年「曼德拉系列」把曼德拉请上正面、五大兽退到背面；2018 年发行曼德拉百年诞辰纪念版；2023 年新版把单只动物改画成动物「一家子」。',
    discoveryLine: '南非兰特背面这头犀牛，是「五大兽」里的一员。正面那位，是纳尔逊·曼德拉——南非人叫他 Madiba。整套兰特的背面凑齐了犀牛、大象、狮子、水牛和豹。南非有十一种官方语言，一张钞票放不下，就让每张分担几种，一整套才把话说全。',
    grandpaNote: '他说曼德拉的笑能让最硬的墙让路，那是他在开普敦学会的第一句话。' },

  /* ===== 扩池新币种（2026-07-31 关卡设计起草 · 2026-08-01 R4 事实核查已完成） =====
     新增 10 币使每区达 6 币，支撑单区关卡章节（chapters.ts）。
     R4 核查结论：anchor / flashPrimary / flashSecondary 已逐条查证，草稿标记全部清除；
     MXN / ARS / CLP / CHF / SEK / RUB / PLN / NGN 的 discoveryLine 有事实出入，已修正。
     签名色为粉彩化色相锚，非真钞主色复刻；denom 参与美术资源命名（app.ts assets 路径），勿改。
     母题分布刻意稀释 portrait（原 5/8），每区最多 2 portrait。
     【图文关系总则】母题 = 该国的风格化文化名片符号，不等于该钞面的实际图案；
     discoveryLine 只讲可查证的文化/历史事实。二者在合规信封内共存，不互相冒充。 */
  { iso: 'CAD', name: '加元',       region: 'amer',     signature: '#B5894E', motif: 'animal',      motifLabel: '极简潜鸟剪影',   glyph: 'chevron',  denom: '5',    denomSymbol: 'C$',  anchor: '现实锚：C$1 硬币「loonie」的金色币面｜母题：普通潜鸟（Gavia immer），1987 年启用',
    flashPrimary: '母题是普通潜鸟——一元硬币绰号 loonie 由它而来', flashSecondary: '加元纸钞自 2011 年起改用聚合物基材',
    frontMotif: '一元硬币正面是在位君主侧面像（2023 年 12 月起改为查尔斯三世）；五元纸钞正面是首位法裔总理威尔弗里德·劳里埃。',
    backMotif: '一元硬币背面是普通潜鸟，由艺术家 Robert-Ralph Carmichael 设计、1987 年启用；五元纸钞背面画的是加拿大机械臂与太空行走的宇航员。',
    historyNote: '一元硬币原定用「独木舟与皮毛商人」图案，1986 年模具在运往温尼伯途中遗失，才临时改用潜鸟；纸钞自 2011 年「前沿系列」起全面改用聚合物基材。',
    discoveryLine: '加元一元硬币叫「loonie」，因为背面那只普通潜鸟。本来要印的是划独木舟的皮毛商人，模具半路弄丢了，才临时换成了鸟。这枚硬币火到什么程度？后来的两元硬币顺势被叫成「toonie」。五元纸钞跑得更远——背面画的是加拿大机械臂，和一个飘在太空里的宇航员。',
    grandpaNote: '他在班夫的湖边听了一下午潜鸟叫，说那声音像有人在很远的地方笑。' },
  { iso: 'MXN', name: '墨西哥比索', region: 'amer',     signature: '#5FA88A', motif: 'animal',      motifLabel: '极简蝾螈剪影',   glyph: 'hexagon',  denom: '20',   denomSymbol: 'MX$', anchor: '现实锚：美西螈（ajolote）与霍奇米尔科水乡，见于 G 系列 $50 聚合物钞背面｜签名色取水乡绿',
    flashPrimary: '母题是美西螈，墨西哥城霍奇米尔科的特有物种', flashSecondary: 'peso 原意为「重量」，源自按秤计价的银币时代',
    frontMotif: 'G 系列正面统一讲「墨西哥身份」——五十比索正面是特诺奇蒂特兰建城传说里那只叼着蛇、立在仙人掌上的鹰。',
    backMotif: 'G 系列背面成套画生态系统——五十比索背面是美西螈与霍奇米尔科的浮田水乡；二十比索背面是仙卡安生物圈保护区的红树林。',
    historyNote: 'F 系列以历史人物为主；2018 年起换代的 G 系列改成「正面身份、背面生态」的双主题结构，2021 年那张五十比索还拿下了当年的国际钞票大奖。',
    discoveryLine: '墨西哥比索上有只小家伙叫美西螈——只住在墨西哥城南边霍奇米尔科的水道里，一辈子留着幼时的模样，鳃像一顶张开的羽毛冠。它旁边那片水田叫「浮田」，是阿兹特克人在湖面上一寸寸种出来的，到今天还在种。至于 peso 这个词，原意是「重量」，从按秤称银币的年代留下来的。',
    grandpaNote: '他在霍奇米尔科坐了一趟花船，说那片田是几百年前的人用手，在水上种出来的。' },
  { iso: 'ARS', name: '阿根廷比索', region: 'amer',     signature: '#6FA3C7', motif: 'landscape',   motifLabel: '极简冰川剪影',   glyph: 'star',     denom: '200',  denomSymbol: 'AR$', anchor: '现实锚：AR$200（本土动物系列）为南露脊鲸与瓦尔德斯半岛｜母题冰川取自同一片巴塔哥尼亚（莫雷诺冰川）',
    flashPrimary: '母题冰川取自巴塔哥尼亚的莫雷诺冰川，冰舌每天向前推进', flashSecondary: '$200 那一版属「阿根廷本土动物」系列，画的是南露脊鲸',
    frontMotif: '两百比索（「阿根廷本土动物」系列）正面是南露脊鲸——每年冬春，它们从南极水域北上到瓦尔德斯半岛外的海湾产崽。',
    backMotif: '背面是瓦尔德斯半岛的海岸——一片以鲸、象海豹与虎鲸闻名的世界自然遗产。',
    historyNote: '「本土动物」系列（2016–2018）之后，阿根廷自 2023 年起改回历史人物系列，新发行的高面额陆续换上圣马丁、贝尔格拉诺等名字，动物系列正逐步退场。',
    discoveryLine: '阿根廷两百比索上是南露脊鲸和瓦尔德斯半岛，都在巴塔哥尼亚。每年冬天，这些几十吨重的大家伙从南极一路北上，到这片海湾里生孩子。再往南走，就是那片会走路的冰——莫雷诺冰川，冰舌每天往前推进两米上下，撑不住了就整块塌进湖里。',
    grandpaNote: '他在瓦尔德斯的岸边等了一整天，说那个大家伙终于浮上来时，海先安静了一下。' },
  { iso: 'CLP', name: '智利比索',   region: 'amer',     signature: '#9A7BC0', motif: 'landscape',   motifLabel: '极简石像剪影',   glyph: 'arrow',    denom: '1000', denomSymbol: 'CLP$',anchor: '现实锚：CLP$1000 为伊格纳西奥·卡雷拉·平托与百内国家公园｜母题摩艾取自智利属地复活节岛（拉帕努伊国家公园，世界遗产）',
    flashPrimary: '母题摩艾来自复活节岛——它是智利在太平洋上的属地', flashSecondary: '智利现行钞背面成套画的是国家公园，$1000 是百内',
    frontMotif: '一千比索正面是伊格纳西奥·卡雷拉·平托，1882 年康塞普西翁之战中的军人。',
    backMotif: '背面是百内国家公园的山与草原；现行智利钞的背面成套画国家公园（两千＝纳尔卡斯、五千＝拉坎帕纳、一万＝阿尔贝托·德·阿戈斯蒂尼、两万＝苏里雷盐沼）。',
    historyNote: '现行系列自 2009 年起陆续发行，把背面统一换成国家公园主题，并逐步改用聚合物基材（一千、两千比索为聚合物）；此前旧版背面多为纪念碑与历史场景。',
    discoveryLine: '智利一千比索背面是百内国家公园的山。往太平洋上再走三千多公里，还是智利——复活节岛，几百座摩艾沉默地立着。有意思的是，几乎所有摩艾都背对着大海、面朝村子，像在守着自己人；全岛只有阿胡阿基维那七尊，是望向海的。',
    grandpaNote: '他说岛上的石头几乎都背着海，只有七尊望着远方，像还在等谁回来。' },

  { iso: 'CHF', name: '瑞士法郎',   region: 'euro',     signature: '#7A8FB0', motif: 'landscape',   motifLabel: '极简山峦剪影',   glyph: 'disc',     denom: '10',   denomSymbol: 'CHF', anchor: '现实锚：第九版瑞士法郎主题「瑞士的多个侧面」，CHF10 主题＝时间（指挥棒／钟表机芯／哥达基线隧道）｜母题山峦＝阿尔卑斯符号',
    flashPrimary: '第九版瑞士法郎放弃名人肖像，改用「手与地球」贯穿全套', flashSecondary: '十法郎背面那条隧道，是穿越阿尔卑斯山的哥达基线隧道',
    frontMotif: '第九版全套竖版排印、不印任何名人；十法郎正面是一双打拍子的手，和一个标着时区的地球——主题是「时间」。',
    backMotif: '十法郎背面是钟表机芯，与穿过阿尔卑斯山的哥达基线隧道——全长约 57 公里，2016 年通车，是世界最长的铁路隧道。',
    historyNote: '第八版（1995–2000）走名人路线：十法郎柯布西耶、五十法郎陶柏-阿尔普、一百法郎贾科梅蒂；第九版彻底放弃肖像，改成「一双手 + 一个地球 + 一个主题」贯穿全套。第八版已于 2021 年 4 月 30 日退出流通，但仍可无限期兑换。',
    discoveryLine: '瑞士法郎新版特意不印名人，改讲「瑞士的几个侧面」。整套都是竖着排的，每张一双手、一个地球、一个主题。十法郎讲的是「时间」——指挥的手在打拍子，背面是钟表机芯，还有那条五十七公里、直接从阿尔卑斯山肚子里穿过去的哥达基线隧道。',
    grandpaNote: '他在少女峰上站到手指发僵，说山不说话，云替它说了。' },
  { iso: 'SEK', name: '瑞典克朗',   region: 'euro',     signature: '#5B9AA0', motif: 'animal',      motifLabel: '极简驼鹿剪影',   glyph: 'spiral',   denom: '100',  denomSymbol: 'kr',  anchor: '现实锚：2015 版「文化之旅」系列，正面文化人物、背面其家乡风景，kr100 为葛丽泰·嘉宝与斯德哥尔摩｜母题驼鹿＝北欧森林符号',
    flashPrimary: '2015 版瑞典克朗主题是「文化之旅」，六种面额六位文化人物', flashSecondary: 'krona 意为「王冠」；瑞典央行是世界上最古老的中央银行',
    frontMotif: '2015 版「文化之旅」系列，每张正面一位二十世纪文化人物——一百克朗是演员葛丽泰·嘉宝，另有作家阿斯特丽德·林格伦、导演英格玛·伯格曼等。',
    backMotif: '背面配上这位人物的家乡或代表地景——一百克朗背面是斯德哥尔摩，二十克朗背面是林格伦笔下的斯莫兰乡野。',
    historyNote: '上一套印的是国王与科学家（一百克朗是林奈、一千克朗是古斯塔夫·瓦萨）；2015 版全部换成二十世纪文化人物，并同时新增了两百克朗面额与两克朗硬币。',
    discoveryLine: '瑞典克朗是一整套「文化之旅」：正面印二十世纪的作家、演员、导演，背面配上他们各自的家乡风景。一百克朗是演员葛丽泰·嘉宝，背面就是斯德哥尔摩。发行它的瑞典央行成立于 1668 年，是世界上最老的中央银行；krona 的意思是「王冠」。至于林子里那位「森林之王」驼鹿——它并不在钞票上，却是瑞典人自己的图腾。',
    grandpaNote: '他说北欧的林子安静得过分，人和鹿撞见了，都只是各自让开。' },
  { iso: 'RUB', name: '俄罗斯卢布', region: 'euro',     signature: '#8C6FB0', motif: 'animal',      motifLabel: '极简熊剪影',     glyph: 'mountain', denom: '100',  denomSymbol: '₽',   anchor: '现实锚：₽100（1997 版）正面为莫斯科大剧院门廊上的驷马战车，背面为大剧院建筑｜母题熊＝民间象征（棕熊），非钞面图案',
    flashPrimary: '一百卢布画的是莫斯科大剧院与门廊上的驷马战车', flashSecondary: 'рубль 源自「砍下的一段」——古时按重量切割银条计价',
    frontMotif: '1997 版一百卢布正面，是莫斯科大剧院门廊顶上那驾四匹马拉的战车（驷马战车），出自雕塑家克洛特之手。',
    backMotif: '背面是大剧院建筑本身——「Большой」这个词，本身就是「大」的意思。',
    historyNote: '2022 年发行的新版一百卢布改成莫斯科主题（斯帕斯克塔、奥斯坦金诺电视塔等），取代了 1997 版的大剧院图案；目前两版并行流通。',
    discoveryLine: '俄罗斯一百卢布上的建筑是莫斯科大剧院，门廊顶上那驾四匹马拉的战车叫驷马战车。「Большой」本身就是「大」的意思。рубль 这个词源自「砍下来的一段」——古时候人们把银条按重量切开来用。至于熊，那是俄罗斯民间最老的图腾之一，森林里的棕熊，不是北极那种。',
    grandpaNote: '他坐了七天火车横穿西伯利亚，说那趟车教会他，「远」也是一种尺度。' },
  { iso: 'PLN', name: '波兰兹罗提', region: 'euro',     signature: '#4F8AA8', motif: 'architecture', motifLabel: '极简塔桥剪影',   glyph: 'sun',      denom: '20',   denomSymbol: 'zł',  anchor: '现实锚：1995 年起的「波兰统治者」系列，zł20 为国王「勇敢者」博莱斯瓦夫，钞面含罗马式门廊与格涅兹诺铜门元素',
    flashPrimary: '现行兹罗提是「波兰统治者」系列，按年代从梅什科一世排起', flashSecondary: 'złoty 意为「金的」；上一套「波兰伟人」曾印过哥白尼与居里夫人',
    frontMotif: '「波兰统治者」系列按年代排开，二十兹罗提正面是「勇敢者」博莱斯瓦夫——1025 年加冕，波兰第一位国王。',
    backMotif: '背面是罗马式建筑元素与同时代钱币纹样，把千年前那段建国史压进一张纸里。',
    historyNote: '1995 年货币改值（一万旧兹罗提兑一新兹罗提）后启用现行「波兰统治者」系列；上一套「波兰伟人」印的是哥白尼、居里夫人、肖邦等人；2017 年增发的五百兹罗提是扬三世·索别斯基。',
    discoveryLine: '波兰兹罗提是一整套「波兰统治者」，按年代排下来——十兹罗提是梅什科一世，二十兹罗提是他儿子、波兰第一位国王「勇敢者」博莱斯瓦夫。złoty 的意思就是「金的」。上一套钞票走的是另一条路线，印的是哥白尼、居里夫人和肖邦。',
    grandpaNote: '他说华沙是照着旧画一砖一砖重砌回来的，波兰人的记性好得可怕。' },

  /* KRW 图文关系说明（R4 结论）：母题「极简虎鲸剪影」是风格化海洋符号，游戏从不自称真实钞币图像；
     discoveryLine 讲的是可查证的真实韩元事实（₩1000＝朝鲜王朝学者李滉／退溪，背面陶山书院）。
     二者在合规信封内共存：文字守事实，图形守风格化；grandpaNote 末句留一条海的暗线做视觉呼应。
     ⚠ grandpaNote 是「海 → 远方 → 大家伙」跨币种暗线的锚点，逐字不动（补全文档 §4）。 */
  { iso: 'KRW', name: '韩元',       region: 'asia_afr', signature: '#C99A3E', motif: 'animal',      motifLabel: '极简虎鲸剪影',   glyph: 'bolt',     denom: '1000', denomSymbol: '₩',   anchor: '现实锚：₩1000 正面为朝鲜王朝学者李滉（号退溪），背面为其讲学的陶山书院｜母题虎鲸＝风格化海洋符号，非钞面图案',
    flashPrimary: '一千韩元上的李滉是朝鲜王朝的性理学大家，号退溪', flashSecondary: '五万韩元上的申师任堂，是韩国流通钞上的第一位女性',
    frontMotif: '一千韩元正面是朝鲜王朝性理学大家李滉（号退溪），旁边配成均馆明伦堂与一枝梅花。',
    backMotif: '背面是画家郑敾（号谦斋）的《溪上静居图》——画的正是李滉讲学的陶山书院一带。',
    historyNote: '1983 版一千韩元背面画的是陶山书院实景；2007 年 1 月启用的现行版改成郑敾那幅古画，等于把「实景」换成了「古人眼里的实景」。2009 年发行的五万韩元上是申师任堂，韩国流通钞上的第一位女性。',
    discoveryLine: '韩元一千元上的那位，是朝鲜王朝的学者李滉，号退溪；背面画的是他讲学的陶山书院。有意思的是，背面并不是照着书院写生的，而是直接用了画家郑敾的一幅古画——把「那个地方」，换成了「古人看那个地方的眼睛」。这个民族，把读书人印在了钱上。',
    grandpaNote: '他在首尔的夜里走路，说风里有海的味道——像有个大家伙，正在远处慢慢地游。' },
  { iso: 'NGN', name: '尼日利亚奈拉', region: 'asia_afr', signature: '#5E8C6A', motif: 'landscape',  motifLabel: '极简岩山剪影',   glyph: 'rhombus',  denom: '100',  denomSymbol: '₦',   anchor: '现实锚：₦100 正面为独立时代政治家奥巴费米·阿沃洛沃，背面为尼日尔州的祖玛岩',
    flashPrimary: '一百奈拉背面的祖玛岩高出地面约 725 米，人称「阿布贾的门户」', flashSecondary: '「奈拉」由 Nigeria 缩写而来，而尼日利亚得名于尼日尔河',
    frontMotif: '一百奈拉正面是奥巴费米·阿沃洛沃——独立时代的西部区总理，在自己辖区率先推行免费小学教育。',
    backMotif: '尼日尔州的祖玛岩——一整块从平地拔起约 725 米的巨岩，人称「阿布贾的门户」，一面岩壁上有一处形似人脸的天然纹路。',
    historyNote: '2014 年发行过一版一百奈拉纪念钞，纪念尼日利亚建制一百年，是尼日利亚第一张带二维码的钞票；2022 年 12 月改版的是 200、500、1000 三种面额，一百奈拉未在其列。',
    discoveryLine: '尼日利亚一百奈拉背面那块巨岩，叫祖玛岩，人称「阿布贾的门户」，从平地上直接拔起七百多米。正面是独立时代的政治家阿沃洛沃——他在自己管的那一片，让小学不要钱。「奈拉」这个名字是从 Nigeria 缩出来的，而尼日利亚，得名于尼日尔河。',
    grandpaNote: '他在那块大岩石底下抬头看了很久，说非洲的红是土地自己给的，晒不褪。' },
];

/** 区域双编码（GDD §0.5 / 美术策略 §1）：形状 + 色，不依赖国旗 */
export const REGION_STYLE: Record<Region, RegionStyle> = {
  amer:     { shape: 'rounded_rect', color: '#E0B15E' }, // 金
  euro:     { shape: 'hexagon',      color: '#5B8FB0' }, // 蓝
  asia_afr: { shape: 'diamond',      color: '#87A878' }, // 绿
};

/** 区域书架标签（图鉴分组，GDD §3.②） */
export const REGION_LABELS: Record<Region, string> = {
  amer:     '美洲',
  euro:     '欧洲',
  asia_afr: '亚洲·非洲',
};

/** 双物理形态（GDD §0.5 form_factor） */
export const FORM_FACTORS: FormFactor[] = ['coin', 'note'];
export const FORM_LABELS: Record<FormFactor, string> = { coin: '硬币', note: '纸币' };

/**
 * 币符 → 中文（图鉴/详情回显；四层识别码 ② 币符层）。
 * 8 币 8 形，互不撞轮廓；「同区域 + 同母题 + 同面额」的最痛对（CNY 十字 / INR 五瓣花）
 * 在此层被彻底拆开，占位美术与色弱模式下均不依赖颜色即可分辨。
 */
export const GLYPH_LABELS: Record<GlyphKind, string> = {
  ring:     '环',
  triangle: '三角',
  arch:     '拱',
  square:   '方',
  plus:     '十字',
  wave:     '波',
  flower:   '花',
  pentagon: '五边形',
  // —— 扩池新币符标签（与 render/glyph.ts 一一对应）——
  chevron:  '山形',
  hexagon:  '六边',
  star:     '星',
  disc:     '圆',
  spiral:   '螺旋',
  mountain: '山',
  sun:      '日',
  bolt:     '电',
  rhombus:  '菱',
  arrow:    '箭',
};

/** 母题类别 → 中文（图鉴/详情现实辨认线索回显） */
export const MOTIF_LABELS: Record<MotifCategory, string> = {
  portrait:     '人像',
  architecture: '建筑',
  animal:       '动物',
  landscape:    '景观',
};

/** 按 ISO 取币种（图鉴/详情用） */
export function getCurrency(iso: string): Currency | undefined {
  return CURRENCIES.find((c) => c.iso === iso);
}
