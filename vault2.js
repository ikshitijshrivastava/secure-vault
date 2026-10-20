/* ===== vault2.js, PHASE 1: data layer for people, vehicles, multi-page documents and versions.
   Loads after app.js and uses its key, enc, dec, encrypt, decrypt, newId, dbAll and readFile. ===== */
'use strict';

const V2_DB_NAME = 'vault-v2';
const V2_STORES = ['people', 'vehicles', 'docs', 'pages'];
let v2DbPromise = null;

function v2Db() {
  if (!v2DbPromise) {
    v2DbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(V2_DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const s of V2_STORES) req.result.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return v2DbPromise;
}
async function v2Tx(store, mode, action) {
  const db = await v2Db();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function v2Need() {
  if (!key) throw new Error('Vault is locked.');
}

// Encrypted records: people, vehicles, documents
async function v2Put(store, obj) {
  v2Need();
  const s = await encrypt(key, enc.encode(JSON.stringify(obj)));
  return v2Tx(store, 'readwrite', os => os.put({ id: obj.id, iv: s.iv, data: s.data }));
}
async function v2List(store) {
  v2Need();
  const rows = await v2Tx(store, 'readonly', os => os.getAll());
  const out = [];
  for (const r of rows) out.push(JSON.parse(dec.decode(await decrypt(key, r.iv, r.data))));
  return out;
}
const v2Delete = (store, id) => v2Tx(store, 'readwrite', os => os.delete(id));

// Encrypted files (document pages and profile photos): metadata and bytes are both encrypted
async function v2PutPage(meta, bytes) {
  v2Need();
  const m = await encrypt(key, enc.encode(JSON.stringify(meta)));
  const d = await encrypt(key, bytes);
  return v2Tx('pages', 'readwrite', os =>
    os.put({ id: meta.id, mIv: m.iv, m: m.data, dIv: d.iv, d: d.data }));
}
async function v2GetPage(id) {
  v2Need();
  const r = await v2Tx('pages', 'readonly', os => os.get(id));
  if (!r) return null;
  return {
    meta: JSON.parse(dec.decode(await decrypt(key, r.mIv, r.m))),
    bytes: await decrypt(key, r.dIv, r.d)
  };
}

/* ---------- Grouping and latest version ---------- */

// Documents that belong together share a groupId. Default: owner + type + first 6 digits of the number.
function v2DefaultGroup(ownerId, kind, number) {
  const digits = (number || '').replace(/\D/g, '').slice(0, 6);
  return [ownerId || 'none', kind || 'Other', digits].join('|');
}
// True if document a is newer than b: later expiry, then later issue date, then later creation
function v2Newer(a, b) {
  if ((a.expiry || '') !== (b.expiry || '')) return (a.expiry || '') > (b.expiry || '');
  if ((a.issue || '') !== (b.issue || '')) return (a.issue || '') > (b.issue || '');
  return a.createdAt > b.createdAt;
}
// Dashboard data: one entry per group, with the latest version and the older ones kept
function v2Dashboard(docs) {
  const groups = new Map();
  for (const d of docs) {
    if (!groups.has(d.groupId)) groups.set(d.groupId, []);
    groups.get(d.groupId).push(d);
  }
  const out = [];
  for (const [groupId, list] of groups) {
    list.sort((a, b) => (v2Newer(a, b) ? -1 : v2Newer(b, a) ? 1 : 0));
    out.push({ groupId, latest: list[0], older: list.slice(1) });
  }
  return out;
}

/* ---------- Add, delete, open ---------- */

async function v2AddPerson({ name, relation, notes, photo }) {
  const person = {
    id: newId(), name: (name || '').trim(), relation: relation || '',
    notes: notes || '', photoId: null, createdAt: Date.now()
  };
  if (photo) {
    person.photoId = newId();
    await v2PutPage({ id: person.photoId, kind: 'photo', mime: photo.type || 'image/jpeg' },
      new Uint8Array(await photo.arrayBuffer()));
  }
  await v2Put('people', person);
  return person;
}
async function v2AddVehicle({ number, make, notes }) {
  const veh = {
    id: newId(), number: (number || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    make: make || '', notes: notes || '', createdAt: Date.now()
  };
  await v2Put('vehicles', veh);
  return veh;
}
// files: an array of File objects, one per page. Each file becomes one stored page.
async function v2AddDocument({ ownerType, ownerId, kind, title, number, issue, expiry, notes, files, groupId }) {
  const id = newId();
  const pageIds = [];
  let pageNo = 0;
  for (const f of files || []) {
    pageNo++;
    const pid = newId();
    await v2PutPage({ id: pid, docId: id, pageNo, name: f.name, mime: f.type || 'application/octet-stream' },
      new Uint8Array(await f.arrayBuffer()));
    pageIds.push(pid);
  }
  const doc = {
    id, ownerType: ownerType || 'unassigned', ownerId: ownerId || null,
    kind: kind || 'Other', title: title || kind || 'Document', number: number || '',
    issue: issue || '', expiry: expiry || '', notes: notes || '', pageIds,
    groupId: groupId || v2DefaultGroup(ownerId, kind, number), createdAt: Date.now()
  };
  await v2Put('docs', doc);
  return doc;
}
async function v2DeleteDocument(doc) {
  for (const pid of doc.pageIds || []) await v2Delete('pages', pid);
  await v2Delete('docs', doc.id);
}
async function v2DeletePerson(person) {
  for (const d of await v2List('docs')) {
    if (d.ownerId === person.id) await v2DeleteDocument(d);
  }
  if (person.photoId) await v2Delete('pages', person.photoId);
  await v2Delete('people', person.id);
}
// Returns a temporary link to view one stored page
async function v2PageUrl(pageId) {
  const p = await v2GetPage(pageId);
  return p ? URL.createObjectURL(new Blob([p.bytes], { type: p.meta.mime })) : null;
}

/* ---------- Import documents from the current vault (safe to run more than once) ---------- */
async function v2ImportOld() {
  v2Need();
  const existing = new Set((await v2List('docs')).map(d => d.id));
  let added = 0;
  for (const r of await dbAll('docs')) {
    const old = JSON.parse(dec.decode(await decrypt(key, r.iv, r.data)));
    if (existing.has(old.id)) continue;
    const pageIds = [];
    if (old.fileId) {
      const bytes = await readFile(old.fileId);
      if (bytes) {
        const pid = newId();
        await v2PutPage({ id: pid, docId: old.id, pageNo: 1, name: old.fileName || 'file',
          mime: old.fileType || 'application/octet-stream' }, bytes);
        pageIds.push(pid);
      }
    }
    await v2Put('docs', {
      id: old.id, ownerType: 'unassigned', ownerId: null,
      kind: old.type || 'Other', title: old.title || '', number: old.number || '',
      issue: old.issue || '', expiry: old.expiry || '', notes: old.notes || '', pageIds,
      groupId: v2DefaultGroup(null, old.type, old.number), createdAt: old.createdAt || Date.now()
    });
    added++;
  }
  return added;
}

/* ---------- Self-test: writes test records, checks them, then removes them ---------- */
async function v2SelfTest() {
  const lines = [];
  const check = (ok, msg) => lines.push((ok ? 'PASS  ' : 'FAIL  ') + msg);
  let person = null, veh = null, oldDoc = null, newDoc = null;
  try {
    person = await v2AddPerson({ name: 'Test Person', relation: 'Self' });
    veh = await v2AddVehicle({ number: 'WB 06 L 2307', make: 'Maruti' });
    check(veh.number === 'WB06L2307', 'vehicle number cleaned: ' + veh.number);

    oldDoc = await v2AddDocument({ ownerType: 'vehicle', ownerId: veh.id, kind: 'Car insurance',
      number: '0157681764', issue: '2025-10-30', expiry: '2026-10-29', files: [] });
    newDoc = await v2AddDocument({ ownerType: 'vehicle', ownerId: veh.id, kind: 'Car insurance',
      number: '015768176409 00', issue: '2026-10-30', expiry: '2027-10-29',
      files: [new File([new Uint8Array([1, 2, 3])], 'p1.png', { type: 'image/png' }),
              new File([new Uint8Array([4, 5])], 'p2.png', { type: 'image/png' })] });
    check(newDoc.groupId === oldDoc.groupId, 'renewal grouped with the old policy');
    check(newDoc.pageIds.length === 2, 'two pages stored for one document');

    const group = v2Dashboard(await v2List('docs')).find(g => g.groupId === newDoc.groupId);
    check(!!group && group.latest.id === newDoc.id, 'dashboard shows the newest version as latest');
    check(!!group && group.older.length === 1 && group.older[0].id === oldDoc.id, 'older version kept');

    const p1 = await v2GetPage(newDoc.pageIds[0]);
    check(!!p1 && p1.bytes.length === 3 && p1.meta.pageNo === 1, 'page 1 decrypts correctly');
    const p2 = await v2GetPage(newDoc.pageIds[1]);
    check(!!p2 && p2.bytes.length === 2 && p2.meta.pageNo === 2, 'page 2 decrypts correctly');
  } catch (e) {
    lines.push('ERROR ' + e.message);
  } finally {
    if (newDoc) await v2DeleteDocument(newDoc);
    if (oldDoc) await v2DeleteDocument(oldDoc);
    if (veh) await v2Delete('vehicles', veh.id);
    if (person) await v2Delete('people', person.id);
  }
  alert('vault2 self-test\n\n' + lines.join('\n'));
}

(function v2AddButton() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('v2-selftest')) return;
  const b = document.createElement('button');
  b.id = 'v2-selftest';
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Run vault2 self-test';
  b.onclick = v2SelfTest;
  bk.appendChild(b);
})();
