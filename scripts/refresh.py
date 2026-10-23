#!/usr/bin/env python3
"""Refresh data/avail.json and Korean Decimal Classification call numbers.

Availability comes from 서울대 도서관 and 평택시립 배다리도서관. A book counts as
대출가능 at 서울대 only when a 중앙도서관 copy, including 관정관, is available.

The KDC call number is stored on each book in data/books.json as ``kdc:…``.
서울대 lists KDC beside Dewey for many Korean books; that KDC number is kept.
Otherwise the 배다리 청구기호 is used, then the 국립중앙도서관 소장 record.
A failed lookup keeps the call number already in the file.

    python scripts/refresh.py

REFRESH_LIMIT and AVAIL_OUT are optional local overrides. KDC_ONLY=1 updates
call numbers without rewriting data/avail.json. The scheduled workflow sets
neither, so it refreshes every book and writes both files.
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
NL = "https://www.nl.go.kr/NL/contents/search.do"

HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
KDC_MARK = re.compile(r"^kdc:(.+)$", re.I)
# Dewey numbers the National Library uses for Korean literature, not KDC.
DDC_KOR_LIT = re.compile(r"^895\.(?:1|7)")


def get(url, headers=None, data=None, timeout=25):
    h = {"User-Agent": "Mozilla/5.0"}
    if headers:
        h.update(headers)
    body = data.encode("utf-8") if isinstance(data, str) else data
    req = urllib.request.Request(url, data=body, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def norm(s):
    return re.sub(r"[^0-9a-z가-힣]", "", (s or "").lower())


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


def class_number(token):
    """Leading KDC/DDC class such as 813.62. Location prefixes are ignored."""
    token = (token or "").strip().strip("()[]")
    if re.match(r"^[A-Za-z]{1,3}\d", token) and re.search(r"\.[A-Za-z]", token):
        return ""
    m = re.match(
        r"^(?:[A-Za-z]{1,4}\s+)*(?:[A-Za-z](?=\d{3}(?:\.\d+)?(?:\s|$|-)))?(\d{1,3}(?:\.\d+)?)(?!\d)",
        token,
    )
    if not m:
        return ""
    head = int(m.group(1).split(".")[0])
    if head > 999:
        return ""
    return m.group(1)


def clean_call(raw):
    s = re.sub(r"\s+", " ", (raw or "").strip().strip("()")).strip()
    s = re.sub(r"^(?:GE|EB|EE Haedong)\s+", "", s)
    return s


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


def pack(book, contents, color, kdc):
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


def same_author(author, record_text):
    """Reject only when the catalog text is Korean and the author prefix is absent."""
    a1 = norm((author or "").split("·")[0])[:2]
    if a1 and re.search("[가-힣]", record_text or "") and a1 not in norm(record_text):
        return False
    return True


def matched_docs(title, author):
    q = core(title)
    u = (
        B
        + "/primo_library/libweb/webservices/rest/primo-explore/v1/pnxs?inst=82SNU_INST&lang=ko_KR&limit=20&offset=0&pcAvailability=false&q="
        + urllib.parse.quote("title,contains," + q)
        + "&scope=ALL&skipDelivery=Y&sort=rank&tab=all&vid=82SNU&getMore=0&rtaLinks=true&refEntryActive=false&rapido=false&qExclude=&qInclude=&blendFacetsSeparately=false"
    )
    d = json.loads(get(u, {"Authorization": "Bearer " + TOK}))
    hits = []
    for x in d.get("docs", []):
        p = x["pnx"]["display"]
        t = (p.get("title") or [""])[0]
        if "book" not in " ".join(p.get("type", [])):
            continue
        if not norm(t).startswith(norm(q)):
            continue
        cr = " ".join(p.get("creator", []) + p.get("contributor", []))
        cc = " ".join(p.get("creator", []))
        if re.search("[가-힣]", cc) and not same_author(author, cc + " " + cr + " " + t):
            continue
        hits.append(x["pnx"])
    return hits


def snu_avail(docs):
    av = 0
    un = 0
    labels = set()
    for pnx in docs:
        for line in (pnx.get("display") or {}).get("availlibrary", []):
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


def kdc_from_snu(docs):
    """Use a 서울대 number only when the record also carries Dewey 895.7, so it is KDC."""
    classes = []
    calls = []
    for pnx in docs:
        for item in (pnx.get("search") or {}).get("lsr06") or []:
            for part in re.split(r"[\s,;/|]+", item):
                n = class_number(part)
                if n:
                    classes.append(n)
        for line in (pnx.get("display") or {}).get("availlibrary") or []:
            m = re.search(r"\$\$2([^$]+)", line)
            if not m:
                continue
            call = clean_call(m.group(1))
            n = class_number(call)
            if n:
                calls.append((bool(central_label(line)), call, n))
    kdc_nums = []
    for n in classes:
        head = int(n.split(".")[0])
        if 810 <= head <= 819 and not DDC_KOR_LIT.match(n):
            kdc_nums.append(n)
    if not kdc_nums or not any(DDC_KOR_LIT.match(n) for n in classes):
        return ""
    want = set(kdc_nums)
    for central, call, n in sorted(calls, key=lambda row: not row[0]):
        if n in want:
            return call
    return kdc_nums[0]


def isbn_of(docs):
    best = ""
    for pnx in docs:
        for raw in (pnx.get("addata") or {}).get("isbn") or []:
            digits = re.sub(r"[^0-9Xx]", "", str(raw))
            if len(digits) == 13 and digits.startswith("978"):
                return digits
            if len(digits) in (10, 13) and not best:
                best = digits
    return best


def fetch_snu(title, author):
    if not TOK:
        return {"s": "err"}, []
    last = {"s": "err"}
    for _ in range(3):
        try:
            docs = matched_docs(title, author)
            return snu_avail(docs), docs
        except Exception:
            last = {"s": "err"}
            time.sleep(2)
    return last, []


def kdc_from_pt(record):
    m = re.search(
        r"청구(?:기호|번호)\s*[:：]?\s*([0-9]{1,3}(?:\.[0-9]+)?(?:[-–][0-9A-Za-z가-힣.]+)*)",
        record,
    )
    if not m:
        return ""
    call = m.group(1).strip()
    return call if class_number(call) else ""


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
    kdc = ""
    for r in recs:
        tt = r.split(" 저자 :")[0]
        au = r.split("저자 :")[1].split("발행자")[0] if "저자 :" in r else ""
        if not norm(tt).startswith(norm(q)) or "배다리" not in r:
            continue
        if not same_author(author, au):
            continue
        if not kdc:
            kdc = kdc_from_pt(r)
        if "대출가능" in r:
            av += 1
        else:
            out_n += 1
            m = re.search(r"반납예정일: ([\d.]+)", r)
            if m:
                due.append(m.group(1))
    if av:
        return {"s": "avail", "n": av}, kdc
    if out_n:
        o = {"s": "out"}
        if due:
            o["due"] = min(due)
        return o, kdc
    return {"s": "none"}, kdc


def fetch_pt(title, author):
    last = {"s": "err"}
    for _ in range(3):
        try:
            return pt(title, author)
        except Exception:
            last = {"s": "err"}
            time.sleep(2)
    return last, ""


def strip_tags(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


CALLISH = re.compile(
    r"^(?:[A-Za-z]{1,4}\s+)*(?:[A-Za-z](?=\d{3}(?:\.\d+)?(?:\s|$|-)))?"
    r"\d{1,3}(?:\.\d+)?(?:(?:\s+\S+)|(?:[-–][\w가-힣.]+))*$"
)


def call_in_parts(parts):
    found = []
    for part in parts:
        piece = re.sub(r"\s+", " ", part).strip()
        if CALLISH.match(piece) and class_number(piece):
            found.append(piece)
    rich = [piece for piece in found if re.search(r"[.\-–\s가-힣A-Za-z]", piece)]
    if rich:
        return rich[0]
    return ""


def titles_match(label, title):
    a = norm(label)
    b = norm(core(title))
    if not a or not b:
        return False
    if a.startswith(b) or b.startswith(a):
        shorter = min(len(a), len(b))
        return shorter >= 6 or shorter == max(len(a), len(b))
    return False


def parse_nlk(body, title, author, trust_isbn=False):
    hits = []
    for raw in re.findall(r'name="cbx"[^>]*value="([^"]+)"', body):
        parts = urllib.parse.unquote(raw).replace("+", " ").split("||")
        if len(parts) < 4:
            continue
        label = strip_tags(parts[3])
        who = parts[6] if len(parts) > 6 else ""
        if not titles_match(label, title):
            continue
        if not trust_isbn and not same_author(author, who + " " + label):
            continue
        hits.append((call_in_parts(parts), label))
    if not hits:
        return ""

    def rank(item):
        call, label = item
        return (0 if call else 1, abs(len(norm(label)) - len(norm(core(title)))))

    hits.sort(key=rank)
    return hits[0][0]


def nlk_search(title, author, isbn):
    if isbn:
        q = urllib.parse.urlencode(
            {
                "detailSearch": "true",
                "srchTarget": "total",
                "pageNum": "1",
                "pageSize": "5",
                "f1": "isbn",
                "v1": isbn,
                "kwd": isbn,
            }
        )
        body = get(NL + "?" + q, timeout=25)
        matched = parse_nlk(body, title, author)
        if matched:
            return matched
    q = urllib.parse.urlencode(
        {"srchTarget": "dan", "pageNum": "1", "pageSize": "12", "kwd": core(title)}
    )
    body = get(NL + "?" + q, timeout=25)
    matched = parse_nlk(body, title, author)
    if matched:
        return matched
    hint = norm((author or "").split("·")[0])[:4]
    if hint:
        q = urllib.parse.urlencode(
            {"srchTarget": "dan", "pageNum": "1", "pageSize": "8", "kwd": core(title) + " " + (author or "").split("·")[0]}
        )
        body = get(NL + "?" + q, timeout=25)
        return parse_nlk(body, title, author)
    return ""


def fetch_nlk(title, author, isbn):
    for _ in range(2):
        try:
            return nlk_search(title, author, isbn) or ""
        except Exception:
            time.sleep(1.5)
    return ""


def keep_if_err(new, prev):
    if new.get("s") == "err" and prev:
        return prev
    return new


def one(book, prev, skip_pt=False):
    _c, title, author = book[:3]
    author = author or ""
    old = prev.get(title, {})
    snu_status, docs = fetch_snu(title, author)
    if skip_pt:
        pt_status, pt_call = {"s": "err"}, ""
    else:
        pt_status, pt_call = fetch_pt(title, author)
    kdc = kdc_from_snu(docs) or pt_call
    if not class_number(kdc):
        kdc = ""
    if not kdc:
        kdc = fetch_nlk(title, author, isbn_of(docs))
    if not class_number(kdc):
        previous = tail(book)[2]
        kdc = previous if class_number(previous) else ""
    print(f"{'ok' if class_number(kdc) else 'miss'}\t{kdc}\t{title}", flush=True)
    return {
        "t": title,
        "snu": keep_if_err(snu_status, old.get("snu")),
        "pt": old.get("pt") or {"s": "none"} if skip_pt else keep_if_err(pt_status, old.get("pt")),
        "kdc": kdc,
    }


def apply_kdc(books, rows):
    by_title = {row["t"]: row.get("kdc") or "" for row in rows}
    out = []
    changed = False
    for book in books:
        kdc = by_title.get(book[1], "")
        if not kdc:
            kdc = tail(book)[2]
        packed = pack(book, *tail(book)[:2], kdc)
        if packed != list(book):
            changed = True
        out.append(packed)
    return out, changed


def report_kdc(rows):
    got = [row.get("kdc") or "" for row in rows if class_number(row.get("kdc") or "")]
    hundreds = Counter(int(class_number(k).split(".")[0]) // 100 for k in got)
    print(f"kdc {len(got)}/{len(rows)}", dict(sorted(hundreds.items())), flush=True)


def main():
    books = json.loads(BOOKS.read_text(encoding="utf-8"))
    kdc_only = os.environ.get("KDC_ONLY") == "1"
    limit = int(os.environ.get("REFRESH_LIMIT") or 0)
    if limit:
        if not os.environ.get("AVAIL_OUT") and not kdc_only:
            print("REFRESH_LIMIT requires AVAIL_OUT so the full archive is not overwritten", file=sys.stderr)
            return 1
        books_run = books[:limit]
    else:
        books_run = books
    prev = {}
    if AVAIL.exists() and not os.environ.get("AVAIL_OUT"):
        try:
            prev = {row["t"]: row for row in json.loads(AVAIL.read_text(encoding="utf-8")).get("r", [])}
        except Exception:
            prev = {}
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(lambda book: one(book, prev, skip_pt=kdc_only), books_run))
    report_kdc(res)
    full_rows = []
    if limit and kdc_only:
        done = {row["t"]: row for row in res}
        for book in books:
            if book[1] in done:
                full_rows.append(done[book[1]])
            else:
                full_rows.append({"t": book[1], "kdc": tail(book)[2]})
    else:
        full_rows = res
    updated, changed = apply_kdc(books, full_rows)
    if changed:
        BOOKS.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("wrote", BOOKS, flush=True)
    else:
        print("books.json call numbers unchanged", flush=True)
    if kdc_only:
        return 0
    failed = sum(1 for x in res if x["snu"]["s"] == "err" and x["pt"]["s"] == "err")
    if res and failed == len(res):
        print("all lookups failed; not writing", file=sys.stderr)
        return 1
    payload = {
        "checked": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "r": [{"t": x["t"], "snu": x["snu"], "pt": x["pt"]} for x in res],
    }
    AVAIL.parent.mkdir(parents=True, exist_ok=True)
    AVAIL.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(Counter(x["snu"]["s"] for x in res), Counter(x["pt"]["s"] for x in res))
    print("wrote", AVAIL)
    return 0


if __name__ == "__main__":
    sys.exit(main())
