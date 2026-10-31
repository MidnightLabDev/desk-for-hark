# Generates installer artwork (NSIS + WiX) from assets/icon-source.png.
from PIL import Image, ImageDraw, ImageFont
import os
src = Image.open(os.path.join(os.path.dirname(__file__), "icon-source.png")).convert("RGBA")
out = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "installer")
TOP, BOT = (0x17, 0x20, 0x48), (0x10, 0x7d, 0x7a)
def grad(w, h):
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line([(0, y), (w, y)], fill=tuple(int(TOP[i] + (BOT[i] - TOP[i]) * t) for i in range(3)))
    return im
def font(sz):
    for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
def paste_icon(im, size, xy):
    ic = src.resize((size, size), Image.LANCZOS)
    im.paste(ic, xy, ic)
def side_panel(w, h):
    im = grad(w, h)
    paste_icon(im, 96, ((w - 96) // 2, 60))
    d = ImageDraw.Draw(im)
    for i, (txt, sz, col, y) in enumerate([("Desk for Hark", 17, (255, 255, 255), 172), ("Unofficial app", 11, (190, 225, 225), 198)]):
        f = font(sz); tw = d.textlength(txt, font=f)
        d.text(((w - tw) / 2, y), txt, font=f, fill=col)
    return im
# NSIS
side_panel(164, 314).save(os.path.join(out, "nsis-sidebar.bmp"))
h = Image.new("RGB", (150, 57), "white"); paste_icon(h, 45, (150 - 51, 6)); h.save(os.path.join(out, "nsis-header.bmp"))
# WiX
b = Image.new("RGB", (493, 58), "white"); paste_icon(b, 46, (493 - 54, 6)); b.save(os.path.join(out, "wix-banner.bmp"))
dlg = Image.new("RGB", (493, 312), "white"); dlg.paste(side_panel(164, 312), (0, 0)); dlg.save(os.path.join(out, "wix-dialog.bmp"))
