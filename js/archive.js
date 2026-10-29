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

const KDC = [
  { id: "0", name: "총류", code: "000" },
  { id: "1", name: "철학", code: "100" },
  { id: "2", name: "종교", code: "200" },
  { id: "3", name: "사회과학", code: "300" },
  { id: "4", name: "자연과학", code: "400" },
  { id: "5", name: "기술과학", code: "500" },
  { id: "6", name: "예술", code: "600" },
  { id: "7", name: "언어", code: "700" },
  { id: "8", name: "문학", code: "800" },
  { id: "9", name: "역사", code: "900" },
];

const shelvesEl = document.getElementById("shelves");
const countEl = document.getElementById("count");
const qEl = document.getElementById("q");
const onlyEl = document.getElementById("only");
const readsEl = document.getElementById("reads");
const dialog = document.getElementById("detail");
const coverEl = document.getElementById("cover");
const cycleEl = document.getElementById("cycle");

let books = [];
let byTitle = new Map();
let memoryStatus = {};
let current = null;
let laying = false;
let widthToken = 0;
let detailState = false;

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

function currentClass() {
  const on = document.querySelector('#classes button[aria-pressed="true"]');
  return on ? on.dataset.kdc : "all";
}

function currentLib() {
  const on = document.querySelector('.libs button[aria-checked="true"]');
  return on ? on.dataset.lib : "both";
}

function currentSort() {
  const on = document.querySelector('.sorts button[aria-checked="true"]');
  return on ? on.dataset.sort : "call";
}

function callKey(call) {
  const m = /^\s*(?:[A-Za-z]{1,4}\s+)*(?:[A-Za-z](?=\d{3}(?:\.\d+)?(?:\s|$|-)))?(\d{1,3})(?:\.(\d+))?(.*)$/.exec(call || "");
  if (!m) return null;
  const n = Number(m[1]);
  if (n > 999) return null;
  return { int: n, frac: m[2] || "", rest: (m[3] || "").trim() };
}

function classMark(call) {
  const m = /^\s*(?:[A-Za-z]{1,4}\s+)*(?:[A-Za-z](?=\d{3}(?:\.\d+)?(?:\s|$|-)))?(\d{1,3}(?:\.\d+)?)/.exec(call || "");
  return m ? m[1] : "";
}

function kdcHundred(call) {
  const key = callKey(call);
  if (!key) return "";
  return String(Math.floor(key.int / 100));
}

function kdcName(call) {
  const id = kdcHundred(call);
  const row = KDC.find((item) => item.id === id);
  return row ? row.name : "";
}

function compareCall(a, b) {
  const pa = callKey(a.call);
  const pb = callKey(b.call);
  if (!pa && !pb) return a.i - b.i;
  if (!pa) return 1;
  if (!pb) return -1;
  if (pa.int !== pb.int) return pa.int - pb.int;
  if (pa.frac !== pb.frac) return pa.frac < pb.frac ? -1 : 1;
  const rest = pa.rest.localeCompare(pb.rest, "ko");
  if (rest) return rest;
  return a.i - b.i;
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

function showingRead() {
  return readsEl.getAttribute("aria-pressed") === "true";
}

function passes(book) {
  const read = statusOf(book.title) === "read";
  if (showingRead() !== read) return false;
  const cls = currentClass();
  const hundred = kdcHundred(book.call);
  if (cls === "none") {
    if (hundred) return false;
  } else if (cls !== "all" && hundred !== cls) return false;
  const q = qEl.value.trim().toLowerCase().replace(/\s+/g, "");
  if (q) {
    const blob = (book.title + book.author).toLowerCase().replace(/\s+/g, "");
    if (!blob.includes(q)) return false;
  }
  if (onlyEl.getAttribute("aria-pressed") === "true") {
    const lib = currentLib();
    if (lib === "both") {
      if (book.snu.s !== "avail" && book.pt.s !== "avail") return false;
    } else if (book[lib].s !== "avail") return false;
  }
  return true;
}

function relLum(rgb) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const CREAM_L = relLum([246, 237, 217]);

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const light = (hi + lo) / 2;
  if (hi === lo) return [0, 0, light];
  const d = hi - lo;
  const sat = light > 0.5 ? d / (2 - hi - lo) : d / (hi + lo);
  let hue;
  if (hi === r) hue = ((g - b) / d) % 6;
  else if (hi === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return [hue / 6, sat, light];
}

function hslToRgb(h, s, light) {
  const chan = (p, q, t) => {
    t = ((t % 1) + 1) % 1;
    let v = p;
    if (t < 1 / 6) v = p + (q - p) * 6 * t;
    else if (t < 1 / 2) v = q;
    else if (t < 2 / 3) v = p + (q - p) * (2 / 3 - t) * 6;
    return Math.round(Math.max(0, Math.min(255, v * 255)));
  };
  if (s === 0) {
    const v = Math.round(light * 255);
    return [v, v, v];
  }
  const q = light < 0.5 ? light * (1 + s) : light + s - light * s;
  const p = 2 * light - q;
  return [chan(p, q, h + 1 / 3), chan(p, q, h), chan(p, q, h - 1 / 3)];
}

function clampHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  let [h, s, light] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  if (s < 0.12) s = 0.12;
  s = Math.min(s, 0.62);
  light = Math.min(Math.max(light, 0.24), 0.42);
  let rgb = hslToRgb(h, s, light);
  while ((CREAM_L + 0.05) / (relLum(rgb) + 0.05) < 4.5 && light > 0.16) {
    light -= 0.015;
    rgb = hslToRgb(h, s, light);
  }
  return "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
}

function clothFor(book) {
  const given = book.color && /^#[0-9a-fA-F]{6}$/.test(book.color) ? book.color : null;
  const base = given || CLOTH[hash(book.title) % CLOTH.length].bg;
  return { bg: clampHex(base) };
}

function paintCloth(el, cloth) {
  el.style.setProperty("--cloth", cloth.bg);
}

function extras(b) {
  let contents = "";
  let color = "";
  let kdc = "";
  for (const part of b.slice(4)) {
    if (typeof part !== "string") continue;
    const text = part.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(text)) color = text.toLowerCase();
    else if (/^kdc:/i.test(text)) kdc = text.slice(4).trim();
    else if (text && !contents) contents = text;
  }
  return { contents, color, kdc };
}

function chunkChars(chars, per) {
  const cols = Math.max(1, Math.ceil(chars.length / per));
  const size = Math.ceil(chars.length / cols);
  const parts = [];
  for (let i = 0; i < cols; i++) {
    const piece = chars.slice(i * size, (i + 1) * size).join("");
    if (piece) parts.push(piece);
  }
  return parts;
}

function fitText(text, usable, startSize) {
  const chars = Array.from(text || "");
  if (!chars.length) return { size: startSize, parts: [] };
  const pitch = (size) => size * 1.22;
  let size = startSize;
  while (size >= 8) {
    const per = Math.max(1, Math.floor(usable / pitch(size)));
    if (Math.ceil(chars.length / per) <= 3) return { size, parts: chunkChars(chars, per) };
    size -= 0.5;
  }
  const per = Math.max(1, Math.floor(usable / pitch(8)));
  return { size: 8, parts: chunkChars(chars, per) };
}

function lightTint(hex) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c * 0.2 + 246 * 0.8);
  return "#" + [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)]
    .map((c) => c.toString(16).padStart(2, "0")).join("");
}

function readableInk(hex) {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return relLum(rgb) > 0.42 ? "#241c14" : "#f6f1e6";
}

function planSpine(book, bayPx) {
  const h = hash(book.title);
  const design = h % 4;
  let hPct = 76 + (h % 25);
  const cloth = clothFor(book).bg;
  const lightPanel = design !== 1;
  const ink = lightPanel ? "#241c14" : readableInk(cloth);
  const panel = lightPanel ? lightTint(cloth) : cloth;
  const reserve = (design === 2 ? 102 : 88) + (classMark(book.call) ? 14 : 0);
  const room = (pct) => Math.max(64, bayPx * (pct / 100) - reserve);
  let titleFit = fitText(book.title, room(hPct), 12.5);
  if (titleFit.size < 10.5 && hPct < 100) {
    hPct = 100;
    titleFit = fitText(book.title, room(100), 12.5);
  }
  const authorFit = fitText(book.author || "", room(hPct), Math.max(8, titleFit.size - 3));
  const colW = (parts, size) => parts.length * (size + 2);
  let w = 12 + colW(titleFit.parts, titleFit.size) + colW(authorFit.parts, authorFit.size);
  w = Math.round(Math.max(w, 28 + (h % 18)) + 6);
  const roll = h % 9;
  let tilt = 0;
  if (roll === 7) tilt = 4 + (h % 3);
  else if (roll === 8) tilt = -(4 + ((h >>> 4) % 3));
  return {
    design,
    hPct,
    size: titleFit.size,
    titleParts: titleFit.parts,
    authorSize: authorFit.size,
    authorParts: authorFit.parts,
    w,
    tilt,
    gap: 2 + (h % 4),
    ink,
    cloth,
    panel,
  };
}

function ariaText(book) {
  const st = STATUS_LABEL[statusOf(book.title)];
  const mark = classMark(book.call);
  return [book.title, book.author, mark, availPhrase({ s: markStatus(book) }), st].filter(Boolean).join(", ");
}

const plans = new Map();
function planFor(book, bay) {
  const key = `${book.title}:${bay}`;
  let plan = plans.get(key);
  if (!plan) {
    plan = planSpine(book, bay);
    plans.set(key, plan);
  }
  return plan;
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
  const bay = bayHeight();
  while (i < list.length) {
    const items = [];
    let used = 0;
    while (i < list.length) {
      const plan = planFor(list[i], bay);
      const add = plan.w + plan.gap;
      if (items.length && used + add > maxW) break;
      items.push({ book: list[i], plan });
      used += add;
      i += 1;
    }
    if (!items.length && i < list.length) {
      items.push({ book: list[i], plan: planFor(list[i], bay) });
      i += 1;
    }
    if (!items.length) break;
    shelves.push(items);
  }
  return shelves;
}

function addRibbon(btn, title) {
  const st = statusOf(title);
  if (!st) return;
  const rib = document.createElement("i");
  rib.className = "ribbon";
  rib.dataset.st = st;
  btn.append(rib);
}

function coverImg(cls) {
  const img = document.createElement("img");
  img.className = cls;
  img.alt = "";
  img.draggable = false;
  img.referrerPolicy = "no-referrer";
  return img;
}

function makeSpine(book, plan) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `spine design-${plan.design}`;
  if (!book.cover) btn.classList.add("plain");
  if (plan.tilt) btn.style.zIndex = "2";
  btn.dataset.title = book.title;
  btn.style.setProperty("--w", `${plan.w}px`);
  btn.style.setProperty("--h", `${plan.hPct}%`);
  btn.style.setProperty("--tilt", `${plan.tilt}deg`);
  btn.style.setProperty("--gap", `${plan.gap}px`);
  btn.style.setProperty("--fs", `${plan.size}px`);
  btn.style.setProperty("--afs", `${plan.authorSize}px`);
  btn.style.setProperty("--ink", plan.ink);
  btn.style.setProperty("--panel", plan.panel);
  btn.style.setProperty("--cloth", plan.cloth);
  btn.setAttribute("aria-label", ariaText(book));

  const face = document.createElement("span");
  face.className = "face";
  const place = (cls) => {
    if (!book.cover) return null;
    const img = coverImg(cls);
    img.src = book.cover;
    img.addEventListener("error", () => img.remove());
    face.append(img);
    return img;
  };

  if (!book.cover) {
    const top = document.createElement("span");
    top.className = "band";
    face.append(top);
  } else if (plan.design === 2) {
    place("banner");
  } else {
    place("strip top");
    if (plan.design !== 1) place("thumb");
    else place("thumb");
    if (plan.design === 3) place("edge");
  }

  const letter = document.createElement("span");
  letter.className = "letter";
  const cols = document.createElement("span");
  cols.className = "cols";
  for (const part of plan.titleParts) {
    const col = document.createElement("span");
    col.className = "col title";
    col.textContent = part;
    cols.append(col);
  }
  for (const part of plan.authorParts) {
    const col = document.createElement("span");
    col.className = "col author";
    col.textContent = part;
    cols.append(col);
  }
  letter.append(cols);
  face.append(letter);

  if (!book.cover) {
    const plate = document.createElement("span");
    plate.className = "plate";
    letter.before(plate);
    const bot = document.createElement("span");
    bot.className = "band bot";
    face.append(bot);
  } else {
    place("strip bot");
  }

  const mark = classMark(book.call);
  if (mark) {
    const label = document.createElement("span");
    label.className = "mark";
    label.textContent = mark;
    letter.prepend(label);
  }
  btn.append(face);
  const foot = document.createElement("i");
  foot.className = "foot";
  foot.dataset.s = markKey(markStatus(book));
  btn.append(foot);
  addRibbon(btn, book.title);
  return btn;
}

function emptyShelf(message) {
  const section = document.createElement("section");
  section.className = "shelf";
  const bay = document.createElement("div");
  bay.className = "bay empty";
  const note = document.createElement("p");
  note.className = "empty-note";
  note.textContent = message;
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
    if (currentSort() === "loan") list.sort((a, b) => rankOf(a) - rankOf(b) || compareCall(a, b));
    else list.sort(compareCall);
    const emptyText = showingRead() ? "읽은 책이 없습니다" : "해당하는 책이 없습니다";
    countEl.textContent = list.length
      ? (showingRead() ? `읽은 책 ${list.length}권` : `${list.length}권`)
      : emptyText;
    if (!list.length || maxW < 40) {
      shelvesEl.replaceChildren(emptyShelf(emptyText));
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
        bayEl.append(makeSpine(item.book, item.plan));
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
  paintCloth(div, clothFor(book));
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

function closeDetail() {
  if (dialog.open) dialog.close();
}

function openBook(book) {
  current = book;
  paintCover(book);
  const klass = kdcName(book.call);
  document.getElementById("d-cat").textContent = klass || "미분류";
  const callEl = document.getElementById("d-call");
  callEl.hidden = !book.call;
  callEl.textContent = book.call || "";
  document.getElementById("d-title").textContent = book.title;
  document.getElementById("d-author").textContent = book.author;
  const blurb = document.getElementById("d-blurb");
  const text = (book.contents || "").trim();
  blurb.hidden = !text;
  blurb.textContent = text;
  const slip = document.getElementById("slip");
  slip.replaceChildren(slipRow("중앙도서관", book.snu), slipRow("배다리", book.pt));
  const links = document.getElementById("links");
  links.replaceChildren(extLink(snuHref(book.title), "서울대 검색"), extLink(ptHref(book.title), "배다리 검색"));
  paintCycle(statusOf(book.title));
  if (!dialog.open) {
    history.pushState({ detail: true }, "");
    detailState = true;
    dialog.showModal();
  }
  const body = dialog.querySelector(".card-body");
  if (body) body.scrollTop = 0;
}

function bindPressed(box) {
  box.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      box.querySelectorAll("button").forEach((b) => {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      renderShelves();
    });
  });
}

function mountClasses() {
  const box = document.getElementById("classes");
  const have = new Set(books.map((b) => kdcHundred(b.call)).filter(Boolean));
  const missing = books.some((b) => !kdcHundred(b.call));
  box.replaceChildren();
  const add = (id, label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.kdc = id;
    btn.textContent = label;
    btn.setAttribute("aria-pressed", id === "all" ? "true" : "false");
    box.append(btn);
  };
  add("all", "전체");
  for (const row of KDC) {
    if (have.has(row.id)) add(row.id, `${row.name} ${row.code}`);
  }
  if (missing) add("none", "미분류");
  bindPressed(box);
}

function wire() {
  document.querySelectorAll(".seg").forEach((group) => {
    const buttons = [...group.querySelectorAll("button")];
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.setAttribute("aria-checked", b === btn ? "true" : "false"));
        renderShelves();
      });
      btn.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const i = buttons.indexOf(btn);
        const next = buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
        next.click();
        next.focus();
        e.preventDefault();
      });
    });
  });
  onlyEl.addEventListener("click", () => {
    const on = onlyEl.getAttribute("aria-pressed") === "true";
    onlyEl.setAttribute("aria-pressed", on ? "false" : "true");
    renderShelves();
  });
  readsEl.addEventListener("click", () => {
    const on = readsEl.getAttribute("aria-pressed") === "true";
    readsEl.setAttribute("aria-pressed", on ? "false" : "true");
    renderShelves();
  });
  qEl.addEventListener("input", renderShelves);
  qEl.addEventListener("keydown", (e) => { if (e.key === "Enter") e.currentTarget.blur(); });
  shelvesEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-title]");
    if (!btn) return;
    const book = byTitle.get(btn.dataset.title);
    if (book) openBook(book);
  });
  document.getElementById("close").addEventListener("click", closeDetail);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.classList.contains("sheet")) closeDetail();
  });
  dialog.addEventListener("close", () => {
    if (!detailState) return;
    detailState = false;
    history.back();
  });
  window.addEventListener("popstate", () => {
    if (!dialog.open) return;
    detailState = false;
    dialog.close();
  });
  const cardTop = dialog.querySelector(".card-top");
  let swipeY = null;
  cardTop.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".close")) return;
    swipeY = e.clientY;
  });
  cardTop.addEventListener("pointerup", (e) => {
    if (swipeY == null) return;
    const dy = e.clientY - swipeY;
    swipeY = null;
    if (dy > 56) closeDetail();
  });
  cardTop.addEventListener("pointercancel", () => { swipeY = null; });
  cycleEl.addEventListener("click", (e) => {
    if (!current) return;
    const span = e.target.closest("[data-v]");
    const cur = statusOf(current.title);
    const next = span && span.dataset.v !== cur ? span.dataset.v : nextStatus(cur);
    saveStatus(current.title, next);
    paintCycle(next);
    renderShelves();
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
      const extra = extras(b);
      return {
        i,
        cat: b[0],
        title: b[1],
        author: b[2] || "",
        cover: b[3] || "",
        contents: extra.contents,
        color: extra.color,
        call: extra.kdc,
        snu: rec.snu || { s: "none" },
        pt: rec.pt || { s: "none" },
      };
    });
    byTitle = new Map(books.map((b) => [b.title, b]));
    mountClasses();
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
