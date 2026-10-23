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
