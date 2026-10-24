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
/* ===== passwords.js PART 2 of 2. Append to the end. Viewing, password display, password screen, navigation and tests. ===== */

// Shows a saved password with Show and Copy buttons
function pwBox(label, pw) {
  let shown = false;
  const val = vuEl('code', {
    text: '••••••••',
    style: 'font-size:15px;padding:4px 8px;background:#f2f4f7;border-radius:6px;word-break:break-all'
  });
  const toggle = vuBtn('Show', () => {
    shown = !shown;
    val.textContent = shown ? pw : '••••••••';
    toggle.textContent = shown ? 'Hide' : 'Show';
  }, true);
  const copy = vuBtn('Copy', async () => {
    try {
      await navigator.clipboard.writeText(pw);
      alert('Password copied. Paste it when the PDF asks for it.');
    } catch {
      alert('Could not copy. Tap Show and copy it by hand.');
    }
  }, true);
  return vuEl('div', { cls: 'page-row' }, [
    vuEl('div', { cls: 'meta', text: label + ' password:' }), val, toggle, copy
  ]);
}

// Renders each page of a protected PDF into the new window, using the saved password
async function pwRenderProtected(w, bytes, password, label) {
  if (!(await pkLoadPdf())) throw new Error('The PDF reader could not load. Check internet and try again.');
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: bytes.slice(), password }).promise;
  } catch (e) {
    throw new Error(pwIsPasswordError(e)
      ? 'The saved password does not open this PDF. Use Document passwords to forget it, then enter the right one.'
      : 'Could not open the PDF: ' + e.message);
  }
  const doc = w.document;
  doc.title = label || 'Document';
  doc.body.innerHTML = '';
  doc.body.style.cssText = 'margin:0;padding:8px;background:#525659;text-align:center';
  const note = doc.createElement('p');
  note.style.cssText = 'color:#fff;font-family:sans-serif;margin:4px';
  note.textContent = 'Opening...';
  doc.body.appendChild(note);
  const count = Math.min(pdf.numPages, 25);
  for (let i = 1; i <= count; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1.6 });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const img = doc.createElement('img');
    img.alt = 'Page ' + i;
    img.src = c.toDataURL('image/png');
    img.style.cssText = 'display:block;max-width:100%;margin:8px auto;background:#fff';
    doc.body.appendChild(img);
  }
  note.textContent = pdf.numPages + ' page(s)' + (count < pdf.numPages ? ', showing the first ' + count : '');
}

// View button: protected PDFs render with the saved password; others use the normal viewer
async function pwViewStored(pid, label) {
  const w = window.open('', '_blank');   // opened straight from the tap, so pop-up blockers allow it
  if (!w) return alert('Your browser blocked the new window. Allow pop-ups for this app and try again.');
  try {
    const p = await v2GetPage(pid);
    if (!p) throw new Error('This page could not be found.');
    let password = p.meta.password || '';
    const isPdf = /pdf/i.test(p.meta.mime || '') || /\.pdf$/i.test(p.meta.name || '');
    if (!password && isPdf && await pwNeedsPassword(p.bytes)) {
      const file = new File([p.bytes], p.meta.name || 'document.pdf', { type: 'application/pdf' });
      const pdf = await pwOpen(p.bytes, file);
      if (!pdf) { w.close(); return; }
      password = PW_BY_FILE.get(file) || '';
      await pwSavePassword(pid, password);
    }
    if (password) {
      await pwRenderProtected(w, p.bytes, password, label);
    } else {
      w.location.href = URL.createObjectURL(new Blob([p.bytes], { type: p.meta.mime || 'application/octet-stream' }));
    }
  } catch (e) {
    w.close();
    alert(e.message);
  }
}

// Document detail: View, Download, and the saved password for each protected page
vuPagesRow = function (d) {
  const pages = d.pageIds || [];
  const wrap = vuEl('div', {});
  if (!pages.length) {
    wrap.append(vuEl('small', { text: 'No pages stored' }));
    return wrap;
  }
  const label = d.title || d.kind || 'Document';
  pages.forEach((pid, i) => {
    const slot = vuEl('div', {});
    wrap.append(
      vuEl('div', { cls: 'row' }, [
        vuBtn('View page ' + (i + 1), () => pwViewStored(pid, label + ' - page ' + (i + 1)), true),
        vuBtn('Download page ' + (i + 1), () => dvDownloadStored(pid, label, i + 1), true)
      ]),
      slot
    );
    pwMeta(pid).then(meta => {
      if (meta && meta.password) slot.append(pwBox('Page ' + (i + 1), meta.password));
    }).catch(() => {});
  });
  return wrap;
};

// Forget a saved password. The file stays as it is; the next read asks again.
async function pwForget(pid) {
  await pwSavePassword(pid, '');
}

// Document passwords screen: every saved password in one list
async function pwScreen(body) {
  const all = await vuLoadAll();
  const map = vuNameMap(all);
  const rows = [];
  for (const d of all.docs) {
    const pages = d.pageIds || [];
    for (let i = 0; i < pages.length; i++) {
      const meta = await pwMeta(pages[i]).catch(() => null);
      if (meta && meta.password) rows.push({ d, i, pid: pages[i], meta });
    }
  }
  rows.sort((a, b) => (a.d.title || a.d.kind || '').localeCompare(b.d.title || b.d.kind || ''));

  body.append(vuEl('h2', { text: 'Document passwords' }));
  body.append(vuEl('p', {
    cls: 'hint',
    text: 'Passwords for protected PDFs are kept inside the encrypted vault and included in backups. Show or copy them here. Open a document to view it with its saved password.'
  }));
  if (!rows.length) {
    body.append(vuEl('p', { cls: 'hint', text: 'No saved passwords yet. A password is saved when you enter it for a protected PDF.' }));
    return;
  }
  const ul = vuEl('ul', { style: 'list-style:none;padding:0;margin:0' });
  for (const r of rows) {
    const owners = vuOwnersOf(r.d).map(id => map.get(id) || 'Removed').join(', ') || 'Unassigned';
    const forget = vuBtn('Forget password', async () => {
      if (!confirm('Forget this password? You will need to enter it again to read this PDF.')) return;
      try {
        await pwForget(r.pid);
        vuGo('pw');
      } catch (e) { alert('Could not forget: ' + e.message); }
    }, true);
    ul.append(vuEl('li', { cls: 'card', style: 'border-left-color:#6a1b9a' }, [
      vuEl('strong', { text: r.d.title || r.d.kind }),
      vuEl('small', { text: owners + ' · Page ' + (r.i + 1) + (r.meta.name ? ' · ' + r.meta.name : '') }),
      pwBox('Password', r.meta.password),
      vuEl('div', { cls: 'row' }, [
        vuBtn('Open document', () => vuGo('detail', r.d.groupId), true),
        forget
      ])
    ]));
  }
  body.append(ul);
}

/* ---------- navigation: the password screen and its dashboard button ---------- */
const pwBaseGo = vuGo;
vuGo = async function (tab, arg) {
  if (tab !== 'pw') return pwBaseGo(tab, arg);
  const root = vuRootEl();
  root.innerHTML = '';
  root.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Dashboard', () => vuGo('dash'), true),
    vuBtn('Profiles', () => vuGo('profiles'), true),
    vuBtn('Close', () => vuClose(), true)
  ]));
  const body = vuEl('div', {});
  root.append(body);
  try { await pwScreen(body); }
  catch (e) { body.append(vuEl('p', { cls: 'error', text: 'Something went wrong: ' + e.message })); }
};

const pwBaseDash = vuDashboard;
vuDashboard = async function (body) {
  await pwBaseDash(body);
  body.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Document passwords', () => vuGo('pw'), true)
  ]));
};

/* ---------- tests: changes nothing permanent; removes its own test page ---------- */
function pwHas(hay, needle) {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

async function pwSelfTest() {
  const lines = [];
  const ok = (c, m) => lines.push((c ? 'PASS  ' : 'FAIL  ') + m);
  try {
    if (!key) throw new Error('unlock the vault first');
    ok(pwIsPasswordError({ name: 'PasswordException', code: 1 }), 'a "password needed" error is recognised');
    ok(pwIsPasswordError({ name: 'PasswordException', code: 2 }), 'a "wrong password" error is recognised');
    ok(!pwIsPasswordError(new Error('other problem')), 'other errors are not treated as passwords');
    ok(typeof readDocument === 'function' && typeof ssDocText === 'function', 'reader hooks are in place');

    const f = new File([new Uint8Array([37, 80, 68, 70])], 'pw-test.pdf', { type: 'application/pdf' });
    const SECRET = 'Test-Secret-' + Date.now();
    PW_BY_FILE.set(f, SECRET);
    const ids = await vuStorePages('pw-test-' + Date.now(), [f], 0);
    try {
      const meta = await pwMeta(ids[0]);
      ok(meta.password === SECRET, 'the password is saved with the page');
      const raw = await v2Tx('pages', 'readonly', os => os.get(ids[0]));
      ok(!pwHas(raw.m, enc.encode(SECRET)), 'the saved password is encrypted in storage');
      await pwForget(ids[0]);
      const after = await pwMeta(ids[0]);
      ok(!after.password, 'forget removes the saved password');
    } finally {
      await v2Delete('pages', ids[0]);
    }
    PW_BY_FILE.delete(f);
  } catch (e) {
    lines.push('FAIL  test stopped: ' + e.message);
  }
  alert('Password tests\n\n' + lines.join('\n'));
}

(function pwButton() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('pw-test')) return;
  const b = document.createElement('button');
  b.id = 'pw-test';
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Run password tests';
  b.onclick = pwSelfTest;
  bk.appendChild(b);
})();
