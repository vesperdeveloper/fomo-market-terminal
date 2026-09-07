#!/usr/bin/env python3
"""
Lift the mark off its blue plate.

The source is a flat periwinkle square with the glyph and crown on it. The
background is one colour, so the cut is a distance threshold rather than a
guess — and the ramp between the two thresholds is what keeps the
antialiased edge from turning into a hard, jagged outline with a blue halo.
"""
import sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "/Users/yaroslav/logo/fomo market.png"
OUT = sys.argv[2] if len(sys.argv) > 2 else "public/brand/mark.png"

im = Image.open(SRC).convert("RGBA")
w, h = im.size
px = im.load()

# the plate colour, taken from a corner rather than assumed
bg = px[2, 2][:3]

NEAR, FAR = 42, 110          # fully background .. fully subject
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        d = ((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2) ** 0.5
        if d <= NEAR:
            px[x, y] = (r, g, b, 0)
        elif d < FAR:
            # the edge pixels are the plate blended with the subject; undo the
            # blend rather than fading to it, or the glyph keeps a blue rim
            t = (d - NEAR) / (FAR - NEAR)
            nr = min(255, max(0, int((r - bg[0] * (1 - t)) / t))) if t > 0 else r
            ng = min(255, max(0, int((g - bg[1] * (1 - t)) / t))) if t > 0 else g
            nb = min(255, max(0, int((b - bg[2] * (1 - t)) / t))) if t > 0 else b
            px[x, y] = (nr, ng, nb, int(255 * t))

im = im.crop(im.getbbox())
im.save(OUT)
print(f"{OUT}  {im.size[0]}x{im.size[1]}  plate {bg}")
