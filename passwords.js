/* ===== passwords.js PART 1 of 2. Create the file with this part. Asks for PDF passwords and keeps them encrypted in the vault. ===== */
'use strict';

// Memory only: the password that opened each File, until it is saved with the page
const PW_BY_FILE = new WeakMap();

function pwIsPasswordError(e) {
  return !!e && e.name === 'PasswordException';
}

// Opens a PDF and asks for its password when needed. Returns the document, or null if cancelled.
async function pwOpen(bytes, file) {
  let pw = PW_BY_FILE.get(file);
  for (let tries = 0; tries < 4; tries++) {
    try {
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), password: pw }).promise;
      if (pw) PW_BY_FILE.set(file, pw);
      return pdf;
    } catch (e) {
      if (!pwIsPasswordError(e)) throw e;
      const ans = prompt(
        (pw ? 'Incorrect password. ' : 'This PDF is password protected. ') +
        'Enter its password.\n\nFile: ' + file.name +
        '\n\nIt will be saved in the vault with this document.');
      if (!ans) return null;
      pw = ans;
    }
  }
  return null;
}

// True if the PDF cannot be opened without a password
async function pwNeedsPassword(bytes) {
  if (!(await pkLoadPdf())) throw new Error('The PDF reader could not load. Check internet and try again.');
  try {
    await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    return false;
  } catch (e) {
    if (pwIsPasswordError(e)) return true;
    throw e;
  }
}

// Reads a PDF (text, or scanned pages by OCR), asking for a password if needed
async function pwReadPdf(file) {
  if (!(await pkLoadPdf())) return { error: 'Could not load the PDF reader. Check internet and try again.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pwOpen(bytes, file);
  if (!pdf) return { error: 'No password entered, so this PDF was not read.' };
  let text = await pkPdfText(pdf);
  if (text.replace(/\s/g, '').length < 40) {
    if (!(await pkLoadOcr())) return { error: 'Scanned PDF needs the OCR engine. Check internet and try again.' };
    text = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      text += await pkOcrBlob(await pkPageImage(pdf, i), false) + '\n';
    }
  }
  return { text };
}

// Every reader (form, issuer review, tests) goes through this. PDFs use the password flow; other files keep their reader.
const pwBaseRead = readDocument;
readDocument = function (file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  return isPdf ? pwReadPdf(file) : pwBaseRead(file);
};

// Saves each page with the password that opened it (empty if the file is not protected)
vuStorePages = async function (docId, files, startNo) {
  const ids = [];
  let n = startNo;
  for (const f of files) {
    n++;
    const pid = newId();
    await v2PutPage({
      id: pid, docId, pageNo: n, name: f.name,
      mime: f.type || 'application/octet-stream',
      password: PW_BY_FILE.get(f) || ''
    }, new Uint8Array(await f.arrayBuffer()));
    ids.push(pid);
  }
  return ids;
};

// Reads a page's details without decrypting its file bytes
async function pwMeta(pid) {
  v2Need();
  const r = await v2Tx('pages', 'readonly', os => os.get(pid));
  if (!r) return null;
  return JSON.parse(dec.decode(await decrypt(key, r.mIv, r.m)));
}

// Saves a password (or clears it, with '') on a stored page
async function pwSavePassword(pid, pw) {
  const p = await v2GetPage(pid);
  if (!p) throw new Error('This page could not be found.');
  await v2PutPage({ ...p.meta, password: pw }, p.bytes);
}

// Issuer review: when a password is needed, it is saved so the page is not asked again
ssDocText = async function (d) {
  let text = '';
  for (const pid of d.pageIds || []) {
    const p = await v2GetPage(pid);
    if (!p) continue;
    const file = new File([p.bytes], p.meta.name || 'page', { type: p.meta.mime || '' });
    if (p.meta.password) PW_BY_FILE.set(file, p.meta.password);
    const r = await readDocument(file);
    if (r.error) continue;
    text += '\n' + (r.text || '');
    const pw = PW_BY_FILE.get(file);
    if (pw && pw !== p.meta.password) await pwSavePassword(pid, pw);
  }
  return text;
};
