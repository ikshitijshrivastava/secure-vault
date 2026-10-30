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
/* ===== search.js PART 2 of 2. Append to the end. Screens, indexing, tests. ===== */

// Used by the filters on the form, which search plain text
function srScoreTitle(text, qt, map) {
  return srScoreDoc({ id: 'text:' + text, noCache: true, updatedAt: 0, title: text,
    owners: [], pageIds: [], searchText: '' }, qt, map).score > 0;
}

// A person or vehicle as a searchable record, so profile searches match relation, date of birth, make, and notes
function srOwnerDoc(id, all) {
  const p = all.people.find(x => x.id === id);
  if (p) {
    return { id: 'owner:' + id, noCache: true, updatedAt: 0, title: p.name,
      kind: p.relation || 'Person', type: 'Person', number: '', issuer: '',
      notes: [p.notes, srDateForms(p.dob)].filter(Boolean).join(' '),
      issue: '', expiry: '', owners: [], pageIds: [], searchText: '' };
  }
  const v = all.vehicles.find(x => x.id === id);
  if (v) {
    return { id: 'owner:' + id, noCache: true, updatedAt: 0, title: v.number,
      kind: 'Vehicle', type: 'Vehicle', number: v.number, issuer: '',
      notes: [v.make, v.notes].filter(Boolean).join(' '),
      issue: '', expiry: '', owners: [], pageIds: [], searchText: '' };
  }
  return null;
}

// Reads one stored document record directly, without loading the whole list
async function srRecord(id) {
  const r = await v2Tx('docs', 'readonly', os => os.get(id));
  return r ? JSON.parse(dec.decode(await decrypt(key, r.iv, r.data))) : null;
}

// Every saved document also stores the text read from its pages.
// Editing an indexed document adds the new text. A document not yet indexed is left for the index button.
const srBaseV2Put = v2Put;
v2Put = async function (store, obj) {
  if (store === 'docs' && obj && obj.searchText === undefined) {
    const old = await srRecord(obj.id).catch(() => null);
    const added = typeof LN_LAST !== 'undefined' && LN_LAST.text ? agNorm(LN_LAST.text) : '';
    if (old && typeof old.searchText === 'string') {
      obj = { ...obj, searchText: (old.searchText + ' ' + added).trim().slice(0, 60000) };
    } else if (!old && added) {
      obj = { ...obj, searchText: added.slice(0, 60000) };
    }
  }
  return srBaseV2Put(store, obj);
};

// Reads the pages of every document that has no text index yet, and stores the text
async function srBackfill(status) {
  const all = await vuLoadAll();
  const todo = all.docs.filter(d => d.searchText === undefined);
  let n = 0, failed = 0;
  for (const d of todo) {
    n++;
    status.textContent = 'Indexing ' + n + ' of ' + todo.length + ': ' + (d.title || d.kind) + '...';
    let text = '';
    try { text = await ssDocText(d); } catch (e) { failed++; }
    const fresh = (await srRecord(d.id)) || d;
    await v2Put('docs', { ...fresh, searchText: agNorm(text).slice(0, 60000) });
  }
  status.textContent = 'Indexed ' + (todo.length - failed) + ' document(s)' +
    (failed ? ', ' + failed + ' could not be read' : '') + '.';
}

// A search box with its result count
function srSearchBox(placeholder) {
  const input = vuEl('input', { type: 'search', placeholder, style: 'margin:6px 0' });
  const count = vuEl('p', { cls: 'hint' });
  return { wrap: vuEl('div', {}, [input, count]), input, count };
}

// Filters and ranks the cards of one list. Each card's data-group-id matches an entry in groups.
function srApplyList(ul, groups, map, query, countEl) {
  const qt = String(query || '').trim();
  const byId = new Map(groups.map(g => [g.groupId, g]));
  const rows = [];
  for (const li of Array.from(ul.children)) {
    li.querySelectorAll('.sr-hit').forEach(n => n.remove());
    const g = byId.get(li.dataset.groupId);
    let score = 1, snip = '';
    if (g && qt) {
      SR_VIEW = { q: qt, snip: new Map() };
      const docs = [g.latest, ...g.older];
      score = Math.max(0, ...docs.map(d => navScore(d, qt, map)));
      const best = docs.map(d => SR_VIEW.snip.get(d.id)).filter(Boolean).sort((a, b) => b.score - a.score)[0];
      snip = best ? best.snip : '';
    }
    li.style.display = score ? '' : 'none';
    if (score && snip) li.append(vuEl('small', { cls: 'sr-hit', text: 'Matched in ' + snip, style: 'color:#1565c0' }));
    rows.push({ li, score });
  }
  if (qt) rows.sort((a, b) => b.score - a.score).forEach(r => ul.append(r.li));
  const shown = rows.filter(r => r.score).length;
  countEl.textContent = qt ? shown + ' of ' + rows.length + ' match "' + qt + '"' : rows.length + ' item(s)';
}

/* ---------- scoring hook: stores where each match was found ---------- */
navScore = function (d, q, map) {
  const r = srScoreDoc(d, q, map);
  const prev = SR_VIEW.snip.get(d.id);
  if (r.score && (!prev || prev.score < r.score)) SR_VIEW.snip.set(d.id, { score: r.score, snip: r.snip });
  return r.score;
};

/* ---------- dashboard: the match line on each card ---------- */
const srBaseRows = navRows;
navRows = function (st, map, groups) {
  SR_VIEW = { q: String(st.q || '').trim(), snip: new Map() };
  return srBaseRows(st, map, groups);
};
const srBaseCard = navDocCard;
navDocCard = function (g, map) {
  const li = srBaseCard(g, map);
  li.dataset.groupId = g.groupId;
  if (SR_VIEW.q) {
    const best = [g.latest, ...g.older].map(d => SR_VIEW.snip.get(d.id))
      .filter(Boolean).sort((a, b) => b.score - a.score)[0];
    if (best && best.snip) li.append(vuEl('small', { cls: 'sr-hit', text: 'Matched in ' + best.snip, style: 'color:#1565c0' }));
  }
  return li;
};

/* ---------- dashboard: index button, shown beneath the normal dashboard ---------- */
const srBaseDash = vuDashboard;
vuDashboard = async function (body) {
  await srBaseDash(body);
  const all = await vuLoadAll();
  const pending = all.docs.filter(d => d.searchText === undefined).length;
  const status = vuEl('p', {
    cls: 'hint',
    text: pending ? pending + ' document(s) not yet indexed for text search.' : 'Every document is indexed for text search.'
  });
  const btn = vuBtn('Index documents for text search', async () => {
    btn.disabled = true;
    try { await srBackfill(status); }
    catch (e) { status.textContent = 'Indexing stopped: ' + e.message; }
    btn.disabled = false;
    alert(status.textContent);
    vuGo('dash');
  }, true);
  body.append(vuEl('div', { cls: 'row' }, [btn]), status);
};

/* ---------- owner page ---------- */
const srBaseOwner = navOwnerScreen;
navOwnerScreen = async function (body, id) {
  SR_VIEW = { q: '', snip: new Map() };
  await srBaseOwner(body, id);
  const ul = body.querySelector('ul');
  if (!ul) return;
  const all = await vuLoadAll();
  const map = vuNameMap(all);
  const groups = v2Dashboard(all.docs.filter(d => vuOwnersOf(d).includes(id)));
  const box = srSearchBox("Search this person's or vehicle's documents: title, number, issuer, dates, text inside pages");
  ul.before(box.wrap);
  box.input.addEventListener('input', () => srApplyList(ul, groups, map, box.input.value, box.count));
  srApplyList(ul, groups, map, '', box.count);
};

/* ---------- profiles ---------- */
const srBaseProfiles = vuProfiles;
vuProfiles = async function (body) {
  await srBaseProfiles(body);
  const all = await vuLoadAll();
  const map = vuNameMap(all);
  const box = srSearchBox('Search people and vehicles, their details, and their documents');
  body.insertBefore(box.wrap, body.firstChild);
  const run = () => {
    const qt = box.input.value.trim();
    let shown = 0;
    body.querySelectorAll('li.card[data-owner-id]').forEach(li => {
      li.querySelectorAll('.sr-hit').forEach(n => n.remove());
      li.style.display = '';
      if (!qt) { shown++; return; }
      const id = li.dataset.ownerId;
      const ownDoc = srOwnerDoc(id, all);
      const own = ownDoc ? srScoreDoc(ownDoc, qt, map) : { score: 0, snip: '' };
      let hits = 0, docSnip = '';
      for (const g of v2Dashboard(all.docs.filter(d => vuOwnersOf(d).includes(id)))) {
        for (const d of [g.latest, ...g.older]) {
          const r = srScoreDoc(d, qt, map);
          if (r.score) { hits++; if (!docSnip) docSnip = r.snip; break; }
        }
      }
      const match = own.score > 0 || hits > 0;
      li.style.display = match ? '' : 'none';
      if (match) {
        shown++;
        const parts = [];
        if (own.score) parts.push('details match');
        if (hits) parts.push(hits + ' matching document(s)');
        if (docSnip) parts.push('e.g. ' + docSnip);
        li.append(vuEl('small', { cls: 'sr-hit', text: parts.join(' · '), style: 'color:#1565c0' }));
      }
    });
    box.count.textContent = qt ? shown + ' match "' + qt + '"' : '';
  };
  box.input.addEventListener('input', run);
};

/* ---------- issuer suggestions: cards are listed in title order, as the screen builds them ---------- */
const srBaseIssuers = ssIssuerScreen;
ssIssuerScreen = async function (body) {
  SR_VIEW = { q: '', snip: new Map() };
  await srBaseIssuers(body);
  const ul = body.querySelector('ul');
  if (!ul) return;
  const all = await vuLoadAll();
  const map = vuNameMap(all);
  const sorted = all.docs.slice().sort((a, b) => (a.title || a.kind || '').localeCompare(b.title || b.kind || ''));
  const groups = sorted.map(d => ({ groupId: 'doc:' + d.id, latest: d, older: [] }));
  Array.from(ul.children).forEach((li, i) => { if (groups[i]) li.dataset.groupId = groups[i].groupId; });
  const box = srSearchBox('Search documents: title, owner, issuer, number, dates, text inside pages');
  ul.before(box.wrap);
  box.input.addEventListener('input', () => srApplyList(ul, groups, map, box.input.value, box.count));
  srApplyList(ul, groups, map, '', box.count);
};

/* ---------- document passwords: rows are listed in title order, as the screen builds them ---------- */
const srBasePw = pwScreen;
pwScreen = async function (body) {
  SR_VIEW = { q: '', snip: new Map() };
  await srBasePw(body);
  const ul = body.querySelector('ul');
  if (!ul) return;
  const all = await vuLoadAll();
  const map = vuNameMap(all);
  const rows = [];
  for (const d of all.docs) {
    for (const pid of d.pageIds || []) {
      const meta = await pwMeta(pid).catch(() => null);
      if (meta && meta.password) rows.push({ d });
    }
  }
  rows.sort((a, b) => (a.d.title || a.d.kind || '').localeCompare(b.d.title || b.d.kind || ''));
  const groups = rows.map((r, i) => ({ groupId: 'pw:' + i, latest: r.d, older: [] }));
  Array.from(ul.children).forEach((li, i) => { if (groups[i]) li.dataset.groupId = groups[i].groupId; });
  const box = srSearchBox('Search protected documents by title, owner, issuer, or number');
  ul.before(box.wrap);
  box.input.addEventListener('input', () => srApplyList(ul, groups, map, box.input.value, box.count));
  srApplyList(ul, groups, map, '', box.count);
};

/* ---------- add document: filters for the owner list and the renewal list ---------- */
const srBaseForm = vuForm;
vuForm = async function (body, editId) {
  await srBaseForm(body, editId);
  const all = await vuLoadAll();
  const map = vuNameMap(all);

  const ownerRows = Array.from(body.querySelectorAll('label.owner-row'));
  if (ownerRows.length) {
    const box = srSearchBox('Filter people and vehicles');
    ownerRows[0].parentElement.before(box.wrap);
    box.input.addEventListener('input', () => {
      const qt = box.input.value.trim();
      let shown = 0;
      for (const r of ownerRows) {
        const ok = !qt || srScoreTitle(r.textContent, qt, map);
        r.style.display = ok ? '' : 'none';
        if (ok) shown++;
      }
      box.count.textContent = qt ? shown + ' match' : '';
    });
  }

  const sel = Array.from(body.querySelectorAll('select')).find(s =>
    Array.from(s.options).some(o => /^Auto \(|^Keep current group/.test(o.textContent)));
  if (sel) {
    const original = Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent }));
    const box = srSearchBox('Filter renewal choices');
    sel.parentElement.before(box.wrap);
    box.input.addEventListener('input', () => {
      const qt = box.input.value.trim();
      const keep = original.filter((o, i) => i === 0 || !qt || srScoreTitle(o.text, qt, map));
      const current = sel.value;
      sel.innerHTML = '';
      keep.forEach(o => sel.append(vuEl('option', { value: o.value, text: o.text })));
      if (keep.some(o => o.value === current)) sel.value = current;
      box.count.textContent = qt ? (keep.length - 1) + ' match' : '';
    });
  }
};

/* ---------- tests ---------- */
function srSelfTest() {
  const lines = [];
  const ok = (c, m) => lines.push((c ? 'PASS  ' : 'FAIL  ') + m);
  try {
    const map = new Map([['p1', 'Kshitij Shrivastava'], ['v1', 'WB06L2307']]);
    const car = {
      id: 'test:car', noCache: true, updatedAt: 1,
      title: 'Car insurance - WB06L2307', kind: 'Car insurance', type: 'Insurance',
      issuer: 'TATA AIG General Insurance Company Limited', number: '0157681764 09 00',
      notes: '', owners: ['v1', 'p1'], issue: '2026-10-30', expiry: '2027-10-29', pageIds: [],
      searchText: agNorm('Policy schedule. The registered owner is Santula Shrivastava. Own damage and third party cover apply.')
    };
    const s = q => srScoreDoc(car, q, map).score;
    ok(s('insurence') > 0, 'typo "insurence" finds car insurance');
    ok(s('tatta aig') > 0, 'typo "tatta" finds the insurer');
    ok(s('wb 06 l2307') > 0, 'vehicle number with spaces: "wb 06 l2307"');
    ok(s('0157681') > 0, 'partial policy number "0157681" finds the document');
    ok(s('29/10/2027') > 0, 'expiry typed as 29/10/2027');
    ok(s('oct 2027') > 0, 'month and year "oct 2027"');
    ok(s('santula') > 0, 'text inside the pages: "santula"');
    ok(s('santulla') > 0, 'typo inside the pages: "santulla"');
    ok(s('santula insurance') > 0, 'two words, both found: "santula insurance"');
    ok(s('santula zebra') === 0, 'two words, one missing: no result');
    ok(s('"registered owner"') > 0, 'quoted phrase found in the pages');
    ok(s('"owner registered"') === 0, 'quoted phrase in the wrong order: no result');
    ok(s('kshitj') > 0, 'owner name with a typo: "kshitj"');
    ok(s('zzqx') === 0, 'unrelated word: no result');
    ok(srScoreDoc(car, 'santula', map).snip.includes('santula'), 'the result shows where the match is');

    const a = { id: 'test:a', noCache: true, updatedAt: 1, title: 'Car insurance', kind: '', type: '',
      issuer: '', number: '', notes: '', owners: [], searchText: '' };
    const b = { id: 'test:b', noCache: true, updatedAt: 1, title: 'Notes', kind: '', type: '',
      issuer: '', number: '', notes: '', owners: [], searchText: 'the car was parked outside' };
    ok(srScoreDoc(a, 'car', map).score > srScoreDoc(b, 'car', map).score, 'a title match ranks above a text match');

    const all = { people: [{ id: 'p1', name: 'Kshitij Shrivastava', relation: 'Self', dob: '1974-08-11', notes: '' }], vehicles: [] };
    const od = srOwnerDoc('p1', all);
    ok(!!od && srScoreDoc(od, 'self', map).score > 0, 'person relation is searchable: "self"');
    ok(!!od && srScoreDoc(od, '11/08/1974', map).score > 0, 'date of birth typed as 11/08/1974');
    ok(!!od && srScoreDoc(od, 'kshitij', map).score > 0, 'person name is searchable');
  } catch (e) {
    lines.push('FAIL  test stopped: ' + e.message);
  }
  alert('Search tests\n\n' + lines.join('\n'));
}
if (typeof AL_SUITES !== 'undefined') AL_SUITES.push(['Document search', 'srSelfTest']);
