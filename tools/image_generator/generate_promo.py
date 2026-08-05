#!/usr/bin/env python3
"""
货币图鉴 · 宣发物料出图（Seedream / 火山方舟）
生成主视觉海报（竖版 9:16）+ 公众号封面（横版 16:9），自动下载并记配额。

用法：
  python3 generate_promo.py                 # 生成海报 + 封面
  python3 generate_promo.py --only poster   # 只出海报
  python3 generate_promo.py --only cover    # 只出封面
  python3 generate_promo.py --model 5.0-lite

注意：
- 默认模型 doubao-seedream-5-0-pro-260628（4.5 自 2026-08-03 起视为用满，新生成走 5.0）。
- 5.0 系列不支持 guidance_scale（脚本已规避）。
- 出图可能带平台「AI生成」水印；如需去除，运行 postprocess_motifs.py 或单独处理。
- 中文标题由模型渲染，质量不保证；若模糊可换 prompt / seed 重出。
"""
import sys, os, json, datetime, urllib.request
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from volcano_ark import VolcanoArkGenerator, SEEDREAM_50_PRO, SEEDREAM_50_LITE

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "promo"
OUT.mkdir(parents=True, exist_ok=True)

NEG = "真实纸币, 真实钞票, 真实货币照片, 国旗, 文字模糊, 低质量, 变形, 潦草手写, 二维码, 杂乱背景"

JOBS = [
    {
        "name": "promo_poster",
        "size": "9:16",
        "prompt": (
            "竖版游戏宣发主视觉海报，比例9:16。深暖近黑底色，画面中央悬浮几枚风格化几何钱币令牌"
            "——抽象圆形钱币，古铜金描边与几何同心纹样，沐浴在羊皮米白柔光中，背景隐约可见旅行收藏册"
            "轮廓与世界地图经纬线。大量负空间，高级精致。画面中上部有大号中文标题「货币图鉴」，"
            "下方副标题「对对碰」，再下方细字标语「认全的孩子，该去看看世界」。教育文化气质，"
            "扁平几何插画风格，不出现任何真实纸币或国旗。电影感、留白克制、构图居中对称。"
        ),
    },
    {
        "name": "promo_cover",
        "size": "16:9",
        "prompt": (
            "横版公众号文章封面图，比例16:9。深暖近黑底色，左侧是风格化几何钱币令牌特写"
            "——古铜金描边的抽象圆形钱币，羊皮米白柔光，右侧大片负空间。"
            "右上区域有中文标题「货币图鉴·对对碰」，下方小字「一场关于钱币的文化旅行」。"
            "扁平几何插画风，教育文化气质，无真实钞币无国旗。精致高级、留白克制。"
        ),
    },
]

MODEL_MAP = {"5.0-pro": SEEDREAM_50_PRO, "5.0-lite": SEEDREAM_50_LITE}


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["poster", "cover"], default=None)
    ap.add_argument("--model", choices=list(MODEL_MAP), default="5.0-pro")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()

    model = MODEL_MAP[args.model]
    gen = VolcanoArkGenerator()
    gen.model = model

    jobs = [j for j in JOBS if args.only is None or j["name"] == f"promo_{args.only}"]
    ok = 0
    for job in jobs:
        print(f"→ 生成 {job['name']} ({job['size']}, {model}) ...")
        results = gen.generate(
            prompt=job["prompt"],
            negative_prompt=NEG,
            size=job["size"],
            model=model,
            num_images=1,
            seed=args.seed,
        )
        if not results or not results[0].success:
            print(f"  ❌ 失败: {results[0].error_message if results else '无结果'}")
            continue
        url = results[0].image_url
        out_path = OUT / f"{job['name']}.png"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            out_path.write_bytes(data)
            print(f"  ✅ 已保存: {out_path} ({len(data)//1024} KB)")
            ok += 1
        except Exception as e:
            print(f"  ❌ 下载失败: {e}")

    # 记配额
    if ok:
        today = datetime.date.today().isoformat()
        qp = HERE / ".quota_state.json"
        state = json.loads(qp.read_text()) if qp.exists() else {}
        state.setdefault(today, {})
        state[today][model] = state[today].get(model, 0) + ok
        qp.write_text(json.dumps(state, indent=2, ensure_ascii=False))
        print(f"📊 配额已更新：{today} {model} = {state[today][model]}")
    print(f"完成：成功 {ok}/{len(jobs)}")


if __name__ == "__main__":
    main()
