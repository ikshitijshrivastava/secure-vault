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
