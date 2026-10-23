/* ===== backup.js PART 1 of 3. Create the file with this part. Collects all data, compresses, encrypts, checks and restores. ===== */
'use strict';

const BK_MAGIC = 'SVBK1';
const BK_MAGIC_BYTES = new TextEncoder().encode(BK_MAGIC);
const BK_HDR_LEN = BK_MAGIC_BYTES.length + 16 + 12;          // magic + salt + iv
const BK_OLD_STORES = ['meta', 'docs', 'files'];              // main database
const BK_V2_STORES = ['people', 'vehicles', 'docs', 'pages']; // vault-v2 database

// Binary values become base64 text so the backup is plain JSON before compression
function bkPack(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) o[k] = v instanceof Uint8Array ? { __b: toB64(v) } : v;
  return o;
}
function bkUnpack(row) {
  const o = {};
  for (const [k, v] of Object.entries(row || {})) {
    o[k] = v && typeof v === 'object' && typeof v.__b === 'string' ? fromB64(v.__b) : v;
  }
  return o;
}

// Streams bytes through a compression or decompression stream
async function bkPipe(bytes, stream) {
  const w = stream.writable.getWriter();
  const writing = w.write(bytes).then(() => w.close());
  writing.catch(() => {});
  const out = new Uint8Array(await new Response(stream.readable).arrayBuffer());
  await writing;
  return out;
}

// Reads every stored row, still encrypted, from both databases
async function bkReadAll() {
  v2Need();
  const old = {}, v2 = {};
  for (const s of BK_OLD_STORES) old[s] = (await dbAll(s)).map(bkPack);
  for (const s of BK_V2_STORES) {
    v2[s] = (await v2Tx(s, 'readonly', os => os.getAll())).map(bkPack);
  }
  return { old, v2 };
}
function bkCountsOf(data) {
  return {
    people: data.v2.people.length,
    vehicles: data.v2.vehicles.length,
    documents: data.v2.docs.length,
    pages: data.v2.pages.length,
    oldDocuments: data.old.docs.length,
    oldFiles: data.old.files.length
  };
}

// Builds the encrypted backup file as bytes
async function bkBuild() {
  if (!key) throw new Error('Unlock the vault first.');
  const cfg = await dbGet('meta', 'config');
  if (!cfg || !cfg.salt || cfg.salt.length !== 16) throw new Error('No vault configuration found.');
  const data = await bkReadAll();
  const counts = bkCountsOf(data);
  const json = enc.encode(JSON.stringify({
    format: 'secure-vault-backup', version: 2, created: new Date().toISOString(),
    counts, old: data.old, v2: data.v2
  }));
  const zipped = await bkPipe(json, new CompressionStream('gzip'));
  const iv = rand(12);
  const header = new Uint8Array(BK_HDR_LEN);
  header.set(BK_MAGIC_BYTES, 0);
  header.set(cfg.salt, BK_MAGIC_BYTES.length);
  header.set(iv, BK_MAGIC_BYTES.length + 16);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, key, zipped));
  const bytes = new Uint8Array(BK_HDR_LEN + cipher.length);
  bytes.set(header, 0);
  bytes.set(cipher, BK_HDR_LEN);
  return { bytes, counts, sizeIn: json.length, sizeOut: bytes.length };
}

// Checks the file header and decrypts the payload with a ready key
async function bkUnwrap(bytes, k) {
  if (bytes.length < BK_HDR_LEN + 16) throw new Error('The file is too small to be a backup.');
  if (dec.decode(bytes.slice(0, BK_MAGIC_BYTES.length)) !== BK_MAGIC) {
    throw new Error('This is not a Secure Vault backup file.');
  }
  const header = bytes.slice(0, BK_HDR_LEN);
  const iv = bytes.slice(BK_MAGIC_BYTES.length + 16, BK_HDR_LEN);
  let zipped;
  try {
    zipped = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: header }, k, bytes.slice(BK_HDR_LEN)));
  } catch {
    throw new Error('Wrong master password, or the backup is damaged.');
  }
  const payload = JSON.parse(dec.decode(await bkPipe(zipped, new DecompressionStream('gzip'))));
  if (payload.format !== 'secure-vault-backup') throw new Error('Unknown backup format.');
  return payload;
}

// Derives the key from the password and the salt stored in the file header
async function bkDecode(bytes, password) {
  if (bytes.length < BK_HDR_LEN + 16) throw new Error('The file is too small to be a backup.');
  if (dec.decode(bytes.slice(0, BK_MAGIC_BYTES.length)) !== BK_MAGIC) {
    throw new Error('This is not a Secure Vault backup file.');
  }
  const salt = bytes.slice(BK_MAGIC_BYTES.length, BK_MAGIC_BYTES.length + 16);
  const k = await deriveKey(password, salt);
  const payload = await bkUnwrap(bytes, k);
  return { payload, k };
}

// Confirms the password matches the vault inside the backup, and that a sample record decrypts
async function bkCheckPayload(payload, k) {
  const old = payload.old || {};
  const cfgRow = (old.meta || []).find(r => r.id === 'config');
  if (!cfgRow) throw new Error('The backup has no vault configuration.');
  const cfg = bkUnpack(cfgRow);
  let ok = false;
  try { ok = dec.decode(await decrypt(k, cfg.iv, cfg.data)) === 'VAULT-OK'; } catch { ok = false; }
  if (!ok) throw new Error('The vault check failed. The password does not match this backup.');
  const sample = ((payload.v2 && payload.v2.docs) || [])[0] || (old.docs || [])[0];
  if (sample) {
    const r = bkUnpack(sample);
    try { await decrypt(k, r.iv, r.data); }
    catch { throw new Error('A document in the backup could not be decrypted.'); }
  }
  return true;
}

// Empties every store. Used only by restore, after the safety copy is saved.
async function bkWipeAll() {
  for (const s of BK_OLD_STORES) await dbClear(s);
  for (const s of BK_V2_STORES) await v2Tx(s, 'readwrite', os => os.clear());
}
async function bkWriteAll(payload) {
  const old = payload.old || {}, v2 = payload.v2 || {};
  for (const s of BK_OLD_STORES) {
    for (const row of old[s] || []) await dbPut(s, bkUnpack(row));
  }
  for (const s of BK_V2_STORES) {
    for (const row of v2[s] || []) await v2Tx(s, 'readwrite', os => os.put(bkUnpack(row)));
  }
    }
/* ===== backup.js PART 2A of 3. Append to the end. Folder access, schedule and automatic runs. ===== */
let BK_STATUS = null;
function bkReport(msg) { if (BK_STATUS) BK_STATUS.textContent = msg; }
function bkKb(n) { return (n / 1024).toFixed(1) + ' KB'; }
function bkCountText(c) { return Object.entries(c).map(([k, v]) => k + ' ' + v).join(', '); }
function bkStamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ---------- settings, kept on this device (no secrets) ---------- */
const BK_SET_KEY = 'sv-backup-schedule';
const BK_DEFAULT = {
  enabled: false, mode: 'download', freq: 'weekly', time: '20:00',
  weekday: 0, monthday: 1, keep: 10, lastRun: 0, lastInfo: ''
};
function bkSettings() {
  try { return { ...BK_DEFAULT, ...JSON.parse(localStorage.getItem(BK_SET_KEY) || '{}') }; }
  catch { return { ...BK_DEFAULT }; }
}
function bkSaveSettings(s) { localStorage.setItem(BK_SET_KEY, JSON.stringify(s)); }

/* ---------- backup folder: desktop Chrome only (PC drive D or E, or a synced cloud folder) ---------- */
let bkDbPromise = null;
function bkDb() {
  if (!bkDbPromise) {
    bkDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('vault-backup', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return bkDbPromise;
}
async function bkHandleGet() {
  const db = await bkDb();
  return new Promise((resolve, reject) => {
    const q = db.transaction('handles', 'readonly').objectStore('handles').get('folder');
    q.onsuccess = () => resolve(q.result || null);
    q.onerror = () => reject(q.error);
  });
}
async function bkHandleSet(handle) {
  const db = await bkDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'folder');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function bkFolderOk(h, ask) {
  const opts = { mode: 'readwrite' };
  if ((await h.queryPermission(opts)) === 'granted') return true;
  if (!ask) return false;
  return (await h.requestPermission(opts)) === 'granted';
}
// Writes the file, reads it back and checks its size and header
async function bkWriteToFolder(h, name, bytes) {
  const fh = await h.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(bytes);
  await w.close();
  const back = new Uint8Array(await (await fh.getFile()).arrayBuffer());
  if (back.length !== bytes.length || dec.decode(back.slice(0, BK_MAGIC_BYTES.length)) !== BK_MAGIC) {
    throw new Error('The saved file did not verify. Choose another folder and try again.');
  }
  return back.length;
}
// Keeps the newest backups in the folder and removes older ones (only files this app made)
async function bkPrune(h, keep) {
  const names = [];
  for await (const [name, entry] of h.entries()) {
    if (entry.kind === 'file' && /^vault-backup-.*\.vbk$/.test(name)) names.push(name);
  }
  names.sort();
  const drop = names.slice(0, Math.max(0, names.length - keep));
  for (const n of drop) await h.removeEntry(n);
  return drop.length;
}

/* ---------- schedule ---------- */
function bkSlotOn(s, day) {
  if (s.freq === 'daily') return true;
  if (s.freq === 'weekly') return day.getDay() === Number(s.weekday);
  return day.getDate() === Number(s.monthday);
}
// Latest scheduled time at or before "now"
function bkPrevSlot(s, now) {
  const [hh, mm] = String(s.time || '20:00').split(':').map(Number);
  for (let back = 0; back <= 62; back++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hh, mm, 0, 0);
    if (day <= now && bkSlotOn(s, day)) return day;
  }
  return null;
}
// First scheduled time after "now"
function bkNextSlot(s, now) {
  const [hh, mm] = String(s.time || '20:00').split(':').map(Number);
  for (let fwd = 0; fwd <= 62; fwd++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + fwd, hh, mm, 0, 0);
    if (day > now && bkSlotOn(s, day)) return day;
  }
  return null;
}

/* ---------- banner and notifications ---------- */
function bkBanner(text, btnText, onBtn) {
  let el = document.getElementById('bk-banner');
  if (!text) { if (el) el.remove(); return; }
  if (!el) {
    el = vuEl('div', {
      id: 'bk-banner',
      style: 'background:#fff3e0;border:1px solid #b26a00;border-radius:10px;padding:10px;margin:8px 0'
    });
    document.querySelector('main').prepend(el);
  }
  el.innerHTML = '';
  el.append(vuEl('div', { text }));
  if (btnText && onBtn) el.append(vuBtn(btnText, onBtn));
}
function bkNotify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = 'serviceWorker' in navigator ? navigator.serviceWorker.getRegistration() : null;
  Promise.resolve(reg).then(r => {
    if (r) r.showNotification(title, { body, tag: 'backup' });
    else new Notification(title, { body });
  }).catch(() => {});
}

/* ---------- running one backup ---------- */
// via: 'folder' | 'download' | 'share'. Folder permission is asked first, while the tap is fresh.
async function bkRun(via, ask) {
  let target = null;
  if (via === 'folder') {
    target = await bkHandleGet();
    if (!target) throw new Error('No backup folder chosen yet.');
    if (!(await bkFolderOk(target, ask))) throw new Error('NEEDS_PERMISSION');
  }
  const built = await bkBuild();
  const name = 'vault-backup-' + bkStamp() + '.vbk';
  let info;
  if (via === 'folder') {
    await bkWriteToFolder(target, name, built.bytes);
    const removed = await bkPrune(target, bkSettings().keep);
    info = 'Saved ' + name + ' to ' + (target.name || 'the backup folder') +
      (removed ? ' (removed ' + removed + ' older copy)' : '');
  } else if (via === 'download') {
    dvSaveBlob(new Blob([built.bytes], { type: 'application/octet-stream' }), name);
    info = 'Downloaded ' + name + '. Copy it to drive D or E on your PC, or to cloud storage.';
  } else {
    const file = new File([built.bytes], name, { type: 'application/octet-stream' });
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
      throw new Error('Sharing is not supported in this browser. Use Download.');
    }
    await navigator.share({ files: [file], title: 'Vault backup' });
    info = 'Shared ' + name + '. Choose Google Drive or another app.';
  }
  const s = bkSettings();
  s.lastRun = Date.now();
  s.lastInfo = info + ' · ' + bkCountText(built.counts) + ' · ' + bkKb(built.sizeOut);
  bkSaveSettings(s);
  return s.lastInfo;
}

// A tap-initiated backup (buttons and banners)
async function bkManual(via, ask) {
  try {
    const msg = await bkRun(via, ask);
    bkBanner('');
    bkReport(msg);
    alert(msg);
  } catch (e) {
    if (e.message === 'NEEDS_PERMISSION') {
      bkReport('Folder permission was not given. Tap the button again and choose Allow.');
      return;
    }
    bkReport('Backup failed: ' + e.message);
    alert('Backup failed: ' + e.message);
  }
}

/* ---------- automatic check, runs every minute while the vault is open ---------- */
let bkTickBusy = false;
async function bkTick() {
  if (bkTickBusy) return;
  const s = bkSettings();
  if (!s.enabled || !key) return;
  const slot = bkPrevSlot(s, new Date());
  if (!slot || s.lastRun >= slot.getTime()) return;   // nothing due
  bkTickBusy = true;
  try {
    if (s.mode === 'folder') {
      try {
        const msg = await bkRun('folder', false);
        bkBanner('');
        bkNotify('Backup saved', msg);
      } catch (e) {
        if (e.message === 'NEEDS_PERMISSION') {
          bkBanner('A scheduled backup is due. Tap to allow the backup folder and save it.',
            'Allow and back up', () => bkManual('folder', true));
          bkNotify('Backup due', 'Open the app to allow the backup folder.');
        } else {
          bkBanner('Scheduled backup failed: ' + e.message);
        }
      }
    } else {
      bkBanner('A scheduled backup is due.',
        s.mode === 'share' ? 'Share backup now' : 'Save backup now',
        () => bkManual(s.mode, false));
      bkNotify('Backup due', 'Open the app to save your backup.');
    }
  } finally {
    bkTickBusy = false;
  }
}

// Check when the vault unlocks, and every minute after that
const bkBaseEnter = enterApp;
enterApp = function () {
  bkBaseEnter();
  setTimeout(bkTick, 1500);
};
setInterval(bkTick, 60000);
