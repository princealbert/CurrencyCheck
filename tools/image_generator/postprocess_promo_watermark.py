#!/usr/bin/env python3
"""
去除 Seedream 宣发图右下角的「AI生成」水印。
策略：在右下角用品牌底色 #1A1614 做柔边覆盖，保留画面其余部分。
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


def remove_watermark(
    src: Path,
    out: Path,
    fill_hex: str = "#1A1614",
    region_w_ratio: float = 0.18,
    region_h_ratio: float = 0.08,
    feather: int = 40,
):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    rw = int(w * region_w_ratio)
    rh = int(h * region_h_ratio)

    # 底色层（带 alpha）
    fill = tuple(int(fill_hex[i:i+2], 16) for i in (1, 3, 5)) + (255,)
    layer = Image.new("RGBA", (w, h), fill)

    # 蒙版：右下角白色圆角矩形 + 高斯模糊做柔边
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    x0 = max(0, w - rw - feather)
    y0 = max(0, h - rh - feather)
    x1 = w
    y1 = h
    draw.rounded_rectangle([x0, y0, x1, y1], radius=feather, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather / 2))

    out_im = Image.composite(layer, im, mask)
    out_im.save(out, "PNG")
    print(f"✅ 已去水印：{out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="源 PNG 路径")
    ap.add_argument("--out", default=None, help="输出路径（默认 src 同名 _clean.png）")
    ap.add_argument("--fill", default="#1A1614", help="覆盖底色 hex")
    ap.add_argument("--w-ratio", type=float, default=0.18, help="覆盖区域宽度占比")
    ap.add_argument("--h-ratio", type=float, default=0.08, help="覆盖区域高度占比")
    ap.add_argument("--feather", type=int, default=40, help="柔边半径（像素）")
    args = ap.parse_args()

    src = Path(args.src)
    out = Path(args.out) if args.out else src.with_stem(src.stem + "_clean")
    remove_watermark(src, out, args.fill, args.w_ratio, args.h_ratio, args.feather)


if __name__ == "__main__":
    main()
