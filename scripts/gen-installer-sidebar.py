#!/usr/bin/env python3
"""Generate dark Liquid Glass installer sidebar (164x314) with logo + 'OpenClaw PC'."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math

W, H = 164, 314
BG_TOP = (11, 16, 32)      # #0B1020
BG_BOT = (18, 26, 52)      # slightly lighter bottom
ACCENT = (10, 132, 255)    # #0A84FF

img = Image.new('RGB', (W, H))
d = ImageDraw.Draw(img)

# vertical gradient
for y in range(H):
    t = y / (H - 1)
    r = int(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t)
    g = int(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t)
    b = int(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t)
    d.line([(0, y), (W, y)], fill=(r, g, b))

# glowing accent blob (top-left-ish)
blob = Image.new('RGB', (W, H), (0, 0, 0))
bd = ImageDraw.Draw(blob)
bd.ellipse([-60, -70, 150, 140], fill=ACCENT + (255,))
blob = blob.filter(ImageFilter.GaussianBlur(38))
img = Image.blend(img, blob, 0.45)

# subtle second blob bottom-right (purple-ish)
blob2 = Image.new('RGB', (W, H), (0, 0, 0))
bd2 = ImageDraw.Draw(blob2)
bd2.ellipse([40, 210, 210, 380], fill=(191, 90, 242, 255))
blob2 = blob2.filter(ImageFilter.GaussianBlur(42))
img = Image.blend(img, blob2, 0.30)

d = ImageDraw.Draw(img)

# logo (from icon.ico, 256px) -> ~118px, centered, y ~ 78
ico = Image.open('resources/icon.ico').convert('RGBA')
logo = ico.resize((118, 118), Image.LANCZOS)
img.paste(logo, ((W - 118) // 2, 78), logo)

# border accent line under logo
d.rounded_rectangle([28, 212, W - 28, 214], radius=1, fill=(255, 255, 255, 40))

# 'OpenClaw PC' title
font_title = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 23)
title = 'OpenClaw PC'
tw = d.textlength(title, font=font_title)
d.text(((W - tw) / 2, 230), title, fill=(242, 244, 248, 255), font=font_title)

# subtitle
font_sub = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 11)
sub = 'Desktop Gateway'
sw = d.textlength(sub, font=font_sub)
d.text(((W - sw) / 2, 262), sub, fill=(154, 163, 178, 255), font=font_sub)

img.save('resources/installer/installer-sidebar.bmp', 'BMP')
print('saved', img.size)
