# assets/ — 母题 PNG 落位说明

本目录用于放置 **风格化母题质感层** PNG（由 Seedream 出图，见 `design/art/seedream-pipeline.md`）。
**当前为空**：游戏会自动用几何占位（白色描边符号）渲染母题；出图放入后引擎通过
`platform.loadImage` 异步叠加，缺失或加载失败自动降级，不影响流程。

## 命名规范（铁律，对齐 seedream-pipeline §2.1）

```
cur_<ISO>_<denom>_<region>_<form>.png
```

- `<ISO>`  3 字母 ISO 4217（大写）
- `<denom>` 代表面额数字（已修正：EUR/GPB = 20）
- `<region>` `amer` / `euro` / `asia_afr`
- `<form>` `coin` / `note`

## 资产清单（16 文件，出图后放入本目录）

| 文件 | form | 签名色 | 母题 |
|------|------|--------|------|
| `cur_USD_100_amer_coin.png` / `cur_USD_100_amer_note.png` | coin/note | `#4E7A6B` | portrait |
| `cur_BRL_10_amer_coin.png` / `cur_BRL_10_amer_note.png` | coin/note | `#C77B7B` | animal |
| `cur_EUR_20_euro_coin.png` / `cur_EUR_20_euro_note.png` | coin/note | `#4A6E8A` | architecture |
| `cur_GBP_20_euro_coin.png` / `cur_GBP_20_euro_note.png` | coin/note | `#6A5B8A` | portrait |
| `cur_CNY_100_asia_afr_coin.png` / `cur_CNY_100_asia_afr_note.png` | coin/note | `#C75D4F` | portrait |
| `cur_JPY_1000_asia_afr_coin.png` / `cur_JPY_1000_asia_afr_note.png` | coin/note | `#6E97A3` | landscape |
| `cur_INR_100_asia_afr_coin.png` / `cur_INR_100_asia_afr_note.png` | coin/note | `#B08FB5` | portrait |
| `cur_ZAR_10_asia_afr_coin.png` / `cur_ZAR_10_asia_afr_note.png` | coin/note | `#6E9B7E` | animal |

## 合规护栏（出图必过，见 seedream-pipeline §6）

- 非真实钞币复刻；无国旗；色弱可辨（形状 + ISO 冗余）；透明底正确；尺寸/命名符合；色相锚定。
- **绝不**在 PNG 中烤入文字 / ISO / 面额 / 区域形状（由 Canvas 代码叠加）。
