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
async function pdfText(pdf) {
  let text = '';
  const last = Math.min(pdf.numPages, 3);
  for (let i = 1; i <= last; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return text;
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
function buildSuggestions(text) {
  const out = [];
  const seen = new Set();
  const snip = (idx, len) =>
    text.slice(Math.max(0, idx - 30), idx + len + 10).replace(/\s+/g, ' ').trim();
  const add = (targets, value, snippet) => {
    const k = targets.join() + '|' + value;
    if (!value || seen.has(k) || out.length >= 12) return;
    seen.add(k);
    out.push({ targets, value, snippet });
  };

  // Document type and suggested title
  const dt = DOC_TYPES.find(d => d.re.test(text));
  if (dt) {
    const m = text.match(dt.re);
    const sn = snip(m.index, m[0].length);
    add(['type'], dt.type, sn);
    add(['title'], dt.title, sn);
  }

  // Document number: first "No", "Number" or "Nbr" followed by a value containing a digit
  for (const m of text.matchAll(/\b(?:no|number|nbr)\b\.?\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{4,24})\b/gi)) {
    if (/\d/.test(m[1])) {
      add(['number'], m[1].toUpperCase(), snip(m.index, m[0].length));
      break;
    }
  }

  // Dates: label nearby decides expiry or issue; unknown dates offer both
  for (const d of findDates(text)) {
    const before = text.slice(Math.max(0, d.idx - 30), d.idx).toLowerCase();
    const sn = snip(d.idx, d.len);
    if (EXPIRY_HINT.test(before)) add(['expiry'], d.value, sn);
    else if (ISSUE_HINT.test(before)) add(['issue'], d.value, sn);
    else add(['issue', 'expiry'], d.value, sn);
  }
  return out;
}

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
function renderReview(statusText) {
  let box = $('review');
  if (!box) {
    box = document.createElement('div');
    box.id = 'review';
    box.className = 'review';
    $('ocr-status').after(box);   // sits just below the file picker
  }
  box.innerHTML = '';

  const head = document.createElement('p');
  head.className = 'hint';
  head.textContent = statusText;
  box.appendChild(head);

  if (!suggestions.length) return;

  box.appendChild(makeButton('Approve all single-field suggestions', () => {
    suggestions = suggestions.filter(s => {
      if (s.targets.length === 1) { applyValue(s.targets[0], s.value); return false; }
      return true;
    });
    renderReview('Approved. Check the form below, then tap Save.');
  }));

  suggestions.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'sugg';

    const strong = document.createElement('strong');
    strong.textContent = s.targets.map(t => FIELD_LABELS[t]).join(' or ') + ': ' + s.value;
    const src = document.createElement('small');
    src.textContent = 'Found in: "' + s.snippet + '"';
    card.append(strong, src);

    const row = document.createElement('div');
    row.className = 'row';
    if (s.targets.length > 1) {
      // Unknown date: let the user choose which field it belongs to
      for (const t of s.targets) {
        row.appendChild(makeButton('Use as ' + FIELD_LABELS[t].toLowerCase(), () => {
          applyValue(t, s.value);
          suggestions.splice(i, 1);
          renderReview('Applied. Check the form below, then tap Save.');
        }));
      }
    } else {
      const t = s.targets[0];
      row.appendChild(makeButton('Approve', () => {
        applyValue(t, s.value);
        suggestions.splice(i, 1);
        renderReview('Approved. Check the form below, then tap Save.');
      }));
      row.appendChild(makeButton('Edit', () => {
        applyValue(t, s.value);
        suggestions.splice(i, 1);
        renderReview('Filled in. Change it in the form below, then tap Save.');
        $(FIELD_IDS[t]).focus();
      }, true));
    }
    row.appendChild(makeButton('Dismiss', () => {
      suggestions.splice(i, 1);
      renderReview(suggestions.length ? 'Dismissed.' : 'No suggestions left. Enter details manually.');
    }, true));
    card.appendChild(row);
    box.appendChild(card);
  });
  }
