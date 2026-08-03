/*
 * data.js — 货币主数据（MVP 垂直切片）
 * 仅占位美术：signature 为占位 hex，后续由美术（林绘澄）定稿。
 * anchor 为「现实锚」小字（GDD §2.7 / §3 图鉴现实辨认线索）。
 * 本文件可被后续美术/内容流程整体替换，不影响 game.js 逻辑。
 *
 * 配对判定键 = iso_code（GDD §1.④ / §6.3）。每个 ISO 在本局恰好 2 张。
 * 合规红线：绝不引用真实钞币图样/国旗；region 用区域双编码（形状+色）。
 */

// 8 币种（MVP 4×4 棋盘 = 8 对 = 每 ISO 2 张）
window.CURRENCIES = [
  { iso: "USD", name: "美元",       region: "amer",     signature: "#4E7A6B", motif: "portrait",     motifLabel: "人像圆章",     denom: "100",  denomSymbol: "$",  anchor: "真钞主导色：绿（海绿）｜中央母题：本杰明·富兰克林人像（非总统）" },
  { iso: "BRL", name: "巴西雷亚尔", region: "amer",     signature: "#C77B7B", motif: "animal",      motifLabel: "极简动物剪影", denom: "10",   denomSymbol: "R$", anchor: "真钞主导色：灰玫红｜中央母题：绿翅金刚鹦鹉（Arara）" },
  { iso: "EUR", name: "欧元",       region: "euro",     signature: "#4A6E8A", motif: "architecture", motifLabel: "几何桥梁剪影", denom: "20",   denomSymbol: "€",  anchor: "真钞主导色：蓝（€20）｜中央母题：文艺复兴式窗/门与桥（虚构建筑）" },
  { iso: "GBP", name: "英镑",       region: "euro",     signature: "#6A5B8A", motif: "portrait",     motifLabel: "人像圆章",     denom: "20",   denomSymbol: "£",  anchor: "真钞主导色：紫（£20）｜中央母题：画家透纳（J.M.W. Turner）人像" },
  { iso: "CNY", name: "人民币",     region: "asia_afr", signature: "#C75D4F", motif: "portrait",     motifLabel: "人像圆章",     denom: "100",  denomSymbol: "¥",  anchor: "真钞主导色：红（红票）｜中央母题：人物头像" },
  { iso: "JPY", name: "日元",       region: "asia_afr", signature: "#6E97A3", motif: "portrait",     motifLabel: "人像圆章",     denom: "1000", denomSymbol: "¥",  anchor: "真钞主导色：蓝（空色）｜中央母题：人物头像" },
  { iso: "INR", name: "印度卢比",   region: "asia_afr", signature: "#B08FB5", motif: "portrait",     motifLabel: "人像圆章",     denom: "100",  denomSymbol: "₹",  anchor: "真钞主导色：薰衣草紫（₹100 新系列）｜中央母题：圣雄甘地人像" },
  { iso: "ZAR", name: "南非兰特",   region: "asia_afr", signature: "#6E9B7E", motif: "animal",      motifLabel: "极简动物剪影", denom: "10",   denomSymbol: "R",   anchor: "真钞主导色：灰绿（sage）｜中央母题：白犀牛（rhinoceros，R10 纸币背面）" }
];

// 区域双编码（GDD §0.5 / 美术策略 §1）：形状 + 色，不依赖国旗
window.REGION_STYLE = {
  amer:     { shape: "rounded_rect", color: "#E0B15E" },
  euro:     { shape: "hexagon",      color: "#5B8FB0" },
  asia_afr: { shape: "diamond",      color: "#87A878" }
};

// 区域书架标签（图鉴分组，GDD §3.②）
window.REGION_LABELS = {
  amer:     "美洲",
  euro:     "欧洲",
  asia_afr: "亚洲·非洲"
};

// 双物理形态（GDD §0.5 form_factor）：硬币局 / 纸币局
// 解锁实体键 = (iso_code, form_factor)；图鉴每个币种含 coin / note 两形态槽
window.FORM_FACTORS = ["coin", "note"];
window.FORM_LABELS = { coin: "硬币", note: "纸币" };
