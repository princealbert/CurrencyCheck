#!/usr/bin/env python3
"""
货币图鉴 · 游戏 logo 出图（Seedream / 火山方舟）
生成：① logo_lockup（符号 + 游戏名，方形）② logo_icon（图标符号，方形）。
默认 5.0-pro；自动下载并记配额。

用法：
  python3 generate_logo.py              # 两款都出
  python3 generate_logo.py --only icon  # 只出图标
"""
import sys, os, json, datetime, urllib.request
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from volcano_ark import VolcanoArkGenerator, SEEDREAM_50_PRO, SEEDREAM_50_LITE

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "promo"
OUT.mkdir(parents=True, exist_ok=True)

NEG = "真实纸币, 真实钞票, 国旗, 文字模糊, 低质量, 变形, 潦草, 二维码, 杂乱背景, 多重阴影, 渐变杂色"

JOBS = [
    {
        "name": "logo_lockup",
        "size": "1:1",
        "prompt": (
            "游戏 logo 设计，正方形构图。深暖近黑底色（#1A1614）。左侧一个风格化几何钱币符号"
            "——抽象圆形硬币，古铜金（#C8A15A）描边与几何同心纹样，中心一枚简约的地球经纬线标记；"
            "右侧中文游戏名「货币图鉴」羊皮米白（#F2E8D5）粗体无衬线字，其下一行小字「对对碰」古铜金。"
            "扁平几何插画风，极简，标志感强，大量负空间。无真实钞币、无国旗。专业游戏品牌 logo。"
        ),
    },
    {
        "name": "logo_icon",
        "size": "1:1",
        "prompt": (
            "游戏 app 图标设计，正方形，内容居中充满。深暖近黑圆角方形底（#1A1614）。"
            "中央一枚风格化几何钱币符号——抽象圆形硬币，古铜金（#C8A15A）描边与几何同心纹样，"
            "中心一个简约的地球经纬线标记。扁平几何风，极简，边缘清晰，适合小尺寸显示。"
            "无文字，无真实钞币、无国旗。专业游戏图标。"
        ),
    },
]

MODEL_MAP = {"5.0-pro": SEEDREAM_50_PRO, "5.0-lite": SEEDREAM_50_LITE}


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["lockup", "icon"], default=None)
    ap.add_argument("--model", choices=list(MODEL_MAP), default="5.0-pro")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()

    model = MODEL_MAP[args.model]
    gen = VolcanoArkGenerator()
    gen.model = model

    jobs = [j for j in JOBS if args.only is None or j["name"] == f"logo_{args.only}"]
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
