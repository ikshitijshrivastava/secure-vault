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
/* ===== nav.js PART 2 of 2. Append to the end. Dashboard, owner screen, detail links, router and tests. ===== */

/* ---------- document card: the card opens the document, name chips open the profile ---------- */
function navDocCard(g, map) {
  const L = g.latest;
  const owners = vuOwnersOf(L);
  const s = statusOf(daysLeft(L.expiry));
  const edge = owners.length ? uiColor(owners[0]) : '#98a2b3';
  return vuEl('li', {
    cls: 'card',
    style: 'border-left-color:' + edge,
    on: { click: () => vuGo('detail', g.groupId) }
  }, [
    vuEl('strong', { text: L.title || L.kind }),
    vuEl('div', {}, owners.length
      ? owners.map(id => navChip(id, map.get(id) || 'Removed'))
      : [vuEl('small', { text: 'Unassigned' })]),
    vuEl('small', { text: [L.kind, L.issuer, L.number].filter(Boolean).join(' · ') }),
    vuEl('span', { cls: 'badge', text: s.label, style: 'color:' + UI_STATUS[s.cls] }),
    g.older.length ? vuEl('small', { text: g.older.length + ' older version(s) kept' }) : ''
  ]);
}

/* ---------- dashboard: clickable names, fuzzy search, sorting ---------- */
vuDashboard = async function (body) {
  const focus = PC_OPEN_FOR;        // set when a profile card or banner asks for one owner
  PC_OPEN_FOR = null;
  const all = await vuLoadAll();
  const map = vuNameMap(all);
  const groups = navGroups(all);

  body.append(vuEl('h2', { text: 'Dashboard' }));
  body.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Import old documents', async () => {
      try {
        const n = await v2ImportOld();
        alert('Imported ' + n + ' old document(s).');
        vuGo('dash');
      } catch (e) { alert('Import failed: ' + e.message); }
    }, true),
    vuBtn('Suggest issuers for existing documents', () => vuGo('issuers'), true)
  ]));

  if (all.people.length || all.vehicles.length) {
    body.append(vuEl('p', { cls: 'hint', text: 'Tap a name to open that person or vehicle:' }));
    body.append(vuEl('div', { cls: 'row' }, [
      ...all.people.map(p => navChip(p.id, p.name)),
      ...all.vehicles.map(v => navChip(v.id, v.number))
    ]));
  }

  // Owner banner, shown when arriving from a profile card or the owner screen
  let bannerNote = null;
  if (focus) {
    const exists = (focus.kind === 'person' ? all.people : all.vehicles).some(x => x.id === focus.id);
    const banner = vuEl('div', {
      id: 'pc-banner',
      style: 'background:#eef4ff;border:1px solid #1565c0;border-radius:10px;padding:10px;margin:8px 0'
    });
    if (exists) {
      NV.owner = focus.id;
      bannerNote = vuEl('small', {});
      banner.append(
        vuEl('strong', { text: 'Documents for ' + focus.name }),
        bannerNote,
        vuEl('div', { cls: 'row' }, [
          vuBtn('+ Add document for ' + focus.name, () => { PC_ADD_FOR = focus; vuGo('form'); }),
          vuBtn('Show everyone', () => {
            NV.owner = '';
            ownerSel.value = '';
            banner.remove();
            draw();
          }, true)
        ])
      );
    } else {
      banner.append(vuEl('strong', { text: focus.name + ' is no longer in the vault.' }));
    }
    body.append(banner);
  }

  const search = vuEl('input', {
    type: 'search',
    placeholder: 'Search name, number, issuer, type (typos are fine)',
    value: NV.q
  });
  const ownerSel = vuEl('select', {}, [
    vuEl('option', { value: '', text: 'Everyone' }),
    ...all.people.map(p => vuEl('option', { value: p.id, text: 'Person: ' + p.name })),
    ...all.vehicles.map(v => vuEl('option', { value: v.id, text: 'Vehicle: ' + v.number }))
  ]);
  if (!Array.from(ownerSel.options).some(o => o.value === NV.owner)) NV.owner = '';
  ownerSel.value = NV.owner;
  const sortSel = vuEl('select', {}, NV_SORTS.map(([v, t]) => vuEl('option', { value: v, text: t })));
  sortSel.value = NV.sort;
  const countEl = vuEl('p', { cls: 'hint' });
  const list = vuEl('ul', { style: 'list-style:none;padding:0;margin:0' });
  body.append(vuEl('div', { cls: 'toolbar' }, [search, ownerSel]));
  body.append(vuEl('div', { cls: 'toolbar' }, [sortSel]));
  body.append(countEl, list);

  const draw = () => {
    NV.q = search.value;
    NV.owner = ownerSel.value;
    NV.sort = sortSel.value;
    const rows = navRows(NV, map, groups);
    list.innerHTML = '';
    for (const r of rows) list.append(navDocCard(r.g, map));
    const typed = NV.q.trim();
    countEl.textContent = 'Showing ' + rows.length + ' of ' + groups.length + ' document(s)' +
      (typed ? ' matching "' + typed + '"' : '');
    if (bannerNote && focus) {
      const linked = groups.filter(g => [g.latest, ...g.older].some(d => vuOwnersOf(d).includes(focus.id)));
      bannerNote.textContent = linked.length
        ? linked.length + ' document group(s) linked to ' + focus.name
        : 'No documents are linked to ' + focus.name + ' yet. Tap + Add document for ' + focus.name + '.';
    }
    if (!rows.length) {
      list.append(vuEl('p', {
        cls: 'hint',
        text: groups.length
          ? 'No documents match. Check the spelling, or try a shorter word.'
          : 'No documents yet. Tap + Add document.'
      }));
    }
  };

  search.addEventListener('input', draw);
  ownerSel.addEventListener('change', draw);
  sortSel.addEventListener('change', draw);
  draw();
};

/* ---------- document detail: owner names open their profile ---------- */
vuDocInfo = function (d, map) {
  const s = statusOf(daysLeft(d.expiry));
  const owners = vuOwnersOf(d);
  const dl = vuEl('dl', {});
  dl.append(
    vuEl('dt', { text: 'Owners' }),
    vuEl('dd', {}, owners.length
      ? owners.map(id => navChip(id, map.get(id) || 'Removed'))
      : [vuEl('span', { text: 'Unassigned' })])
  );
  const rows = [
    ['Kind', d.kind], ['Type', d.type], ['Issuer / provider', d.issuer || 'Not set'],
    ['Number', d.number], ['Issue date', d.issue ? smShow(d.issue) : ''],
    ['Expiry date', d.expiry ? smShow(d.expiry) : ''], ['Status', s.label],
    ['Other details', d.notes], ['Pages stored', String((d.pageIds || []).length)]
  ];
  for (const [k, val] of rows) if (val) dl.append(vuEl('dt', { text: k }), vuEl('dd', { text: val }));
  return dl;
};

/* ---------- owner screen: one person or vehicle with their documents ---------- */
async function navOwnerScreen(body, id) {
  const all = await vuLoadAll();
  const map = vuNameMap(all);
  const person = all.people.find(p => p.id === id) || null;
  const veh = person ? null : (all.vehicles.find(v => v.id === id) || null);
  if (!person && !veh) {
    body.append(vuEl('p', { cls: 'hint', text: 'This person or vehicle is no longer in the vault.' }));
    return;
  }
  const owner = person
    ? { kind: 'person', id, name: person.name }
    : { kind: 'vehicle', id, name: veh.number };
  const col = uiColor(id);
  const url = person ? await vuPhotoUrl(person.photoId) : null;
  const avatar = url
    ? vuEl('img', { src: url, alt: '', style: 'width:96px;height:96px;object-fit:cover;border-radius:12px;border:3px solid ' + col + ';flex:0 0 auto' })
    : vuEl('div', {
        text: person ? owner.name.charAt(0).toUpperCase() : 'Car',
        style: 'width:96px;height:96px;border-radius:12px;background:' + col + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:' + (person ? '36' : '18') + 'px;font-weight:700;flex:0 0 auto'
      });
  const docs = all.docs.filter(d => vuOwnersOf(d).includes(id));
  const facts = person
    ? [person.relation, person.dob ? 'DOB ' + smShow(person.dob) : ''].filter(Boolean)
    : [veh.make].filter(Boolean);
  const notes = person ? person.notes : veh.notes;

  body.append(vuEl('div', {
    style: 'display:flex;gap:14px;align-items:center;background:#fff;border-radius:12px;padding:12px;border-left:6px solid ' + col
  }, [
    avatar,
    vuEl('div', { style: 'min-width:0' }, [
      vuEl('strong', { text: owner.name, style: 'font-size:20px' }),
      vuEl('small', { text: (person ? 'Person' : 'Vehicle') + (facts.length ? ' · ' + facts.join(' · ') : '') }),
      vuEl('small', { text: docs.length + ' document(s)' }),
      notes ? vuEl('small', { text: notes }) : ''
    ])
  ]));

  body.append(vuEl('div', { cls: 'row' }, [
    vuBtn('View in dashboard', () => { PC_OPEN_FOR = owner; vuGo('dash'); }, true),
    vuBtn('+ Add document for ' + owner.name, () => { PC_ADD_FOR = owner; vuGo('form'); }),
    vuBtn('Edit', () => vuGo(person ? 'person' : 'vehicle', id), true)
  ]));

  body.append(vuEl('h2', { text: 'Documents' }));
  const groups = v2Dashboard(docs).sort((a, b) =>
    (a.latest.expiry || '9999-12-31').localeCompare(b.latest.expiry || '9999-12-31'));
  if (!groups.length) {
    body.append(vuEl('p', { cls: 'hint', text: 'No documents yet for ' + owner.name + '.' }));
    return;
  }
  const ul = vuEl('ul', { style: 'list-style:none;padding:0;margin:0' });
  for (const g of groups) ul.append(navDocCard(g, map));
  body.append(ul);
}

/* ---------- router: adds the owner screen to the existing navigation ---------- */
const navBaseGo = vuGo;
vuGo = async function (tab, arg) {
  if (tab !== 'owner') return navBaseGo(tab, arg);
  const root = vuRootEl();
  root.innerHTML = '';
  root.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Dashboard', () => vuGo('dash'), true),
    vuBtn('Profiles', () => vuGo('profiles'), true),
    vuBtn('+ Add document', () => vuGo('form'), true),
    vuBtn('Close', () => vuClose(), true)
  ]));
  const body = vuEl('div', {});
  root.append(body);
  try { await navOwnerScreen(body, arg); }
  catch (e) { body.append(vuEl('p', { cls: 'error', text: 'Something went wrong: ' + e.message })); }
};

/* ---------- tests: run on the tablet, changes no data ---------- */
async function navSelfTest() {
  const lines = [];
  const ok = (c, m) => lines.push((c ? 'PASS  ' : 'FAIL  ') + m);
  try {
    const map = new Map([['p1', 'Kshitij Shrivastava'], ['v1', 'WB06L2307']]);
    const car = {
      id: 'd1', groupId: 'g1', title: 'Car insurance - WB06L2307', kind: 'Car insurance', type: 'Insurance',
      issuer: 'TATA AIG General Insurance Company Limited', number: '0157681764 09 00',
      notes: '', owners: ['v1'], createdAt: 1, expiry: '2027-10-29'
    };
    const passport = {
      id: 'd2', groupId: 'g2', title: 'Passport - Kshitij Shrivastava', kind: 'Passport', type: 'Identity',
      issuer: '', number: 'K1234567', notes: '', owners: ['p1'], createdAt: 2, expiry: '2031-01-01'
    };
    ok(navScore(car, 'insurence', map) > 0, 'typo "insurence" finds Car insurance');
    ok(navScore(car, 'tatta aig', map) > 0, 'typo "tatta" finds TATA AIG');
    ok(navScore(car, 'wb06 l2307', map) > 0, 'spaces ignored: "wb06 l2307" finds WB06L2307');
    ok(navScore(car, 'carinsurance', map) > 0, 'words typed without a space still match');
    ok(navScore(car, '0157681', map) > 0, 'partial number "0157681" finds the policy number');
    ok(navScore(passport, 'shrivastva', map) > 0, 'name typo "shrivastva" finds the owner');
    ok(navScore(car, 'zzzqqq', map) === 0, 'an unrelated word finds nothing');

    const mk = (id, title, expiry, createdAt) => ({
      id, groupId: id, title, kind: 'Other', type: 'Other', issuer: '', owners: [],
      expiry, createdAt, pageIds: [], notes: '', number: ''
    });
    const groups = v2Dashboard([
      mk('A', 'Zebra', '2027-10-29', 3),
      mk('B', 'Alpha', '', 2),
      mk('C', 'Mid', '2026-05-01', 1)
    ]);
    const order = sort => groups.slice()
      .sort((x, y) => navSortCmp(sort, x, y, new Map()))
      .map(g => g.latest.title).join(' > ');
    ok(order('expiry') === 'Mid > Zebra > Alpha', 'sort: soonest expiry first, undated last (' + order('expiry') + ')');
    ok(order('expiry-desc') === 'Zebra > Mid > Alpha', 'sort: latest expiry first, undated last (' + order('expiry-desc') + ')');
    ok(order('title') === 'Alpha > Mid > Zebra', 'sort: title A to Z');
    ok(order('added') === 'Zebra > Alpha > Mid', 'sort: recently added first');
    ok(order('status') === 'Mid > Zebra > Alpha', 'sort: expired first, then valid, then undated');

    const all = await vuLoadAll();
    if (all.people.length) {
      const p = all.people[0];
      ok(navChip(p.id, p.name).dataset.ownerId === p.id, 'a saved name chip is clickable and carries the person id');
    } else {
      lines.push('INFO  add a person to test the clickable name chip');
    }
    ok(navChip('no-such-id', 'Nobody').dataset.ownerId === undefined, 'an unknown name shows but is not clickable');
  } catch (e) {
    lines.push('FAIL  test stopped: ' + e.message);
  }
  alert('Search, sort and clickable name tests\n\n' + lines.join('\n'));
}

(function navButton() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('nv-test')) return;
  const b = document.createElement('button');
  b.id = 'nv-test';
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Run search and sort tests';
  b.onclick = navSelfTest;
  bk.appendChild(b);
})();
