'use strict';

/* ================= Config ================= */
const ITERATIONS = 600000;          // PBKDF2 strength
const AUTO_LOCK_MS = 5 * 60 * 1000; // lock after 5 min idle
const HIDDEN_LOCK_MS = 60 * 1000;   // lock if hidden over 1 min
const WARN_DAYS = 30;               // renewal warning window

/* ================= State (memory only) ================= */
let key = null;          // AES key, never stored
let docs = [];           // decrypted document metadata
let currentId = null;    // document being viewed or edited
let pendingFile = null;  // file chosen in the form, not yet saved
let lastActive = Date.now();
let hiddenAt = 0;

/* ================= Helpers ================= */
const $ = id => document.getElementById(id);
const enc = new TextEncoder();
const dec = new TextDecoder();
const rand = n => crypto.getRandomValues(new Uint8Array(n));
const newId = () => crypto.randomUUID ? crypto.randomUUID()
  : [...rand(16)].map(b => b.toString(16).padStart(2, '0')).join('');

const VIEWS = ['view-setup', 'view-unlock', 'view-list', 'view-edit', 'view-detail'];
function show(view) {
  VIEWS.forEach(v => $(v).classList.toggle('hidden', v !== view));
}
function setTop(on) {
  $('topbar').classList.toggle('hidden', !on);
}

function toB64(bytes) {
  const arr = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i += 0x8000) {
    s += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ================= Crypto ================= */
async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encrypt(k, bytes) {
  const iv = rand(12);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, bytes));
  return { iv, data };
}
async function decrypt(k, iv, data) {
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, data));
}

/* ================= IndexedDB (local storage) ================= */
let dbPromise = null;
function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('secure-vault', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['meta', 'docs', 'files']) {
          if (!db.objectStoreNames.contains(s)) {
            db.createObjectStore(s, { keyPath: 'id' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function run(store, mode, action) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const dbGet = (s, id) => run(s, 'readonly', os => os.get(id));
const dbPut = (s, val) => run(s, 'readwrite', os => os.put(val));
const dbDel = (s, id) => run(s, 'readwrite', os => os.delete(id));
const dbAll = s => run(s, 'readonly', os => os.getAll());
const dbClear = s => run(s, 'readwrite', os => os.clear());

/* ================= Vault: create, unlock ================= */
async function createVault(pass) {
  const salt = rand(16);
  const k = await deriveKey(pass, salt);
  const v = await encrypt(k, enc.encode('VAULT-OK'));
  await dbPut('meta', { id: 'config', salt, iv: v.iv, data: v.data, created: Date.now() });
  key = k;
}
async function unlockVault(pass) {
  const cfg = await dbGet('meta', 'config');
  if (!cfg) throw new Error('No vault found on this device.');
  const k = await deriveKey(pass, cfg.salt);
  let ok = false;
  try {
    ok = dec.decode(await decrypt(k, cfg.iv, cfg.data)) === 'VAULT-OK';
  } catch { ok = false; }
  if (!ok) throw new Error('Wrong password.');
  key = k;
}

/* ================= Documents ================= */
async function loadDocs() {
  const rows = await dbAll('docs');
  const list = [];
  for (const r of rows) {
    list.push(JSON.parse(dec.decode(await decrypt(key, r.iv, r.data))));
  }
  docs = list.sort((a, b) =>
    (a.expiry || '9999-12-31').localeCompare(b.expiry || '9999-12-31'));
}
async function saveMeta(meta) {
  const s = await encrypt(key, enc.encode(JSON.stringify(meta)));
  await dbPut('docs', { id: meta.id, iv: s.iv, data: s.data });
}
async function saveFile(fileId, bytes) {
  const s = await encrypt(key, bytes);
  await dbPut('files', { id: fileId, iv: s.iv, data: s.data });
}
async function readFile(fileId) {
  const r = await dbGet('files', fileId);
  return r ? decrypt(key, r.iv, r.data) : null;
}

/* ================= Dates and status ================= */
function daysLeft(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const exp = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((exp - today) / 86400000);
}
function statusOf(days) {
  if (days === null) return { cls: 'none', label: 'No expiry date' };
  if (days < 0) return { cls: 'expired', label: `Expired ${-days} day(s) ago` };
  if (days <= WARN_DAYS) return { cls: 'soon', label: `Renew soon: ${days} day(s) left` };
  return { cls: 'ok', label: `Valid: ${days} day(s) left` };
}

/* ================= OCR (optional, offline) ================= */
let ocrState = 'unknown'; // unknown | ready | failed
function addScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}
async function loadOCR() {
  if (window.Tesseract) return true;
  if (ocrState === 'failed') return false;
  try {
    await addScript('vendor/tesseract.min.js');
    ocrState = window.Tesseract ? 'ready' : 'failed';
  } catch { ocrState = 'failed'; }
  return ocrState === 'ready';
}
async function ocrImage(blob) {
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: 'vendor/worker.min.js',
    corePath: 'vendor/core/',
    langPath: 'vendor/lang'
  });
  try {
    const { data } = await worker.recognize(blob);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}

/* Find dates like 05/03/2027, 05-03-2027, 2027-03-05. Assumes DD/MM unless clearly MM/DD. */
function extractDates(text) {
  const found = [];
  const re = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})|(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/g;
  let m;
  while ((m = re.exec(text))) {
    let y, mo, d;
    if (m[3]) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else { y = +m[4]; mo = +m[5]; d = +m[6]; }
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const ctx = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    found.push({
      iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      ctx
    });
  }
  return found;
}
function suggestFields(text) {
  const s = {};
  for (const { iso, ctx } of extractDates(text)) {
    if (!s.expiry && /expir|valid|until|till/.test(ctx)) s.expiry = iso;
    else if (!s.issue && /issu|dated/.test(ctx)) s.issue = iso;
  }
  return s;
}

/* ================= Lists and details ================= */
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const ul = $('doc-list');
  ul.innerHTML = '';

  const items = docs.filter(d =>
    !q || [d.title, d.type, d.number, d.notes].join(' ').toLowerCase().includes(q));
  $('empty-msg').classList.toggle('hidden', docs.length > 0);

  for (const d of items) {
    const s = statusOf(daysLeft(d.expiry));
    const li = document.createElement('li');
    li.className = 'card ' + s.cls;
    const strong = document.createElement('strong');
    strong.textContent = d.title;
    const small = document.createElement('small');
    small.textContent = d.type + (d.number ? ' · ' + d.number : '');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = s.label;
    li.append(strong, small, badge);
    li.onclick = () => showDetail(d.id);
    ul.appendChild(li);
  }
  renderAlerts();
}
function renderAlerts() {
  const due = docs.filter(d => {
    const n = daysLeft(d.expiry);
    return n !== null && n <= WARN_DAYS;
  });
  $('alerts').innerHTML = '';
  if (due.length) {
    const p = document.createElement('div');
    p.className = 'alert';
    p.textContent = `${due.length} document(s) expired or expiring within ${WARN_DAYS} days.`;
    $('alerts').appendChild(p);
  }
}
function showDetail(id) {
  currentId = id;
  const d = docs.find(x => x.id === id);
  if (!d) return;
  const s = statusOf(daysLeft(d.expiry));
  const rows = [
    ['Title', d.title], ['Type', d.type], ['Document number', d.number],
    ['Issue date', d.issue], ['Expiry date', d.expiry], ['Status', s.label],
    ['Notes', d.notes], ['File', d.fileName]
  ];
  const box = $('detail');
  box.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = d.title;
  box.appendChild(h);
  const dl = document.createElement('dl');
  for (const [k, v] of rows) {
    if (!v) continue;
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  box.appendChild(dl);
  $('btn-download').classList.toggle('hidden', !d.fileId);
  show('view-detail');
}

/* ================= Add / edit form ================= */
function openForm(doc) {
  currentId = doc ? doc.id : null;
  pendingFile = null;
  $('edit-title').textContent = doc ? 'Edit document' : 'Add document';
  $('f-title').value = doc?.title || '';
  $('f-type').value = doc?.type || 'Other';
  $('f-number').value = doc?.number || '';
  $('f-issue').value = doc?.issue || '';
  $('f-expiry').value = doc?.expiry || '';
  $('f-notes').value = doc?.notes || '';
  $('f-file').value = '';
  $('ocr-status').textContent = doc?.fileName ? `Current file: ${doc.fileName}` : '';
  show('view-edit');
}

$('f-file').addEventListener('change', async e => {
  pendingFile = e.target.files[0] || null;
  if (!pendingFile) return;
  if (!pendingFile.type.startsWith('image/')) {
    $('ocr-status').textContent =
      'PDF saved. Enter the details manually (automatic reading is for images only).';
    return;
  }
  $('ocr-status').textContent = 'Reading document...';
  if (!(await loadOCR())) {
    $('ocr-status').textContent = 'OCR not installed. Enter the details manually.';
    return;
  }
  try {
    const s = suggestFields(await ocrImage(pendingFile));
    if (s.issue && !$('f-issue').value) $('f-issue').value = s.issue;
    if (s.expiry && !$('f-expiry').value) $('f-expiry').value = s.expiry;
    $('ocr-status').textContent =
      'Suggested dates filled in where found. Please check and correct before saving.';
  } catch {
    $('ocr-status').textContent = 'Could not read the document. Enter the details manually.';
  }
});

$('form-doc').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const old = docs.find(d => d.id === currentId);
    const meta = {
      id: currentId || newId(),
      title: $('f-title').value.trim(),
      type: $('f-type').value,
      number: $('f-number').value.trim(),
      issue: $('f-issue').value,
      expiry: $('f-expiry').value,
      notes: $('f-notes').value.trim(),
      fileId: old?.fileId || null,
      fileName: old?.fileName || null,
      fileType: old?.fileType || null,
      createdAt: old?.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    if (pendingFile) {
      const bytes = new Uint8Array(await pendingFile.arrayBuffer());
      const newFileId = newId();
      await saveFile(newFileId, bytes);        // write new file first
      if (old?.fileId) await dbDel('files', old.fileId); // then remove old
      meta.fileId = newFileId;
      meta.fileName = pendingFile.name;
      meta.fileType = pendingFile.type;
    }
    await saveMeta(meta);
    currentId = null;
    pendingFile = null;
    await loadDocs();
    renderList();
    show('view-list');
  } catch (err) {
    alert('Could not save: ' + err.message);
  }
});

$('btn-cancel').onclick = () => { pendingFile = null; show('view-list'); };

/* ================= Detail actions ================= */
$('btn-back').onclick = () => show('view-list');
$('btn-edit').onclick = () => openForm(docs.find(d => d.id === currentId));

$('btn-download').onclick = async () => {
  const d = docs.find(x => x.id === currentId);
  const bytes = d?.fileId ? await readFile(d.fileId) : null;
  if (!bytes) return alert('No file found for this document.');
  const url = URL.createObjectURL(new Blob([bytes], { type: d.fileType || 'application/octet-stream' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

$('btn-delete').onclick = async () => {
  if (!confirm('Delete this document permanently?')) return;
  try {
    const d = docs.find(x => x.id === currentId);
    if (d?.fileId) await dbDel('files', d.fileId);
    await dbDel('docs', currentId);
    await loadDocs();
    renderList();
    show('view-list');
  } catch (err) { alert('Delete failed: ' + err.message); }
};

$('search').addEventListener('input', renderList);
$('btn-add').onclick = () => openForm(null);

/* ================= Export and import ================= */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

$('btn-export').onclick = async () => {
  try {
    const cfg = await dbGet('meta', 'config');
    const docRows = await dbAll('docs');
    const fileRows = await dbAll('files');
    const payload = {
      format: 'secure-vault',
      version: 1,
      exportedAt: new Date().toISOString(),
      salt: toB64(cfg.salt),
      verifier: { iv: toB64(cfg.iv), data: toB64(cfg.data) },
      docs: docRows.map(r => ({ id: r.id, iv: toB64(r.iv), data: toB64(r.data) })),
      files: fileRows.map(r => ({ id: r.id, iv: toB64(r.iv), data: toB64(r.data) }))
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    download(blob, `vault-${new Date().toISOString().slice(0, 10)}.vault`);
  } catch (err) { alert('Export failed: ' + err.message); }
};

$('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const p = JSON.parse(await file.text());
    if (p.format !== 'secure-vault' || !p.salt) throw new Error('Not a valid vault file.');

    const pass = prompt('Enter the master password used when this vault was exported:');
    if (!pass) return;

    // Derive the key from the export's own salt, then re-encrypt with this device's key
    const oldKey = await deriveKey(pass, fromB64(p.salt));
    let ok = false;
    try {
      ok = dec.decode(await decrypt(oldKey, fromB64(p.verifier.iv), fromB64(p.verifier.data))) === 'VAULT-OK';
    } catch { ok = false; }
    if (!ok) throw new Error('Wrong password for this file.');

    for (const f of p.files) {
      await saveFile(f.id, await decrypt(oldKey, fromB64(f.iv), fromB64(f.data)));
    }
    let count = 0;
    for (const d of p.docs) {
      const meta = JSON.parse(dec.decode(await decrypt(oldKey, fromB64(d.iv), fromB64(d.data))));
      await saveMeta(meta);
      count++;
    }
    await loadDocs();
    renderList();
    alert(`Imported ${count} document(s). Existing items with the same ID were replaced.`);
  } catch (err) { alert('Import failed: ' + err.message); }
});

/* ================= Notifications ================= */
$('btn-notify').onclick = async () => {
  if (!('Notification' in window)) return alert('Notifications are not supported here.');
  const r = await Notification.requestPermission();
  alert(r === 'granted'
    ? 'Enabled. Renewal alerts appear when the app is opened.'
    : 'Notifications were not allowed.');
};

async function notifyDue() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const due = docs.filter(d => {
    const n = daysLeft(d.expiry);
    return n !== null && n <= WARN_DAYS;
  });
  if (!due.length) return;
  const body = due.slice(0, 3).map(d => d.title).join(', ') + (due.length > 3 ? ' and more' : '');
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  if (reg) reg.showNotification('Documents need renewal', { body, tag: 'renewal' });
  else new Notification('Documents need renewal', { body });
}

/* ================= Wipe ================= */
$('btn-wipe').onclick = async () => {
  if (!confirm('This permanently deletes ALL documents on this device.')) return;
  if (prompt('Type DELETE to confirm:') !== 'DELETE') return;
  try {
    for (const s of ['meta', 'docs', 'files']) await dbClear(s);
    key = null;
    alert('All data deleted.');
    location.reload();
  } catch (err) { alert('Wipe failed: ' + err.message); }
};

/* ================= Session flow ================= */
function enterApp() {
  setTop(true);
  renderList();
  show('view-list');
  notifyDue();
}
function lockVault() {
  key = null;
  docs = [];
  currentId = null;
  pendingFile = null;
  $('unlock-pass').value = '';
  setTop(false);
  show('view-unlock');
}

$('btn-lock').onclick = lockVault;

$('form-setup').addEventListener('submit', async e => {
  e.preventDefault();
  const a = $('setup-pass').value;
  const b = $('setup-pass2').value;
  if (a !== b) return alert('Passwords do not match.');
  if (a.length < 8) return alert('Use at least 8 characters.');
  if (!confirm('If this password is lost, your data cannot be recovered. Continue?')) return;
  try {
    await createVault(a);
    $('setup-pass').value = '';
    $('setup-pass2').value = '';
    lastActive = Date.now();
    await loadDocs();
    enterApp();
  } catch (err) { alert('Setup failed: ' + err.message); }
});

$('form-unlock').addEventListener('submit', async e => {
  e.preventDefault();
  $('unlock-error').classList.add('hidden');
  try {
    await unlockVault($('unlock-pass').value);
    $('unlock-pass').value = '';
    lastActive = Date.now();
    await loadDocs();
    enterApp();
  } catch (err) {
    $('unlock-error').textContent = err.message;
    $('unlock-error').classList.remove('hidden');
  }
});

// Auto-lock: inactivity, and long time in background
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
setInterval(() => {
  if (key && Date.now() - lastActive > AUTO_LOCK_MS) lockVault();
}, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (key && Date.now() - hiddenAt > HIDDEN_LOCK_MS) lockVault();
});

/* ================= Start ================= */
(async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  const cfg = await dbGet('meta', 'config');
  show(cfg ? 'view-unlock' : 'view-setup');
})();
