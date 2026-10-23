const STATUS_KEY = "book-archive-status";
const ORDER = ["", "want", "maybe", "read"];
const STATUS_LABEL = { want: "읽고 싶음", maybe: "후보", read: "읽음" };

const CLOTH = [
  { bg: "#2f6f73", edge: "#1d4e52", ink: "#f6edd9", light: false },
  { bg: "#3e6288", edge: "#2a4664", ink: "#f4efe4", light: false },
  { bg: "#1f4464", edge: "#163348", ink: "#f6edd9", light: false },
  { bg: "#e6d3a4", edge: "#c4ad7c", ink: "#243044", light: true },
  { bg: "#d08a45", edge: "#a86a30", ink: "#2a2118", light: true },
  { bg: "#c56b4a", edge: "#9a4e34", ink: "#f8f1e4", light: false },
  { bg: "#7f9a84", edge: "#5e7864", ink: "#1c2c24", light: true },
  { bg: "#8d4e4c", edge: "#6c3836", ink: "#f6edd9", light: false },
  { bg: "#f0e2c4", edge: "#d4c4a4", ink: "#243044", light: true },
  { bg: "#4e8f8a", edge: "#366e6a", ink: "#f7f1e4", light: false },
  { bg: "#6a7f99", edge: "#4e6278", ink: "#f4efe4", light: false },
  { bg: "#e7c7a4", edge: "#c9a67e", ink: "#2c241c", light: true },
];

const shelvesEl = document.getElementById("shelves");
const countEl = document.getElementById("count");
const qEl = document.getElementById("q");
const onlyEl = document.getElementById("only");
const dialog = document.getElementById("detail");
const coverEl = document.getElementById("cover");
const cycleEl = document.getElementById("cycle");

let books = [];
let byTitle = new Map();
let memoryStatus = {};
let current = null;
let laying = false;
let widthToken = 0;

function hash(s) {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const look = new Map();
function metrics(book) {
  let m = look.get(book.title);
  if (m) return m;
  const h = hash(book.title);
  m = {
    cloth: CLOTH[h % CLOTH.length],
    tilt: ((((h >>> 8) % 7) - 3) * 0.4).toFixed(2),
    gap: 3 + (h % 4),
  };
  look.set(book.title, m);
  return m;
}

function loadStatus() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATUS_KEY) || "{}");
    if (parsed && typeof parsed === "object") return parsed;
  } catch (e) { /* private mode */ }
  return memoryStatus;
}

function statusOf(title) {
  const v = loadStatus()[title];
  return ORDER.includes(v) ? v : "";
}

function saveStatus(title, value) {
  const all = loadStatus();
  if (value) all[title] = value;
  else delete all[title];
  memoryStatus = all;
  try { localStorage.setItem(STATUS_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
}

function nextStatus(cur) {
  const i = Math.max(0, ORDER.indexOf(cur || ""));
  return ORDER[(i + 1) % ORDER.length];
}

function currentCat() {
  const on = document.querySelector('.cats button[aria-pressed="true"]');
  return on ? on.dataset.cat : "all";
}

function currentLib() {
  const on = document.querySelector('.seg button[aria-checked="true"]');
  return on ? on.dataset.lib : "both";
}

function stateRank(s) {
  if (s === "avail") return 0;
  if (s === "out" || s === "loan") return 1;
  if (s === "none") return 2;
  return 3;
}

function rankOf(book) {
  const lib = currentLib();
  if (lib === "both") return Math.min(stateRank(book.snu.s), stateRank(book.pt.s));
  return stateRank(book[lib].s);
}

function markStatus(book) {
  const lib = currentLib();
  if (lib !== "both") return book[lib].s;
  return stateRank(book.snu.s) <= stateRank(book.pt.s) ? book.snu.s : book.pt.s;
}

function markKey(s) {
  if (s === "avail") return "avail";
  if (s === "out" || s === "loan") return "out";
  return "none";
}

function dueLabel(due) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(due || "");
  if (!m) return due || "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return y === new Date().getFullYear() ? `반납 ${mo}.${d}` : `반납 ${y}.${mo}.${d}`;
}

function availPhrase(rec) {
  if (!rec || rec.s === "none") return "소장 없음";
  if (rec.s === "avail") {
    const bits = ["대출가능"];
    if (rec.n) bits.push(`${rec.n}권`);
    if (rec.where) bits.push(rec.where);
    return bits.join(" · ");
  }
  if (rec.s === "out" || rec.s === "loan") {
    const due = dueLabel(rec.due);
    return due ? `대출중 · ${due}` : "대출중";
  }
  return "확인 불가";
}

function availClass(rec) {
  if (!rec || rec.s === "none") return "st-none";
  if (rec.s === "avail") return "st-avail";
  if (rec.s === "out" || rec.s === "loan") return "st-out";
  return "st-err";
}

function catName(code) {
  if (code === "H") return "인문·사회·AI";
  if (code === "W") return "일·자기계발";
  if (code === "N" || code === "F") return "소설·에세이·시";
  return "";
}

function passes(book) {
  const cat = currentCat();
  if (cat === "N") {
    if (book.cat !== "N" && book.cat !== "F") return false;
  } else if (cat !== "all" && book.cat !== cat) return false;
  const q = qEl.value.trim().toLowerCase().replace(/\s+/g, "");
  if (q) {
    const blob = (book.title + book.author).toLowerCase().replace(/\s+/g, "");
    if (!blob.includes(q)) return false;
  }
  if (onlyEl.checked) {
    const lib = currentLib();
    if (lib === "both") {
      if (book.snu.s !== "avail" && book.pt.s !== "avail") return false;
    } else if (book[lib].s !== "avail") return false;
  }
  return true;
}

function paintCloth(el, cloth) {
  el.style.setProperty("--cloth", cloth.bg);
  el.style.setProperty("--edge", cloth.edge);
  el.style.setProperty("--ink-on", cloth.ink);
  el.style.setProperty("--shade", cloth.light ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.35)");
}

function titlePlan(title, bayPx) {
  const chars = Array.from(title);
  const n = chars.length;
  const h = hash(title);
  const pitch = (size) => size * 1.16;
  const usable = (pct) => Math.max(36, bayPx * (pct / 100) - 30);
  const fits = (count, size, pct) => count * pitch(size) <= usable(pct);
  let size = 13;
  let hPct = 100;
  let parts = [title];
  if (n <= 4) {
    size = 14.5;
    hPct = 74 + (h % 4) * 5;
    if (!fits(n, size, hPct)) hPct = 100;
  } else if (fits(n, 12, 100)) {
    size = n <= 8 ? 13.5 : 12;
    hPct = n <= 8 ? 86 + (h % 3) * 4 : 100;
    if (!fits(n, size, hPct)) hPct = 100;
    if (!fits(n, size, 100)) size = 11;
  } else {
    const mid = Math.round(n / 2);
    let at = mid;
    let best = 1e9;
    for (let i = 2; i < n - 1; i++) {
      const ch = chars[i];
      const prev = chars[i - 1];
      if (ch !== " " && prev !== " " && ch !== ":" && ch !== "：" && ch !== "·") continue;
      const d = Math.abs(i - mid);
      if (d < best) { best = d; at = i; }
    }
    let a = chars.slice(0, at).join("").trim();
    let b = chars.slice(at).join("").trim();
    if (!a || !b) {
      a = chars.slice(0, mid).join("");
      b = chars.slice(mid).join("");
    }
    parts = [a, b];
    const longer = Math.max(Array.from(a).length, Array.from(b).length);
    size = 13;
    while (size > 8.5 && !fits(longer, size, 100)) size -= 0.5;
  }
  const w = parts.length === 1
    ? Math.round(Math.max(30, size + 16 + (h % 5)))
    : Math.round(size * 2 + 20);
  return { size, w, hPct, parts };
}

function ariaText(book) {
  const st = STATUS_LABEL[statusOf(book.title)];
  return [book.title, book.author, availPhrase({ s: markStatus(book) }), st].filter(Boolean).join(", ");
}

function contentWidth() {
  const shelf = document.createElement("section");
  shelf.className = "shelf";
  const bay = document.createElement("div");
  bay.className = "bay";
  shelf.append(bay);
  shelvesEl.append(shelf);
  const cs = getComputedStyle(bay);
  const w = bay.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  shelf.remove();
  return w;
}

function bayHeight() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--bay");
  return parseFloat(raw) || 196;
}

function layout(list, maxW) {
  const shelves = [];
  let i = 0;
  let n = 0;
  const bay = bayHeight();
  while (i < list.length) {
    const items = [];
    let used = 0;
    const wantStack = n % 2 === 1 && list.length - i >= 5;
    const stackW = Math.round(Math.max(128, Math.min(180, maxW * 0.36)));
    const budget = Math.max(40, maxW - (wantStack ? stackW + 8 : 0));
    while (i < list.length) {
      const plan = titlePlan(list[i].title, bay);
      const add = plan.w + metrics(list[i]).gap;
      if (items.length && used + add > budget) break;
      if (wantStack && list.length - i <= 3 && items.length) break;
      items.push({ type: "book", book: list[i], plan });
      used += add;
      i += 1;
      if (items.length >= 16) break;
    }
    let stack = null;
    if (wantStack && list.length - i >= 3) {
      stack = { type: "stack", books: list.slice(i, i + 3), w: stackW };
      i += 3;
    }
    const row = [];
    if (stack && n % 4 === 1) row.push(stack);
    row.push(...items);
    if (stack && n % 4 !== 1) row.push(stack);
    if (!row.length && i < list.length) {
      row.push({ type: "book", book: list[i], plan: titlePlan(list[i].title, bay) });
      i += 1;
    }
    if (!row.length) break;
    shelves.push(row);
    n += 1;
  }
  return shelves;
}

function thicknesses(group, bay) {
  const raw = group.map((b) => 34 + (hash(b.title + "flat") % 5) * 3);
  const gaps = (group.length - 1) * 4;
  const sum = raw.reduce((a, b) => a + b, 0);
  const limit = bay - 12;
  if (sum + gaps <= limit) return raw;
  const scale = (limit - gaps) / sum;
  return raw.map((n) => Math.max(28, Math.floor(n * scale)));
}

function addRibbon(btn, title) {
  const st = statusOf(title);
  if (!st) return;
  const rib = document.createElement("i");
  rib.className = "ribbon";
  rib.dataset.st = st;
  btn.append(rib);
}

function makeSpine(book, plan) {
  const m = metrics(book);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "spine";
  btn.dataset.title = book.title;
  btn.style.setProperty("--w", `${plan.w}px`);
  btn.style.setProperty("--h", `${plan.hPct}%`);
  btn.style.setProperty("--tilt", `${m.tilt}deg`);
  btn.style.setProperty("--gap", `${m.gap}px`);
  btn.style.setProperty("--fs", `${plan.size}px`);
  paintCloth(btn, m.cloth);
  btn.setAttribute("aria-label", ariaText(book));
  const title = document.createElement("span");
  title.className = "title";
  for (const part of plan.parts) {
    const col = document.createElement("span");
    col.textContent = part;
    title.append(col);
  }
  const foot = document.createElement("i");
  foot.className = "foot";
  foot.dataset.s = markKey(markStatus(book));
  btn.append(title, foot);
  addRibbon(btn, book.title);
  return btn;
}

function makeStack(group, stackW, bay) {
  const wrap = document.createElement("div");
  wrap.className = "stack";
  wrap.style.setProperty("--sw", `${stackW}px`);
  const thick = thicknesses(group, bay);
  group.forEach((book, idx) => {
    const m = metrics(book);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "flat";
    btn.dataset.title = book.title;
    btn.style.minHeight = `${thick[idx]}px`;
    btn.style.height = "auto";
    paintCloth(btn, m.cloth);
    btn.setAttribute("aria-label", ariaText(book));
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = book.title;
    const foot = document.createElement("i");
    foot.className = "foot";
    foot.dataset.s = markKey(markStatus(book));
    const pages = document.createElement("i");
    pages.className = "pages";
    pages.setAttribute("aria-hidden", "true");
    btn.append(name, foot, pages);
    addRibbon(btn, book.title);
    wrap.append(btn);
  });
  return wrap;
}

function emptyShelf() {
  const section = document.createElement("section");
  section.className = "shelf";
  const bay = document.createElement("div");
  bay.className = "bay empty";
  const note = document.createElement("p");
  note.className = "empty-note";
  note.textContent = "해당하는 책이 없습니다";
  bay.append(note);
  const plank = document.createElement("div");
  plank.className = "plank";
  section.append(bay, plank);
  return section;
}

function renderShelves() {
  if (laying || !books.length) return;
  laying = true;
  try {
    const maxW = contentWidth();
    widthToken = Math.round(shelvesEl.clientWidth);
    const list = books.filter(passes);
    list.sort((a, b) => rankOf(a) - rankOf(b) || a.i - b.i);
    countEl.textContent = list.length ? `${list.length}권` : "해당하는 책이 없습니다";
    if (!list.length || maxW < 40) {
      shelvesEl.replaceChildren(emptyShelf());
      return;
    }
    const bay = bayHeight();
    const frag = document.createDocumentFragment();
    for (const row of layout(list, maxW)) {
      const section = document.createElement("section");
      section.className = "shelf";
      const bayEl = document.createElement("div");
      bayEl.className = "bay";
      for (const item of row) {
        bayEl.append(item.type === "stack" ? makeStack(item.books, item.w, bay) : makeSpine(item.book, item.plan));
      }
      const plank = document.createElement("div");
      plank.className = "plank";
      section.append(bayEl, plank);
      frag.append(section);
    }
    shelvesEl.replaceChildren(frag);
  } finally {
    laying = false;
  }
}

function fauxCover(book) {
  const m = metrics(book);
  const div = document.createElement("div");
  div.className = "faux";
  paintCloth(div, m.cloth);
  const span = document.createElement("span");
  span.textContent = book.title;
  div.append(span);
  return div;
}

function paintCover(book) {
  coverEl.replaceChildren();
  if (!book.cover) {
    coverEl.append(fauxCover(book));
    return;
  }
  const big = book.cover.replace("/thumb/R120x174.q85/", "/thumb/R400x0.q85/");
  const urls = big === book.cover ? [book.cover] : [big, book.cover];
  const img = new Image();
  img.alt = "표지";
  img.referrerPolicy = "no-referrer";
  let i = 0;
  img.onload = () => { if (current === book) coverEl.replaceChildren(img); };
  img.onerror = () => {
    i += 1;
    if (i < urls.length) img.src = urls[i];
    else if (current === book) coverEl.replaceChildren(fauxCover(book));
  };
  img.src = urls[0];
}

function slipRow(name, rec) {
  const p = document.createElement("p");
  const lib = document.createElement("span");
  lib.className = "lib";
  lib.textContent = name;
  const st = document.createElement("span");
  st.className = availClass(rec);
  st.textContent = availPhrase(rec);
  p.append(lib, st);
  return p;
}

function extLink(href, label) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = label;
  return a;
}

function snuHref(title) {
  return "https://snu-primo.hosted.exlibrisgroup.com/primo-explore/search?query=any,contains,"
    + encodeURIComponent(title) + "&tab=all&search_scope=ALL&vid=82SNU&lang=ko_KR&offset=0";
}

function ptHref(title) {
  return "https://www.ptlib.go.kr/intro/menu/11089/program/30015/plusSearchResultList.do?searchType=SIMPLE&searchCategory=BOOK&searchKey=TITLE&searchKeyword="
    + encodeURIComponent(title) + "&searchLibraryArr=MJ";
}

function paintCycle(status) {
  cycleEl.querySelectorAll("span").forEach((s) => s.classList.toggle("on", s.dataset.v === status));
  const name = STATUS_LABEL[status] || "표시 없음";
  cycleEl.setAttribute("aria-label", `독서 상태, ${name}. 눌러서 바꿉니다.`);
}

function refreshMarks(book) {
  const label = ariaText(book);
  document.querySelectorAll("button[data-title]").forEach((btn) => {
    if (btn.dataset.title !== book.title) return;
    btn.setAttribute("aria-label", label);
    btn.querySelector(".ribbon")?.remove();
    addRibbon(btn, book.title);
  });
}

function openBook(book) {
  current = book;
  paintCover(book);
  document.getElementById("d-cat").textContent = catName(book.cat);
  document.getElementById("d-title").textContent = book.title;
  document.getElementById("d-author").textContent = book.author;
  const blurb = document.getElementById("d-blurb");
  const text = (book.contents || "").trim();
  blurb.hidden = !text;
  blurb.textContent = text;
  const slip = document.getElementById("slip");
  slip.replaceChildren(slipRow("서울대", book.snu), slipRow("배다리", book.pt));
  const links = document.getElementById("links");
  links.replaceChildren(extLink(snuHref(book.title), "서울대 검색"), extLink(ptHref(book.title), "배다리 검색"));
  paintCycle(statusOf(book.title));
  if (!dialog.open) dialog.showModal();
  dialog.querySelector(".card").scrollTop = 0;
}

function wire() {
  document.querySelectorAll(".cats button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cats button").forEach((b) => {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      renderShelves();
    });
  });
  document.querySelectorAll(".seg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg button").forEach((b) => {
        b.setAttribute("aria-checked", b === btn ? "true" : "false");
      });
      renderShelves();
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const all = [...document.querySelectorAll(".seg button")];
      const i = all.indexOf(btn);
      const next = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
      next.click();
      next.focus();
      e.preventDefault();
    });
  });
  onlyEl.addEventListener("change", renderShelves);
  qEl.addEventListener("input", renderShelves);
  qEl.addEventListener("keydown", (e) => { if (e.key === "Enter") e.currentTarget.blur(); });
  shelvesEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-title]");
    if (!btn) return;
    const book = byTitle.get(btn.dataset.title);
    if (book) openBook(book);
  });
  document.getElementById("close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.classList.contains("sheet")) dialog.close();
  });
  cycleEl.addEventListener("click", (e) => {
    if (!current) return;
    const span = e.target.closest("[data-v]");
    const cur = statusOf(current.title);
    const next = span && span.dataset.v !== cur ? span.dataset.v : nextStatus(cur);
    saveStatus(current.title, next);
    paintCycle(next);
    refreshMarks(current);
  });
}

function showNote(text) {
  shelvesEl.replaceChildren();
  const p = document.createElement("p");
  p.className = "load-note";
  p.textContent = text;
  shelvesEl.append(p);
}

async function init() {
  wire();
  try {
    const [rawBooks, avail] = await Promise.all([
      fetch("data/books.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error("books"); return r.json(); }),
      fetch("data/avail.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error("avail"); return r.json(); }),
    ]);
    const rows = Array.isArray(avail.r) ? avail.r : [];
    const map = new Map(rows.map((r) => [r.t, r]));
    books = rawBooks.map((b, i) => {
      const rec = rows[i] && rows[i].t === b[1] ? rows[i] : (map.get(b[1]) || {});
      return {
        i,
        cat: b[0],
        title: b[1],
        author: b[2] || "",
        cover: b[3] || "",
        contents: typeof b[4] === "string" ? b[4] : "",
        snu: rec.snu || { s: "none" },
        pt: rec.pt || { s: "none" },
      };
    });
    byTitle = new Map(books.map((b) => [b.title, b]));
    renderShelves();
    const ro = new ResizeObserver(() => {
      const w = Math.round(shelvesEl.clientWidth);
      if (Math.abs(w - widthToken) < 8) return;
      renderShelves();
    });
    ro.observe(shelvesEl);
  } catch (e) {
    showNote("책을 불러오지 못했습니다");
  }
}

init();
