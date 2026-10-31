"""Tray icon variants + unread badge overlay. Run: python3 assets/make_tray_icons.py"""
import math, os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src-tauri", "icons", "tray")
os.makedirs(OUT, exist_ok=True)
S, SS = 32, 8
W = S * SS


def glyph(color):
    im = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = int(W * 0.30), int(W * 0.5)
    r0 = int(W * 0.10)
    d.ellipse([cx - r0, cy - r0, cx + r0, cy + r0], fill=color)
    stroke = int(W * 0.085)
    for r in (0.25, 0.42, 0.59):
        rr = int(W * r)
        d.arc([cx - rr, cy - rr, cx + rr, cy + rr], start=-52, end=52, fill=color, width=stroke)
        for ang in (-52, 52):
            a = math.radians(ang)
            px = cx + (rr - stroke / 2) * math.cos(a)
            py = cy + (rr - stroke / 2) * math.sin(a)
            h = stroke / 2
            d.ellipse([px - h, py - h, px + h, py + h], fill=color)
    return im


def badge(im):
    im = im.copy()
    d = ImageDraw.Draw(im)
    r = int(W * 0.17)
    cx, cy = W - r - int(W * 0.02), r + int(W * 0.02)
    d.ellipse([cx - r - SS * 2, cy - r - SS * 2, cx + r + SS * 2, cy + r + SS * 2], fill=(0, 0, 0, 0))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(229, 57, 53, 255))
    return im


color = Image.open(os.path.join(HERE, "icon-source.png")).convert("RGBA").resize((W, W), Image.LANCZOS)
variants = {"color": color, "light": glyph((255, 255, 255, 255)), "dark": glyph((20, 20, 24, 255))}
for name, im in variants.items():
    im.resize((S, S), Image.LANCZOS).save(os.path.join(OUT, f"{name}.png"))
    badge(im).resize((S, S), Image.LANCZOS).save(os.path.join(OUT, f"{name}-badge.png"))

dot = Image.new("RGBA", (16 * SS, 16 * SS), (0, 0, 0, 0))
ImageDraw.Draw(dot).ellipse([SS, SS, 15 * SS, 15 * SS], fill=(229, 57, 53, 255))
dot.resize((16, 16), Image.LANCZOS).save(os.path.join(OUT, "overlay-dot.png"))
print("wrote", sorted(os.listdir(OUT)))
