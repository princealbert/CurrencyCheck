#!/usr/bin/env python3
"""
《货币图鉴》真实货币参考图 · 下载与特征提取管线
================================================

目的（按产品负责人要求）：
  1. 把所有货币的「真实图片」下载到本地，做好命名与目录管理（coin / note 的正反面）。
  2. 在本地做特征提取（主导色取色、主母题关键词、构图比例），供后续「风格化重绘」使用。

⚠️ 合规隔离（工程纪律，非功能开关）：
  - 真实图二进制仅存于 tools/reference/raw/（已在根 .gitignore 忽略），绝不进仓库、绝不进游戏包。
  - 本脚本默认只下载 **维基共享资源（commons.wikimedia.org / upload.wikimedia.org）** 的
    CC/BSD/公有领域钞币图（自由许可），不抓取任何银行官网/版权图库。
  - 解析出的「特征」是颜色 hex / 母题类别 / 关键词 等**结构化文本**，抽进 references.json
    （可入库、可喂给 Seedream 风格化重绘脚本的 --ref-dir 或特征速查），不含任何图像二进制。
  - 真实图 -> 风格化重绘 的「重绘」由 generate_currency_tokens.py 完成（见其文生/图生图护栏），
    本脚本不生成任何可直接进游戏的资产。

用法：
  # 1) 下载全部预置币种的真实参考图（note 正反 / coin 正反）
  python3 fetch_real_currency.py download

  # 2) 仅下载某个币种
  python3 fetch_real_currency.py download --iso USD

  # 3) 特征提取：对 raw/ 下所有图取主导色 + 写入 references.json（不联网）
  python3 fetch_real_currency.py extract

  # 4) 报告：哪些币/面缺图、各规格完成情况
  python3 fetch_real_currency.py report

目录结构（下载产物，raw/ 已被 gitignore）：
  tools/reference/raw/
    <ISO>/
      note_obverse/  note_reverse/  coin_obverse/  coin_reverse/
        <ISO>_<denom>_<side>_01.jpg   # 真实图（自由许可来源）
  tools/reference/references.json      # 结构化特征卡（可入库）
"""

import argparse
import json
import os
import re
import shutil
import sys
import urllib.request
from pathlib import Path

try:
    from PIL import Image  # 取色用；缺则自动跳过取色只做清单
except Exception:  # pragma: no cover
    Image = None

SCRIPT_DIR = Path(__file__).resolve().parent
RAW_DIR = SCRIPT_DIR / "raw"
REF_JSON = SCRIPT_DIR / "references.json"
USER_AGENT = "Mozilla/5.0 (CurrencyCheck reference fetcher; educational, non-commercial) "

# —— 每个币种的「真实图来源清单」——
# side: note_obverse / note_reverse / coin_obverse / coin_reverse
# url: 维基共享资源直链（upload.wikimedia.org，自由许可/公有领域）。
#      若某面无合适自由图，url 留空 ""，download 会跳过并在 report 标 missing。
# motif: 母题类别（与 currencies.ts 一致）；kw: 风格化重绘关键词（中文，喂 Seedream 用）
# 说明：coind 形态游戏内是抽象令牌，但本管线按你的要求把「对应面值硬币」也下载归档（若有）。
CURRENCY_SPECS = [
    dict(iso="USD", denom="100", region="amer",
         motif="portrait", kw="富兰克林人像圆章 / 独立厅建筑",
         note_obverse="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/US_%24100_obverse.jpg/640px-US_%24100_obverse.jpg",
         note_reverse="https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/US_%24100_reverse.jpg/640px-US_%24100_reverse.jpg",
         coin_obverse="", coin_reverse=""),  # 无 $100 流通硬币
    dict(iso="BRL", denom="10", region="amer",
         motif="animal", kw="绿翅金刚鹦鹉 / 共和国女神雕塑",
         note_obverse="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Brazil_10_reais_front.jpg/640px-Brazil_10_reais_front.jpg",
         note_reverse="https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Brazil_10_reais_back.jpg/640px-Brazil_10_reais_back.jpg",
         coin_obverse="", coin_reverse=""),  # 无 R$10 流通硬币
    dict(iso="EUR", denom="20", region="euro",
         motif="architecture", kw="哥特式窗拱 / 哥特式桥（虚构建筑）",
         note_obverse="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Euro_banknote_20_euro_reverse.jpg/640px-Euro_banknote_20_euro_reverse.jpg",
         note_reverse="https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/20_euro_back.png/640px-20_euro_back.png",
         coin_obverse="", coin_reverse=""),  # 无 €20 硬币
    dict(iso="GBP", denom="20", region="euro",
         motif="portrait", kw="透纳自画像 / 战舰无畏号",
         note_obverse="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/UK_20_pound_note_obverse.jpg/640px-UK_20_pound_note_obverse.jpg",
         note_reverse="https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/UK_20_pound_note_reverse.jpg/640px-UK_20_pound_note_reverse.jpg",
         coin_obverse="", coin_reverse=""),  # 无 £20 流通硬币
    dict(iso="CNY", denom="100", region="asia_afr",
         motif="portrait", kw="毛泽东人像圆章 / 人民大会堂",
         note_obverse="", note_reverse="",  # 人民币图多版权受限，留空由人工补免费来源
         coin_obverse="", coin_reverse=""),
    dict(iso="JPY", denom="1000", region="asia_afr",
         motif="landscape", kw="北里柴三郎人像 / 神奈川冲浪里",
         note_obverse="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Japan_1000_yen_note.jpg/640px-Japan_1000_yen_note.jpg",
         note_reverse="",  # 反面上浪里图多在版权图，留空
         coin_obverse="", coin_reverse=""),
    dict(iso="INR", denom="100", region="asia_afr",
         motif="portrait", kw="甘地人像圆章 / Rani ki Vav 阶梯井",
         note_obverse="https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/India_100_rupees_front.jpg/640px-India_100_rupees_front.jpg",
         note_reverse="https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/India_100_rupees_back.jpg/640px-India_100_rupees_back.jpg",
         coin_obverse="", coin_reverse=""),  # 有 ₹100 硬币但少见，留空
    dict(iso="ZAR", denom="10", region="asia_afr",
         motif="animal", kw="曼德拉人像 / 白犀牛（Big Five）",
         note_obverse="https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/South_Africa_10_rand_obverse.jpg/640px-South_Africa_10_rand_obverse.jpg",
         note_reverse="https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/South_Africa_10_rand_reverse.jpg/640px-South_Africa_10_rand_reverse.jpg",
         coin_obverse="", coin_reverse=""),
]

SIDES = ["note_obverse", "note_reverse", "coin_obverse", "coin_reverse"]
SIDE_LABEL = {
    "note_obverse": "纸币正面", "note_reverse": "纸币反面",
    "coin_obverse": "硬币正面", "coin_reverse": "硬币反面",
}


def _safe_get(url: str, dest: Path, timeout: int = 30) -> bool:
    """下载单图；失败返回 False 不抛。"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as f:
            shutil.copyfileobj(resp, f)
        return dest.stat().st_size > 1024
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"  ! 下载失败 {url[:80]}…：{e}\n")
        return False


def _dominant_color(path: Path) -> str | None:
    """抽 1 个主导色（最频繁量化色），返回 hex；无 PIL 返回 None。"""
    if Image is None:
        return None
    try:
        with Image.open(path) as im:
            im = im.convert("RGB").resize((64, 64))
            from collections import Counter
            px = list(im.getdata())
            cnt = Counter(px)
            (r, g, b) = cnt.most_common(1)[0][0]
            return f"#{r:02X}{g:02X}{b:02X}"
    except Exception:  # noqa: BLE001
        return None


def cmd_download(iso_filter: str | None):
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    ok = 0
    for spec in CURRENCY_SPECS:
        if iso_filter and spec["iso"] != iso_filter:
            continue
        for side in SIDES:
            url = spec.get(side, "")
            if not url:
                continue
            d = RAW_DIR / spec["iso"] / side
            d.mkdir(parents=True, exist_ok=True)
            # 同币种多个面共用一张维基图时按 side 命名，避免覆盖
            ext = ".png" if "png" in url.split("?")[0] else ".jpg"
            dest = d / f"{spec['iso']}_{spec['denom']}_{side}{ext}"
            total += 1
            if dest.exists():
                print(f"  · 已存在跳过 {dest.relative_to(SCRIPT_DIR)}")
                ok += 1
                continue
            if _safe_get(url, dest):
                ok += 1
                print(f"  ✓ {spec['iso']} {SIDE_LABEL[side]}")
    print(f"\n下载完成：{ok}/{total} 成功（raw/ 已被 gitignore，不进仓库）")


def cmd_extract():
    """扫 raw/ 下所有图，抽主导色 + 元数据，写 references.json。"""
    refs = {}
    for spec in CURRENCY_SPECS:
        entry = dict(
            iso=spec["iso"], denom=spec["denom"], region=spec["region"],
            motif=spec["motif"], kw=spec["kw"], sides={},
        )
        for side in SIDES:
            d = RAW_DIR / spec["iso"] / side
            if not d.exists():
                continue
            imgs = sorted(p for p in d.iterdir() if p.suffix.lower() in (".jpg", ".png", ".jpeg"))
            if not imgs:
                continue
            # 取第一张图抽主导色
            color = _dominant_color(imgs[0])
            entry["sides"][side] = dict(
                present=True,
                files=[p.name for p in imgs],
                dominant_color=color,
                label=SIDE_LABEL[side],
            )
        refs[spec["iso"]] = entry

    REF_JSON.write_text(json.dumps(refs, ensure_ascii=False, indent=2), encoding="utf-8")
    n = sum(1 for e in refs.values() for s in e["sides"].values())
    print(f"✓ references.json 已写（{len(refs)} 币种 / {n} 个已下载面 / 含主导色）")


def cmd_report():
    print("币种        纸币正  纸币反  硬币正  硬币反   母题")
    print("-" * 64)
    for spec in CURRENCY_SPECS:
        cells = []
        for side in SIDES:
            d = RAW_DIR / spec["iso"] / side
            has = d.exists() and any(p.suffix.lower() in (".jpg", ".png", ".jpeg") for p in d.iterdir())
            cells.append("✓" if has else "—")
        print(f"{spec['iso']:10}  {cells[0]:>4}   {cells[1]:>4}   {cells[2]:>4}   {cells[3]:>4}    {spec['motif']}")
    print("\n说明：✓=已下载  —=未下载/未配置来源（见 CURRENCY_SPECS；CNY/JPY 等版权受限面留空待人工补免费来源）")


def main():
    ap = argparse.ArgumentParser(description="真实货币参考图下载与特征提取")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_dl = sub.add_parser("download", help="下载真实参考图到 raw/")
    p_dl.add_argument("--iso", default=None, help="仅下载某币种，如 USD")
    sub.add_parser("extract", help="特征提取 -> references.json（主导色等，不联网）")
    sub.add_parser("report", help="列出各币/面下载完成情况")
    args = ap.parse_args()

    if args.cmd == "download":
        cmd_download(args.iso)
    elif args.cmd == "extract":
        cmd_extract()
    elif args.cmd == "report":
        cmd_report()


if __name__ == "__main__":
    main()
