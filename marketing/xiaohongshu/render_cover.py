from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).parent
ASSETS = ROOT / "assets"
FONT = Path(
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font8/"
    "86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData/PingFang.ttc"
)


def font(size: int, index: int = 11) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size=size, index=index)


base = Image.open(ASSETS / "cover-ai-interview-base.png").convert("RGBA")
canvas = Image.new("RGBA", base.size, (0, 0, 0, 0))
canvas.alpha_composite(base)
overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)

# Preserve the image's open portal and monitor; only add a low-contrast reading zone.
draw.rounded_rectangle((40, 42, 812, 472), radius=46, fill=(2, 9, 27, 178))
draw.rounded_rectangle((72, 72, 390, 124), radius=26, fill=(22, 119, 255, 255))
draw.text((101, 84), "OPEN SOURCE PROJECT", fill="#FFFFFF", font=font(23, 7))
draw.text((74, 165), "面试前", fill="#F4F8FF", font=font(74))
draw.text((74, 263), "先练到不慌", fill="#F4F8FF", font=font(74))
draw.ellipse((78, 375, 98, 395), fill="#25E9B4")
draw.text((116, 365), "AI 模拟面试 · 实时追问 · 复盘报告", fill="#D8E8FF", font=font(28, 7))

# A restrained source line gives the static post a directly usable repository address.
draw.rounded_rectangle((52, 1305, 713, 1361), radius=28, fill=(5, 27, 62, 218))
draw.text((80, 1319), "github.com/zifenglu443-star/ai-interview", fill="#D1E2FF", font=font(24, 7))

canvas.alpha_composite(overlay)
canvas.convert("RGB").save(ROOT / "AI模拟面试开源封面.png", quality=96)
