#!/usr/bin/env bash
# =============================================================================
# run_assets.sh —— 「环游世界」结算视频串烧 · 资产一键生成
# -----------------------------------------------------------------------------
# 阶段1：出图（8 帧名胜风格化图）   generate_world_tour.py  →  assets/remote/worldtour/
# 阶段2：出曲（bgm_tour 旅行主题曲） gen_bgm_minimax.mjs     →   assets/audio/bgm/bgm_tour_take1..5.mp3
#
# 用法：
#   export MINIMAX_API_KEY="你的minimax密钥"   # .env 里没有这条，必须手设
#   bash run_assets.sh --force                  # --force 必填：本脚本会调用付费 API，需显式确认
#
# ⚠ 安全：本脚本两阶段都调用付费 API（ARK 出图 / Minimax 出曲）。默认拒绝执行，
#   必须显式加 --force 才真正生成，避免误触重出消耗额度。
# 说明：
#   - ARK_API_KEY 自动从仓库根 .env 读取（已存在）；若已 export 优先用环境变量。
#   - MINIMAX_API_KEY 必须手设；缺了阶段2会直接报错退出，不会误跑。
#   - gen_bgm_minimax.mjs 自带成品母带保护：hub/match/codex 文件存在则跳过，除非 --force。
#     bgm_tour 走 _takeN 候选名，永不写成品名 bgm_tour.mp3（成品由后期人工落）。
#   - 想先看 prompt 不调 API：python3 tools/image_generator/generate_world_tour.py --dry-run
# =============================================================================
set -euo pipefail

# 切到仓库根（脚本放根目录）
cd "$(cd "$(dirname "$0")" && pwd)"

# ---- 显式确认（避免误触付费 API）----
FORCE=0
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    *) echo "❌ 未知参数: $a（仅支持 --force）" >&2; exit 2 ;;
  esac
done
if [ "$FORCE" -ne 1 ]; then
  echo "⚠ run_assets.sh 会调用付费 API（ARK 出图 + Minimax 出曲）生成资产。" >&2
  echo "  默认不执行；如确要重新生成全部资产，请显式加 --force：" >&2
  echo "    bash run_assets.sh --force" >&2
  exit 2
fi

# ---- 密钥自检 ----
if [ -z "${ARK_API_KEY:-}" ] && [ -f .env ]; then
  ARK_API_KEY="$(awk -F= '/^ARK_API_KEY=/{sub(/^[^=]*=/,""); print; exit}' .env)"
  export ARK_API_KEY
fi
if [ -z "${ARK_API_KEY:-}" ]; then
  echo "❌ 未设置 ARK_API_KEY：请先 export ARK_API_KEY=... 或在仓库根 .env 配置" >&2
  exit 1
fi
if [ -z "${MINIMAX_API_KEY:-}" ]; then
  echo "❌ 未设置 MINIMAX_API_KEY：请先 export MINIMAX_API_KEY=...（.env 不含此密钥）" >&2
  exit 1
fi

echo "🔑 密钥就绪（ARK_API_KEY / MINIMAX_API_KEY）"

# ---- 阶段1：出图 ----
echo ""
echo "══════════════════════════════════════════════════════"
echo " 阶段1 / 出图：8 帧名胜风格化图（候选 3，安装到 assets/remote）"
echo "══════════════════════════════════════════════════════"
python3 tools/image_generator/generate_world_tour.py --candidates 3 --force
python3 tools/image_generator/generate_world_tour.py --install

# ---- 阶段2：出曲 ----
echo ""
echo "══════════════════════════════════════════════════════"
echo " 阶段2 / 出曲：bgm_tour 候选 5（一次性不循环，落 _takeN）"
echo "══════════════════════════════════════════════════════"
( cd minigame && MINIMAX_API_KEY="$MINIMAX_API_KEY" node tools/gen_bgm_minimax.mjs --only bgm_tour --takes 5 )

echo ""
echo "✅ 资产生成完成。"
echo "   出图：tools/image_generator/output/  +  minigame/assets/remote/worldtour/"
echo "   出曲候选：minigame/assets/audio/bgm/bgm_tour_take1..5.mp3"
echo "   下一步：把候选发阮和鸣挑片 → 后期归一落 bgm_tour.mp3 → 程基岩换 audioEvents.ts:364"
