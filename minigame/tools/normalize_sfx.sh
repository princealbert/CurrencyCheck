#!/usr/bin/env bash
# normalize_sfx.sh — SFX 全库电平归一 + 静音裁剪（离线 ffmpeg，零积分）
#
# 依据：design/audio/clear-sfx-presence-fix.md §4.2（通关序列目标表）+ 附录 A（全库体检）
#
# 每个文件三件事（文档 §4.2）：
#   1. 去前导静音（阈值 -50 dB，容差 10ms）→ 触发即响
#   2. 峰值增益到分层目标 volume=<G>dB + alimiter 兜底防削顶
#   3. 裁尾：自然衰减至 -50 dB 后再留 150ms
#   → 编码回 mp3 128k 单声道
#
# 两遍法（关键）：先无增益裁剪+降单声道到 f32 WAV 并实测峰值，再据此算精确增益，
# 只做一次 mp3 重编码。避免「立体声降混改变峰值」导致目标偏移。
#
# 用法：
#   ./normalize_sfx.sh --dry            仅打印目标/增益表，不写文件
#   ./normalize_sfx.sh --only <名字...>  只处理指定文件（试跑）
#   ./normalize_sfx.sh                  处理全库

set -euo pipefail

SFX_DIR="$(cd "$(dirname "$0")/.." && pwd)/assets/audio/sfx"

# ---- 目标真峰值表（dBFS，文件口径，已倒推总线增益）----
# 总线有效偏移：REWARD/GAMEPLAY -1.41dB | UI -4.51dB | NARRATIVE -3.35dB
#              scroll_tick 另含 volumeMul 0.55 (-5.19) | flipback 另含 0.85 (-1.41)
targets() {
  case "$1" in
    # —— C/D 组 REWARD：文档 §4.2 表逐条钉死 ——
    sfx_chapter_complete_01)      echo -4.1  ;;  # 全作唯一 P0，最高位阶
    sfx_win_session_01)           echo -5.1  ;;  # ★ 通关锚点
    sfx_region_complete_amer)     echo -5.6  ;;
    sfx_region_complete_euro)     echo -5.6  ;;
    sfx_region_complete_asia_afr) echo -5.6  ;;
    sfx_grade_unlock_01)          echo -5.6  ;;
    sfx_star_pip_01)              echo -10.0 ;;  # 三颗递升 1 dB，跨度 2 dB
    sfx_star_pip_02)              echo -9.1  ;;
    sfx_star_pip_03)              echo -8.2  ;;
    sfx_match_success_new_01)     echo -9.1  ;;  # 退到通关音下方 4 dB
    sfx_match_success_new_02)     echo -9.1  ;;
    sfx_unlock_codex_01)          echo -11.1 ;;
    sfx_streak_milestone_01)      echo -6.6  ;;  # 每日里程碑，位阶低于 region/grade
    # —— B 组 GAMEPLAY ——
    sfx_card_flip_01|sfx_card_flip_02|sfx_card_flip_03) echo -16.1 ;;  # 最高频，最低（eff -17.5）
    sfx_card_flipback_01|sfx_card_flipback_02)          echo -16.2 ;;  # 含 volumeMul .85 → eff -19.0
    sfx_match_miss_01|sfx_match_miss_02)                echo -14.1 ;;  # 柔和，非惩罚
    sfx_match_success_repeat_01|sfx_match_success_repeat_02|sfx_match_success_repeat_03) echo -12.1 ;;
    # 连击装饰层：5 级单调递升 0.5 dB，整体压在 repeat 之下
    sfx_combo_step_01) echo -15.6 ;;
    sfx_combo_step_02) echo -15.1 ;;
    sfx_combo_step_03) echo -14.6 ;;
    sfx_combo_step_04) echo -14.1 ;;
    sfx_combo_step_05) echo -13.6 ;;
    # —— A 组 UI（总线 -4.51）——
    sfx_ui_tap_01|sfx_ui_tap_02)                          echo -15.5 ;;
    sfx_ui_back_01)                                       echo -16.0 ;;
    sfx_ui_toggle_01|sfx_ui_toggle_02)                    echo -15.5 ;;  # 解除贴顶
    sfx_ui_locked_01)                                     echo -14.5 ;;  # 从 -31 救回可闻
    sfx_view_codex_open_01|sfx_view_codex_open_02)        echo -13.5 ;;
    sfx_view_detail_open_01|sfx_view_detail_open_02)      echo -14.5 ;;
    sfx_ui_scroll_tick_01|sfx_ui_scroll_tick_02|sfx_ui_scroll_tick_03) echo -16.3 ;;  # 含 .55 → eff -26 耳语级
    # —— E 组 NARRATIVE（总线 -3.35）——
    sfx_dialogue_pop_01|sfx_dialogue_pop_02) echo -14.7 ;;  # 2 变体必须等响
    sfx_hub_first_open_01)                   echo -5.7  ;;  # 一生一次，P0
    *) echo "NONE" ;;
  esac
}

peak_of() {
  ffmpeg -hide_banner -nostats -i "$1" -af astats=metadata=1:reset=0 -f null - 2>&1 \
    | awk '/Overall/{o=1} o&&/Peak level dB/{print $NF; exit}'
}

# 静音裁剪用 rms 检测（与文档 §2.2 的 silencedetect 口径一致；peak 检测下
# win_session 的 -45dB 衰减尾不会被判为静音，裁尾会整体失效）。
# ⚠ 顺序上把 volume 放在裁剪之前：这样 -50dB 阈值是「归一之后的绝对地板」，
#   全库口径统一；否则 ui_tap_01(-47dBFS) 这类极弱文件会被整段判成静音砍掉。
TRIM_LEAD="silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:start_silence=0.01"
TRIM_TAIL="areverse,silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:start_silence=0,areverse"
PAD="apad=pad_dur=0.15"
LIMIT="alimiter=level_in=1:level_out=1:limit=0.891:attack=5:release=50"
# 收敛容差 / 最大重编次数：LAME 编码会让峰值溢出 0.5~0.9dB，需闭环校正。
TOL=0.1
MAX_TRY=6

DRY=0; ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry) DRY=1; shift ;;
    --only) shift; ONLY="$*"; break ;;
    *) shift ;;
  esac
done

printf "%-34s %8s %8s %8s %8s %7s %7s\n" FILE OLD_PK TARGET GAIN NEW_PK OLD_DUR NEW_DUR

for f in $(find "$SFX_DIR" -name "*.mp3" -not -path "*_backup_wooden*" | sort); do
  base="$(basename "$f" .mp3)"
  if [[ -n "$ONLY" ]] && [[ " $ONLY " != *" $base "* ]]; then continue; fi
  tgt="$(targets "$base")"
  if [[ "$tgt" == "NONE" ]]; then
    echo "!! 无目标定义，跳过: $base" >&2
    continue
  fi

  old_pk="$(peak_of "$f")"
  old_dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"

  tmp="/tmp/nsfx_$base.wav"
  # Pass 1：仅降单声道到无损 f32 母版（不裁剪、不增益），量出降混后的真实峰值。
  # 立体声降混会改变峰值，故增益必须基于降混后的数值来算，不能用原 mp3 的峰值。
  ffmpeg -y -v error -i "$f" -ac 1 -ar 44100 -c:a pcm_f32le "$tmp"
  base_pk="$(peak_of "$tmp")"
  gain="$(awk -v t="$tgt" -v p="$base_pk" 'BEGIN{printf "%.2f", t-p}')"

  if [[ $DRY -eq 1 ]]; then
    printf "%-34s %8.2f %8s %8s %8s %7.2f %7s\n" "$base" "$old_pk" "$tgt" "$gain" "-" "$old_dur" "-"
    rm -f "$tmp"; continue
  fi

  # Pass 2：增益 → 裁前导 → 裁尾 → 补 150ms → 限制器 → mp3 128k 单声道。
  # 闭环校正：每次都从无损 WAV 母版重编，故交付文件永远只经过一次 mp3 编码。
  out="/tmp/nsfx_out_$base.mp3"
  for try in $(seq 1 $MAX_TRY); do
    ffmpeg -y -v error -i "$tmp" \
           -af "volume=${gain}dB,${TRIM_LEAD},${TRIM_TAIL},${PAD},${LIMIT}" \
           -ac 1 -c:a libmp3lame -b:a 128k "$out"
    got="$(peak_of "$out")"
    err="$(awk -v t="$tgt" -v g="$got" 'BEGIN{printf "%.2f", t-g}')"
    if awk -v e="$err" -v tol="$TOL" 'BEGIN{exit !(e<=tol && e>=-tol)}'; then break; fi
    gain="$(awk -v g="$gain" -v e="$err" 'BEGIN{printf "%.2f", g+e}')"
  done
  mv "$out" "$f"
  rm -f "$tmp"

  new_pk="$(peak_of "$f")"
  new_dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"
  printf "%-34s %8.2f %8s %8s %8.2f %7.2f %7.2f\n" "$base" "$old_pk" "$tgt" "$gain" "$new_pk" "$old_dur" "$new_dur"
done
