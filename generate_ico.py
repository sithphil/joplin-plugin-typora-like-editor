#!/usr/bin/env python3
"""
图片转 ICO 图标生成工具

使用方法:
    python generate_ico.py input.png

输出:
    生成多个 ICO 文件，每个文件包含单一尺寸：
    - filename_32.ico (32x32)
    - filename_64.ico (64x64)
    - filename_128.ico (128x128)
    - filename_256.ico (256x256)
"""

import sys
import os
from PIL import Image


def generate_ico(input_path, output_path=None):
    """
    将图片转换为包含多种尺寸的 ICO 文件

    Args:
        input_path: 输入图片路径
        output_path: 输出 ICO 文件路径（可选），如果提供则作为基础名称
    """
    # 检查输入文件是否存在
    if not os.path.exists(input_path):
        print(f"错误: 文件不存在: {input_path}")
        return False

    # 确定基础输出路径
    if output_path:
        base_name = os.path.splitext(output_path)[0]
    else:
        base_name = os.path.splitext(input_path)[0]

    try:
        # 打开原始图片
        with Image.open(input_path) as img:
            # 转换为 RGBA 模式（支持透明度）
            if img.mode != 'RGBA':
                img = img.convert('RGBA')

            # 定义目标尺寸
            sizes = [(32, 32), (64, 64), (128, 128), (256, 256)]

            # 调整图片到最大尺寸
            max_size = 256
            if img.size[0] != max_size or img.size[1] != max_size:
                print(f"调整图片尺寸: {img.size} -> ({max_size}, {max_size})")
                img = img.resize((max_size, max_size), Image.LANCZOS)

            # 为每个尺寸生成单独的 ICO 文件
            for size in sizes:
                resized = img.resize(size, Image.LANCZOS)
                output_file = f"{base_name}_{size[0]}.ico"
                resized.save(output_file, format='ICO', sizes=[size])
                print(f"生成: {output_file} ({size[0]}x{size[1]})")

            print(f"\n成功生成 {len(sizes)} 个 ICO 文件")
            return True

    except Exception as e:
        print(f"错误: {e}")
        return False


def main():
    """命令行入口"""
    if len(sys.argv) < 2:
        print("用法: python generate_ico.py <input_image> [output_base]")
        print("\n示例:")
        print("  python generate_ico.py logo.png")
        print("  输出: logo_32.ico, logo_64.ico, logo_128.ico, logo_256.ico")
        print("\n  python generate_ico.py logo.png myicon")
        print("  输出: myicon_32.ico, myicon_64.ico, myicon_128.ico, myicon_256.ico")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    success = generate_ico(input_path, output_path)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
