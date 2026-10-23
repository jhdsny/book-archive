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


def search(token, query):
    url = API + "?" + urllib.parse.urlencode({"query": query, "target": "title", "size": "5"})
    req = urllib.request.Request(
        url,
        headers={"Authorization": "KakaoAK " + token, "User-Agent": "book-archive"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def score(doc, title, author):
    got = plain(doc.get("title"))
    ng, nq = norm(got), norm(title)
    nc = norm(core(title))
    if ng and ng == nq:
        s = 5
    elif nq and (nq in ng or ng in nq):
        s = 3
    elif nc and nc in ng:
        s = 2
    else:
        s = 0
    a1 = norm(author.split("·")[0])[:2]
    names = norm("".join(doc.get("authors") or []))
    if a1 and a1 in names:
        s += 2
    return s


def lookup(token, title, author):
    best = None
    best_s = 0
    for query in (title, core(title)):
        if not query:
            continue
        try:
            data = search(token, query)
        except Exception as e:
            print(f"search failed for {title}: {e}", file=sys.stderr)
            return None
        for doc in data.get("documents") or []:
            s = score(doc, title, author)
            if s > best_s:
                best_s = s
                best = doc
        if best_s >= 5:
            break
        time.sleep(0.15)
    if best_s < 2 or not best:
        return ""
    return plain(best.get("contents"))


HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def tail(book):
    contents = ""
    color = ""
    for part in book[4:]:
        if isinstance(part, str) and HEX.match(part.strip()):
            color = part.strip().lower()
        elif isinstance(part, str) and part.strip() and not contents:
            contents = part
    return contents, color


def pack(book, contents, color):
    head = list(book[:4])
    while len(head) < 4:
        head.append("")
    if contents or color:
        head.append(contents or "")
    if color:
        head.append(color)
    return head


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
    out = []
    for book in books:
        title, author = book[1], book[2] if len(book) > 2 else ""
        old, color = tail(book)
        got = lookup(token, title, author)
        text = old if got is None else (got or old)
        if text:
            found += 1
        out.append(pack(book, text, color))
        time.sleep(0.12)
    BOOKS.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {BOOKS} ({found} blurbs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
