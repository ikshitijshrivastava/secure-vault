/* ===== picker.js: smart document picker (v3). Loads after app.js and overrides its reading and suggestion functions. ===== */
const PK_VERSION = 'Smart picker v3';
const PK_LIB = {
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int'
};
const PK_STATES = new Set(['AN','AP','AR','AS','BR','BH','CG','CH','DD','DL','DN','GA','GJ','HP','HR','JH','JK','KA','KL','LA','LD','MH','ML','MN','MP','MZ','NL','OD','PB','PY','RJ','SK','TN','TG','TS','TR','UP','UK','UA','WB']);
const PK_FIELD = { title: 'f-title', type: 'f-type', number: 'f-number', issue: 'f-issue', expiry: 'f-expiry' };
const PK_LABEL = { title: 'Title', type: 'Type', number: 'Document number', issue: 'Issue date', expiry: 'Expiry date' };
const PK_MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
const PK_EXCLUDE = /birth|\bdob\b|d\.o\.b|registration|receipt|gstin/i;
const PK_COVER = /own\s*damage|third[\s-]?party|\bod\b|\btp\b|valid\s*(from|till|upto|until)|policy\s*period|period\s*of\s*insurance|cover\s*period/i;
const PK_NAME_BLOCK = /^(of|the|and|name|policy|number|no|date|address|holder|insured|owner|registered|motor|vehicle|son|daughter|wife|husband|dob|sex|male|female|issue|valid|from|till|expiry|nominee|premium|mobile|email|phone|contact|client|id|gstin|insurance|company|limited|ltd|bank|plan|certificate|tower|flat|road|nagar|city|state|pin|code|for|to|hrs|midnight|make|model|fuel|engine|chassis|cover|damage|third|party|own|period|details|key|information)$/i;

// Document kinds. The kind with the most keyword hits wins; "generic" is used only if nothing else matches.
const PK_KINDS = [
  { kind: 'Life insurance', type: 'Insurance', person: true, re: /life\s+(insurance|assurance|cover)|term\s+(plan|insurance)|endowment|sum\s+assured/ },
  { kind: 'Health insurance', type: 'Insurance', person: true, re: /health\s+insurance|mediclaim|medical\s+insurance/ },
  { kind: 'Car insurance', type: 'Insurance', vehicle: true, re: /motor\s+(insurance|policy)|car\s+insurance|vehicle\s+insurance|two[\s-]?wheeler\s+insurance|own\s+damage|third[\s-]?party|private\s+car|package\s+policy|auto\s+secure/ },
  { kind: 'Travel insurance', type: 'Insurance', person: true, re: /travel\s+insurance/ },
  { kind: 'Home insurance', type: 'Insurance', re: /home\s+insurance|property\s+insurance/ },
  { kind: 'Vehicle registration (RC)', type: 'Vehicle', vehicle: true, re: /registration\s+certificate|certificate\s+of\s+registration|registering\s+authority|chassis/ },
  { kind: 'Driving licence', type: 'Identity', person: true, re: /driving\s+licen[cs]e|driver'?s?\s+licen[cs]e/ },
  { kind: 'Passport', type: 'Identity', person: true, re: /\bpassport\b/ },
  { kind: 'ID card', type: 'Identity', person: true, re: /aadhaar|aadhar|national identity|identity card|\bid card\b|permanent account number/ },
  { kind: 'Certificate', type: 'Certificate', person: true, re: /certif(icate|y)|this is to certify/ },
  { kind: 'Property document', type: 'Property', re: /sale\s+deed|property|land\s+record/ },
  { kind: 'Financial document', type: 'Financial', re: /bank\s+statement|statement\s+of\s+account|\btax\b|\binvoice\b/ },
  { kind: 'Insurance policy', type: 'Insurance', person: true, generic: true, re: /insurance|policy\s*(holder|no|number)|premium/ }
];

const PK_SAMPLE = `Insured Details Name Mr KSHITIJ SHRIVASTAVA Address TOWER-3, FLAT NO 5B1 Policy No. 0157681764 09 00 Client ID 6014438842
Coverage Details Valid From Valid Till Own Damage Cover 30/10/2026 (00:00 Hrs) 29/10/2027 (Midnight) Third-Party Cover 30/10/2026 (00:00 Hrs) 29/10/2027 (Midnight)
Auto Secure - Private Car Package Policy Certificate of Insurance Cum Policy Schedule
Registration No. WB 06 L 2307 MAKE MARUTI / WAGON R Date of Registration 21/10/2014 Chassis No. 794699
Receipt Date 19/10/2026 GSTIN 19AABCT3518Q1ZT
Previous Insurance Details Date of Expiry: 29/10/2026 OD Cover Period: 30/10/2025(00:00 Hrs) to 29/10/2026(Midnight)`;

/* ---------- small helpers ---------- */
const pkLetters = s => s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B');
const pkDigits = s => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
const pkValid = (y, m, d) => y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
const pkIso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function pkSnip(text, a, b) {
  return text.slice(Math.max(0, a - 30), Math.min(text.length, b + 12)).replace(/\s+/g, ' ').trim().slice(0, 110);
}
function pkBtn(text, fn, ghost) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (ghost) b.className = 'ghost';
  b.onclick = fn;
  return b;
}

/* ---------- reading the file ---------- */
function pkLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('load failed'));
    document.head.appendChild(s);
  });
}
async function pkLoadPdf() {
  if (!window.pdfjsLib) {
    try { await pkLoadScript(PK_LIB.pdfjs); } catch { return false; }
  }
  if (!window.pdfjsLib) return false;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PK_LIB.pdfWorker;
  return true;
}
async function pkLoadOcr() {
  if (window.Tesseract) return true;
  try { await pkLoadScript(PK_LIB.tesseract); } catch { return false; }
  return !!window.Tesseract;
}
async function pkOcrBlob(blob) {
  const worker = await Tesseract.createWorker('eng', 1, { langPath: PK_LIB.lang });
  try {
    const { data } = await worker.recognize(blob);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}
async function pkPdfText(pdf) {
  let text = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 25); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return text;
}
async function pkPageImage(pdf, n) {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// Overrides app.js: reads every PDF page; scanned PDFs and images use OCR
async function readDocument(file) {
  if (file.type === 'application/pdf') {
    if (!(await pkLoadPdf())) return { error: 'Could not load the PDF reader. Check internet and try again.' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    let text = await pkPdfText(pdf);
    if (text.replace(/\s/g, '').length < 40) {
      if (!(await pkLoadOcr())) return { error: 'Scanned PDF needs the OCR engine. Check internet and try again.' };
      text = '';
      for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
        text += await pkOcrBlob(await pkPageImage(pdf, i)) + '\n';
      }
    }
    return { text };
  }
  if (file.type.startsWith('image/')) {
    if (!(await pkLoadOcr())) return { error: 'Could not load the OCR engine. Check internet and try again.' };
    return { text: await pkOcrBlob(file) };
  }
  return { error: 'Unsupported file type.' };
}

/* ---------- finding details ---------- */
function pkFindDates(text) {
  const out = [];
  const pats = [
    [/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/g, m => [+m[3], +m[2], +m[1]]],
    [/\b(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/g, m => [+m[1], +m[2], +m[3]]],
    [/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/gi, m => [+m[3], PK_MONTHS[m[2].toLowerCase()], +m[1]]],
    [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi, m => [+m[3], PK_MONTHS[m[1].toLowerCase()], +m[2]]]
  ];
  for (const [re, parse] of pats) {
    for (const m of text.matchAll(re)) {
      let [y, mo, d] = parse(m);
      if (mo > 12 && d <= 12) [mo, d] = [d, mo];
      if (pkValid(y, mo, d)) out.push({ idx: m.index, len: m[0].length, value: pkIso(y, mo, d) });
    }
  }
  return out.sort((a, b) => a.idx - b.idx);
}

// Policy period = two dates about a year apart, next to cover words. Latest period wins.
function pkDates(text) {
  const all = pkFindDates(text).filter(d => !PK_EXCLUDE.test(text.slice(Math.max(0, d.idx - 40), d.idx)));
  const anch = new Set(all.filter(d => PK_COVER.test(text.slice(Math.max(0, d.idx - 120), d.idx))).map(d => d.value));
  const uniq = [];
  for (const d of all) if (!uniq.some(u => u.value === d.value)) uniq.push(d);
  uniq.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));

  const pairs = [];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const days = (Date.parse(uniq[j].value) - Date.parse(uniq[i].value)) / 86400000;
      if (days > 390) break;
      if (days >= 340) pairs.push({ from: uniq[i], till: uniq[j], days });
    }
  }
  if (pairs.length) {
    const isA = p => (anch.has(p.from.value) || anch.has(p.till.value)) ? 1 : 0;
    pairs.sort((p, q) => {
      if (isA(p) !== isA(q)) return isA(q) - isA(p);
      if (p.till.value !== q.till.value) return p.till.value < q.till.value ? 1 : -1;
      return Math.abs(p.days - 364) - Math.abs(q.days - 364);
    });
    const b = pairs[0];
    return [
      { targets: ['issue'], value: b.from.value, snippet: pkSnip(text, b.from.idx, b.from.idx + 10), note: 'Policy start' },
      { targets: ['expiry'], value: b.till.value, snippet: pkSnip(text, b.till.idx, b.till.idx + 10), note: 'Policy end' }
    ];
  }

  // No clear pair: use nearby words, or offer both choices
  const out = [];
  for (const d of uniq.slice(0, 4)) {
    const before = text.slice(Math.max(0, d.idx - 30), d.idx).toLowerCase();
    const sn = pkSnip(text, d.idx, d.idx + d.len);
    if (/expir|renew|due date|valid\s*(upto|until|till)/.test(before)) out.push({ targets: ['expiry'], value: d.value, snippet: sn, note: '' });
    else if (/issu|dated|granted/.test(before)) out.push({ targets: ['issue'], value: d.value, snippet: sn, note: '' });
    else out.push({ targets: ['issue', 'expiry'], value: d.value, snippet: sn, note: 'Check which date this is' });
  }
  return out;
}

function pkVehicleFromSquashed(s) {
  const bh = s.match(/^(\d{2})BH([0-9OILSB]{4})([A-Z]{1,2})(?![A-Z])/);
  if (bh) return `${bh[1]}BH${pkDigits(bh[2])}${bh[3]}`;
  const m = s.match(/^([A-Z0-9]{2})([0-9OIL]{1,2})([A-Z]{1,3})([0-9OILSB]{4})(?!\d)/);
  if (!m) return null;
  const st = pkLetters(m[1]);
  if (!PK_STATES.has(st)) return null;
  return st + pkDigits(m[2]).padStart(2, '0') + m[3] + pkDigits(m[4]);
}

// Vehicle number: first the one after a registration label, then anywhere in the text
function pkVehicle(text) {
  const up = text.toUpperCase();
  const lab = /(REGISTRATION|REGN|REG)\.?\s*(NO|NUMBER|MARK|NUM)?\.?\s*[:\-#]?\s*/g;
  for (const m of up.matchAll(lab)) {
    const start = m.index + m[0].length;
    const win = up.slice(start, start + 40).replace(/[^A-Z0-9]/g, '');
    const v = pkVehicleFromSquashed(win);
    if (v) return { value: v, idx: m.index, label: true };
  }
  const sq = up.replace(/[^A-Z0-9]/g, '');
  for (let i = 0; i + 10 <= sq.length; i++) {
    const v = pkVehicleFromSquashed(sq.slice(i, i + 20));
    if (v) return { value: v, idx: -1, label: false };
  }
  return null;
}

function pkPolicyNo(text) {
  const m = /policy\s*(?:no|number|num)\.?\s*[:\-#]?\s*/i.exec(text);
  if (!m) return null;
  const toks = [];
  for (const t of text.slice(m.index + m[0].length, m.index + m[0].length + 60).split(/\s+/)) {
    if (!t) continue;
    if (!/^[A-Za-z0-9\/\-]+$/.test(t) || !/\d/.test(t)) break;
    toks.push(t.toUpperCase());
    if (toks.length === 4) break;
  }
  return toks.length ? { value: toks.join(' '), idx: m.index } : null;
}

function pkName(text) {
  const re = /(policy\s*holder'?s?\s*name|insured\s*name|name\s+of\s+(?:the\s+)?(?:holder|insured|candidate|student|employee|person|nominee)|full\s+name|certify\s+that|issued\s+to|\bname)\s*[:\-]?\s*/gi;
  for (const m of text.matchAll(re)) {
    const words = [];
    const chunk = text.slice(m.index + m[0].length, m.index + m[0].length + 120);
    for (const raw of chunk.split(/\s+/)) {
      const w = raw.replace(/[^A-Za-z.'-]/g, '');
      if (!w) continue;
      if (!words.length && /^(mr|mrs|ms|miss|dr|shri|smt|kum)\.?$/i.test(w)) continue;
      if (PK_NAME_BLOCK.test(w)) break;
      words.push(w);
      if (words.length === 4) break;
    }
    if (words.length >= 2) {
      return { value: words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' '), idx: m.index };
    }
  }
  return null;
}

function pkKind(text) {
  let best = null;
  for (const k of PK_KINDS) {
    if (k.generic) continue;
    const n = (text.match(new RegExp(k.re.source, 'gi')) || []).length;
    if (n && (!best || n > best.n)) best = { k, n };
  }
  if (best) return best.k;
  return PK_KINDS.find(k => k.generic && k.re.test(text)) || null;
}

// Overrides app.js: builds the review suggestions
function pkBuild(text) {
  const out = [];
  const add = (targets, value, snippet, note) => {
    if (!value || out.length >= 12) return;
    if (out.some(s => s.value === value && s.targets.join() === targets.join())) return;
    out.push({ targets, value, snippet: snippet || '', note: note || '' });
  };

  const kind = pkKind(text);
  const veh = pkVehicle(text);
  const name = pkName(text);
  const pol = pkPolicyNo(text);

  if (kind) {
    const km = new RegExp(kind.re.source, 'i').exec(text);
    const kindSn = km ? pkSnip(text, km.index, km.index + km[0].length) : '';
    let title = kind.kind;
    let tSn = kindSn;
    let tNote = '';
    if (kind.vehicle) {
      if (veh) {
        title += ' - ' + veh.value;
        if (veh.idx >= 0) tSn = pkSnip(text, veh.idx, veh.idx + 12);
        tNote = veh.label ? 'Vehicle no.' : 'Vehicle no. (check it)';
      } else {
        tNote = 'Vehicle no. not found, add it in Title';
      }
    } else if (kind.person && name) {
      title += ' - ' + name.value;
      tSn = pkSnip(text, name.idx, name.idx + 30);
      tNote = 'Name';
    }
    add(['title'], title, tSn, tNote);
    add(['type'], kind.type, kindSn, 'Document type');
  }

  if (pol) {
    add(['number'], pol.value, pkSnip(text, pol.idx, pol.idx + 20), 'Policy no.');
  } else if (kind && kind.vehicle && veh) {
    add(['number'], veh.value, veh.idx >= 0 ? pkSnip(text, veh.idx, veh.idx + 12) : '', 'Vehicle no.');
  }

  for (const d of pkDates(text)) add(d.targets, d.value, d.snippet, d.note);
  return out;
}
function buildSuggestions(text) {
  return pkBuild(text);
}

// Review panel. Shows the version tag so you can confirm this file is running.
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
  head.textContent = statusText + '  [' + PK_VERSION + ']';
  box.appendChild(head);
  if (!suggestions.length) return;

  box.appendChild(pkBtn('Approve best suggestion for each field', () => {
    const used = new Set();
    const keep = [];
    for (const s of suggestions) {
      const t = s.targets[0];
      if (s.targets.length === 1 && !used.has(t)) {
        used.add(t);
        $(PK_FIELD[t]).value = s.value;
      } else {
        keep.push(s);
      }
    }
    suggestions = keep;
    renderReview('Applied best suggestion for each field. Check the form, then tap Save.');
  }));

  suggestions.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'sugg';

    const strong = document.createElement('strong');
    strong.textContent = s.targets.map(t => PK_LABEL[t]).join(' or ') + ': ' + s.value;
    const small = document.createElement('small');
    small.textContent = (s.note ? s.note + ' · ' : '') + 'Found in: "' + s.snippet + '"';
    card.append(strong, small);

    const row = document.createElement('div');
    row.className = 'row';
    const done = (msg, field) => {
      if (field) $(PK_FIELD[field]).value = s.value;
      suggestions.splice(i, 1);
      renderReview(msg);
    };

    if (s.targets.length > 1) {
      for (const t of s.targets) {
        row.appendChild(pkBtn('Use as ' + PK_LABEL[t].toLowerCase(),
          () => done('Applied. Check the form, then tap Save.', t)));
      }
    } else {
      const t = s.targets[0];
      row.appendChild(pkBtn('Approve', () => done('Approved. Check the form, then tap Save.', t)));
      row.appendChild(pkBtn('Edit', () => {
        $(PK_FIELD[t]).value = s.value;
        suggestions.splice(i, 1);
        renderReview('Filled in. Change it in the form, then tap Save.');
        $(PK_FIELD[t]).focus();
      }, true));
    }
    row.appendChild(pkBtn('Dismiss', () => done('Dismissed.', null), true));
    card.appendChild(row);
    box.appendChild(card);
  });
}

/* ---------- self-test: runs the picker on a sample of your policy text ---------- */
function pkSelfTest() {
  const got = pkBuild(PK_SAMPLE);
  const pick = t => got.find(s => s.targets.length === 1 && s.targets[0] === t);
  const expect = {
    title: 'Car insurance - WB06L2307',
    type: 'Insurance',
    number: '0157681764 09 00',
    issue: '2026-10-30',
    expiry: '2027-10-29'
  };
  const lines = Object.keys(expect).map(k => {
    const s = pick(k);
    const ok = !!s && s.value === expect[k];
    return (ok ? 'PASS  ' : 'FAIL  ') + k + ': ' + (s ? s.value : 'nothing found') +
      (ok ? '' : '  (expected ' + expect[k] + ')');
  });
  alert(PK_VERSION + ' self-test\n\n' + lines.join('\n'));
}
(function pkAddSelfTestButton() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('pk-selftest')) return;
  const b = pkBtn('Run picker self-test', pkSelfTest, true);
  b.id = 'pk-selftest';
  bk.appendChild(b);
})();
