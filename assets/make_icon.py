"""Generates the original Desk for Hark app icon (not Hark's logo).

Motif: a dot with three listening arcs ("hark" = listen) on a
midnight-to-teal rounded square. Run: python3 assets/make_icon.py
"""
from PIL import Image, ImageDraw, ImageFilter

S = 1024
SS = 4  # supersample
W = S * SS


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


top, bottom = (24, 18, 64), (14, 140, 132)
g = 256
small = Image.new("RGB", (g, g))
px = small.load()
for y in range(g):
    for x in range(g):
        t = min(1.0, max(0.0, (y * 0.8 + (g - x) * 0.6) / (g * 1.4)))
        px[x, y] = lerp(top, bottom, t)
grad = small.resize((W, W), Image.BICUBIC)

mask = Image.new("L", (W, W), 0)
md = ImageDraw.Draw(mask)
pad = int(W * 0.06)
md.rounded_rectangle([pad, pad, W - pad, W - pad], radius=int(W * 0.22), fill=255)

icon = Image.new("RGBA", (W, W), (0, 0, 0, 0))
icon.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(icon)
cx, cy = int(W * 0.36), int(W * 0.5)
white = (255, 255, 255, 255)
r0 = int(W * 0.075)
d.ellipse([cx - r0, cy - r0, cx + r0, cy + r0], fill=white)
stroke = int(W * 0.055)
for i, r in enumerate([0.19, 0.30, 0.41]):
    rr = int(W * r)
    alpha = [255, 220, 170][i]
    d.arc([cx - rr, cy - rr, cx + rr, cy + rr], start=-50, end=50,
          fill=(255, 255, 255, alpha), width=stroke)
    # round caps
    import math
    for ang in (-50, 50):
        a = math.radians(ang)
        px = cx + (rr - stroke / 2) * math.cos(a)
        py = cy + (rr - stroke / 2) * math.sin(a)
        h = stroke / 2
        d.ellipse([px - h, py - h, px + h, py + h], fill=(255, 255, 255, alpha))

out = icon.resize((S, S), Image.LANCZOS)
out.save("assets/icon-source.png")
print("wrote assets/icon-source.png")
