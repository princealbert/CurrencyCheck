#!/usr/bin/env python3
"""
LiblibAI 生图生成器
"""

import hmac
from hashlib import sha1
import base64
import time
import uuid
import requests
from typing import Optional, List, Dict
from .base import ImageGeneratorBase, ImageResult


class LiblibAIGenerator(ImageGeneratorBase):
    """LiblibAI 生图生成器"""
    
    def __init__(self, access_key: str = None, secret_key: str = None):
        super().__init__("LiblibAI")
        self.access_key = access_key or "UOfRTQ1ZK0o_iNNffSWNhQ"
        self.secret_key = secret_key or "cDisYbnhVUAS0Tl3Z-O68NKVOTTw4tPm"
        self.base_url = "https://openapi.liblibai.cloud"
        self.template_uuid = "5d7e67009b344550bc1aa6ccbfa1d7f4"  # 星流 Star-3 Alpha
    
    def _make_sign(self, uri: str) -> tuple:
        """生成签名"""
        timestamp = str(int(time.time() * 1000))
        signature_nonce = str(uuid.uuid4())
        content = '&'.join((uri, timestamp, signature_nonce))
        digest = hmac.new(self.secret_key.encode(), content.encode(), sha1).digest()
        sign = base64.urlsafe_b64encode(digest).rstrip(b'=').decode()
        return sign, timestamp, signature_nonce
    
    def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        size: str = "landscape",  # landscape, portrait, square
        seed: Optional[int] = None,
        num_images: int = 1,
        steps: int = 30,
        **kwargs
    ) -> List[ImageResult]:
        """
        LiblibAI 生图（星流 Star-3）
        """
        try:
            # Step 1: 创建生图任务
            uri = "/api/generate/webui/text2img/ultra"
            signature, timestamp, nonce = self._make_sign(uri)
            
            params = {
                "AccessKey": self.access_key,
                "Signature": signature,
                "Timestamp": timestamp,
                "SignatureNonce": nonce
            }
            
            payload = {
                "templateUuid": self.template_uuid,
                "generateParams": {
                    "prompt": prompt,
                    "aspectRatio": size,
                    "imgCount": num_images,
                    "steps": steps
                }
            }
            
            resp = requests.post(
                f"{self.base_url}{uri}",
                headers={"Content-Type": "application/json"},
                params=params,
                json=payload,
                timeout=60
            )
            
            if resp.status_code != 200:
                return [ImageResult(success=False, error_message=f"HTTP {resp.status_code}")]
            
            result = resp.json()
            if result.get('code') != 0:
                return [ImageResult(success=False, error_message=result.get('msg', 'Unknown'))]
            
            generate_uuid = result['data']['generateUuid']
            
            # Step 2: 等待生成完成
            time.sleep(30)
            
            # Step 3: 查询结果
            status_uri = "/api/generate/webui/status"
            sign, ts, nc = self._make_sign(status_uri)
            
            status_params = {
                "AccessKey": self.access_key,
                "Signature": sign,
                "Timestamp": ts,
                "SignatureNonce": nc
            }
            
            status_payload = {"generateUuid": generate_uuid}
            
            status_resp = requests.post(
                f"{self.base_url}{status_uri}",
                headers={"Content-Type": "application/json"},
                params=status_params,
                json=status_payload,
                timeout=30
            )
            
            if status_resp.status_code == 200:
                status_result = status_resp.json()
                if status_result.get('code') == 0:
                    data = status_result.get('data', {})
                    images = data.get('images', [])
                    
                    results = []
                    for img in images:
                        results.append(ImageResult(
                            success=True,
                            image_url=img.get('imageUrl'),
                            seed=img.get('seed'),
                            cost=data.get('pointsCost'),
                            metadata={
                                'model': '星流 Star-3',
                                'balance': data.get('accountBalance'),
                                'audit_status': img.get('auditStatus')
                            }
                        ))
                    
                    return results if results else [ImageResult(success=False, error_message="无图片返回")]
            
            return [ImageResult(success=False, error_message="查询失败")]
            
        except Exception as e:
            return [ImageResult(success=False, error_message=str(e))]
    
    def check_quota(self) -> Dict:
        """查询额度（通过生图响应返回）"""
        return {
            'platform': self.name,
            'note': '额度在生图响应中返回',
            'daily_limit': '100-200 积分'
        }
