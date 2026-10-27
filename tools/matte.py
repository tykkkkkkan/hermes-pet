"""把 AI 画出来的假棋盘背景抠成真透明。

思路：棋盘是两种浅灰交替（约 251 与 229），从四边向内做 flood fill，
只吃掉与边缘连通的浅灰区域，角色内部的白色衣服因为有深色描边隔着，不会被吃掉。
"""
import sys
from collections import deque
from PIL import Image, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else r"D:\01-项目\hermes-pet\assets\Take_ONLY_the_small_chibi_girl_2026-10-27T13-12-33.png"
DST = sys.argv[2] if len(sys.argv) > 2 else r"D:\01-项目\hermes-pet\assets\hermes-chibi.png"

im = Image.open(SRC).convert("RGB")
w, h = im.size
px = im.load()

# 1) 标记候选背景像素：够亮 + 几乎无彩度
cand = bytearray(w * h)
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        if min(r, g, b) >= 210 and (max(r, g, b) - min(r, g, b)) <= 14:
            cand[y * w + x] = 1

# 2) 从四边 flood fill
bg = bytearray(w * h)
q = deque()
for x in range(w):
    for y in (0, h - 1):
        i = y * w + x
        if cand[i] and not bg[i]:
            bg[i] = 1
            q.append((x, y))
for y in range(h):
    for x in (0, w - 1):
        i = y * w + x
        if cand[i] and not bg[i]:
            bg[i] = 1
            q.append((x, y))
while q:
    x, y = q.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h:
            i = ny * w + nx
            if cand[i] and not bg[i]:
                bg[i] = 1
                q.append((nx, ny))

# 3) 生成 alpha：背景 0，前景 255
alpha = Image.new("L", (w, h), 255)
ap = alpha.load()
removed = 0
for i in range(w * h):
    if bg[i]:
        ap[i % w, i // w] = 0
        removed += 1

# 4) 边缘羽化：轻微模糊后收缩 1px，去掉小灰边
alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))
alpha = alpha.point(lambda v: 0 if v < 40 else int((v - 40) * 255 / 215))

out = im.convert("RGBA")
out.putalpha(alpha)

# 5) 裁到内容边界，留 12px 边距
bbox = out.getbbox()
if bbox:
    x0, y0, x1, y1 = bbox
    m = 12
    out = out.crop((max(0, x0 - m), max(0, y0 - m), min(w, x1 + m), min(h, y1 + m)))

out.save(DST)
print(f"src {w}x{h} -> out {out.size[0]}x{out.size[1]}  removed_px={removed} ({removed / (w * h):.1%})")
print("saved:", DST)
