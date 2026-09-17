"""
生成 CodeAtlas 应用图标源图（1024x1024 PNG）

设计：Atlas Blue 圆角方块 + 白色"代码地图"图形语言 —— 节点与连线，
呼应产品定位（目录是地形，调用关系是道路）。
随后用 `npm run tauri icon` 从该 PNG 生成各平台所需尺寸（含 Windows .ico）。

运行：python scripts/make-icon.py
输出：assets/icon-source.png
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
BG_TOP = (74, 108, 247)     # #4A6CF7 主色
BG_BOTTOM = (42, 62, 150)   # 深一档，形成纵向渐变
NODE = (228, 230, 235)      # #E4E6EB 主文字色
EDGE = (124, 158, 255)      # #7C9EFF 强调色
ACCENT = (255, 255, 255)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def gradient(size: int) -> Image.Image:
    """纵向线性渐变背景"""
    img = Image.new("RGB", (1, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        px[0, y] = tuple(
            round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)
        )
    return img.resize((size, size), Image.BILINEAR)


def draw_graph(draw: ImageDraw.ImageDraw, scale: float = 1.0) -> None:
    """
    画一个示意性的调用图：3 层节点 + 连线。
    坐标以 1024 为基准手工设计，保证缩到 16px 时仍可辨认（线条足够粗、节点足够大）。
    """
    s = lambda v: v * scale  # noqa: E731
    lw = int(s(26))

    # 节点坐标（左→右体现"从底层到高层"的阅读路线）
    nodes = {
        "a": (s(300), s(690)),
        "b": (s(300), s(360)),
        "c": (s(530), s(520)),
        "d": (s(720), s(310)),
        "e": (s(720), s(720)),
    }
    edges = [("a", "c"), ("b", "c"), ("c", "d"), ("c", "e"), ("b", "e")]

    for frm, to in edges:
        draw.line([nodes[frm], nodes[to]], fill=EDGE, width=lw)

    r = s(64)
    for i, (key, (x, y)) in enumerate(nodes.items()):
        fill = ACCENT if key == "c" else NODE
        draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)
        # 中心节点加一圈光晕，突出"枢纽函数"
        if key == "c":
            draw.ellipse((x - r - 22, y - r - 22, x + r + 22, y + r + 22), outline=ACCENT, width=int(s(10)))


def main() -> None:
    base = gradient(SIZE).convert("RGBA")
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw_graph(draw, scale=1.0)

    # 轻微内缩，让图形不贴边（小尺寸下更耐看）
    composed = Image.alpha_composite(base, layer)
    mask = rounded_mask(SIZE, radius=int(SIZE * 0.22))

    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(composed, (0, 0), mask)

    target = Path(__file__).resolve().parent.parent / "assets" / "icon-source.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    out.save(target)
    # 16px 可辨识度预览
    out.resize((32, 32), Image.LANCZOS).save(target.with_name("icon-preview-32.png"))
    print(f"icon written: {target}")


if __name__ == "__main__":
    main()
