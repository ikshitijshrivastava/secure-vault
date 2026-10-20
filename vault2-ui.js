/* ===== vault2-ui.js PART 1 of 3: data helpers, owners, voter and college readers. Create the file with this part. ===== */
'use strict';

const VU_KINDS = [
  { kind: 'Driving licence', type: 'Identity' },
  { kind: 'Voter ID card', type: 'Identity' },
  { kind: 'College ID card', type: 'Identity' },
  { kind: 'Passport', type: 'Identity' },
  { kind: 'Aadhaar card', type: 'Identity' },
  { kind: 'PAN card', type: 'Identity' },
  { kind: 'Car insurance', type: 'Insurance' },
  { kind: 'Life insurance', type: 'Insurance' },
  { kind: 'Health insurance', type: 'Insurance' },
  { kind: 'Insurance policy', type: 'Insurance' },
  { kind: 'Vehicle registration (RC)', type: 'Vehicle' },
  { kind: 'Certificate', type: 'Certificate' },
  { kind: 'Property document', type: 'Property' },
  { kind: 'Financial document', type: 'Financial' },
  { kind: 'Other', type: 'Other' }
];
const VU_TYPES = ['Identity', 'Insurance', 'Vehicle', 'Certificate', 'Property', 'Financial', 'Other'];
const VU_RELATIONS = ['Self', 'Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'];

/* ---------- small DOM helpers ---------- */
function vuEl(tag, props = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') e.textContent = v;
    else if (k === 'cls') e.className = v;
    else if (k === 'on') { for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); }
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) e.append(c);
  return e;
}
const vuBtn = (text, fn, ghost) => vuEl('button', { type: 'button', text, cls: ghost ? 'ghost' : '', on: { click: fn } });
const vuField = (label, input) => vuEl('label', {}, [vuEl('span', { text: label }), input]);
const vuTitleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const vuSnip = (text, idx, len) =>
  text.slice(Math.max(0, idx - 25), idx + len + 15).replace(/\s+/g, ' ').trim().slice(0, 110);

/* ---------- loading and owners ---------- */
async function vuLoadAll() {
  const people = await v2List('people');
  const vehicles = await v2List('vehicles');
  const docs = await v2List('docs');
  return { people, vehicles, docs };
}
// Owners: a list of person and vehicle ids. Old documents may only have ownerId.
const vuOwnersOf = d => d.owners || (d.ownerId ? [d.ownerId] : []);
function vuNameMap(all) {
  const m = new Map();
  for (const p of all.people) m.set(p.id, p.name);
  for (const v of all.vehicles) m.set(v.id, v.number);
  return m;
}
const vuOwnerLabel = (map, ids) =>
  ids.map(id => map.get(id) || 'Removed owner').join(', ') || 'Unassigned';

// Documents in one group are versions of the same thing (renewals, updated copies)
function vuGroupKey(owners, kind, number, id) {
  const digits = (number || '').replace(/\D/g, '').slice(0, 6);
  if (!digits) return 'solo|' + id;
  return [owners.slice().sort().join('+') || 'none', kind, digits].join('|');
}

/* ---------- storage ---------- */
async function vuStorePages(docId, files, startNo) {
  const ids = [];
  let n = startNo;
  for (const f of files) {
    n++;
    const pid = newId();
    await v2PutPage({ id: pid, docId, pageNo: n, name: f.name, mime: f.type || 'application/octet-stream' },
      new Uint8Array(await f.arrayBuffer()));
    ids.push(pid);
  }
  return ids;
}
async function vuPhotoUrl(pid) {
  const p = pid ? await v2GetPage(pid) : null;
  return p ? URL.createObjectURL(new Blob([p.bytes], { type: p.meta.mime })) : null;
}
async function vuSavePerson(p, photoFile) {
  const person = {
    id: p.id || newId(), name: p.name.trim(), relation: p.relation || '', dob: p.dob || '',
    notes: (p.notes || '').trim(), photoId: p.photoId || null, createdAt: p.createdAt || Date.now()
  };
  if (photoFile) {
    if (person.photoId) await v2Delete('pages', person.photoId);
    person.photoId = newId();
    await v2PutPage({ id: person.photoId, kind: 'photo', mime: photoFile.type || 'image/jpeg' },
      new Uint8Array(await photoFile.arrayBuffer()));
  }
  await v2Put('people', person);
  return person;
}
async function vuSaveVehicle(v) {
  const veh = {
    id: v.id || newId(), number: (v.number || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    make: (v.make || '').trim(), notes: (v.notes || '').trim(), createdAt: v.createdAt || Date.now()
  };
  await v2Put('vehicles', veh);
  return veh;
}
// Removes an owner from every document. Documents left with no owner are deleted.
async function vuRemoveOwner(ownerId) {
  for (const d of await v2List('docs')) {
    const owners = vuOwnersOf(d);
    if (!owners.includes(ownerId)) continue;
    const left = owners.filter(x => x !== ownerId);
    if (left.length) {
      d.owners = left;
      d.ownerId = left[0];
      await v2Put('docs', d);
    } else {
      await v2DeleteDocument(d);
    }
  }
}
async function vuDeleteOwner(store, rec) {
  await vuRemoveOwner(rec.id);
  if (rec.photoId) await v2Delete('pages', rec.photoId);
  await v2Delete(store, rec.id);
}

/* ---------- matching names and vehicle numbers to profiles ---------- */
function vuMatchPeople(text, people) {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  return people.filter(p => {
    const parts = p.name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    return parts.length >= 2 && parts.every(w => t.includes(w));
  }).map(p => p.id);
}
function vuMatchVehicles(text, vehicles) {
  const sq = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return vehicles.filter(v => v.number && sq.includes(v.number)).map(v => v.id);
}
// Picks the document kind that matches the start of a title, e.g. "Voter ID card - Laleet"
function vuKindFromTitle(t) {
  if (!t) return null;
  const low = t.toLowerCase();
  return VU_KINDS.filter(k => low.startsWith(k.kind.toLowerCase()))
    .sort((a, b) => b.kind.length - a.kind.length)[0] || null;
}

/* ---------- reader upgrades: voter ID and college ID ---------- */
function vuAddSuggestion(out, targets, value, snippet, note) {
  if (!value || out.some(s => s.value === value && s.targets.join() === targets.join())) return;
  out.push({ targets, value, snippet: snippet || '', note: note || '' });
}
function vuVoterSuggestions(text) {
  PK_LAST = 'Voter ID card';
  const out = [];
  const nm = /elector.{0,3}s?\s*name\s*[:\-]?\s*([A-Za-z][A-Za-z .]{1,40}?)(?=\s*(?:\bfather|\bsex\b|\bage\b|\d|[^\x00-\x7F]|$))/i.exec(text);
  const name = nm ? vuTitleCase(nm[1].trim()) : '';
  vuAddSuggestion(out, ['title'], name ? 'Voter ID card - ' + name : 'Voter ID card',
    nm ? vuSnip(text, nm.index, nm[0].length) : '', name ? 'Name' : 'Name not found, add it in Title');
  vuAddSuggestion(out, ['type'], 'Identity', 'Voter ID card', 'Document type');
  const num = /\b([A-Z]{3}\d{7})\b/.exec(text);
  if (num) vuAddSuggestion(out, ['number'], num[1], vuSnip(text, num.index, num[0].length), 'Voter ID (EPIC) no.');
  const dt = /\bdate\s*[:\-]?\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/i.exec(text);
  if (dt) vuAddSuggestion(out, ['issue'], pkIso(+dt[3], +dt[2], +dt[1]),
    vuSnip(text, dt.index, dt[0].length), 'Issue date (voter ID has no expiry)');
  return out;
}
function vuCollegeSuggestions(text) {
  PK_LAST = 'College ID card';
  const out = [];
  const nm = /\bname\s*[:\-]?\s*([A-Za-z][A-Za-z .]{2,40}?)(?=\s*(?:father|husband|date|designation|s\.?\s*no|gpf|bearer|principal|\d|$))/i.exec(text);
  const name = nm ? vuTitleCase(nm[1].trim()) : '';
  vuAddSuggestion(out, ['title'], name ? 'College ID card - ' + name : 'College ID card',
    nm ? vuSnip(text, nm.index, nm[0].length) : '', name ? 'Name' : 'Name not found, add it in Title');
  vuAddSuggestion(out, ['type'], 'Identity', 'College ID card', 'Document type');
  return out;
}

// Replaces the picker's suggestion builder for these two card types; other cards use the picker
const vuBasePkBuild = pkBuild;
pkBuild = function (text) {
  if (/election\s+commission|elector.{0,3}s?\s*name/i.test(text)) return vuVoterSuggestions(text);
  if (/identity\s+card/i.test(text) && /college|university|institute|school/i.test(text)) return vuCollegeSuggestions(text);
  return vuBasePkBuild(text);
};
/* ===== vault2-ui.js PART 2 of 3: navigation, profiles, person and vehicle forms. Append to the end. ===== */
const VU = { root: null };
const VU_OLD_VIEWS = ['view-setup', 'view-unlock', 'view-list', 'view-edit', 'view-detail'];
const VU_LIST = 'list-style:none;padding:0;margin:0';

function vuRootEl() {
  if (!VU.root) {
    VU.root = document.createElement('section');
    VU.root.id = 'view-vault';
    VU.root.className = 'view hidden';
    document.querySelector('main').appendChild(VU.root);
  }
  return VU.root;
}
function vuHide() { if (VU.root) VU.root.classList.add('hidden'); }

// Any screen change in the original app also hides the new vault screen
const vuBaseShow = show;
show = function (view) { vuHide(); vuBaseShow(view); };

function vuOpen(tab) {
  VU_OLD_VIEWS.forEach(v => $(v).classList.add('hidden'));
  vuRootEl().classList.remove('hidden');
  setTop(true);
  vuGo(tab);
}
function vuClose() {
  vuHide();
  show('view-list');
  renderList();
}

async function vuGo(tab, arg) {
  const root = vuRootEl();
  root.innerHTML = '';
  root.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Dashboard', () => vuGo('dash'), tab !== 'dash'),
    vuBtn('Profiles', () => vuGo('profiles'), !['profiles', 'person', 'vehicle'].includes(tab)),
    vuBtn('+ Add document', () => vuGo('form'), tab !== 'form'),
    vuBtn('Close', () => vuClose(), true)
  ]));
  const body = vuEl('div', {});
  root.append(body);
  try {
    if (tab === 'dash') await vuDashboard(body);
    else if (tab === 'profiles') await vuProfiles(body);
    else if (tab === 'person') await vuPersonForm(body, arg);
    else if (tab === 'vehicle') await vuVehicleForm(body, arg);
    else if (tab === 'form') await vuForm(body, arg);
    else if (tab === 'detail') await vuDetail(body, arg);
  } catch (e) {
    body.append(vuEl('p', { cls: 'error', text: 'Something went wrong: ' + e.message }));
  }
}

/* ---------- profiles ---------- */
async function vuProfiles(body) {
  const all = await vuLoadAll();

  body.append(vuEl('h2', { text: 'People' }));
  const pl = vuEl('ul', { style: VU_LIST });
  if (!all.people.length) pl.append(vuEl('p', { cls: 'hint', text: 'No people yet.' }));
  for (const p of all.people) pl.append(await vuPersonCard(p, all));
  body.append(pl, vuEl('div', { cls: 'row' }, [vuBtn('+ Add person', () => vuGo('person', null))]));

  body.append(vuEl('h2', { text: 'Vehicles' }));
  const vl = vuEl('ul', { style: VU_LIST });
  if (!all.vehicles.length) vl.append(vuEl('p', { cls: 'hint', text: 'No vehicles yet.' }));
  for (const v of all.vehicles) vl.append(vuVehicleCard(v, all));
  body.append(vl, vuEl('div', { cls: 'row' }, [vuBtn('+ Add vehicle', () => vuGo('vehicle', null))]));
}

async function vuPersonCard(p, all) {
  const url = await vuPhotoUrl(p.photoId);
  const count = all.docs.filter(d => vuOwnersOf(d).includes(p.id)).length;
  const photo = url
    ? vuEl('img', { src: url, alt: '', style: 'width:64px;height:64px;object-fit:cover;border-radius:8px' })
    : vuEl('div', { text: 'No photo', style: 'width:64px;height:64px;display:flex;align-items:center;justify-content:center;background:#eef1f6;border-radius:8px;font-size:12px;color:#667085' });
  const del = vuBtn('Delete', async () => {
    const solo = all.docs.filter(d => { const o = vuOwnersOf(d); return o.length === 1 && o[0] === p.id; }).length;
    if (!confirm(`Delete ${p.name}? ${solo} document(s) that belong only to this person will be deleted. Shared documents stay with the others.`)) return;
    try { await vuDeleteOwner('people', p); vuGo('profiles'); } catch (e) { alert('Delete failed: ' + e.message); }
  }, true);
  return vuEl('li', { cls: 'card none' }, [
    vuEl('div', { cls: 'row', style: 'margin-top:0;align-items:center' }, [
      photo,
      vuEl('div', {}, [
        vuEl('strong', { text: p.name }),
        vuEl('small', { text: [p.relation, p.dob ? 'DOB ' + p.dob : '', count + ' document(s)'].filter(Boolean).join(' · ') }),
        p.notes ? vuEl('small', { text: p.notes }) : ''
      ])
    ]),
    vuEl('div', { cls: 'row' }, [vuBtn('Edit', () => vuGo('person', p.id), true), del])
  ]);
}

function vuVehicleCard(v, all) {
  const count = all.docs.filter(d => vuOwnersOf(d).includes(v.id)).length;
  const del = vuBtn('Delete', async () => {
    const solo = all.docs.filter(d => { const o = vuOwnersOf(d); return o.length === 1 && o[0] === v.id; }).length;
    if (!confirm(`Delete vehicle ${v.number}? ${solo} document(s) that belong only to it will be deleted.`)) return;
    try { await vuDeleteOwner('vehicles', v); vuGo('profiles'); } catch (e) { alert('Delete failed: ' + e.message); }
  }, true);
  return vuEl('li', { cls: 'card none' }, [
    vuEl('strong', { text: v.number }),
    vuEl('small', { text: [v.make, count + ' document(s)'].filter(Boolean).join(' · ') }),
    v.notes ? vuEl('small', { text: v.notes }) : '',
    vuEl('div', { cls: 'row' }, [vuBtn('Edit', () => vuGo('vehicle', v.id), true), del])
  ]);
}

async function vuPersonForm(body, id) {
  const all = await vuLoadAll();
  const p = id ? all.people.find(x => x.id === id) : null;
  const name = vuEl('input', { value: p ? p.name : '', placeholder: 'Full name' });
  const rel = vuEl('select', {}, VU_RELATIONS.map(r => vuEl('option', { value: r, text: r })));
  rel.value = p ? p.relation || 'Self' : 'Self';
  const dob = vuEl('input', { type: 'date', value: p ? p.dob || '' : '' });
  const notes = vuEl('textarea', { rows: 3, placeholder: 'Short profile, for example address, blood group, notes' });
  notes.value = p ? p.notes || '' : '';
  const photo = vuEl('input', { type: 'file', accept: 'image/*' });
  const preview = vuEl('img', { alt: '', hidden: true, style: 'width:80px;height:80px;object-fit:cover;border-radius:8px' });
  if (p && p.photoId) {
    const u = await vuPhotoUrl(p.photoId);
    if (u) { preview.src = u; preview.hidden = false; }
  }
  photo.addEventListener('change', () => {
    const f = photo.files[0];
    if (f) { preview.src = URL.createObjectURL(f); preview.hidden = false; }
  });

  body.append(vuEl('h2', { text: p ? 'Edit person' : 'Add person' }));
  body.append(vuEl('form', { on: { submit: e => e.preventDefault() } }, [
    vuField('Name', name), vuField('Relation', rel), vuField('Date of birth (optional)', dob),
    vuField('Short profile', notes), vuField('Photo (optional)', photo), preview
  ]));
  body.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Save', async () => {
      if (!name.value.trim()) return alert('Enter a name.');
      try {
        await vuSavePerson({
          id: p ? p.id : null, name: name.value, relation: rel.value, dob: dob.value,
          notes: notes.value, photoId: p ? p.photoId : null, createdAt: p ? p.createdAt : null
        }, photo.files[0] || null);
        vuGo('profiles');
      } catch (e) { alert('Save failed: ' + e.message); }
    }),
    vuBtn('Cancel', () => vuGo('profiles'), true)
  ]));
}

async function vuVehicleForm(body, id) {
  const all = await vuLoadAll();
  const v = id ? all.vehicles.find(x => x.id === id) : null;
  const number = vuEl('input', { value: v ? v.number : '', placeholder: 'Registration number, e.g. WB06L2307' });
  const make = vuEl('input', { value: v ? v.make || '' : '', placeholder: 'Make and model, e.g. Maruti Wagon R' });
  const notes = vuEl('textarea', { rows: 2, placeholder: 'Notes' });
  notes.value = v ? v.notes || '' : '';

  body.append(vuEl('h2', { text: v ? 'Edit vehicle' : 'Add vehicle' }));
  body.append(vuEl('form', { on: { submit: e => e.preventDefault() } }, [
    vuField('Vehicle number', number), vuField('Make and model', make), vuField('Notes', notes)
  ]));
  body.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Save', async () => {
      if (!number.value.trim()) return alert('Enter the vehicle number.');
      try {
        await vuSaveVehicle({
          id: v ? v.id : null, number: number.value, make: make.value,
          notes: notes.value, createdAt: v ? v.createdAt : null
        });
        vuGo('profiles');
      } catch (e) { alert('Save failed: ' + e.message); }
    }),
    vuBtn('Cancel', () => vuGo('profiles'), true)
  ]));
}
/* ===== vault2-ui.js PART 3 of 3: dashboard, add and edit document, detail, buttons and tests. Append to the end. ===== */
const VU_LBL = { title: 'Title', type: 'Type', number: 'Document number', issue: 'Issue date', expiry: 'Expiry date' };

async function vuDashboard(body) {
  const all = await vuLoadAll();
  const map = vuNameMap(all);

  body.append(vuEl('h2', { text: 'Dashboard' }));
  body.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Import old documents', async () => {
      try {
        const n = await v2ImportOld();
        alert('Imported ' + n + ' old document(s). They appear as Unassigned until you add owners.');
        vuGo('dash');
      } catch (e) { alert('Import failed: ' + e.message); }
    }, true)
  ]));

  const search = vuEl('input', { type: 'search', placeholder: 'Search title, number, owner' });
  const filter = vuEl('select', {}, [
    vuEl('option', { value: '', text: 'Everyone' }),
    ...all.people.map(p => vuEl('option', { value: p.id, text: 'Person: ' + p.name })),
    ...all.vehicles.map(v => vuEl('option', { value: v.id, text: 'Vehicle: ' + v.number }))
  ]);
  const list = vuEl('ul', { style: VU_LIST });
  body.append(vuEl('div', { cls: 'toolbar' }, [search, filter]), list);

  // Latest version first: soonest expiry at the top, undated documents last
  const groups = v2Dashboard(all.docs).sort((a, b) =>
    (a.latest.expiry || '9999-12-31').localeCompare(b.latest.expiry || '9999-12-31'));

  const draw = () => {
    list.innerHTML = '';
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const g of groups) {
      const L = g.latest;
      const owners = vuOwnersOf(L);
      const ownerText = vuOwnerLabel(map, owners);
      if (filter.value && !owners.includes(filter.value)) continue;
      if (q && ![L.title, L.kind, L.number, ownerText].join(' ').toLowerCase().includes(q)) continue;
      const s = statusOf(daysLeft(L.expiry));
      list.append(vuEl('li', { cls: 'card ' + s.cls, on: { click: () => vuGo('detail', g.groupId) } }, [
        vuEl('strong', { text: L.title || L.kind }),
        vuEl('small', { text: ownerText + ' · ' + L.kind + (L.number ? ' · ' + L.number : '') }),
        vuEl('span', { cls: 'badge', text: s.label }),
        g.older.length ? vuEl('small', { text: g.older.length + ' older version(s) kept' }) : ''
      ]));
      shown++;
    }
    if (!shown) list.append(vuEl('p', { cls: 'hint', text: 'No documents match. Tap + Add document.' }));
  };
  search.addEventListener('input', draw);
  filter.addEventListener('change', draw);
  draw();
}

function vuDocInfo(d, map) {
  const s = statusOf(daysLeft(d.expiry));
  const rows = [
    ['Owners', vuOwnerLabel(map, vuOwnersOf(d))], ['Kind', d.kind], ['Type', d.type],
    ['Number', d.number], ['Issue date', d.issue], ['Expiry date', d.expiry],
    ['Status', s.label], ['Notes', d.notes], ['Pages stored', String((d.pageIds || []).length)]
  ];
  const dl = vuEl('dl', {});
  for (const [k, v] of rows) if (v) dl.append(vuEl('dt', { text: k }), vuEl('dd', { text: v }));
  return dl;
}

async function vuOpenPage(pid) {
  const url = await vuPhotoUrl(pid);
  if (!url) return alert('This page could not be found.');
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
function vuPagesRow(d) {
  const row = vuEl('div', { cls: 'row' });
  const pages = d.pageIds || [];
  pages.forEach((pid, i) => row.append(vuBtn('Open page ' + (i + 1), () => vuOpenPage(pid), true)));
  if (!pages.length) row.append(vuEl('small', { text: 'No pages stored' }));
  return row;
}

async function vuDetail(body, groupId) {
  const all = await vuLoadAll();
  const map = vuNameMap(all);
  const g = v2Dashboard(all.docs).find(x => x.groupId === groupId);
  if (!g) { body.append(vuEl('p', { text: 'This document no longer exists.' })); return; }
  const L = g.latest;

  body.append(vuEl('h2', { text: L.title || L.kind }));
  body.append(vuEl('p', { cls: 'hint', text: 'Latest version' }));
  body.append(vuDocInfo(L, map), vuPagesRow(L));
  body.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Edit or add pages', () => vuGo('form', L.id)),
    vuBtn('Delete this version', () => vuDeleteVersion(L, groupId), true)
  ]));

  if (g.older.length) {
    body.append(vuEl('h2', { text: 'Older versions (kept in storage)' }));
    for (const d of g.older) {
      body.append(vuEl('div', { cls: 'card none' }, [
        vuEl('strong', { text: d.title || d.kind }),
        vuEl('small', { text: 'Issued ' + (d.issue || '-') + ' · Expiry ' + (d.expiry || '-') }),
        vuPagesRow(d),
        vuEl('div', { cls: 'row' }, [
          vuBtn('Edit', () => vuGo('form', d.id), true),
          vuBtn('Delete', () => vuDeleteVersion(d, groupId), true)
        ])
      ]));
    }
  }
}

async function vuDeleteVersion(d, groupId) {
  if (!confirm('Delete this version and its pages? Other versions stay.')) return;
  try {
    await v2DeleteDocument(d);
    const left = (await v2List('docs')).some(x => x.groupId === groupId);
    if (left) vuGo('detail', groupId);
    else vuGo('dash');
  } catch (e) { alert('Delete failed: ' + e.message); }
}

async function vuForm(body, editId) {
  const all = await vuLoadAll();
  const cur = editId ? all.docs.find(d => d.id === editId) || null : null;
  const st = { files: [], suggestions: [] };

  /* fields */
  const title = vuEl('input', { value: cur ? cur.title || '' : '', placeholder: 'Title, e.g. Car insurance - WB06L2307' });
  const kind = vuEl('select', {}, VU_KINDS.map(k => vuEl('option', { value: k.kind, text: k.kind })));
  const kindVal = cur ? cur.kind || 'Other' : 'Other';
  if (!VU_KINDS.some(k => k.kind === kindVal)) kind.append(vuEl('option', { value: kindVal, text: kindVal }));
  kind.value = kindVal;
  const type = vuEl('select', {}, VU_TYPES.map(t => vuEl('option', { value: t, text: t })));
  type.value = cur ? cur.type || 'Other' : 'Other';
  const number = vuEl('input', { value: cur ? cur.number || '' : '', placeholder: 'Document number' });
  const issue = vuEl('input', { type: 'date', value: cur ? cur.issue || '' : '' });
  const expiry = vuEl('input', { type: 'date', value: cur ? cur.expiry || '' : '' });
  const notes = vuEl('textarea', { rows: 2 });
  notes.value = cur ? cur.notes || '' : '';
  const fieldEl = { title, type, number, issue, expiry };

  /* owners: tick every person or vehicle this document belongs to */
  const ownedNow = cur ? vuOwnersOf(cur) : [];
  const owners = [];
  const ownerBox = vuEl('div', { cls: 'review' });
  const addOwner = (id, label) => {
    const cb = vuEl('input', { type: 'checkbox', checked: ownedNow.includes(id) });
    owners.push({ id, cb });
    ownerBox.append(vuEl('label', {}, [cb, ' ' + label]));
  };
  all.people.forEach(p => addOwner(p.id, 'Person: ' + p.name));
  all.vehicles.forEach(v => addOwner(v.id, 'Vehicle: ' + v.number));
  if (!owners.length) ownerBox.append(vuEl('p', { cls: 'hint', text: 'Add a person or vehicle first in Profiles.' }));

  /* renewal or group */
  const renew = vuEl('select', {}, [
    vuEl('option', { value: '', text: cur ? 'Keep current group' : 'Auto (same owner, type and number)' }),
    ...all.docs.filter(d => !cur || d.id !== cur.id).map(d =>
      vuEl('option', { value: d.id, text: 'Renewal of: ' + (d.title || d.kind) + ' (expiry ' + (d.expiry || '-') + ')' }))
  ]);

  /* files and status */
  const files = vuEl('input', { type: 'file', multiple: true, accept: 'image/*,application/pdf' });
  const status = vuEl('p', {
    cls: 'hint',
    text: cur ? 'Add more pages here if needed. Each photo takes about 30 seconds to read.'
      : 'Attach one or more photos or a PDF. All files become pages of ONE document. Each photo takes about 30 seconds to read.'
  });
  const sugBox = vuEl('div', {});

  const applyField = (field, value) => {
    if (field === 'title') {
      title.value = value;
      const k = vuKindFromTitle(value);
      if (k) kind.value = k.kind;
    } else if (fieldEl[field]) {
      fieldEl[field].value = value;
    }
  };

  const drawSuggestions = () => {
    sugBox.innerHTML = '';
    if (!st.suggestions.length) return;
    sugBox.append(vuBtn('Approve best suggestion for each field', () => {
      const used = new Set();
      st.suggestions = st.suggestions.filter(s => {
        const t = s.targets[0];
        if (s.targets.length === 1 && !used.has(t)) { used.add(t); applyField(t, s.value); return false; }
        return true;
      });
      drawSuggestions();
    }));
    st.suggestions.forEach((s, i) => {
      const done = field => {
        if (field) applyField(field, s.value);
        st.suggestions.splice(i, 1);
        drawSuggestions();
      };
      const btns = vuEl('div', { cls: 'row' });
      if (s.targets.length > 1) {
        s.targets.forEach(t => btns.append(vuBtn('Use as ' + VU_LBL[t].toLowerCase(), () => done(t))));
      } else {
        const t = s.targets[0];
        btns.append(vuBtn('Approve', () => done(t)));
        btns.append(vuBtn('Edit', () => {
          applyField(t, s.value);
          st.suggestions.splice(i, 1);
          drawSuggestions();
          fieldEl[t].focus();
        }, true));
      }
      btns.append(vuBtn('Dismiss', () => done(null), true));
      sugBox.append(vuEl('div', { cls: 'sugg' }, [
        vuEl('strong', { text: s.targets.map(t => VU_LBL[t]).join(' or ') + ': ' + s.value }),
        vuEl('small', { text: (s.note ? s.note + ' · ' : '') + 'Found in: "' + s.snippet + '"' }),
        btns
      ]));
    });
  };

  // Reads every attached file as pages of one document and builds suggestions from all of them
  files.addEventListener('change', async () => {
    st.files = Array.from(files.files || []);
    st.suggestions = [];
    drawSuggestions();
    if (!st.files.length) { status.textContent = ''; return; }
    let text = '';
    for (let i = 0; i < st.files.length; i++) {
      status.textContent = 'Reading page ' + (i + 1) + ' of ' + st.files.length + ' on this device...';
      try {
        const r = await readDocument(st.files[i]);
        if (r.error) status.textContent = r.error;
        else text += '\n' + r.text;
      } catch (e) {
        status.textContent = 'Could not read page ' + (i + 1) + ': ' + e.message;
      }
    }
    if (text.trim()) {
      st.suggestions = buildSuggestions(text);
      const hits = new Set([...vuMatchPeople(text, all.people), ...vuMatchVehicles(text, all.vehicles)]);
      if (!cur && hits.size) owners.forEach(o => { o.cb.checked = hits.has(o.id); });
      status.textContent = 'Found ' + st.suggestions.length + ' suggestion(s). Owners were ticked where a name or vehicle number matched. Approve, edit or dismiss each one.';
    }
    drawSuggestions();
  });

  const saveDoc = async () => {
    const t = title.value.trim();
    if (!t) return alert('Enter a title.');
    const ownerIds = owners.filter(o => o.cb.checked).map(o => o.id);
    try {
      const id = cur ? cur.id : newId();
      const newPages = await vuStorePages(id, st.files, cur ? (cur.pageIds || []).length : 0);
      const pageIds = [...(cur ? cur.pageIds || [] : []), ...newPages];
      let groupId;
      if (renew.value) {
        const target = all.docs.find(d => d.id === renew.value);
        groupId = target ? target.groupId : vuGroupKey(ownerIds, kind.value, number.value, id);
      } else if (cur) {
        groupId = cur.groupId;
      } else {
        groupId = vuGroupKey(ownerIds, kind.value, number.value, id);
      }
      await v2Put('docs', {
        id, owners: ownerIds, ownerId: ownerIds[0] || null,
        kind: kind.value, type: type.value, title: t, number: number.value.trim(),
        issue: issue.value, expiry: expiry.value, notes: notes.value.trim(),
        pageIds, groupId, createdAt: cur ? cur.createdAt : Date.now(), updatedAt: Date.now()
      });
      vuGo('detail', groupId);
    } catch (e) { alert('Save failed: ' + e.message); }
  };

  body.append(vuEl('h2', { text: cur ? 'Edit document' : 'Add document' }));
  body.append(vuEl('form', { on: { submit: e => e.preventDefault() } }, [
    vuField('Title', title), vuField('Kind', kind), vuField('Type', type),
    vuField('Document number', number), vuField('Issue date', issue), vuField('Expiry date', expiry),
    vuField('Notes', notes),
    vuEl('span', { text: 'Owners: tick every family member or vehicle this document belongs to' }),
    ownerBox,
    vuField('Renewal or group', renew),
    vuField(cur ? 'Add more pages' : 'Pages: photos or PDF (select several at once)', files)
  ]));
  body.append(status, sugBox, vuEl('div', { cls: 'row' }, [
    vuBtn('Save document', saveDoc),
    vuBtn('Cancel', () => vuGo('dash'), true)
  ]));
  drawSuggestions();
}

/* ---------- buttons added to the existing screens ---------- */
(function vuBoot() {
  const bar = document.querySelector('.toolbar');
  if (bar && !document.getElementById('vu-open')) {
    const a = vuBtn('Vault dashboard', () => vuOpen('dash'), true);
    a.id = 'vu-open';
    const b = vuBtn('Profiles', () => vuOpen('profiles'), true);
    b.id = 'vu-profiles';
    bar.append(a, b);
  }
  const oldAdd = document.getElementById('btn-add');
  if (oldAdd) oldAdd.classList.add('hidden');
  const bk = document.querySelector('.backup');
  if (bk && !document.getElementById('vu-test')) {
    const t = vuBtn('Run reader tests (voter, college)', () => vuSelfTest(), true);
    t.id = 'vu-test';
    bk.append(t);
  }
})();

/* ---------- reader tests using your uploaded voter ID and college ID text ---------- */
function vuSelfTest() {
  const voter = "ELECTION COMMISSION OF INDIA IDENTITY CARD GDH9779703 Elector's Name :LALEET Father's Name :HARKISHOR Sex / MALE Age as on 1.1.2003 :66 Years Address : HNO. 3106/2 COLLEGE WARD Date : 10-02-2003";
  const college = "GOVERNMENT MODEL COLLEGE OF SCIENCE RAIPUR IDENTITY CARD S. No. Name LALIT KUMAR SRIVASTAVA Father/Husband Name SRI H.K. SRIVASTAVA Date of Birth 15.10.1938 Designation PROFESSOR PHYSICS Bearer Principal";
  const tests = [
    { name: 'Voter ID', text: voter,
      expect: { title: 'Voter ID card - Laleet', type: 'Identity', number: 'GDH9779703', issue: '2003-02-10' },
      absent: ['expiry'] },
    { name: 'College ID', text: college,
      expect: { title: 'College ID card - Lalit Kumar Srivastava', type: 'Identity' },
      absent: ['number', 'issue', 'expiry'] }
  ];
  const lines = [];
  for (const t of tests) {
    const got = buildSuggestions(t.text);
    const pick = k => got.find(s => s.targets.length === 1 && s.targets[0] === k);
    lines.push('-- ' + t.name + ' (detected: ' + PK_LAST + ')');
    for (const k of Object.keys(t.expect)) {
      const s = pick(k);
      const ok = !!s && s.value === t.expect[k];
      lines.push((ok ? 'PASS  ' : 'FAIL  ') + k + ': ' + (s ? s.value : 'nothing found'));
    }
    for (const k of t.absent) {
      const s = pick(k);
      lines.push((s ? 'FAIL  ' : 'PASS  ') + 'no ' + k + ' suggested' + (s ? ' (got ' + s.value + ')' : ''));
    }
  }
  alert('Reader tests\n\n' + lines.join('\n'));
         }
