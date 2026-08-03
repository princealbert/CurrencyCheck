#!/usr/bin/env python3
"""
生图模块基类
定义统一接口，所有生图平台都继承此类
"""

from abc import ABC, abstractmethod
from typing import Optional, List, Dict
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ImageResult:
    """生图结果"""
    success: bool
    image_url: Optional[str] = None
    image_path: Optional[str] = None  # 本地保存路径
    seed: Optional[int] = None
    cost: Optional[float] = None  # 消耗积分/金额
    error_message: Optional[str] = None
    metadata: Optional[Dict] = None


class ImageGeneratorBase(ABC):
    """生图生成器基类"""
    
    def __init__(self, name: str):
        self.name = name
        self.api_key = None
        self.base_url = None
    
    @abstractmethod
    def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        size: str = "1024x1024",
        seed: Optional[int] = None,
        num_images: int = 1,
        **kwargs
    ) -> List[ImageResult]:
        """
        生成图片
        
        Args:
            prompt: 正向提示词
            negative_prompt: 负向提示词
            size: 图片尺寸 (如 "1024x1024", "1280x720")
            seed: 随机种子
            num_images: 生成数量
            **kwargs: 其他平台特定参数
        
        Returns:
            List[ImageResult]: 生图结果列表
        """
        pass
    
    @abstractmethod
    def check_quota(self) -> Dict:
        """
        查询剩余额度
        
        Returns:
            Dict: 额度信息
        """
        pass
    
    def save_image(self, image_url: str, save_path: str) -> bool:
        """
        保存图片到本地
        
        Args:
            image_url: 图片 URL
            save_path: 保存路径
        
        Returns:
            bool: 是否成功
        """
        import requests
        
        try:
            resp = requests.get(image_url, timeout=60)
            if resp.status_code == 200:
                Path(save_path).parent.mkdir(parents=True, exist_ok=True)
                with open(save_path, 'wb') as f:
                    f.write(resp.content)
                return True
            return False
        except Exception as e:
            print(f"❌ 保存图片失败：{e}")
            return False
    
    def __str__(self):
        return f"{self.name} Generator"
