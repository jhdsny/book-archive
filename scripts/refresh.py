#!/usr/bin/env python3
"""Refresh data/avail.json from 서울대 도서관 and 평택시립 배다리도서관.

The matching rules are the original checker, moved so GitHub Actions can run it
from the repository root or from this file's directory:

    python scripts/refresh.py

REFRESH_LIMIT and AVAIL_OUT are optional local overrides. The scheduled
workflow sets neither, so it refreshes every book and writes data/avail.json.
"""

import datetime
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "data" / "books.json"
AVAIL = Path(os.environ["AVAIL_OUT"]) if os.environ.get("AVAIL_OUT") else ROOT / "data" / "avail.json"

B = "https://snu-primo.hosted.exlibrisgroup.com"
PT = "https://www.ptlib.go.kr/intro/menu/11089/program/30015/plusSearchResultList.do"


def get(url, headers=None):
    h = {"User-Agent": "Mozilla/5.0"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=25) as resp:
        return resp.read().decode("utf-8", "replace")


def norm(s):
    return re.sub(r"[^0-9a-z가-힣]", "", s.lower())


def core(t):
    return re.split(r"[:(（]", t)[0].strip()


def load_token():
    try:
        return get(
            B + "/primo_library/libweb/webservices/rest/v1/guestJwt/82SNU_INST?isGuest=true&lang=ko_KR&viewId=82SNU"
        ).strip('"')
    except Exception as e:
        print("snu token failed:", e, file=sys.stderr)
        return ""


TOK = load_token()


def central_label(line):
    """중앙도서관, including the 관정관 building. Branch libraries are ignored."""
    y = re.search(r"\$\$Y([^$]+)", line)
    z = re.search(r"\$\$Z([^$]+)", line)
    lib = re.search(r"\$\$L([^$]+)", line)
    name = (y.group(1) if y else "").strip()
    place = (z.group(1) if z else "").strip()
    code = (lib.group(1) if lib else "").strip()
    if "관정" in name + place:
        return "관정관"
    if name.startswith("중앙") or code == "MAIN":
        return "중앙"
    return ""


def snu(title, author):
    if not TOK:
        return {"s": "err"}
    q = core(title)
    u = (
        B
        + "/primo_library/libweb/webservices/rest/primo-explore/v1/pnxs?inst=82SNU_INST&lang=ko_KR&limit=20&offset=0&pcAvailability=false&q="
        + urllib.parse.quote("title,contains," + q)
        + "&scope=ALL&skipDelivery=Y&sort=rank&tab=all&vid=82SNU&getMore=0&rtaLinks=true&refEntryActive=false&rapido=false&qExclude=&qInclude=&blendFacetsSeparately=false"
    )
    d = json.loads(get(u, {"Authorization": "Bearer " + TOK}))
    av = 0
    un = 0
    labels = set()
    a1 = norm(author.split("·")[0])[:2]
    for x in d.get("docs", []):
        p = x["pnx"]["display"]
        t = (p.get("title") or [""])[0]
        if "book" not in " ".join(p.get("type", [])):
            continue
        if not norm(t).startswith(norm(q)):
            continue
        cr = norm(" ".join(p.get("creator", []) + p.get("contributor", [])))
        cc = norm(" ".join(p.get("creator", [])))
        if a1 and re.search("[가-힣]", cc) and a1 not in cr + norm(t):
            continue
        for line in p.get("availlibrary", []):
            label = central_label(line)
            if not label:
                continue
            status = re.search(r"\$\$S(\w+)", line)
            if status and status.group(1) == "available":
                av += 1
                labels.add(label)
            else:
                un += 1
    if av:
        where = "·".join(sorted(labels, key=lambda b: (b != "중앙", b)))
        out = {"s": "avail", "n": av}
        if where:
            out["where"] = where
        return out
    if un:
        return {"s": "out"}
    return {"s": "none"}


def pt(title, author):
    q = core(title)
    s = get(
        PT
        + "?searchType=SIMPLE&searchCategory=BOOK&searchKey=TITLE&searchKeyword="
        + urllib.parse.quote(q)
        + "&searchLibraryArr=MJ&searchRecordCount=50"
    )
    t = re.sub(r"<(script|style).*?</\1>", "", s, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"\s+", " ", html.unescape(t))
    recs = re.split(r" 도서 \d+\. ", t)[1:]
    av = 0
    out_n = 0
    due = []
    a1 = norm(author.split("·")[0])[:2]
    for r in recs:
        tt = r.split(" 저자 :")[0]
        au = r.split("저자 :")[1].split("발행자")[0] if "저자 :" in r else ""
        if not norm(tt).startswith(norm(q)) or "배다리" not in r:
            continue
        if a1 and re.search("[가-힣]", au) and a1 not in norm(au):
            continue
        if "대출가능" in r:
            av += 1
        else:
            out_n += 1
            m = re.search(r"반납예정일: ([\d.]+)", r)
            if m:
                due.append(m.group(1))
    if av:
        return {"s": "avail", "n": av}
    if out_n:
        o = {"s": "out"}
        if due:
            o["due"] = min(due)
        return o
    return {"s": "none"}


def lookup(fn, title, author):
    last = {"s": "err"}
    for _ in range(3):
        try:
            return fn(title, author)
        except Exception:
            last = {"s": "err"}
            time.sleep(2)
    return last


def keep_if_err(new, prev):
    if new.get("s") == "err" and prev:
        return prev
    return new


def one(book, prev):
    _c, title, author = book[:3]
    old = prev.get(title, {})
    return {
        "t": title,
        "snu": keep_if_err(lookup(snu, title, author), old.get("snu")),
        "pt": keep_if_err(lookup(pt, title, author), old.get("pt")),
    }


def main():
    books = json.loads(BOOKS.read_text(encoding="utf-8"))
    limit = int(os.environ.get("REFRESH_LIMIT") or 0)
    if limit:
        if not os.environ.get("AVAIL_OUT"):
            print("REFRESH_LIMIT requires AVAIL_OUT so the full archive is not overwritten", file=sys.stderr)
            return 1
        books = books[:limit]
    prev = {}
    if AVAIL.exists() and not os.environ.get("AVAIL_OUT"):
        try:
            prev = {row["t"]: row for row in json.loads(AVAIL.read_text(encoding="utf-8")).get("r", [])}
        except Exception:
            prev = {}
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(lambda book: one(book, prev), books))
    failed = sum(1 for x in res if x["snu"]["s"] == "err" and x["pt"]["s"] == "err")
    if res and failed == len(res):
        print("all lookups failed; not writing", file=sys.stderr)
        return 1
    payload = {
        "checked": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "r": res,
    }
    AVAIL.parent.mkdir(parents=True, exist_ok=True)
    AVAIL.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(Counter(x["snu"]["s"] for x in res), Counter(x["pt"]["s"] for x in res))
    print("wrote", AVAIL)
    return 0


if __name__ == "__main__":
    sys.exit(main())
