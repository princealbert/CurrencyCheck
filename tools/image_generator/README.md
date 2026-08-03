# Image Generator - 统一生图模块

**设计目标**: 统一管理多个生图平台，简洁易用的接口

---

## 🎯 核心特性

- ✅ **统一接口** - 所有平台使用相同的调用方式
- ✅ **自动切换** - 失败时自动尝试其他平台
- ✅ **易于扩展** - 添加新平台只需继承基类
- ✅ **独立模块** - 不依赖工作流，可单独使用

---

## 🚀 快速开始

### 基础用法

```python
from tools.image_generator import generate_image

# 自动生成（自动选择最优平台）
result = generate_image("AI 科技概念图，蓝色主题，未来主义")

if result.success:
    print(f"✅ 生图成功：{result.image_url}")
else:
    print(f"❌ 失败：{result.error_message}")
```

### 指定平台

```python
from tools.image_generator import get_generator_manager

manager = get_generator_manager()

# 使用火山方舟
result = manager.generate(
    "AI 科技概念图",
    platform="volcano_ark"
)

# 使用 LiblibAI
result = manager.generate(
    "AI 科技概念图",
    platform="liblibai"
)
```

### 批量生成

```python
prompts = [
    "AI 科技概念图，蓝色主题",
    "未来主义仪表盘，简洁设计",
    "神经网络可视化，紫色渐变"
]

results = manager.generate_batch(prompts)
for i, result in enumerate(results):
    if result.success:
        print(f"图片{i}: {result.image_url}")
```

### 保存图片

```python
# 保存到本地
manager.save_image(
    result.image_url,
    "assets/images/test_001.png"
)
```

---

## 📊 已支持平台

| 平台 | 优先级 | 免费额度 | 质量 |
|------|--------|----------|------|
| **火山方舟** | 1 | 200 次 + tokens | ⭐⭐⭐⭐⭐ |
| **LiblibAI** | 2 | 100-200 分/天 | ⭐⭐⭐⭐ |

---

## 🔧 添加新平台

### 1. 创建生图器

```python
# tools/image_generator/myscale_generator.py
from .base import ImageGeneratorBase, ImageResult

class MyScaleGenerator(ImageGeneratorBase):
    def __init__(self, api_key: str = None):
        super().__init__("MyScale")
        self.api_key = api_key
    
    def generate(self, prompt: str, **kwargs):
        # 实现生图逻辑
        return [ImageResult(success=True, image_url="...")]
    
    def check_quota(self) -> Dict:
        return {'quota': 100}
```

### 2. 注册到管理器

```python
from tools.image_generator import get_generator_manager
from tools.image_generator.myscale_generator import MyScaleGenerator

manager = get_generator_manager()
manager.register("myscale", MyScaleGenerator(api_key="xxx"), priority=3)
```

---

## 💡 使用场景

### 场景 1: 内容生产工作流

```python
from tools.image_generator import generate_image

# 为文章生成配图
def generate_article_image(article_title: str):
    prompt = f"{article_title}, 概念图，简洁设计，无文字"
    result = generate_image(prompt)
    
    if result.success:
        return result.image_url
    return None
```

### 场景 2: 批量测试

```python
# 测试不同提示词效果
prompts = [
    "AI 科技，蓝色，简洁",
    "AI 科技，紫色，赛博朋克",
    "AI 科技，绿色，清新"
]

results = manager.generate_batch(prompts, platform="volcano_ark")
```

### 场景 3: 额度管理

```python
# 查询所有平台额度
quotas = manager.check_all_quotas()
for platform, quota in quotas.items():
    print(f"{platform}: {quota}")
```

---

## 📁 文件结构

```
tools/image_generator/
├── __init__.py              # 导出接口
├── base.py                  # 基类定义
├── volcano_ark.py          # 火山方舟实现
├── liblibai.py             # LiblibAI 实现
├── manager.py              # 统一管理器
└── README.md               # 使用说明
```

---

## 🔗 相关文档

- 火山方舟文档：https://www.volcengine.com/docs/82379/1541523
- LiblibAI 文档：飞书文档

---

*创建时间：2026-03-22*  
*Molly - AI 超级个体创业管理系统*
