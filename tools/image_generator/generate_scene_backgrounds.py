#!/usr/bin/env python3
"""
《货币图鉴》场景背景 & 装饰出图驱动（Seedream / 火山方舟）
========================================================
依赖：同目录 volcano_ark.py / base.py
前置：必须设置环境变量 ARK_API_KEY

用法：
    export ARK_API_KEY="ark-xxxx"
    python3 generate_scene_backgrounds.py            # 出 5 张（bg_hub/board/codex/detail + deco_globe）
    python3 generate_scene_backgrounds.py --candidates 4   # 每图 4 候选，人工挑 1（自动取第 1 张）
    python3 generate_scene_backgrounds.py --only bg_hub

资产（详见 design/art/scene-backgrounds-spec.md）：
    bg_hub / bg_board / bg_codex / bg_detail  → 9:16 直出，cover 裁到 780×1688（= 逻辑视口 390×844 @2x）
    deco_globe                              → 1k 直出，alpha bbox 裁切补方到 512×512（保留透明）

合规：场景均为装饰性「旅行/收藏」意象，无真实钞币/国旗/人脸/防伪；大陆块为抽象色块。
"""
import os
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from base import ImageResult  # noqa: E402
from volcano_ark import VolcanoArkGenerator  # noqa: E402

SCRIPT_DIR = Path(__file__).resolve().parent

NEG_BASE = (
    "no realistic banknote, no coin replica, no currency, no money, no flag, no national emblem, "
    "no text, no letters, no numbers, no watermark, no security thread, no hologram, "
    "no human face, no people, no hands, no photorealistic, no photograph, no detailed texture, "
    "no heavy contrast, no dark background, no busy clutter, no vignette burn, no lens flare, "
    "no 3d render, no realistic wood grain photo, no noise grain"
)

# 五张资产。prompt 已内联 STYLE_BASE（与 cur_*.png 同族笔法）。
SCENES = [
    dict(key="bg_hub", kind="bg",
         prompt=("Top-down flat-lay illustration of a traveler's writing desk: an open world atlas book with "
                 "abstract continent color blocks, a leather-bound collector's album with an embossed circular "
                 "badge, a few loose bookmarks and ribbon tails, several blank perforated paper stamp squares, "
                 "a small round compass, a rolled paper map tied with string, a dried leaf, strips of washi tape; "
                 "generous empty warm cream space through the vertical center of the frame; "
                 "flat geometric, minimal, clean vector-like, soft game-UI illustration, single flat color per "
                 "object with one accent stroke, gentle ambient lighting, soft long shadows, no outline noise, "
                 "game asset; warm cream #F8F5F0 base, terracotta #D89575 / sage teal #87A878 / warm gold "
                 "#E0B15E accent palette, deep ink #3A3A38 used only for the thinnest linework; "
                 "vertical 9:16 composition, calm and airy, no text, no letters, no numbers."),
         neg_extra=(", no globe in the center, no compass needle text, no map labels, no country borders, "
                    "no city names, no open book pages full of writing, no coins on the desk, no wallet, "
                    "no purse, no clock face numbers")),
    dict(key="bg_board", kind="bg",
         prompt=("Top-down illustration of a soft felt game mat laid on a warm wooden table, seen from directly "
                 "above; the felt mat occupies most of the frame with a large calm even center and softly darker "
                 "edges, a subtle stitched border runs along the mat's outline, a narrow band of smooth warm wood "
                 "is visible at the very top and very bottom edges of the frame; "
                 "flat geometric, minimal, clean vector-like, soft game-UI illustration, single flat color per "
                 "object with one accent stroke, gentle ambient lighting, soft long shadows, no outline noise, "
                 "game asset; warm cream #F8F5F0 and muted sage teal #87A878 felt, terracotta #D89575 stitching "
                 "accent, warm gold #E0B15E hairline trim; extremely low contrast, quiet, almost empty in the "
                 "center, vertical 9:16 composition, no text, no letters, no numbers."),
         neg_extra=(", no cards, no playing cards, no dice, no game pieces, no chips, no tokens, no board grid, "
                    "no pattern in the center, no fabric weave close-up, no strong wood grain lines, "
                    "no objects on the mat")),
    dict(key="bg_codex", kind="bg",
         prompt=("Front view illustration of a warm wooden bookcase interior, gentle and out of focus; "
                 "one soft horizontal shelf plank hinted near the very top edge and one near the very bottom "
                 "edge, the large middle area is a calm smooth warm wood panel with only faint soft vertical "
                 "grain suggestions; a few very subtle rounded book spines and a folded paper page tucked into "
                 "the top corners; flat geometric, minimal, clean vector-like, soft game-UI illustration, single "
                 "flat color per object with one accent stroke, gentle ambient lighting, soft long shadows, no "
                 "outline noise, game asset; warm cream #F8F5F0 page tone over warm gold #E0B15E and terracotta "
                 "#D89575 wood tones, sage teal #87A878 as a single small accent; low contrast, airy, vertical "
                 "9:16 composition, no text, no letters, no numbers."),
         neg_extra=(", no book titles, no spine labels, no shelf in the middle of the frame, no repeating "
                    "horizontal lines, no strong perspective, no ladder, no plants, no lamp, no realistic wood "
                    "grain, no dense bookshelf")),
    dict(key="bg_detail", kind="bg",
         prompt=("Soft-focus illustration of a study corner with a large stylized globe standing to one side and "
                 "a faded world map field behind it, rendered as abstract rounded continent color blocks on a "
                 "warm cream field, thin latitude and longitude arcs, everything gently blurred and low contrast; "
                 "a bright soft pool of light in the upper third of the frame, edges of the frame falling into "
                 "warm shade; flat geometric, minimal, clean vector-like, soft game-UI illustration, single flat "
                 "color per object with one accent stroke, gentle ambient lighting, soft long shadows, no outline "
                 "noise, game asset; warm cream #F8F5F0 base, sage teal #87A878 and terracotta #D89575 continent "
                 "blocks, warm gold #E0B15E meridian arcs; vertical 9:16 composition, no text, no letters, "
                 "no numbers."),
         neg_extra=(", no country borders, no country names, no city dots, no recognizable coastlines, no compass "
                    "rose text, no latitude numbers, no realistic earth photo, no satellite image, no dark navy "
                    "ocean, no bright white highlight")),
    dict(key="deco_globe", kind="deco",
         prompt=("A single stylized desk globe icon, perfectly centered, filling the frame edge to edge with "
                 "minimal margin: a sphere with a few thin latitude and longitude arcs and three or four abstract "
                 "rounded continent color blocks, sitting on a simple slim curved stand; "
                 "flat geometric, minimal, clean vector-like, soft game-UI illustration, single flat color per "
                 "object with one accent stroke, gentle ambient lighting, no outline noise, game asset; "
                 "sage teal #87A878 and terracotta #D89575 continent blocks on a warm cream #F8F5F0 sphere, "
                 "warm gold #E0B15E meridian arcs and stand; transparent background, square 1:1 composition, "
                 "no text, no letters, no numbers."),
         neg_extra=(", no country borders, no country names, no recognizable continents, no realistic earth, "
                    "no background scene, no shadow on ground, no desk, no drop shadow, no white background, "
                    "no frame")),
]

SIZE_MAP = {"bg": "9:16", "deco": "1k"}      # Seedream 直出尺寸
TARGET = {"bg": (780, 1688), "deco": (512, 512)}  # 落盘尺寸


def build_negative(s: dict) -> str:
    return f"{NEG_BASE}{s['neg_extra']}"


def cover_crop(im, tw: int, th: int):
    """等比 cover 缩放 + 居中裁切到 (tw, th)。im 为 RGB/RGBA。"""
    from PIL import Image
    w, h = im.size
    scale = max(tw / w, th / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return im.crop((left, top, left + tw, top + th))


def flatten_on_cream(im):
    """若有透明通道，合成到奶油底，避免黑边。"""
    from PIL import Image
    if im.mode != "RGBA":
        return im.convert("RGB")
    bg = Image.new("RGB", im.size, (248, 245, 240))
    bg.paste(im, mask=im.split()[3])
    return bg


def alpha_bbox_resquare(im, size: int):
    """透明 PNG：裁掉 alpha 包围盒 → 居中补成 size×size 正方（cover）。"""
    from PIL import Image
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    return cover_crop(im, size, size)


def postprocess(scene: dict, im) -> "Image.Image":
    from PIL import Image
    kind = scene["kind"]
    tw, th = TARGET[kind]
    if kind == "bg":
        im = flatten_on_cream(im)            # 落盘为不透明 RGB
        return cover_crop(im, tw, th)
    else:  # deco：保留透明，alpha bbox 补方
        return alpha_bbox_resquare(im, tw)


def download(url: str, path: str):
    import urllib.request
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "scene-gen/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        Path(path).write_bytes(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", type=int, default=1, help="每图候选数（建议 4，自动取第 1 张）")
    ap.add_argument("--only", default=None, help="只出指定 key，如 --only bg_hub")
    args = ap.parse_args()

    api_key = os.getenv("ARK_API_KEY", "")
    if not api_key:
        print("❌ 未设置 ARK_API_KEY。请先 export ARK_API_KEY=你的火山方舟密钥")
        sys.exit(1)

    gen = VolcanoArkGenerator(api_key=api_key)
    out_dir = SCRIPT_DIR / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    ok, fail = 0, 0
    for s in SCENES:
        if args.only and s["key"] != args.only:
            continue
        fname = f"{s['key']}.png"
        fpath = out_dir / fname
        prompt = s["prompt"]
        neg = build_negative(s)
        print(f"▶ {fname}  [{s['kind']} / {SIZE_MAP[s['kind']]}]")
        try:
            results = gen.generate(prompt, negative_prompt=neg,
                                   size=SIZE_MAP[s["kind"]], num_images=args.candidates)
            if not results or not results[0].success:
                print(f"  ❌ 失败：{results[0].error_message if results else '无返回'}")
                fail += 1
                continue
            from PIL import Image
            tmp = out_dir / f".{s['key']}.raw.png"
            download(results[0].image_url, str(tmp))
            im = Image.open(tmp).convert("RGBA")
            im = postprocess(s, im)
            im.save(str(fpath), "PNG")
            tmp.unlink(missing_ok=True)
            print(f"  ✅ 已保存 {fpath}  ({im.size[0]}×{im.size[1]})")
            ok += 1
        except Exception as e:
            print(f"  ❌ 异常：{e}")
            fail += 1

    print(f"\n完成：成功 {ok} / 失败 {fail}。输出目录：{out_dir}")


if __name__ == "__main__":
    main()
