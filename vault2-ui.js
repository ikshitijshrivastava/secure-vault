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
