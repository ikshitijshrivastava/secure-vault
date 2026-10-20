/* ===== picker.js v4 - PART A. Replace the whole file with this. ===== */
const PK_VERSION = 'Smart picker v4';
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
let PK_LAST = null;   // last detected document type, shown in the status line

// Words that mark the start of the next field; value capture stops here
const PK_STOP = /\b(d\.?\s?o\.?\s?b|date\s+of\s+birth|doi|cdoi|valid|address|s\s?\/\s?o|sign|cov|b\.?g|dl\s*no|licen[cs]e\s*no|name|policy\s*no|registration|reg\.?\s*no|chassis|engine|make|model|issue|expiry|date)\b/i;
// Words that are never part of a person's name
const PK_NAME_BLOCK = /^(of|the|and|name|policy|number|no|date|address|holder|insured|owner|registered|motor|vehicle|son|daughter|wife|husband|dob|sex|male|female|issue|valid|from|till|expiry|nominee|premium|mobile|email|phone|contact|client|id|gstin|insurance|company|limited|ltd|bank|plan|certificate|tower|flat|road|nagar|city|state|code|for|to|hrs|midnight|make|model|fuel|engine|chassis|cover|damage|third|party|own|period|details|key|information|so|do|co|licence|licencing|authority|sign|throughout|india|bg|cov|cdoi|doi|birth|bangalore|karnataka)$/i;
// Context words that mean a date is NOT a policy or document date
const PK_DOB_CTX = /birth|d\.?\s?o\.?\s?b|cdoi|\bcov\b|registration|receipt|gstin|previous|prior/i;
const PK_COVER = /own\s*damage|third[\s-]?party|\bod\b|\btp\b|valid\s*(from|till|upto|until|to)|policy\s*period|period\s*of\s*insurance|cover\s*period/i;

// Document types. The type with the most keyword hits wins. "weak" is used only when nothing else matches.
const PK_PROFILES = [
  { id: 'dl', kind: 'Driving licence', type: 'Identity', person: true,
    re: /driving\s+licen[cs]e|driver'?s?\s+licen[cs]e|valid\s+throughout\s+india|\bLMV\b|\bMCWG\b|licencing\s+authority|form\s*-?\s*7|rule\s*16|\bDL\s*no/i },
  { id: 'car', kind: 'Car insurance', type: 'Insurance', vehicle: true,
    re: /motor\s+(insurance|policy)|car\s+insurance|vehicle\s+insurance|two[\s-]?wheeler|own\s+damage|third[\s-]?party|private\s+car|package\s+policy|auto\s+secure|\bidv\b|\bncb\b|policy\s+schedule/i },
  { id: 'life', kind: 'Life insurance', type: 'Insurance', person: true,
    re: /life\s+(insurance|assurance|cover)|term\s+(plan|insurance)|endowment|sum\s+assured|life\s+assured/i },
  { id: 'health', kind: 'Health insurance', type: 'Insurance', person: true,
    re: /health\s+(insurance|card|policy)|mediclaim|cashless\s+hospital|family\s+floater/i },
  { id: 'rc', kind: 'Vehicle registration (RC)', type: 'Vehicle', vehicle: true,
    re: /registration\s+certificate|certificate\s+of\s+registration|registering\s+authority|chassis\s+no|regn\.?\s*no/i },
  { id: 'passport', kind: 'Passport', type: 'Identity', person: true,
    re: /\bpassport\b|republic\s+of\s+india|nationality|place\s+of\s+birth|P<IND/i },
  { id: 'aadhaar', kind: 'Aadhaar card', type: 'Identity', person: true,
    re: /aadhaar|aadhar|unique\s+identification|\buidai\b/i },
  { id: 'pan', kind: 'PAN card', type: 'Identity', person: true,
    re: /permanent\s+account\s+number|income\s+tax\s+department|\bPAN\s+card\b/i },
  { id: 'cert', kind: 'Certificate', type: 'Certificate', person: true,
    re: /certif(icate|y)|this\s+is\s+to\s+certify/i },
  { id: 'property', kind: 'Property document', type: 'Property',
    re: /sale\s+deed|property|land\s+record/i },
  { id: 'finance', kind: 'Financial document', type: 'Financial',
    re: /bank\s+statement|statement\s+of\s+account|\btax\b|\binvoice\b/i },
  { id: 'insgen', kind: 'Insurance policy', type: 'Insurance', person: true, weak: true,
    re: /insurance|premium|policy/i }
];

/* ---------- small helpers ---------- */
const pkLetters = s => s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B');
const pkDigits = s => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
const pkValid = (y, m, d) => y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
const pkIso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function pkSnip(text, a, b) {
  return text.slice(Math.max(0, a - 30), Math.min(text.length, b + 12)).replace(/\s+/g, ' ').trim().slice(0, 110);
}
function pkRegexSnip(text, re) {
  const m = new RegExp(re.source, 'i').exec(text);
  return m ? pkSnip(text, m.index, m.index + m[0].length) : '';
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
// Photos get two passes: normal layout, then sparse text (good for ID cards)
async function pkOcrBlob(blob, twoPasses) {
  const worker = await Tesseract.createWorker('eng', 1, { langPath: PK_LIB.lang });
  try {
    let text = (await worker.recognize(blob)).data.text || '';
    if (twoPasses) {
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      text += '\n' + ((await worker.recognize(blob)).data.text || '');
    }
    return text;
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

// Replaces the reader in app.js: PDFs (text or scanned) and photos (JPG/PNG)
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
        text += await pkOcrBlob(await pkPageImage(pdf, i), false) + '\n';
      }
    }
    return { text };
  }
  if (file.type.startsWith('image/')) {
    if (!(await pkLoadOcr())) return { error: 'Could not load the OCR engine. Check internet and try again.' };
    return { text: await pkOcrBlob(file, true) };
  }
  return { error: 'Unsupported file type.' };
}

/* ---------- finding dates ---------- */
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
// First date that appears just after a label (e.g. "VALID TILL : 10/08/2034")
function pkDateNear(text, labelRe) {
  const re = new RegExp(labelRe.source, 'gi');
  for (const m of text.matchAll(re)) {
    const start = m.index + m[0].length;
    const d = pkFindDates(text.slice(start, start + 30))[0];
    if (d && d.idx <= 12) return { value: d.value, idx: start + d.idx, len: d.len };
  }
  return null;
}
// Labelled dates: issue and expiry, ignoring a pair that is out of order
function pkLabelled(text, issueRe, expiryRe, fallback) {
  const out = [];
  let i = issueRe ? pkDateNear(text, issueRe) : null;
  const e = expiryRe ? pkDateNear(text, expiryRe) : null;
  if (i && e && i.value >= e.value) i = null;
  if (i) out.push({ targets: ['issue'], value: i.value, snippet: pkSnip(text, i.idx, i.idx + i.len), note: '' });
  if (e) out.push({ targets: ['expiry'], value: e.value, snippet: pkSnip(text, e.idx, e.idx + e.len), note: '' });
  if (!out.length && fallback) {
    const all = pkFindDates(text).filter(d => !PK_DOB_CTX.test(text.slice(Math.max(0, d.idx - 30), d.idx)));
    for (const d of all.slice(0, 3)) {
      out.push({ targets: ['issue', 'expiry'], value: d.value, snippet: pkSnip(text, d.idx, d.idx + d.len), note: 'Check which date this is' });
    }
  }
  return out;
}
// Insurance period: two dates about a year apart next to cover words. Latest period wins.
function pkPeriod(text) {
  const all = pkFindDates(text).filter(d => !PK_DOB_CTX.test(text.slice(Math.max(0, d.idx - 40), d.idx)));
  const anch = new Set(all.filter(d => PK_COVER.test(text.slice(Math.max(0, d.idx - 150), d.idx))).map(d => d.value));
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
  if (!pairs.length) return null;
  const score = p => (anch.has(p.from.value) || anch.has(p.till.value) ? 1 : 0);
  pairs.sort((p, q) =>
    (score(q) - score(p)) ||
    (p.till.value < q.till.value ? 1 : p.till.value > q.till.value ? -1 : 0) ||
    (Math.abs(p.days - 364) - Math.abs(q.days - 364)));
  return pairs[0];
}
function pkDatesFor(id, text) {
  if (id === 'aadhaar' || id === 'pan') return [];
  if (['car', 'life', 'health', 'insgen'].includes(id)) {
    const per = pkPeriod(text);
    if (per) return [
      { targets: ['issue'], value: per.from.value, snippet: pkSnip(text, per.from.idx, per.from.idx + 10), note: 'Policy start' },
      { targets: ['expiry'], value: per.till.value, snippet: pkSnip(text, per.till.idx, per.till.idx + 10), note: 'Policy end' }
    ];
    return pkLabelled(text, /valid\s*from|issue[ds]?\b|issue\s+date/i, /valid\s*(till|to|upto|until)|expir|expires/i, true);
  }
  const rules = {
    dl: [/\bdoi\b|date\s+of\s+issue|issue\s+date/i, /valid\s*(till|til|upto|up\s*to|until)/i, false],
    passport: [/date\s+of\s+issue|issue\s+date/i, /date\s+of\s+expiry|expiry\s+date/i, false],
    rc: [/date\s+of\s+registration|registration\s+date/i, null, false]
  };
  if (rules[id]) return pkLabelled(text, rules[id][0], rules[id][1], rules[id][2]);
  return pkLabelled(text, /issued|issue\s+date|dated|granted/i, /expir|renew|valid\s*(upto|until|till)|due\s+date/i, true);
}

/* ---------- finding other details ---------- */
function pkVehicleFromSquashed(s) {
  const bh = s.match(/^(\d{2})BH([0-9OILSB]{4})([A-Z]{1,2})(?![A-Z])/);
  if (bh) return `${bh[1]}BH${pkDigits(bh[2])}${bh[3]}`;
  const m = s.match(/^([A-Z0-9]{2})([0-9OIL]{1,2})([A-Z]{1,3})([0-9OILSB]{4})(?!\d)/);
  if (!m) return null;
  const st = pkLetters(m[1]);
  if (!PK_STATES.has(st)) return null;
  return st + pkDigits(m[2]).padStart(2, '0') + m[3] + pkDigits(m[4]);
}
// Vehicle number: after a registration label first, then anywhere. Spaces, dots and hyphens are ignored.
function pkVehicle(text) {
  const up = text.toUpperCase();
  for (const m of up.matchAll(/\b(REGISTRATION|REGN|REG)\b\.?\s*(NO|NUMBER|MARK|NUM)?\.?\s*[:\-#]?\s*/g)) {
    const start = m.index + m[0].length;
    const v = pkVehicleFromSquashed(up.slice(start, start + 40).replace(/[^A-Z0-9]/g, ''));
    if (v) return { value: v, idx: m.index, label: true };
  }
  const sq = up.replace(/[^A-Z0-9]/g, '');
  for (let i = 0; i + 10 <= sq.length; i++) {
    const v = pkVehicleFromSquashed(sq.slice(i, i + 20));
    if (v) return { value: v, idx: i, label: false };
  }
  return null;
}
// Policy number, keeping spaces (e.g. "0157681764 09 00")
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
// Driving licence number, e.g. "MH13 20090023095" becomes "MH1320090023095"
function pkDlNumber(text) {
  const m = /(?:dl|licen[cs]e|lic)\s*(?:no|number|num)\.?\s*[:\-#]?\s*/i.exec(text);
  if (!m) return null;
  const sq = text.slice(m.index + m[0].length, m.index + m[0].length + 30).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const g = /^([A-Z0-9]{2})([0-9OIL]{2})([0-9OILSB]{7,13})/.exec(sq);
  if (!g) return null;
  const st = pkLetters(g[1]);
  if (!PK_STATES.has(st)) return null;
  return { value: st + pkDigits(g[2]) + pkDigits(g[3]), idx: m.index };
}
// Person name after "Name", "Insured Name", "certify that" and similar labels
function pkNameFrom(text) {
  const re = /(policy\s*holder'?s?\s*name|insured\s*name|name\s+of\s+(?:the\s+)?(?:holder|insured|candidate|student|employee|person|nominee)|full\s+name|certify\s+that|issued\s+to|\bname)\s*[:\-]?\s*/gi;
  for (const m of text.matchAll(re)) {
    let chunk = text.slice(m.index + m[0].length, m.index + m[0].length + 90);
    const stop = PK_STOP.exec(chunk);
    if (stop) chunk = chunk.slice(0, stop.index);
    const words = [];
    for (const raw of chunk.split(/\s+/)) {
      const core = raw.replace(/[^A-Za-z]/g, '');
      if (!core) continue;
      if (!words.length && /^(mr|mrs|ms|miss|dr|shri|smt|kum)$/i.test(core)) continue;
      if (core.length < 2 || PK_NAME_BLOCK.test(core) || !/^[A-Za-z.'\-]+$/.test(raw)) break;
      words.push(core);
      if (words.length === 4) break;
    }
    if (words.length >= 2) {
      return { value: words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' '), idx: m.index };
    }
  }
  return null;
}

/* ---------- document type ---------- */
function pkDetect(text) {
  let best = null;
  for (const p of PK_PROFILES) {
    if (p.weak) continue;
    const n = (text.match(new RegExp(p.re.source, 'gi')) || []).length;
    if (n && (!best || n > best.n)) best = { p, n };
  }
  if (best) return best.p;
  return PK_PROFILES.find(p => p.weak && p.re.test(text)) || null;
}

/* ---------- building suggestions ---------- */
function pkBuild(text) {
  const out = [];
  const add = (targets, value, snippet, note) => {
    if (!value || out.length >= 12) return;
    if (out.some(s => s.value === value && s.targets.join() === targets.join())) return;
    out.push({ targets, value, snippet: snippet || '', note: note || '' });
  };

  const prof = pkDetect(text);
  PK_LAST = prof ? prof.kind : null;
  const id = prof ? prof.id : 'other';
  const kind = prof ? prof.kind : 'Document';
  const kindSn = prof ? pkRegexSnip(text, prof.re) : '';
  const name = pkNameFrom(text);
  const veh = pkVehicle(text);
  const pol = pkPolicyNo(text);

  // Title and type
  let subject = null, subSn = '', subNote = '';
  if (prof && prof.vehicle) {
    if (veh) { subject = veh.value; subSn = pkSnip(text, veh.idx, veh.idx + 12); subNote = 'Vehicle no.'; }
    else subNote = 'Vehicle no. not found, add it in Title';
  } else if (prof && prof.person) {
    if (name) { subject = name.value; subSn = pkSnip(text, name.idx, name.idx + 30); subNote = 'Name'; }
    else subNote = 'Name not found, add it in Title';
  }
  add(['title'], subject ? kind + ' - ' + subject : kind, subject ? subSn : kindSn, subNote);
  if (prof) add(['type'], prof.type, kindSn, 'Document type');

  // Number
  let num = null, numLabel = 'Document no.';
  if (id === 'dl') { num = pkDlNumber(text); numLabel = 'Licence no.'; }
  else if (id === 'passport') {
    const m = /passport\s*(?:no|number)\.?\s*[:\-]?\s*([A-Z][0-9]{7})\b/i.exec(text) || /\b([A-Z][0-9]{7})\b/.exec(text);
    if (m) num = { value: m[1].toUpperCase(), idx: m.index };
    numLabel = 'Passport no.';
  } else if (id === 'aadhaar') {
    const m = /\b(\d{4})\s?(\d{4})\s?(\d{4})\b/.exec(text);
    if (m) num = { value: `${m[1]} ${m[2]} ${m[3]}`, idx: m.index };
    numLabel = 'Aadhaar no.';
  } else if (id === 'pan') {
    const m = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/.exec(text);
    if (m) num = { value: m[1], idx: m.index };
    numLabel = 'PAN';
  } else if (id === 'rc') { num = veh; numLabel = 'Vehicle no.'; }
  else if (prof && prof.vehicle) { num = pol || veh; numLabel = pol ? 'Policy no.' : 'Vehicle no.'; }
  else { num = pol; numLabel = 'Policy no.'; }
  if (num) add(['number'], num.value, pkSnip(text, num.idx, num.idx + 20), numLabel);

  // Dates
  for (const d of pkDatesFor(id, text)) add(d.targets, d.value, d.snippet, d.note);
  return out;
  }
