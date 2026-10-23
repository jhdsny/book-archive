#!/usr/bin/env python3
"""Store a spine color from each Kakao cover in data/books.json.

Downloads the thumbnail, takes a dominant non-white color from the left edge
(or the whole cover if that edge is blank), and clamps it to a mid-dark range
so cream title type stays readable. Books with no cover are left unchanged and
the page falls back to its palette.

    python3 scripts/cover_colors.py
"""

import json
import re
import sys
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "data" / "books.json"
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
CREAM = (246, 237, 217)


def rel_lum(rgb):
    def f(c):
        s = c / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = (f(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


CREAM_L = rel_lum(CREAM)


def contrast(rgb):
    return (CREAM_L + 0.05) / (rel_lum(rgb) + 0.05)


def rgb_to_hsl(r, g, b):
    r, g, b = r / 255, g / 255, b / 255
    hi, lo = max(r, g, b), min(r, g, b)
    light = (hi + lo) / 2
    if hi == lo:
        return 0.0, 0.0, light
    d = hi - lo
    sat = d / (2 - hi - lo) if light > 0.5 else d / (hi + lo)
    if hi == r:
        hue = ((g - b) / d) % 6
    elif hi == g:
        hue = (b - r) / d + 2
    else:
        hue = (r - g) / d + 4
    return hue / 6, sat, light


def hsl_to_rgb(h, s, light):
    def chan(p, q, t):
        t = t % 1
        if t < 1 / 6:
            v = p + (q - p) * 6 * t
        elif t < 1 / 2:
            v = q
        elif t < 2 / 3:
            v = p + (q - p) * (2 / 3 - t) * 6
        else:
            v = p
        return round(max(0, min(255, v * 255)))

    if s == 0:
        v = round(light * 255)
        return v, v, v
    q = light * (1 + s) if light < 0.5 else light + s - light * s
    p = 2 * light - q
    return chan(p, q, h + 1 / 3), chan(p, q, h), chan(p, q, h - 1 / 3)


def clamp_mid_dark(rgb):
    """Keep the hue, and hold lightness where cream type still clears it."""
    h, s, light = rgb_to_hsl(*rgb)
    if s < 0.12:
        s = 0.12
    s = min(s, 0.62)
    light = min(max(light, 0.24), 0.42)
    color = hsl_to_rgb(h, s, light)
    while contrast(color) < 4.5 and light > 0.16:
        light -= 0.015
        color = hsl_to_rgb(h, s, light)
    return color


def is_white(px):
    r, g, b = px[:3]
    return r > 232 and g > 232 and b > 232


def dominant(im):
    im = im.convert("RGB")
    w, h = im.size
    regions = [im.crop((0, 0, max(1, int(w * 0.22)), h)), im]
    for region in regions:
        region.thumbnail((36, 52))
        pixels = [px for px in region.get_flattened_data() if not is_white(px)]
        if len(pixels) < 12:
            continue
        buckets = {}
        for r, g, b in pixels:
            key = (r // 18 * 18, g // 18 * 18, b // 18 * 18)
            buckets.setdefault(key, []).append((r, g, b))
        ranked = sorted(buckets.items(), key=lambda item: len(item[1]), reverse=True)[:6]
        best = None
        best_score = -1
        for _key, group in ranked:
            n = len(group)
            avg = tuple(sum(p[i] for p in group) / n for i in range(3))
            sat = (max(avg) - min(avg)) / 255
            score = n * (0.4 + sat)
            if score > best_score:
                best_score = score
                best = avg
        if best:
            return clamp_mid_dark(tuple(round(c) for c in best))
    return None


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "book-archive"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = resp.read()
    return dominant(Image.open(BytesIO(data)))


def tail(book):
    contents = ""
    color = ""
    for part in book[4:]:
        if isinstance(part, str) and HEX.match(part.strip()):
            color = part.strip().lower()
        elif isinstance(part, str) and part.strip() and not contents:
            contents = part
    return contents, color


def pack(head, contents, color):
    book = list(head[:4])
    while len(book) < 4:
        book.append("")
    if contents or color:
        book.append(contents or "")
    if color:
        book.append(color)
    return book


def color_of(book):
    url = book[3] if len(book) > 3 else ""
    if not url:
        return None
    try:
        return fetch(url)
    except Exception as e:
        print(f"cover failed for {book[1]}: {e}", file=sys.stderr)
        return None


def hex_of(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def main():
    books = json.loads(BOOKS.read_text(encoding="utf-8"))
    with ThreadPoolExecutor(max_workers=8) as pool:
        found = list(pool.map(color_of, books))
    colored = 0
    missed = 0
    out = []
    for book, rgb in zip(books, found):
        contents, old = tail(book)
        if rgb:
            color = hex_of(rgb)
            colored += 1
        elif book[3] if len(book) > 3 else "":
            color = old
            missed += 1
        else:
            color = ""
        out.append(pack(book, contents, color))
    BOOKS.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {BOOKS} ({colored} colors, {missed} covers unread)")
    return 0 if missed == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
