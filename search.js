/* ===== search.js PART 1 of 2. Create the file with this part. Fuzzy search engine. ===== */
'use strict';

let SR_VIEW = { q: '', snip: new Map() };   // the current screen's query, and where each match was found
const SR_CACHE = new Map();                  // document id -> searchable parts
const SR_W = { title: 4, number: 4, owner: 3, issuer: 3, kind: 3, notes: 2, dates: 2, page: 1 };
const SR_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// Every common way a date can be typed or printed
function srDateForms(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const p = n => String(n).padStart(2, '0');
  const mon = SR_MONTHS[m - 1];
  return [
    iso, `${p(d)}/${p(m)}/${y}`, `${p(d)}-${p(m)}-${y}`, `${d} ${mon.slice(0, 3)} ${y}`,
    `${d} ${mon} ${y}`, `${mon} ${y}`, `${mon.slice(0, 3)} ${y}`, String(y)
  ].join(' ');
}

// Number of single-letter changes between two words
function srEdit(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// True when the letters of t appear in order inside w, e.g. "shvt" inside "shrivastava"
function srSub(t, w) {
  let i = 0;
  for (const ch of w) {
    if (ch === t[i]) i++;
    if (i === t.length) return true;
  }
  return false;
}

// One searchable field: its words, joined text, and compact text without spaces
function srEntry(label, raw, weight) {
  const words = agNorm(String(raw || '')).split(' ').filter(Boolean);
  const set = new Set(words);
  const byLen = {};
  for (const w of set) (byLen[w.length] = byLen[w.length] || []).push(w);
  return {
    label, weight, raw: words.join(' '),
    joined: ' ' + words.join(' ') + ' ', compact: words.join(''),
    words: set, byLen
  };
}

// Builds (or reuses) a document's searchable fields. Owner names come from the map, so renames apply at once.
function srIndexOf(d, map = new Map()) {
  const names = vuOwnersOf(d).map(id => map.get(id) || '').join(' ');
  const text = d.searchText || '';
  const sig = [d.id, d.updatedAt || 0, text.length, text.slice(0, 64), names,
    d.title, d.number, d.issuer, d.notes, d.issue, d.expiry, d.kind, d.type].join('|');
  if (!d.noCache) {
    const hit = SR_CACHE.get(d.id);
    if (hit && hit.sig === sig) return hit;
  }
  const dates = (srDateForms(d.issue) + ' ' + srDateForms(d.expiry)).trim();
  const parts = [
    ['title', d.title, SR_W.title],
    ['number', d.number, SR_W.number],
    ['owner', names, SR_W.owner],
    ['issuer', d.issuer, SR_W.issuer],
    ['kind', [d.kind, d.type].filter(Boolean).join(' '), SR_W.kind],
    ['notes', d.notes, SR_W.notes],
    ['dates', dates, SR_W.dates],
    ['page text', text, SR_W.page]
  ];
  const idx = {
    sig,
    entries: parts.filter(p => p[1] && String(p[1]).trim()).map(([l, r, w]) => srEntry(l, r, w))
  };
  if (!d.noCache) SR_CACHE.set(d.id, idx);
  return idx;
}

// Splits the query into words and "quoted phrases". Spaces, dashes, and dots are ignored inside a word.
function srParse(q) {
  const out = [];
  const s = String(q || '');
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) {
      const words = agNorm(m[1]).split(' ').filter(Boolean);
      if (words.length) out.push({ phrase: true, words });
    } else {
      const t = agNorm(m[2]).replace(/ /g, '');
      if (t) out.push({ phrase: false, t });
    }
  }
  return out;
}

// One word against one field. 3 exact word, 2.5 start of a word or a number, 2 typo, 1 loose match, 0 none.
function srTok(t, e) {
  const pref = t.length >= 2 ? ' ' + t : ' ' + t + ' ';
  const i = e.joined.indexOf(pref);
  if (i >= 0) {
    const w = e.joined.slice(i + 1).split(' ')[0];
    return { q: w === t ? 3 : 2.5, i: i + 1, w };
  }
  if (t.length >= 3 || (/\d/.test(t) && t.length >= 2)) {
    if (e.compact.includes(t)) return { q: 2.5, i: -1, w: '' };
  }
  if (!/\d/.test(t)) {
    const lim = t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0;
    for (let L = t.length - lim; lim && L <= t.length + lim; L++) {
      for (const w of e.byLen[L] || []) {
        if (srEdit(t, w) <= lim) return { q: 2, i: -1, w };
      }
    }
    if (t.length >= 4) {
      for (const w of e.words) {
        if (w[0] === t[0] && srSub(t, w)) return { q: 1, i: -1, w };
      }
    }
  }
  return { q: 0, i: -1, w: '' };
}

// A quoted phrase must appear with its words in order
function srPhrase(words, e) {
  const i = e.joined.indexOf(' ' + words.join(' ') + ' ');
  return i >= 0 ? { q: 3, i: i + 1, w: words.join(' ') } : { q: 0, i: -1, w: '' };
}

// The short text shown as "Matched in …"
function srSnippet(e, r) {
  if (!e) return '';
  if (e.label === 'page text' && r.i >= 0) {
    const from = Math.max(0, r.i - 40);
    return 'page text: "' + (from > 0 ? '…' : '') + e.joined.slice(from, r.i + 80).trim() + '…"';
  }
  return e.label + ': ' + e.raw.slice(0, 90);
}

// Scores one document. Every word in the query must match somewhere, or the score is 0.
function srScoreDoc(d, q, map = new Map()) {
  const tokens = srParse(q);
  if (!tokens.length) return { score: 1, snip: '' };
  const idx = srIndexOf(d, map);
  let total = 0, snip = '', snipScore = 0;
  for (const tk of tokens) {
    let best = 0, bestE = null, bestR = null;
    for (const e of idx.entries) {
      const r = tk.phrase ? srPhrase(tk.words, e) : srTok(tk.t, e);
      const v = r.q * e.weight;
      if (v > best) { best = v; bestE = e; bestR = r; }
    }
    if (!best) return { score: 0, snip: '' };
    total += best;
    if (best > snipScore) { snipScore = best; snip = srSnippet(bestE, bestR); }
  }
  return { score: total, snip };
  }
