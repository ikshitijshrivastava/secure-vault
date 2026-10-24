/* ===== nav.js PART 1 of 2. Create the file with this part. Clickable names, fuzzy search and sort helpers. ===== */
'use strict';

const NV_SORTS = [
  ['expiry', 'Expiry: soonest first'],
  ['expiry-desc', 'Expiry: latest first'],
  ['status', 'Status: expired first'],
  ['title', 'Title: A to Z'],
  ['owner', 'Owner: A to Z'],
  ['issuer', 'Issuer: A to Z'],
  ['type', 'Type: A to Z'],
  ['added', 'Recently added first']
];
const NV_STATUS_RANK = { expired: 0, soon: 1, ok: 2, none: 3 };
let NV = { q: '', owner: '', sort: 'expiry' };   // dashboard state, kept while the app is open

/* ---------- navigation ---------- */
function navShow(tab, arg) {
  VU_OLD_VIEWS.forEach(v => $(v).classList.add('hidden'));
  vuRootEl().classList.remove('hidden');
  setTop(true);
  return vuGo(tab, arg);
}
function navOpenOwner(id) {
  return navShow('owner', id);
}

/* ---------- clickable name chips ---------- */
function navChip(id, text) {
  const known = UI_COLORS.has(id);
  const chip = vuEl('span', {
    cls: 'chip',
    text,
    style: 'background:' + uiColor(id) + ';cursor:' + (known ? 'pointer' : 'default')
  });
  if (known) {
    chip.dataset.ownerId = id;
    chip.title = 'Open profile';
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.addEventListener('click', e => { e.stopPropagation(); navOpenOwner(id); });
    chip.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.stopPropagation(); navOpenOwner(id); }
    });
  }
  return chip;
}

/* ---------- fuzzy search: tolerates typos, extra spaces and partial numbers ---------- */
function navNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function navEdit(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
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
// True if the letters of t appear in order inside w, e.g. "shvt" inside "shrivastava"
function navSubseq(t, w) {
  let i = 0;
  for (const ch of w) {
    if (ch === t[i]) i++;
    if (i === t.length) return true;
  }
  return false;
}
// 3 = exact part, 2 = close typo, 1 = loose match, 0 = no match
function navTokenScore(t, words, compact) {
  if (compact.includes(t)) return 3;
  const lim = t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0;
  let best = 0;
  for (const w of words) {
    if (w.includes(t)) return 3;
    if (lim && Math.abs(w.length - t.length) <= lim && navEdit(t, w) <= lim) {
      best = Math.max(best, 2);
    } else if (t.length >= 4 && w[0] === t[0] && navSubseq(t, w)) {
      best = Math.max(best, 1);
    }
  }
  return best;
}
// Score for one document. Every word typed must match somewhere in the document.
function navScore(d, q, map) {
  const owners = vuOwnersOf(d).map(id => map.get(id) || '').join(' ');
  const words = navNorm([d.title, d.kind, d.type, d.issuer, d.number, d.notes, owners].join(' '))
    .split(' ').filter(Boolean);
  const compact = words.join('');
  const tokens = navNorm(q).split(' ').filter(Boolean);
  let total = 0;
  for (const t of tokens) {
    const s = navTokenScore(t, words, compact);
    if (!s) return 0;
    total += s;
  }
  return total;
}

/* ---------- sorting ---------- */
function navOwnerName(map, d) {
  const ids = vuOwnersOf(d);
  return ids.length ? (map.get(ids[0]) || '') : '';
}
const navAdded = g => Math.max(0, ...[g.latest, ...g.older].map(d => d.createdAt || 0));
function navSortCmp(sort, A, B, map) {
  const a = A.latest, b = B.latest;
  const asc = (x, y) => (x.expiry || '9999-12-31').localeCompare(y.expiry || '9999-12-31');
  const desc = (x, y) => (y.expiry || '').localeCompare(x.expiry || '');
  const text = (x, y) => String(x || '').localeCompare(String(y || ''), undefined, { sensitivity: 'base', numeric: true });
  const emptyLast = (x, y, then) => ((x ? 0 : 1) - (y ? 0 : 1)) || then();
  const rank = d => NV_STATUS_RANK[statusOf(daysLeft(d.expiry)).cls];
  switch (sort) {
    case 'expiry-desc': return desc(a, b) || text(a.title || a.kind, b.title || b.kind);
    case 'status': return (rank(a) - rank(b)) || asc(a, b);
    case 'title': return text(a.title || a.kind, b.title || b.kind);
    case 'owner': {
      const x = navOwnerName(map, a), y = navOwnerName(map, b);
      return emptyLast(x, y, () => text(x, y));
    }
    case 'issuer': return emptyLast(a.issuer, b.issuer, () => text(a.issuer, b.issuer));
    case 'type': return text(a.type, b.type) || text(a.title, b.title);
    case 'added': return navAdded(B) - navAdded(A);
    default: return asc(a, b) || text(a.title || a.kind, b.title || b.kind);
  }
}

/* ---------- filter, score and sort the dashboard groups ---------- */
function navGroups(all) {
  return v2Dashboard(all.docs);
}
function navRows(st, map, groups) {
  const rows = [];
  for (const g of groups) {
    const versions = [g.latest, ...g.older];
    if (st.owner && !versions.some(d => vuOwnersOf(d).includes(st.owner))) continue;
    let score = 1;
    if (st.q.trim()) {
      score = Math.max(...versions.map(d => navScore(d, st.q, map)));
      if (!score) continue;
    }
    rows.push({ g, score });
  }
  const searching = st.q.trim() !== '';
  rows.sort((x, y) => (searching ? y.score - x.score : 0) || navSortCmp(st.sort, x.g, y.g, map));
  return rows;
}
