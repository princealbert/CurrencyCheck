#!/usr/bin/env python3
"""
火山方舟 Seedream 生图生成器
模型（均已验证可用）：
  默认  : doubao-seedream-4-5-251128
  扩展  : doubao-seedream-5-0-pro-260628 / doubao-seedream-5-0-260128  （探测确认 2026-08-03）
接口：POST https://ark.cn-beijing.volces.com/api/v3/images/generations
鉴权：Bearer {ARK_API_KEY}
支持尺寸：2k / 2048x2048 / 2560x1440 / 2048x1152 等（最低 3686400 px）
"""

import os
import json
import base64
import urllib.request
from typing import Optional, List, Dict
from pathlib import Path
try:
    from .base import ImageGeneratorBase, ImageResult
except ImportError:  # 独立脚本运行（非 tools.image_generator 包）时回退绝对导入
    from base import ImageGeneratorBase, ImageResult

# 尺寸映射：对外用友好名称，实际请求用 API 接受的值
SIZE_MAP = {
    "2K": "2k",
    "2k": "2k",
    "16:9": "2560x1440",
    "9:16": "1440x2560",
    "1:1": "2048x2048",
    "2048x2048": "2048x2048",
    "2560x1440": "2560x1440",
    "1440x2560": "1440x2560",
    "2048x1152": "2048x1152",  # 接近 16:9
    "1152x2048": "1152x2048",  # 接近 9:16
}


# ============ 已验证可用的 Seedream 模型 id（火山方舟，探测确认于 2026-08-03）============
# 命名规律：doubao-seedream-<主版本>-<次版本>-<日期后缀>
#   4.5 为既有基线；5.0-pro / 5.0-lite 为本次扩展。
# 两个 5.0 id 经「GET /api/v3/models 列表 + 各一次轻量生成探测」双重确认，
# 非臆造 —— 火山方舟目录中 5.0 仅两个端点：
#   doubao-seedream-5-0-pro-260628  (专业版)
#   doubao-seedream-5-0-260128     (基础 5.0 端点，即本仓库所称「lite」)
SEEDREAM_45 = "doubao-seedream-4-5-251128"
SEEDREAM_50_PRO = "doubao-seedream-5-0-pro-260628"   # 5.0 专业版
SEEDREAM_50_LITE = "doubao-seedream-5-0-260128"      # 5.0 轻量版（基础 5.0 端点）

# 模型能力差异：guidance_scale 仅 4.5 支持；5.0 系列（pro/lite）会返回 HTTP 400 拒绝该参数
GUIDANCE_SCALE_SUPPORTED = {SEEDREAM_45}
# 批处理能力：仅 4.5 支持单次 n>1；5.0 端点对 n>1 响应极慢（易超时）且实测只回 1 张，故逐张请求
BATCH_CAPABLE = {SEEDREAM_45}


class VolcanoArkGenerator(ImageGeneratorBase):
    """火山方舟 Seedream 生图生成器（HTTP 直连，无需 SDK）"""
    
    def __init__(self, api_key: str = None):
        super().__init__("VolcanoArk")
        # 必须从环境变量 ARK_API_KEY 注入你自己的火山方舟密钥（复制自 Molly 配置，
        # 已移除原硬编码默认值）。未设置则调用会失败（HTTP 401）。
        self.api_key = api_key or os.getenv('ARK_API_KEY', '')
        self.model = "doubao-seedream-4-5-251128"
        self.base_url = "https://ark.cn-beijing.volces.com/api/v3"
    
    def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        size: str = "2k",
        seed: Optional[int] = None,
        num_images: int = 1,
        watermark: bool = False,
        style_strength: Optional[float] = 9,
        detail_level: Optional[float] = None,
        guidance_scale: Optional[float] = None,
        optimize_prompt_mode: Optional[str] = None,
        ref_image: Optional[str] = None,
        model: Optional[str] = None,
        **kwargs
    ) -> List[ImageResult]:
        """
        火山方舟 Seedream 生图（支持文生图 + 图生图/参考图锁定）

        Args:
            prompt: 提示词（中英文均支持，中文效果更好）
            negative_prompt: 负面提示词（晓波 harness 必加）
            size: 尺寸，支持 "2k"/"16:9"/"9:16"/"1:1" 等，默认 "2k"
            watermark: 是否加水印，默认 False
            style_strength: 风格强度 0-10（harness: 插画 8, 人像 6, 产品 5）
            detail_level: 细节丰富度 0-10（harness: 7-9）
            guidance_scale: 文本权重 1-10（harness: 7-8）
            optimize_prompt_mode: 提示词优化模式，"standard"=质量优先
            ref_image: 参考图片路径（图生图模式）
            model: 覆盖本次请求使用的模型 id（不传则用 self.model 默认 4.5）。
                   出图管线（generate_world_tour.py）据此按配额/优先级逐请求切换 5.0/4.5。
        """
        """
        火山方舟 Seedream 生图（支持文生图 + 图生图/参考图锁定）

        Args:
            prompt: 提示词（中英文均支持，中文效果更好）
            negative_prompt: 负面提示词（晓波 harness 必加）
            size: 尺寸，支持 "2k"/"16:9"/"9:16"/"1:1" 等，默认 "2k"
            watermark: 是否加水印，默认 False
            style_strength: 风格强度 0-10（harness: 插画 8, 人像 6, 产品 5）
            detail_level: 细节丰富度 0-10（harness: 7-9）
            guidance_scale: 文本权重 1-10（harness: 7-8）
            optimize_prompt_mode: 提示词优化模式，"standard"=质量优先
            ref_image: 参考图片路径（图生图模式：传入后模型以该图为参考生成，
                      可用于锁定角色身份/风格一致性；传入本地文件路径即可）
        """
        # 转换尺寸
        api_size = SIZE_MAP.get(size, "2k")
        # 本次实际使用的模型：显式传入优先，否则回落 self.model（默认 4.5）
        used_model = model or self.model

        body = {
            "model": used_model,
            "prompt": prompt,
            "size": api_size,
            "response_format": "url",
            "n": num_images,
        }
        # ── 图生图 / 参考图锁定 ──
        if ref_image:
            ref_path = Path(ref_image)
            if ref_path.exists():
                img_bytes = ref_path.read_bytes()
                b64 = base64.b64encode(img_bytes).decode("ascii")
                # 根据图片格式选择 MIME 类型
                ext = ref_path.suffix.lower()
                mime = {
                    ".png": "image/png",
                    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                    ".webp": "image/webp",
                }.get(ext, "image/png")
                body["image"] = f"data:{mime};base64,{b64}"
            else:
                return [ImageResult(success=False,
                    error_message=f"参考图文件不存在: {ref_image}")]
        # 随机种子：锁种子复现的唯一开关。
        # ⚠ 修复（world-tour-assets §B.9 已知工具限制）：此前 seed 只在返回的
        #   ImageResult 里被回填（见下方 L~140），**从未写进请求 body** ——
        #   于是「记下 seed 下次复现」这条路整条是假的：拿同一个 seed 重跑，
        #   服务端每次仍随机，而且不报任何错。对本仓库的影响是返工只能靠重出候选。
        #   本批（环游世界 8 帧）帧 7 摩艾朝向是史实硬约束、返工概率高，
        #   能锁种子意味着「只微调 prompt、其余变量不动」的定向返工成为可能。
        if seed is not None:
            body["seed"] = seed
        # 负面提示词（晓波 harness 必加，最有效的质量提升手段）
        if negative_prompt:
            body["negative_prompt"] = negative_prompt
        # 风格强度（插画 8 / 人像 6 / 产品 5）
        if style_strength is not None:
            body["style_strength"] = style_strength
        # 细节丰富度（7-9）
        if detail_level is not None:
            body["detail_level"] = detail_level
        # 文本权重（7-8）—— 仅 4.5 支持；5.0 模型传此参数会 HTTP 400
        if guidance_scale is not None and used_model in GUIDANCE_SCALE_SUPPORTED:
            body["guidance_scale"] = guidance_scale
        # 提示词优化模式
        if optimize_prompt_mode is not None:
            body["optimize_prompt_options"] = {"mode": optimize_prompt_mode}
        if watermark:
            body["watermark"] = True
        
        try:
            req = urllib.request.Request(
                f"{self.base_url}/images/generations",
                data=json.dumps(body).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=180) as r:
                resp = json.loads(r.read().decode("utf-8"))
            
            results = []
            for img in resp.get("data", []):
                results.append(ImageResult(
                    success=True,
                    image_url=img.get("url", ""),
                    seed=seed,
                    metadata={
                        "model": used_model,
                        "size": api_size,
                    }
                ))
            
            return results if results else [ImageResult(success=False, error_message="无返回数据")]
            
        except urllib.error.HTTPError as e:
            body_content = e.read().decode("utf-8", errors="replace")
            err_msg = json.loads(body_content).get("error", {}).get("message", body_content[:200]) \
                if body_content.startswith("{") else body_content[:200]
            return [ImageResult(success=False, error_message=f"HTTP {e.code}: {err_msg}")]
        except Exception as e:
            return [ImageResult(success=False, error_message=str(e))]
    
    def check_quota(self) -> Dict:
        """查询额度（火山方舟暂不支持 API 查询）"""
        return {
            'platform': self.name,
            'note': '请前往火山方舟控制台查看额度',
            'console_url': 'https://console.volcengine.com/ark'
        }
