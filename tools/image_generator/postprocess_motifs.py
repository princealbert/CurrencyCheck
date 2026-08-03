#!/usr/bin/env python3
"""
母题 PNG 后处理：裁掉 Seedream 自带的透明留白（alpha bbox），补方到规范尺寸。
==========================================================================
解决 coin-redesign-spec.md §A2「母题没填满内盘」的第二重根因：
母题 PNG 四周常带 15%–30% 透明留白，只改绘制半径填不满。

用法：
    python3 postprocess_motifs.py                 # 处理 minigame/assets/ 下全部 cur_*.png
    python3 postprocess_motifs.py --src output    # 处理 output/ 下（可选）

目标尺寸（与 generate_currency_tokens.py TARGET 一致）：
    coin → 1024×1024（方）
    note → 2048×1024（2:1）

策略：getbbox 裁透明 → cover 缩放补方（内容最大化、不拉伸）→ 覆盖写回。
不重新出图、不烧 key。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

TARGET = {"coin": (1024, 1024), "note": (2048, 1024)}


def cover_resquare(im, tw: int, th: int):
    from PIL import Image
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    w, h = im.size
    scale = max(tw / w, th / h)          # cover：取较大比例，溢出部分裁掉
    nw, nh = int(round(w * scale)), int(round(h * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return im.crop((left, top, left + tw, top + th))


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=None, help="源目录（默认 minigame/assets）")
    args = ap.parse_args()

    if args.src:
        src_dir = Path(args.src)
    else:
        src_dir = Path(__file__).resolve().parent.parent / "minigame" / "assets"

    files = sorted(src_dir.glob("cur_*.png"))
    if not files:
        print(f"⚠ 未找到 {src_dir}/cur_*.png")
        return

    from PIL import Image
    done = 0
    for f in files:
        form = "coin" if f.name.endswith("_coin.png") else "note"
        tw, th = TARGET[form]
        im = Image.open(f).convert("RGBA")
        out = cover_resquare(im, tw, th)
        out.save(str(f), "PNG")
        print(f"  ✅ {f.name}  → {tw}×{th}  (原 {im.size[0]}×{im.size[1]})")
        done += 1
    print(f"\n完成：后处理 {done} 张母题 PNG → {src_dir}")


if __name__ == "__main__":
    main()
