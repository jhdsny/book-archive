#!/usr/bin/env python3
"""Download real printed-spine photos into assets/spines.

Aladin search results include a 3D cover. The side face is a photo at

    https://image.aladin.co.kr/product/{id//10000}/{(id//100)%100}/SpineShelf/{code}_d.jpg

and is tagged class="left_cover" in the HTML. letslook front/back scans are
not spines. Books with no SpineShelf image are left as plain text spines.

    python3 scripts/fetch_spines.py

The script rewrites only the spine: token in data/books.json.
"""

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "data" / "books.json"
DEST = ROOT / "assets" / "spines"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def norm(s):
    return re.sub(r"[^0-9a-z가-힣]", "", (s or "").lower())


def core(title):
    return re.split(r"[:：(（]", title)[0].strip()


def get(url, timeout=15):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Referer": "https://www.aladin.co.kr/",
            "Accept": "text/html,image/jpeg,*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def jpeg_size(data):
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            height = int.from_bytes(data[i + 5 : i + 7], "big")
            width = int.from_bytes(data[i + 7 : i + 9], "big")
            return width, height
        if marker in (0xD8, 0xD9):
            i += 2
            continue
        if i + 4 > len(data):
            break
        seglen = int.from_bytes(data[i + 2 : i + 4], "big")
        if seglen < 2:
            break
        i += 2 + seglen
    return None


def author_ok(author, text):
    bit = norm((author or "").split("·")[0])[:2]
    if not bit or not re.search(r"[가-힣]", author or ""):
        return True
    if not re.search(r"[가-힣]", text or ""):
        return False
    return bit in norm(text)


def titles_ok(want, got):
    a, b = norm(core(want)), norm(got)
    if not a or not b:
        return False
    if any(word in got for word in ("세트", "큰글자", "빅북")):
        return False
    if a == b:
        return True
    if a.startswith(b) or b.startswith(a):
        shorter = min(len(a), len(b))
        return shorter >= 6 or shorter == max(len(a), len(b))
    return False


def parse_boxes(html):
    boxes = []
    for chunk in html.split('class="ss_book_box"')[1:]:
        title_m = re.search(r'class="bo3"[^>]*>([^<]+)</a>', chunk)
        if not title_m:
            continue
        title = re.sub(r"\s+", " ", title_m.group(1)).strip()
        author_m = re.search(r"AuthorSearch=[^>]*>([^<]+)</a>\s*\(지은이\)", chunk)
        spine_m = re.search(
            r'src="(https://image\.aladin\.co\.kr/[^"]+/SpineShelf/[^"]+)"', chunk
        )
        boxes.append(
            {
                "title": title,
                "author": author_m.group(1).strip() if author_m else "",
                "spine": spine_m.group(1) if spine_m else "",
            }
        )
    return boxes


def search(query):
    url = "https://www.aladin.co.kr/search/wsearchresult.aspx?" + urllib.parse.urlencode(
        {"SearchTarget": "Book", "SearchWord": query}
    )
    return get(url).decode("utf-8", "replace")


def find_spine(title, author):
    queries = [title]
    bit = (author or "").split("·")[0].strip()
    if core(title) != title:
        queries.append(core(title))
    if bit:
        queries.append(f"{core(title)} {bit}")
    seen = set()
    for query in queries:
        if not query or query in seen:
            continue
        seen.add(query)
        try:
            html = search(query)
        except Exception as e:
            print(f"search failed for {title}: {type(e).__name__}", flush=True)
            return ""
        hits = []
        for box in parse_boxes(html):
            if not titles_ok(title, box["title"]):
                continue
            if not author_ok(author, box["author"] + " " + box["title"]):
                continue
            if box["spine"]:
                hits.append(box)
        if hits:
            exact = [
                h
                for h in hits
                if norm(h["title"]) in (norm(title), norm(core(title)))
            ]
            return (exact or hits)[0]["spine"]
        time.sleep(0.12)
    return ""


def spine_name(url):
    name = url.split("/")[-1].split("?")[0]
    name = re.sub(r"[^A-Za-z0-9._-]", "", name)
    if not name.lower().endswith((".jpg", ".jpeg")):
        name += ".jpg"
    return name


def set_token(book, token):
    out = [
        part
        for part in book
        if not (isinstance(part, str) and part.lower().startswith("spine:"))
    ]
    if token:
        out.append(token)
    return out


def main():
    books = json.loads(BOOKS.read_text(encoding="utf-8"))
    DEST.mkdir(parents=True, exist_ok=True)
    kept = set()
    found = 0
    out = []
    for book in books:
        title = book[1]
        author = book[2] if len(book) > 2 else ""
        url = find_spine(title, author)
        token = ""
        if url:
            try:
                data = get(url, timeout=12)
            except Exception as e:
                print(f"image failed for {title}: {type(e).__name__}", flush=True)
                data = b""
            size = jpeg_size(data)
            if size and size[1] / max(size[0], 1) >= 2.2:
                name = spine_name(url)
                path = DEST / name
                path.write_bytes(data)
                kept.add(name)
                ratio = f"{size[0] / size[1]:.5f}"
                token = f"spine:assets/spines/{name}@{ratio}"
                found += 1
                print(f"ok\t{size[0]}x{size[1]}\t{title}", flush=True)
            else:
                print(f"skip\t{title}", flush=True)
        else:
            print(f"none\t{title}", flush=True)
        out.append(set_token(book, token))
        time.sleep(0.12)
    for old in DEST.glob("*"):
        if old.is_file() and old.name not in kept:
            old.unlink()
    BOOKS.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {found}/{len(books)} spines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
