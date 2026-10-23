#!/usr/bin/env python3
"""Fill Kakao book-search blurbs into data/books.json.

Each book is [분류, 제목, 저자, 표지] and, when this script has run, a fifth
string: the Kakao `contents` field. The detail card shows that string and
hides the section when it is empty.

The Kakao REST API key is not stored in the repo. Pass it in the environment:

    KAKAO_REST_API_KEY=... python3 scripts/fetch_blurbs.py

KAKAO_API_KEY is accepted as an alias. Without a key the file is left as it is.
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "data" / "books.json"
API = "https://dapi.kakao.com/v3/search/book"


def norm(s):
    return re.sub(r"[^0-9a-z가-힣]", "", (s or "").lower())


def core(title):
    return re.split(r"[:：(（]", title)[0].strip()


def plain(s):
    text = re.sub(r"<[^>]+>", "", s or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def key():
    return os.environ.get("KAKAO_REST_API_KEY") or os.environ.get("KAKAO_API_KEY") or ""


def search(token, query, target="title"):
    params = {"query": query, "size": "5"}
    # An empty target searches every field, so a title plus the author can
    # still find the right edition when the title alone is shared.
    if target:
        params["target"] = target
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={"Authorization": "KakaoAK " + token, "User-Agent": "book-archive"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def title_score(doc, title):
    got = plain(doc.get("title"))
    ng, nq = norm(got), norm(title)
    nc = norm(core(title))
    if ng and ng == nq:
        return 5
    if nq and (nq in ng or ng in nq):
        return 3
    if nc and len(nc) >= 4 and nc in ng:
        return 2
    return 0


def author_agrees(doc, author):
    """True or False when both names are Korean. None when they cannot be compared."""
    our = norm((author or "").split("·")[0])
    listed = " ".join(doc.get("authors") or [])
    if not our or not re.search(r"[가-힣]", author or "") or not re.search(r"[가-힣]", listed):
        return None
    return our[:2] in norm(listed)


def lookup(token, title, author):
    """Return (contents, document). None means the search itself failed."""
    pool = []
    failed = False

    def take(query, target="title"):
        nonlocal failed
        try:
            data = search(token, query, target)
        except Exception as e:
            print(f"search failed for {title}: {e}", file=sys.stderr)
            failed = True
            return
        for doc in data.get("documents") or []:
            ts = title_score(doc, title)
            if ts < 2:
                continue
            flag = author_agrees(doc, author)
            if flag is False:
                continue
            pool.append((ts + (2 if flag else 0), doc))

    for query in (title, core(title)):
        if not query:
            continue
        take(query)
        if pool and max(item[0] for item in pool) >= 5:
            break
        time.sleep(0.15)
    author_bit = (author or "").split("·")[0].strip()
    if not pool and author_bit and not failed:
        take(f"{core(title)} {author_bit}", target="")
    if failed and not pool:
        return None
    if not pool:
        return "", None
    _s, doc = max(pool, key=lambda item: item[0])
    return plain(doc.get("contents")), doc


HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


KDC_MARK = re.compile(r"^kdc:(.+)$", re.I)


def tail(book):
    contents = ""
    color = ""
    kdc = ""
    for part in book[4:]:
        if not isinstance(part, str):
            continue
        text = part.strip()
        marked = KDC_MARK.match(text)
        if HEX.match(text):
            color = text.lower()
        elif marked:
            kdc = marked.group(1).strip()
        elif text and not contents:
            contents = part
    return contents, color, kdc


def pack(book, contents, color, kdc=""):
    head = list(book[:4])
    while len(head) < 4:
        head.append("")
    if contents or color or kdc:
        head.append(contents or "")
    if color:
        head.append(color)
    if kdc:
        head.append("kdc:" + kdc)
    return head


def isbn_of(doc):
    parts = []
    for part in str(doc.get("isbn") or "").replace("-", " ").split():
        digits = re.sub(r"[^0-9Xx]", "", part)
        if digits:
            parts.append(digits)
    for digits in parts:
        if len(digits) == 13 and digits[:3] in ("978", "979"):
            return digits
    for digits in parts:
        if len(digits) in (10, 13):
            return digits
    return ""


def main():
    token = key()
    if not token:
        print(
            "KAKAO_REST_API_KEY is not set, so data/books.json was not changed.",
            file=sys.stderr,
        )
        return 1
    books = json.loads(BOOKS.read_text(encoding="utf-8"))
    found = 0
    new_covers = 0
    new_kdc = 0
    out = []
    color_mod = None
    refresh_mod = None
    for book in books:
        title, author = book[1], book[2] if len(book) > 2 else ""
        old, color, kdc = tail(book)
        cover = book[3] if len(book) > 3 else ""
        got = lookup(token, title, author)
        if got is None:
            text, doc = old, None
        else:
            text, doc = got
        if doc and not cover:
            thumb = (doc.get("thumbnail") or "").strip()
            if thumb.startswith("http"):
                cover = thumb
                new_covers += 1
        if doc and not kdc:
            isbn = isbn_of(doc)
            if isbn:
                if refresh_mod is None:
                    import refresh as refresh_mod
                try:
                    found_call = refresh_mod.fetch_nlk(title, author, isbn)
                except Exception as e:
                    print(f"kdc lookup failed for {title}: {e}", file=sys.stderr)
                    found_call = ""
                if refresh_mod.class_number(found_call):
                    kdc = found_call
                    new_kdc += 1
        if cover and not color:
            if color_mod is None:
                import cover_colors as color_mod
            try:
                rgb = color_mod.fetch(cover)
            except Exception as e:
                print(f"cover color failed for {title}: {e}", file=sys.stderr)
                rgb = None
            if rgb:
                color = color_mod.hex_of(rgb)
        if text:
            found += 1
        head = list(book[:4])
        while len(head) < 4:
            head.append("")
        head[3] = cover
        out.append(pack(head, text, color, kdc))
        time.sleep(0.12)
    BOOKS.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {BOOKS} ({found} blurbs, {new_covers} new covers, {new_kdc} new call numbers)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
