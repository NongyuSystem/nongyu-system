#!/usr/bin/env python3
"""教务验证码识别 worker（常驻进程，行协议）

协议：每行一个 base64 PNG → 每行输出一个识别结果（4 位数字，或 ERR:xxx）。
模型只加载一次，避免每次识别都付启动成本。

依赖：pip install ddddocr pillow
"""

import base64
import io
import sys

import ddddocr
from PIL import Image, ImageFilter

# 只认数字：教务验证码实测为 4 位纯数字，限制字符集能去掉「把 0 认成 o」这类噪声
_ocr = ddddocr.DdddOcr(show_ad=False)
_ocr.set_ranges("0123456789")


def recognize(base64_png: str) -> str:
    raw = base64.b64decode(base64_png)
    image = Image.open(io.BytesIO(raw)).convert("L")
    # 中值滤波去掉干扰线：同批样本上准确率从 3/6 提升到 5/6
    image = image.filter(ImageFilter.MedianFilter(3))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return _ocr.classification(buffer.getvalue())


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            print(recognize(line), flush=True)
        except Exception as exc:  # noqa: BLE001 - worker 不能因单张图崩掉
            print(f"ERR:{exc}", flush=True)


if __name__ == "__main__":
    main()
