'use strict';

/* ================= Config ================= */
const ITERATIONS = 600000;          // PBKDF2 strength
const AUTO_LOCK_MS = 5 * 60 * 1000; // lock after 5 min idle
const HIDDEN_LOCK_MS = 60 * 1000;   // lock if hidden over 1 min
const WARN_DAYS = 30;               // renewal warning window

/* ================= Libraries (downloaded once, then cached on the device) ================= */
const LIB = {
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int'
};

/* ================= Styles for review panel (no CSS edit needed) ================= */
const reviewCss = document.createElement('style');
reviewCss.textContent = `
.review { background:#fff; border-radius:10px; padding:10px; display:flex; flex-direction:column; gap:8px; }
.sugg { border:1px solid #d0d5dd; border-radius:8px; padding:8px; display:flex; flex-direction:column; gap:6px; }
.sugg small { color:#667085; word-break:break-word; }
.sugg .row { margin-top:0; }
.sugg button { padding:6px 10px; font-size:14px; }
`;
document.head.appendChild(reviewCss);

/* ================= State (memory only) ================= */
let key = null;          // AES key, never stored
let docs = [];           // decrypted document metadata
let currentId = null;    // document being viewed or edited
let pendingFile = null;  // file chosen in the form, not yet saved
let suggestions = [];    // auto-fill suggestions awaiting review
let extractRun = 0;      // ignores out-of-date extraction results
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

/* ================= Reading libraries (loaded on demand, cached by sw.js) ================= */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
async function ensurePdfJs() {
  if (window.pdfjsLib) return true;
  try {
    await loadScript(LIB.pdfjs);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIB.pdfWorker;
    return true;
  } catch { return false; }
}
async function ensureOcr() {
  if (window.Tesseract) return true;
  try {
    await loadScript(LIB.tesseract);
    return !!window.Tesseract;
  } catch { return false; }
}
async function ocrBlob(blob) {
  const worker = await Tesseract.createWorker('eng', 1, { langPath: LIB.lang });
  try {
    const { data } = await worker.recognize(blob);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}

/* ================= Reading files ================= */
async function openPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return pdfjsLib.getDocument({ data: bytes }).promise;
}

async function pdfFirstPageImage(pdf) {
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
async function readDocument(file) {
  if (file.type === 'application/pdf') {
    if (!(await ensurePdfJs())) return { error: 'Could not load the PDF reader. Check internet and try again.' };
    const pdf = await openPdf(file);
    let text = await pdfText(pdf);
    // Scanned PDF with no text layer: read the first page as an image instead
    if (text.replace(/\s/g, '').length < 20) {
      if (!(await ensureOcr())) return { error: 'Could not load the OCR engine. Check internet and try again.' };
      text = await ocrBlob(await pdfFirstPageImage(pdf));
    }
    return { text };
  }
  if (file.type.startsWith('image/')) {
    if (!(await ensureOcr())) return { error: 'Could not load the OCR engine. Check internet and try again.' };
    return { text: await ocrBlob(file) };
  }
  return { error: 'Unsupported file type.' };
}

/* ================= Finding details in the text ================= */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
                 jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const isoDate = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const validDate = (y, m, d) =>
  y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

// Finds dates in several common formats. Assumes DD/MM unless the day is over 12.
function findDates(text) {
  const found = [];
  const patterns = [
    [/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/g, a => [+a[3], +a[2], +a[1]]],
    [/\b(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/g, a => [+a[1], +a[2], +a[3]]],
    [/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/gi,
      a => [+a[3], MONTHS[a[2].toLowerCase()], +a[1]]],
    [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi,
      a => [+a[3], MONTHS[a[1].toLowerCase()], +a[2]]]
  ];
  for (const [re, parse] of patterns) {
    let m;
    while ((m = re.exec(text))) {
      let [y, mo, d] = parse(m);
      if (mo > 12 && d <= 12) [mo, d] = [d, mo];
      if (validDate(y, mo, d)) {
        found.push({ idx: m.index, len: m[0].length, value: isoDate(y, mo, d) });
      }
    }
  }
  return found.sort((a, b) => a.idx - b.idx);
}

const EXPIRY_HINT = /expir|\bexp\b|valid\s*(till|until|upto|up to|to|through)|renew|good till|due date/i;
const ISSUE_HINT = /issue|issued|dated|registered on|granted on/i;

const DOC_TYPES = [
  { re: /\bpassport\b/i, type: 'Identity', title: 'Passport' },
  { re: /driving\s+licen[cs]e|driver'?s?\s+licen[cs]e/i, type: 'Identity', title: 'Driving licence' },
  { re: /aadhaar|aadhar|national identity|identity card|\bid card\b/i, type: 'Identity', title: 'ID card' },
  { re: /\binsurance\b|\bpolicy\s*holder\b|\bpremium\b/i, type: 'Insurance', title: 'Insurance policy' },
  { re: /registration certificate|\bvehicle\b|\bchassis\b/i, type: 'Vehicle', title: 'Vehicle registration' },
  { re: /\bcertificate\b/i, type: 'Certificate', title: 'Certificate' },
  { re: /\bsale deed\b|\bproperty\b|\bland\b/i, type: 'Property', title: 'Property document' },
  { re: /\bbank\b|\bstatement\b|\btax\b|\binvoice\b/i, type: 'Financial', title: 'Financial document' }
];

// Builds suggestions. Each one can fill one or more form fields.


/* ================= Review panel ================= */
const FIELD_IDS = { title: 'f-title', type: 'f-type', number: 'f-number', issue: 'f-issue', expiry: 'f-expiry' };
const FIELD_LABELS = { title: 'Title', type: 'Type', number: 'Document number', issue: 'Issue date', expiry: 'Expiry date' };

function applyValue(field, value) {
  $(FIELD_IDS[field]).value = value;
}
function makeButton(text, onClick, secondary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (secondary) b.className = 'ghost';
  b.onclick = onClick;
  return b;
}
function clearReview() {
  suggestions = [];
  const box = $('review');
  if (box) box.remove();
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
  extractRun++;
  clearReview();
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

// Auto-read the chosen file and show suggestions for review
$('f-file').addEventListener('change', async e => {
  pendingFile = e.target.files[0] || null;
  const run = ++extractRun;
  clearReview();
  if (!pendingFile) return;

  renderReview('Reading document on this device...');
  try {
    const result = await readDocument(pendingFile);
    if (run !== extractRun) return;           // a newer file was chosen
    if (result.error) {
      renderReview(result.error + ' Enter details manually.');
      return;
    }
    suggestions = buildSuggestions(result.text);
    renderReview(suggestions.length
      ? `Found ${suggestions.length} suggestion(s). Approve, edit or dismiss each one. Nothing is saved until you tap Save.`
      : 'No details found. Enter them manually.');
  } catch (err) {
    if (run === extractRun) {
      renderReview('Could not read this document. Enter details manually. (' + err.message + ')');
    }
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
      await saveFile(newFileId, bytes);                       // write new file first
      if (old?.fileId) await dbDel('files', old.fileId);      // then remove old
      meta.fileId = newFileId;
      meta.fileName = pendingFile.name;
      meta.fileType = pendingFile.type;
    }
    await saveMeta(meta);
    currentId = null;
    pendingFile = null;
    extractRun++;
    clearReview();
    await loadDocs();
    renderList();
    show('view-list');
  } catch (err) {
    alert('Could not save: ' + err.message);
  }
});

$('btn-cancel').onclick = () => {
  pendingFile = null;
  extractRun++;
  clearReview();
  show('view-list');
};

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
  extractRun++;
  clearReview();
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
    if (navigator.onLine) { ensurePdfJs(); ensureOcr(); }   // pre-load readers while online
  }
  const cfg = await dbGet('meta', 'config');
  show(cfg ? 'view-unlock' : 'view-setup');
})();
/* ================= Smart document recognition (replaces older buildSuggestions) ================= */

// Document kinds, most specific first. The first match wins.
const DOC_RULES = [
  { re: /life\s+(insurance|assurance|cover)|term\s+(plan|insurance)|endowment|sum\s+assured/i,
    kind: 'Life insurance', type: 'Insurance', person: true },
  { re: /health\s+insurance|mediclaim|medical\s+insurance|health\s+card/i,
    kind: 'Health insurance', type: 'Insurance', person: true },
  { re: /motor\s+(insurance|policy)|car\s+insurance|vehicle\s+insurance|two[\s-]?wheeler\s+insurance|own\s+damage|third[\s-]?party/i,
    kind: 'Car insurance', type: 'Insurance', vehicle: true },
  { re: /travel\s+insurance/i, kind: 'Travel insurance', type: 'Insurance', person: true },
  { re: /home\s+insurance|property\s+insurance/i, kind: 'Home insurance', type: 'Insurance' },
  { re: /insurance|policy\s*(holder|no|number)|premium/i,
    kind: 'Insurance policy', type: 'Insurance', person: true },
  { re: /registration\s+certificate|certificate\s+of\s+registration|registering\s+authority|chassis/i,
    kind: 'Vehicle registration (RC)', type: 'Vehicle', vehicle: true },
  { re: /driving\s+licen[cs]e|driver'?s?\s+licen[cs]e/i,
    kind: 'Driving licence', type: 'Identity', person: true },
  { re: /\bpassport\b/i, kind: 'Passport', type: 'Identity', person: true },
  { re: /aadhaar|aadhar|national identity|identity card|\bid card\b|\bpan\s+card|permanent account number/i,
    kind: 'ID card', type: 'Identity', person: true },
  { re: /certif(icate|y)|this is to certify|certify that/i,
    kind: 'Certificate', type: 'Certificate', person: true },
  { re: /sale\s+deed|property|land\s+record|\bland\b/i, kind: 'Property document', type: 'Property' },
  { re: /bank\s+statement|statement\s+of\s+account|\btax\b|\binvoice\b/i,
    kind: 'Financial document', type: 'Financial' }
];

// Words that are never part of a person's name
const NAME_STOP = /^(of|the|and|name|policy|number|no|date|address|holder|insured|son|daughter|wife|dob|sex|male|female|issue|valid|expiry|nominee|premium|mobile|email|phone|insurance|company|limited|ltd|bank|plan|certificate|s\/o|d\/o|w\/o)$/i;

// Finds a person's name after common labels such as "Name:", "Insured:" or "certify that"
function extractPersonName(text) {
  const labels = /(?:policy\s*holder'?s?\s*name|holder'?s?\s*name|insured\s*name|insured|name\s+of\s+(?:the\s+)?(?:holder|insured|candidate|student|employee|person)|full\s+name|this\s+is\s+to\s+certify\s+that|certify\s+that|issued\s+to|name)\s*[:\-]?\s*/gi;
  for (const m of text.matchAll(labels)) {
    const start = m.index + m[0].length;
    const rest = text.slice(start, start + 80);
    const words = [];
    for (const w of rest.split(/\s+/)) {
      const clean = w.replace(/[^A-Za-z.'-]/g, '');
      if (!clean || !/^[A-Z]/.test(clean) || NAME_STOP.test(clean)) break;
      words.push(clean);
      if (words.length === 4) break;
    }
    if (words.length >= 2) return words.join(' ');
  }
  return null;
}

// Finds an Indian-style vehicle registration number, e.g. MH12AB1234


// Finds a document number, preferring one labelled "Policy No" or similar
function extractNumber(text) {
  const labelled = /(policy|certificate|passport|licen[cs]e|registration|reg\.?|document|pan|cover\s*note|member)?\s*(?:no|number|nbr|#)\.?\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{4,24})\b/gi;
  let best = null;
  for (const m of text.matchAll(labelled)) {
    if (!/\d/.test(m[2])) continue;
    const prefix = (m[1] || '').toLowerCase();
    const score = prefix.startsWith('policy') ? 3 : prefix ? 2 : 1;
    if (!best || score > best.score) best = { value: m[2].toUpperCase(), score };
  }
  return best ? best.value : null;
}

// Builds suggestions: title, type, number, and dates for review

/* ================= Vehicle number reader (replaces older extractVehicleNo) ================= */

const INDIAN_STATE_CODES = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'BH', 'CG', 'CH', 'DD', 'DL', 'DN', 'GA', 'GJ',
  'HP', 'HR', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ',
  'NL', 'OD', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TG', 'TS', 'TR', 'UP', 'UK', 'UA', 'WB'
]);

// Convert letters that OCR often mistakes for digits, and the reverse
const fixAsLetters = s => s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B');
const fixAsDigits = s => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8');

// Finds a vehicle registration number, ignoring spaces, hyphens and dots
// Examples accepted: MH12AB1234, MH 12 AB 1234, MH-12-AB-1234, MH12 AB1234, 22BH1234AA

/* ================= Vehicle number and date pairing (replaces older versions) ================= */

// Labels that usually sit just before a vehicle number
const VEH_LABEL_RE = /(registration\s*(no|number|num|mark)?|reg\.?\s*(no|number)?|regn\.?\s*(no)?|vehicle\s*(no|number|reg)?|veh\.?\s*(no)?)/gi;

// Reads a vehicle number from a chunk of text, ignoring spaces, hyphens and dots
function vehicleFromChunk(chunk, strictState) {
  const clean = chunk.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Bharat (BH) series, e.g. 22BH1234AA
  const bh = clean.match(/(\d{2})BH([0-9OILSB]{4})([A-Z]{1,2})/);
  if (bh) return `${bh[1]}BH${fixAsDigits(bh[2])}${bh[3]}`;

  // Standard format: state, district, series letters, 4-digit number
  const re = /(?=([A-Z0-9]{2})([0-9OILSB]{1,2})([A-Z]{1,3})([0-9OILSB]{4}))/g;
  for (const m of clean.matchAll(re)) {
    const state = fixAsLetters(m[1]);
    if (strictState && !INDIAN_STATE_CODES.has(state)) continue;
    return `${state}${fixAsDigits(m[2]).padStart(2, '0')}${m[3]}${fixAsDigits(m[4])}`;
  }
  return null;
}

// Order: 1) text just after a label, 2) anywhere in the text, 3) after a label without state check
function extractVehicleNo(text) {
  for (const m of text.matchAll(VEH_LABEL_RE)) {
    const start = m.index + m[0].length;
    const v = vehicleFromChunk(text.slice(start, start + 60), true);
    if (v) return v;
  }
  const anywhere = vehicleFromChunk(text, true);
  if (anywhere) return anywhere;
  for (const m of text.matchAll(VEH_LABEL_RE)) {
    const start = m.index + m[0].length;
    const v = vehicleFromChunk(text.slice(start, start + 60), false);
    if (v) return v;
  }
  return null;
}

// Dates: two dates = earlier is issue, later is expiry. Otherwise use nearby labels.
function buildDates(text) {
  const out = [];
  const snipAt = d => text.slice(Math.max(0, d.idx - 30), d.idx + d.len + 10).replace(/\s+/g, ' ').trim();
  const notBirth = d => !/birth|\bdob\b|d\.o\.b/.test(text.slice(Math.max(0, d.idx - 30), d.idx).toLowerCase());

  const uniq = [];
  for (const d of findDates(text).filter(notBirth)) {
    if (!uniq.some(u => u.value === d.value)) uniq.push(d);
  }

  if (uniq.length === 2) {
    const [a, b] = [...uniq].sort((x, y) => x.value.localeCompare(y.value));
    out.push({ targets: ['issue'], value: a.value, snippet: snipAt(a) });
    out.push({ targets: ['expiry'], value: b.value, snippet: snipAt(b) });
    return out;
  }

  for (const d of uniq) {
    const before = text.slice(Math.max(0, d.idx - 30), d.idx);
    if (EXPIRY_HINT.test(before)) out.push({ targets: ['expiry'], value: d.value, snippet: snipAt(d) });
    else if (ISSUE_HINT.test(before)) out.push({ targets: ['issue'], value: d.value, snippet: snipAt(d) });
    else out.push({ targets: ['issue', 'expiry'], value: d.value, snippet: snipAt(d) });
  }
  return out;
}

// Builds suggestions for the review panel

/* ================= Smart picker v2 (part 1: reading the text) ================= */

const VALID_STATES = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'BH', 'CG', 'CH', 'DD', 'DL', 'DN', 'GA', 'GJ',
  'HP', 'HR', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ',
  'NL', 'OD', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TG', 'TS', 'TR', 'UP', 'UK', 'UA', 'WB'
]);
const toLetters = s => s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B');
const toDigits = s => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8');

// Read every page of a PDF, not just the first few
async function pdfText(pdf) {
  let text = '';
  const last = Math.min(pdf.numPages, 25);
  for (let i = 1; i <= last; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return text;
}

// Document kinds. Specific kinds are counted; the generic one is used only if nothing else matches.
const DOC_KINDS = [
  { kind: 'Life insurance', type: 'Insurance', person: true,
    re: /life\s+(insurance|assurance|cover)|term\s+(plan|insurance)|endowment|sum\s+assured/ },
  { kind: 'Health insurance', type: 'Insurance', person: true,
    re: /health\s+insurance|mediclaim|medical\s+insurance|health\s+card/ },
  { kind: 'Car insurance', type: 'Insurance', vehicle: true,
    re: /motor\s+(insurance|policy)|car\s+insurance|vehicle\s+insurance|two[\s-]?wheeler\s+insurance|own\s+damage|third[\s-]?party|private\s+car|package\s+policy|auto\s+secure/ },
  { kind: 'Travel insurance', type: 'Insurance', person: true, re: /travel\s+insurance/ },
  { kind: 'Home insurance', type: 'Insurance', re: /home\s+insurance|property\s+insurance/ },
  { kind: 'Vehicle registration (RC)', type: 'Vehicle', vehicle: true,
    re: /registration\s+certificate|certificate\s+of\s+registration|registering\s+authority|chassis/ },
  { kind: 'Driving licence', type: 'Identity', person: true, re: /driving\s+licen[cs]e|driver'?s?\s+licen[cs]e/ },
  { kind: 'Passport', type: 'Identity', person: true, re: /\bpassport\b/ },
  { kind: 'ID card', type: 'Identity', person: true,
    re: /aadhaar|aadhar|national identity|identity card|\bid card\b|permanent account number/ },
  { kind: 'Certificate', type: 'Certificate', person: true, re: /certif(icate|y)|this is to certify/ },
  { kind: 'Property document', type: 'Property', re: /sale\s+deed|property|land\s+record/ },
  { kind: 'Financial document', type: 'Financial', re: /bank\s+statement|statement\s+of\s+account|\btax\b|\binvoice\b/ },
  { kind: 'Insurance policy', type: 'Insurance', person: true, generic: true,
    re: /insurance|policy\s*(holder|no|number)|premium/ }
];

function countHits(re, text) {
  return (text.match(new RegExp(re.source, 'gi')) || []).length;
}
function pickKind(text) {
  let best = null;
  for (const k of DOC_KINDS) {
    if (k.generic) continue;
    const n = countHits(k.re, text);
    if (n && (!best || n > best.n)) best = { k, n };
  }
  if (best) return best.k;
  return DOC_KINDS.find(k => k.generic && countHits(k.re, text)) || null;
}

// Words that are never part of a person's name
const NAME_BLOCK = /^(of|the|and|name|policy|number|no|date|address|holder|insured|owner|registered|motor|vehicle|son|daughter|wife|husband|dob|sex|male|female|issue|valid|from|till|expiry|nominee|premium|mobile|email|phone|contact|client|id|gstin|insurance|company|limited|ltd|bank|plan|certificate|tower|flat|road|nagar|city|state|pin|code|for|to|hrs|midnight|make|model|fuel|engine|chassis|cover|damage|third|party|own|period|details|key|information)$/i;

function findPersonName(text) {
  const label = /(policy\s*holder'?s?\s*name|insured\s*name|name\s+of\s+(?:the\s+)?(?:holder|insured|candidate|student|employee|person|nominee)|full\s+name|certify\s+that|issued\s+to|\bname)\s*[:\-]?\s*/gi;
  for (const m of text.matchAll(label)) {
    const words = [];
    const chunk = text.slice(m.index + m[0].length, m.index + m[0].length + 120);
    for (const raw of chunk.split(/\s+/)) {
      const w = raw.replace(/[^A-Za-z.'-]/g, '');
      if (!w) continue;
      if (!words.length && /^(mr|mrs|ms|miss|dr|shri|smt|kum)\.?$/i.test(w)) continue;
      if (NAME_BLOCK.test(w)) break;
      words.push(w);
      if (words.length === 4) break;
    }
    if (words.length >= 2) {
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  }
  return null;
}

// Policy or document number, allowing spaces (e.g. "0157681764 09 00")
function takeTokens(text, start) {
  const toks = [];
  for (const t of text.slice(start, start + 60).split(/\s+/)) {
    if (!t) continue;
    if (!/^[A-Z0-9\/\-]+$/i.test(t) || !/\d/.test(t)) break;
    toks.push(t.toUpperCase());
    if (toks.length === 4) break;
  }
  return toks.join(' ');
}
function findNumber(text) {
  const p = /policy\s*(?:no|number|num)\.?\s*[:\-#]?\s*/i.exec(text);
  if (p) {
    const v = takeTokens(text, p.index + p[0].length);
    if (v) return v;
  }
  const g = /(certificate|passport|licen[cs]e|\bpan|document|cover\s*note|member|client)\s*(?:id|no|number)\.?\s*[:\-#]?\s*/i.exec(text);
  if (g) {
    const v = takeTokens(text, g.index + g[0].length);
    if (v) return v;
  }
  return null;
}

// Vehicle numbers, ignoring spaces, dots and hyphens. Only valid state codes are accepted.
function vehicleCandidates(text) {
  const up = text.toUpperCase();
  const found = new Map();
  const std = /(?<![A-Z0-9])([A-Z0-9]{2})[\s.\-]*([0-9OIL]{1,2})[\s.\-]*([A-Z0-9]{1,3})[\s.\-]*([0-9OILSB]{4})(?![0-9])/g;
  for (const m of up.matchAll(std)) {
    const state = toLetters(m[1]);
    if (!VALID_STATES.has(state)) continue;
    const series = toLetters(m[3]);
    const value = `${state}${toDigits(m[2]).padStart(2, '0')}${series}${toDigits(m[4])}`;
    if (!/^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$/.test(value)) continue;
    const before = up.slice(Math.max(0, m.index - 40), m.index);
    const score = /regn|registration|reg\.?\s*no|vehicle|veh/i.test(before) ? 4 : 1;
    const prev = found.get(value);
    if (!prev || prev.score < score) found.set(value, { value, score, idx: m.index });
  }
  const bh = /(?<![A-Z0-9])(\d{2})[\s.\-]*BH[\s.\-]*([0-9OILSB]{4})[\s.\-]*([A-Z]{1,2})(?![A-Z])/g;
  for (const m of up.matchAll(bh)) {
    const value = `${m[1]}BH${toDigits(m[2])}${m[3]}`;
    if (!found.has(value)) found.set(value, { value, score: 1, idx: m.index });
  }
  return [...found.values()].sort((a, b) => b.score - a.score || a.idx - b.idx);
}

// Dates: a pair about one year apart after a cover label is treated as the policy period
const COVER_ANCHOR = /own\s*damage|\bod\s*(cover|period)|third[\s-]?party|\btp\s*(cover|period)|policy\s*period|period\s*of\s*insurance|cover\s*period|valid\s*(from|till|upto|until)/i;
const NOT_POLICY_DATE = /birth|\bdob\b|d\.o\.b|registration|receipt|previous|prior|premium/i;
const snipDate = (text, a, b) =>
  text.slice(Math.max(0, a - 30), Math.min(text.length, b + 12)).replace(/\s+/g, ' ').trim().slice(0, 110);

function smartDates(text) {
  const all = findDates(text).filter(d =>
    !NOT_POLICY_DATE.test(text.slice(Math.max(0, d.idx - 40), d.idx)));

  const pairs = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length && j < i + 6; j++) {
      const a = all[i], b = all[j];
      const days = (Date.parse(b.value) - Date.parse(a.value)) / 86400000;
      if (days < 340 || days > 390) continue;
      const anchored = COVER_ANCHOR.test(text.slice(Math.max(0, a.idx - 120), a.idx));
      pairs.push({ a, b, anchored: anchored ? 1 : 0 });
    }
  }
  if (pairs.length) {
    const ranked = pairs.map(p => {
      const [from, till] = p.a.value < p.b.value ? [p.a, p.b] : [p.b, p.a];
      return { from, till, anchored: p.anchored };
    }).sort((x, y) => (y.anchored - x.anchored) ||
      (y.till.value < x.till.value ? -1 : y.till.value > x.till.value ? 1 : 0));
    const best = ranked[0];
    const s = snipDate(text, best.from.idx, best.till.idx + best.till.len);
    return [
      { targets: ['issue'], value: best.from.value, snippet: s, note: 'Policy period' },
      { targets: ['expiry'], value: best.till.value, snippet: s, note: 'Policy period' }
    ];
  }

  // No clear pair: use nearby words, or offer both choices
  const out = [];
  const seen = new Set();
  for (const d of all) {
    if (seen.has(d.value)) continue;
    seen.add(d.value);
    const before = text.slice(Math.max(0, d.idx - 30), d.idx).toLowerCase();
    const s = snipDate(text, d.idx, d.idx + d.len);
    if (/expir|expires|renew|due\s*date|valid\s*upto|valid\s*until/.test(before)) {
      out.push({ targets: ['expiry'], value: d.value, snippet: s, note: '' });
    } else if (/issued|issue\s*date|dated|granted\s*on/.test(before)) {
      out.push({ targets: ['issue'], value: d.value, snippet: s, note: '' });
    } else {
      out.push({ targets: ['issue', 'expiry'], value: d.value, snippet: s, note: 'Check which date this is' });
    }
  }
  return out.slice(0, 4);
  }
/* ================= Smart picker v2 (part 2: suggestions and review) ================= */

function buildSuggestions(text) {
  const out = [];
  const add = (targets, value, snippet, note) => {
    if (!value || out.length >= 14) return;
    if (out.some(s => s.value === value && s.targets.join() === targets.join())) return;
    out.push({ targets, value, snippet, note: note || '' });
  };
  const near = (idx, len) =>
    text.slice(Math.max(0, idx - 30), idx + len + 20).replace(/\s+/g, ' ').trim().slice(0, 110);
  const at = v => {
    const i = text.toLowerCase().indexOf(v.toLowerCase());
    return i >= 0 ? near(i, v.length) : '';
  };

  const kind = pickKind(text);
  const vehicles = vehicleCandidates(text);
  const person = findPersonName(text);
  const policyNo = findNumber(text);

  if (kind) {
    const km = text.match(new RegExp(kind.re.source, 'i'));
    const kindSn = km ? near(km.index, km[0].length) : '';

    if (kind.vehicle && vehicles.length) {
      add(['title'], `${kind.kind} - ${vehicles[0].value}`, near(vehicles[0].idx, 12), 'Vehicle no.');
      for (const v of vehicles.slice(1, 3)) {
        add(['title'], `${kind.kind} - ${v.value}`, near(v.idx, 12), 'Other vehicle no. (check which is correct)');
      }
    } else if (kind.person && person) {
      add(['title'], `${kind.kind} - ${person}`, at(person), 'Name');
    } else {
      add(['title'], kind.kind, kindSn, '');
    }
    add(['type'], kind.type, kindSn, 'Document type');
  }

  const num = policyNo || (kind && kind.vehicle && vehicles[0] ? vehicles[0].value : null);
  if (num) {
    const snip = policyNo ? at(num) : near(vehicles[0].idx, 12);
    add(['number'], num, snip, policyNo ? 'Policy no.' : 'Vehicle no.');
  }

  for (const d of smartDates(text)) add(d.targets, d.value, d.snippet, d.note);
  return out;
}

// Review panel. "Approve best suggestion for each field" applies only the first suggestion per field.
function renderReview(statusText) {
  let box = $('review');
  if (!box) {
    box = document.createElement('div');
    box.id = 'review';
    box.className = 'review';
    $('ocr-status').after(box);
  }
  box.innerHTML = '';

  const head = document.createElement('p');
  head.className = 'hint';
  head.textContent = statusText;
  box.appendChild(head);
  if (!suggestions.length) return;

  box.appendChild(makeButton('Approve best suggestion for each field', () => {
    const used = new Set();
    const keep = [];
    for (const s of suggestions) {
      const t = s.targets[0];
      if (s.targets.length === 1 && !used.has(t)) {
        used.add(t);
        applyValue(t, s.value);
      } else {
        keep.push(s);
      }
    }
    suggestions = keep;
    renderReview('Applied the best suggestion for each field. Check the form, then tap Save.');
  }));

  suggestions.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'sugg';

    const strong = document.createElement('strong');
    strong.textContent = s.targets.map(t => FIELD_LABELS[t]).join(' or ') + ': ' + s.value;
    const src = document.createElement('small');
    src.textContent = (s.note ? s.note + ' · ' : '') + 'Found in: "' + s.snippet + '"';
    card.append(strong, src);

    const row = document.createElement('div');
    row.className = 'row';
    const finish = (msg, field) => {
      if (field) applyValue(field, s.value);
      suggestions.splice(i, 1);
      renderReview(msg);
    };

    if (s.targets.length > 1) {
      for (const t of s.targets) {
        row.appendChild(makeButton('Use as ' + FIELD_LABELS[t].toLowerCase(), () =>
          finish('Applied. Check the form, then tap Save.', t)));
      }
    } else {
      const t = s.targets[0];
      row.appendChild(makeButton('Approve', () => finish('Approved. Check the form, then tap Save.', t)));
      row.appendChild(makeButton('Edit', () => {
        applyValue(t, s.value);
        suggestions.splice(i, 1);
        renderReview('Filled in. Change it in the form, then tap Save.');
        $(FIELD_IDS[t]).focus();
      }, true));
    }
    row.appendChild(makeButton('Dismiss', () => finish('Dismissed.', null), true));
    card.appendChild(row);
    box.appendChild(card);
  });
      }
