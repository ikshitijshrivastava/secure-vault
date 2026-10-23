/* ===== smart.js PART 1 of 2. Create the file with this part. Reads non-standard documents by their labels and wording. ===== */
'use strict';

const SM_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

// Make the extra types and kinds available in the form lists
for (const t of ['Education', 'Medical']) if (!VU_TYPES.includes(t)) VU_TYPES.push(t);
const SM_NEW_KINDS = [
  ['Marksheet', 'Education'], ['Degree certificate', 'Education'], ['Birth certificate', 'Certificate'],
  ['Salary slip', 'Financial'], ['Bank statement', 'Financial'], ['Receipt', 'Financial'],
  ['Bill / invoice', 'Financial'], ['Medical record', 'Medical'], ['PAN card', 'Identity']
];
for (const [k, t] of SM_NEW_KINDS) if (!VU_KINDS.some(x => x.kind === k)) VU_KINDS.push({ kind: k, type: t });

/* ---------- 1. Document kinds: the kind with the most keyword hits wins ---------- */
const SM_KINDS = [
  { kind: 'Driving licence', type: 'Identity', person: true,
    re: /driving\s+licen[cs]e|driver'?s?\s+licen[cs]e|valid\s+throughout\s+india|\bLMV\b|\bMCWG\b|licencing\s+authority|form\s*-?\s*7\b|rule\s*16|\bDL\s*no\b/gi },
  { kind: 'Voter ID card', type: 'Identity', person: true,
    re: /election\s+commission|elector'?s?\b|\bEPIC\b|निर्वाचक|निर्वाचन/gi },
  { kind: 'College ID card', type: 'Identity', person: true, must: /identity\s+card|student|bearer/i,
    re: /college|university|institute|school|polytechnic|academy/gi },
  { kind: 'Car insurance', type: 'Insurance', vehicle: true,
    re: /motor\s+(?:insurance|policy)|car\s+insurance|vehicle\s+insurance|own\s+damage|third[\s-]?party|private\s+car|package\s+policy|auto\s+secure|policy\s+schedule|\bIDV\b|\bNCB\b/gi },
  { kind: 'Life insurance', type: 'Insurance', person: true,
    re: /life\s+(?:insurance|assurance|cover)|term\s+(?:plan|insurance)|endowment|sum\s+assured|life\s+assured/gi },
  { kind: 'Health insurance', type: 'Insurance', person: true,
    re: /health\s+(?:insurance|card|policy)|mediclaim|cashless\s+hospital|family\s+floater/gi },
  { kind: 'Vehicle registration (RC)', type: 'Vehicle', vehicle: true,
    re: /registration\s+certificate|certificate\s+of\s+registration|registering\s+authority|chassis\s+(?:no|number)|regn\.?\s*no/gi },
  { kind: 'Passport', type: 'Identity', person: true,
    re: /\bpassport\b|republic\s+of\s+india|nationality|place\s+of\s+birth|P<IND/gi },
  { kind: 'Aadhaar card', type: 'Identity', person: true,
    re: /aadhaar|aadhar|unique\s+identification|\buidai\b/gi },
  { kind: 'PAN card', type: 'Identity', person: true,
    re: /permanent\s+account\s+number|income\s+tax\s+department|\bPAN\b/gi },
  { kind: 'Marksheet', type: 'Education', person: true,
    re: /marks?\s*sheet|statement\s+of\s+marks|grade\s+card|secured\s+marks|marks\s+obtained|\bcgpa\b|\bsgpa\b/gi },
  { kind: 'Degree certificate', type: 'Education', person: true,
    re: /\bdegree\b|\bdiploma\b|convocation|bachelor\s+of|master\s+of|passed\s+the\s+examination|has\s+been\s+awarded/gi },
  { kind: 'Birth certificate', type: 'Certificate', person: true,
    re: /birth\s+certificate|registrar\s+of\s+births?|date\s+and\s+place\s+of\s+birth/gi },
  { kind: 'Certificate', type: 'Certificate', person: true,
    re: /certif(?:icate|y|ies)|this\s+is\s+to\s+certify|awarded\s+to|presented\s+to|participation/gi },
  { kind: 'Property document', type: 'Property',
    re: /sale\s+deed|property|land\s+record|khasra|khatauni|registration\s+office/gi },
  { kind: 'Salary slip', type: 'Financial', person: true,
    re: /salary\s+slip|pay\s+slip|net\s+pay|gross\s+pay|earnings|deductions/gi },
  { kind: 'Bank statement', type: 'Financial',
    re: /bank\s+statement|statement\s+of\s+account|account\s+number|closing\s+balance|\bIFSC\b/gi },
  { kind: 'Receipt', type: 'Financial', re: /receipt|received\s+with\s+thanks|paid\s+by/gi },
  { kind: 'Bill / invoice', type: 'Financial', re: /invoice|\bbill\b|gstin|tax\s+invoice/gi },
  { kind: 'Medical record', type: 'Medical', person: true,
    re: /prescription|diagnosis|lab\s+report|pathology|discharge\s+summary|\bhospital\b|\bdoctor\b/gi },
  { kind: 'Insurance policy', type: 'Insurance', person: true, weak: true, re: /insurance|premium|policy/gi }
];

function smKind(T) {
  let best = null;
  let bestN = 0;
  for (const k of SM_KINDS) {
    if (k.weak) continue;
    if (k.must && !k.must.test(T)) continue;
    const n = (T.match(k.re) || []).length;
    if (n > bestN) { best = k; bestN = n; }
  }
  if (best) return best;
  return SM_KINDS.find(k => k.weak && new RegExp(k.re.source, 'i').test(T)) || null;
}

/* ---------- 2. Cleaning text ---------- */
function smClean(t) {
  return String(t || '')
    .replace(/\r/g, '\n')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}
function smShow(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/* ---------- 3. Labels: words that introduce a value ---------- */
const SM_LABELS = [
  { k: 'father', re: /father'?s?\s*(?:\/\s*husband'?s?)?\s*name|husband'?s?\s*name|mother'?s?\s*name|spouse'?s?\s*name|guardian'?s?\s*name|\bs\s*\/\s*o\b|\bd\s*\/\s*o\b|\bw\s*\/\s*o\b|\bc\s*\/\s*o\b|\bson\s+of\b|\bdaughter\s+of\b|\bwife\s+of\b/ },
  { k: 'dob', re: /date\s*of\s*birth|\bd\.?\s?[o0]\.?\s?b\b|\bdob\b|\bborn\s+on\b/ },
  { k: 'appoint', re: /date\s*of\s*(?:first\s*)?appoint\w*|first\s+appointment/ },
  { k: 'issue', re: /date\s*of\s*issue|issue\s*date|date\s*issued|issued\s*on|\bdoi\b|date\s*of\s*registration|registration\s*date|granted\s*on|date\s*of\s*admission|date\s*of\s*award|\bissued\b|\bdated\b/ },
  { k: 'expiry', re: /valid\s*(?:till|til|tll|upto|up\s*to|until|to\b|through\b|thru\b)|date\s*of\s*expiry|expiry\s*date|\bexpir\w*|renewal\s*due|due\s*date|good\s*till/ },
  { k: 'validfrom', re: /valid\s*from|\bw\.?\s?e\.?\s?f\.?|effective\s+from|period\s+from/ },
  { k: 'npolicy', re: /policy\s*(?:no|number|num)\b\.?/ },
  { k: 'nvehicle', re: /(?:registration|regn|reg)\.?\s*(?:no|number|num|mark)\b\.?|vehicle\s*(?:no|number)\b\.?/ },
  { k: 'nlicence', re: /\b(?:dl|licen[cs]e|lic)\s*(?:no|number|num)\b\.?/ },
  { k: 'nother', re: /\b(?:passport|certificate|cert|epic|voter|elector|enrol\w*|roll|membership|member|student|admission|application|account|pan|gst(?:in)?|serial|sr|card|file|client|employee|emp|id|code|reg)\s*(?:no|number|num|id|code)\b\.?|\bs\.?\s*no\b\.?/ },
  { k: 'name', re: /\bn[a4]m[e3]\b/ },
  { k: 'address', re: /\baddress\b|\bpata\b|\bresiden(?:ce|tial)\b/ },
  { k: 'designation', re: /designation|\bpost\b|\brank\b|occupation|\bposition\b|job\s*title/ },
  { k: 'course', re: /\bcourse\b|\bclass\b|\bgrade\b|\bbranch\b|\bprogramme?\b|\bstream\b|\bdegree\b|\bsubject\b/ },
  { k: 'purpose', re: /\bpurpose\b|in\s+recognition/ },
  { k: 'sex', re: /\bsex\b|\bgender\b/ },
  { k: 'blood', re: /blood\s*group|\bb\.?\s?g\.?(?=\s*[:\-]|\s+[ABO])/ },
  { k: 'age', re: /\bage\b/ },
  { k: 'vdetail', re: /chassis\s*(?:no|number)|engine\s*(?:no|number)|\bmake\b|\bmodel\b|\bfuel\b/ },
  { k: 'amount', re: /premium|sum\s*assured|\btotal\b|\bamount\b|\bmarks?\b|percentage|\bresult\b|\bsalary\b|net\s*pay/ },
  { k: 'date', re: /\bdate\b(?!\s*of)/ }
];
const SM_NOT_DATE = /birth|\bdob\b|d\.?\s?[o0]\.?\s?b|\bage\b|receipt|registration|gstin|previous/i;

function smFindLabels(T) {
  const hits = [];
  for (const L of SM_LABELS) {
    for (const m of T.matchAll(new RegExp(L.re.source, 'gi'))) {
      const end = m.index + m[0].length;
      const pre = T.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
      const post = T.slice(end, end + 6).toLowerCase();
      if (L.k === 'name') {
        if (/(father|husband|mother|spouse|guardian|nominee|school|college|company|bank|institute|university|of)[\s\/\-'s]*$/.test(pre)) continue;
        if (/^\s+of\b/.test(post)) continue;
      }
      hits.push({ k: L.k, idx: m.index, end, text: m[0] });
    }
  }
  // Longer label wins at the same place; labels inside a longer label are dropped
  hits.sort((a, b) => a.idx - b.idx || (b.end - b.idx) - (a.end - a.idx));
  const out = [];
  let last = -1;
  for (const h of hits) if (h.idx >= last) { out.push(h); last = h.end; }
  return out;
}

// The value for each label: text up to the next label, first line only
function smValues(T, labels) {
  const vals = {};
  labels.forEach((L, i) => {
    if (vals[L.k]) return;
    const stop = i + 1 < labels.length ? labels[i + 1].idx : T.length;
    let raw = T.slice(L.end, Math.min(stop, L.end + 90));
    raw = raw.replace(/^[ \t:\-–—.#=]+/, '');
    if (raw.startsWith('\n')) raw = raw.replace(/^\s+/, '');
    raw = raw.split('\n')[0].trim();
    if (raw) vals[L.k] = { value: raw, idx: L.idx, end: L.end };
  });
  return vals;
}

/* ---------- 4. Names ---------- */
const SM_NAME_STOP = /^(d\.?\s?[o0]\.?\s?b\.?|dob|date|sign|signature|valid|address|father|husband|mother|s\/o|d\/o|w\/o|no|nos?|card|issued?|from|till|cdoi|doi|bg|blood|sex|age|cov|designation|male|female|bearer|principal|of|the|and|s|h|k|has|have|is|was|successfully|completed|for|conducted|with|in|at|on)$/i;

function smName(v) {
  if (!v) return '';
  const s = v.split(/[\d(\[{@|]/)[0].replace(/[^A-Za-z .'\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = [];
  for (let w of s.split(' ')) {
    w = w.replace(/^\.+|\.+$/g, '');
    if (!w) continue;
    if (!words.length && /^(mr|mrs|ms|miss|dr|shri|smt|kum|kumari)$/i.test(w)) continue;
    if (SM_NAME_STOP.test(w) || w.length < 2) break;
    words.push(w);
    if (words.length === 4) break;
  }
  return words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// Name from wording such as "This is to certify that Priya Sharma has..."
function smPersonFallback(T) {
  const ph = /(?:certify\s+that|awarded\s+to|presented\s+to|issued\s+to)/i.exec(T);
  if (!ph) return null;
  const rest = T.slice(ph.index + ph[0].length, ph.index + ph[0].length + 80);
  const m = /^\s*((?:(?:Mr|Mrs|Ms|Dr|Shri|Smt)\.?\s+)?[A-Z][a-zA-Z.'\-]+(?:\s+[A-Z][a-zA-Z.'\-]+){0,3})/.exec(rest);
  if (!m) return null;
  const n = smName(m[1]);
  return n ? { value: n, idx: ph.index } : null;
}

// Heading of the document, used when no kind matches
function smHeading(T) {
  const m = /((?:[A-Za-z&\-]+\s+){0,3})(card|certificate|licen[cs]e|policy|passport|schedule|statement|receipt|invoice|bill|deed|marksheet|degree|report|record|letter|agreement|permit|voucher|registration)\b/i.exec(T);
  if (!m) return '';
  return (m[1] + m[2]).trim().replace(/\s+/g, ' ').split(' ')
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ').slice(0, 50);
}

function smPurpose(s) {
  return s.replace(/^(of|for|the|to|in|that)\s+/i, '').replace(/^(of|for|the|to|in|that)\s+/i, '')
    .replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim().slice(0, 90);
}

/* ---------- 5. Dates: any common layout, including month-only ---------- */
function smYear(y) {
  if (y >= 100) return y;
  const now = new Date().getFullYear() % 100;
  return y > now ? 1900 + y : 2000 + y;
}
function smNorm(p) {
  let { y, mo, d } = p;
  if (d != null && mo > 12 && d <= 12) [mo, d] = [d, mo];
  y = smYear(y);
  if (!y || y < 1900 || y > 2100 || !mo || mo < 1 || mo > 12) return null;
  if (d != null && (d < 1 || d > new Date(y, mo, 0).getDate())) return null;
  return { y, mo, d, precision: d == null ? 'month' : 'day' };
}
const SM_DATE_RES = [
  { re: /\b(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4}|\d{2})\b/g, f: m => ({ d: +m[1], mo: +m[2], y: +m[3] }) },
  { re: /\b(\d{4})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\b/g, f: m => ({ y: +m[1], mo: +m[2], d: +m[3] }) },
  { re: /\b(\d{1,2})(?:st|nd|rd|th)?\s*[\-\s,]*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?[\s,\-]*(\d{4}|\d{2})\b/gi,
    f: m => ({ d: +m[1], mo: SM_MON[m[2].toLowerCase()], y: +m[3] }) },
  { re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})?,?\s*(\d{4})\b/gi,
    f: m => ({ mo: SM_MON[m[1].toLowerCase()], d: m[2] ? +m[2] : null, y: +m[3] }) },
  { re: /\b(\d{1,2})\s*[\/\-]\s*(\d{4})\b/g, f: m => ({ mo: +m[1], d: null, y: +m[2] }) }
];
function smDates(str) {
  const hits = [];
  for (const r of SM_DATE_RES) {
    const re = new RegExp(r.re.source, r.re.flags.includes('i') ? 'gi' : 'g');
    for (const m of str.matchAll(re)) {
      const p = smNorm(r.f(m));
      if (p) hits.push({ p, idx: m.index, end: m.index + m[0].length });
    }
  }
  hits.sort((a, b) => a.idx - b.idx || (b.end - b.idx) - (a.end - a.idx));
  const out = [];
  let last = -1;
  for (const h of hits) if (h.idx >= last) { out.push(h); last = h.end; }
  return out;
}
// Month-only dates: an issue date becomes the 1st, an expiry becomes the last day of the month
function smIso(p, isEnd) {
  const d = p.d != null ? p.d : (isEnd ? new Date(p.y, p.mo, 0).getDate() : 1);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function smLabelDate(src, isEnd) {
  if (!src) return null;
  const ds = smDates(src.value.slice(0, 40));
  if (!ds.length) return null;
  const p = ds[0].p;
  const note = p.precision === 'month'
    ? (isEnd ? 'Month only, set to last day' : 'Month only, set to 1st day') : '';
  return { iso: smIso(p, isEnd), src, note };
}
/* ===== smart.js PART 2 of 2. Append to the end. Builds suggestions, prepares photos, runs the tests. ===== */

/* ---------- 7. Numbers ---------- */
// Keeps a number that may contain spaces, such as "0157681764 09 00"
function smNumberTokens(x) {
  const toks = [];
  for (const t of x.value.split(/\s+/)) {
    if (!t) continue;
    if (!/^[A-Za-z0-9\/\-]+$/.test(t) || !/\d/.test(t)) break;
    toks.push(t.toUpperCase());
    if (toks.length === 4) break;
  }
  return toks.join(' ');
}

/* ---------- 8. Other details (kept as one Notes suggestion) ---------- */
function smOtherDetails(T, v) {
  const extra = [];
  if (v.dob) {
    const d = smDates(v.dob.value.slice(0, 30))[0];
    if (d) extra.push('Date of birth: ' + smShow(smIso(d.p, false)));
  }
  if (v.father) { const n = smName(v.father.value); if (n) extra.push('Father/Husband: ' + n); }
  if (v.sex) extra.push('Sex: ' + v.sex.value.slice(0, 12));
  if (v.age) {
    const a = /(\d{1,3})\s*(?:years?|yrs?)\b/i.exec(v.age.value);
    if (a) extra.push('Age: ' + a[1] + ' years');
  }
  if (v.blood) extra.push('Blood group: ' + v.blood.value.slice(0, 4));
  if (v.designation) extra.push('Designation: ' + v.designation.value.slice(0, 50));
  if (v.course) extra.push('Course/class: ' + v.course.value.slice(0, 50));
  if (v.address) extra.push('Address: ' + v.address.value.slice(0, 90));
  if (v.purpose) { const p = smPurpose(v.purpose.value); if (p) extra.push('Purpose: ' + p); }
  if (v.vdetail) extra.push('Vehicle: ' + v.vdetail.value.slice(0, 40));
  if (v.amount) extra.push('Amount: ' + v.amount.value.slice(0, 40));
  const iss = /(?:issued\s+by|conducted\s+by|offered\s+by|issued\s+from|from)\s+((?:[A-Z][\w&.\-]*\s*){1,6})/.exec(T);
  if (iss && /institute|university|college|school|board|council|department|ministry|bank|limited|ltd|academy|company|corporation|authority|commission|government|insurance/i.test(iss[1])) {
    extra.push('Issued by: ' + iss[1].trim());
  }
  return extra;
}

/* ---------- 9. The main builder ---------- */
function smBuild(text) {
  const T = smClean(text);
  const kind = smKind(T);
  PK_LAST = kind ? kind.kind : null;
  const v = smValues(T, smFindLabels(T));
  const out = [];
  const add = (targets, value, snippet, note) => {
    if (!value || out.length >= 14) return;
    if (out.some(s => s.value === value && s.targets.join() === targets.join())) return;
    out.push({ targets, value, snippet: snippet || '', note: note || '' });
  };
  const snip = (idx, len) =>
    T.slice(Math.max(0, idx - 25), idx + len + 25).replace(/\s+/g, ' ').trim().slice(0, 120);
  const vsnip = x => snip(x.idx, Math.min(40, x.end - x.idx + 25));

  // Title and type
  const isVehicle = !!(kind && kind.vehicle);
  const isPerson = !!(kind && kind.person);
  const veh = isVehicle ? pkVehicle(T) : null;
  let person = isPerson && v.name ? { value: smName(v.name.value), idx: v.name.idx } : null;
  if (isPerson && (!person || !person.value)) person = smPersonFallback(T);
  let subject = '', subSn = '', subNote = '';
  if (isVehicle) {
    if (veh) { subject = veh.value; subSn = snip(Math.max(0, veh.idx), 14); subNote = 'Vehicle no.'; }
    else subNote = 'Vehicle no. not found, add it in Title';
  } else if (isPerson) {
    if (person && person.value) { subject = person.value; subSn = snip(person.idx, 30); subNote = 'Name'; }
    else subNote = 'Name not found, add it in Title';
  }
  const kindName = kind ? kind.kind : (smHeading(T) || 'Document');
  const titleText = subject ? kindName + ' - ' + subject : kindName;
  add(['title'], titleText, subSn || snip(0, 60), subNote || (kind ? '' : 'Heading guessed, check it'));
  add(['type'], kind ? kind.type : 'Other', '', 'Document type');

  // Number, chosen by document kind
  const k = kind ? kind.kind : '';
  let num = null;
  if (k === 'Driving licence') {
    const sq = v.nlicence ? /^([A-Z]{2})(\d{2})(\d{11})/.exec(v.nlicence.value.toUpperCase().replace(/[^A-Z0-9]/g, '')) : null;
    if (sq) num = { value: sq[1] + sq[2] + sq[3], idx: v.nlicence.idx, label: 'Licence no.' };
    else { const p = pkDlNumber(T); if (p) num = { value: p.value, idx: p.idx, label: 'Licence no.' }; }
  } else if (k === 'Voter ID card') {
    const m = /\b[A-Z]{3}\d{7}\b/.exec(T);
    if (m) num = { value: m[0], idx: m.index, label: 'Voter ID (EPIC) no.' };
  } else if (k === 'Passport') {
    const m = /\b[A-Z]\d{7}\b/.exec(T);
    if (m) num = { value: m[0], idx: m.index, label: 'Passport no.' };
  } else if (k === 'Aadhaar card') {
    const m = /\b(\d{4})\s?(\d{4})\s?(\d{4})\b/.exec(T);
    if (m) num = { value: m[1] + ' ' + m[2] + ' ' + m[3], idx: m.index, label: 'Aadhaar no.' };
  } else if (k === 'PAN card') {
    const m = /\b[A-Z]{5}\d{4}[A-Z]\b/.exec(T);
    if (m) num = { value: m[0], idx: m.index, label: 'PAN' };
  } else if (isVehicle) {
    if (v.npolicy && smNumberTokens(v.npolicy)) num = { value: smNumberTokens(v.npolicy), idx: v.npolicy.idx, label: 'Policy no.' };
    else if (veh) num = { value: veh.value, idx: Math.max(0, veh.idx), label: 'Vehicle no.' };
  } else {
    const L = [v.npolicy, v.nother, v.nvehicle].find(x => x && smNumberTokens(x));
    if (L) num = { value: smNumberTokens(L), idx: L.idx, label: 'Document no.' };
  }
  if (num) add(['number'], num.value, snip(num.idx, 30), num.label);

  // Dates: policy period for insurance, labelled dates otherwise, then unlabelled dates
  const insuranceLike = isVehicle || ['Life insurance', 'Health insurance', 'Insurance policy'].includes(k);
  const period = insuranceLike ? pkPeriod(T) : null;
  if (period) {
    add(['issue'], period.from.value, snip(period.from.idx, 12), 'Policy start');
    add(['expiry'], period.till.value, snip(period.till.idx, 12), 'Policy end');
  } else {
    const dIssue = smLabelDate(v.issue || v.appoint || v.validfrom || v.date, false);
    const dExpiry = smLabelDate(v.expiry, true);
    if (dIssue) add(['issue'], dIssue.iso, vsnip(dIssue.src), dIssue.note);
    if (dExpiry) add(['expiry'], dExpiry.iso, vsnip(dExpiry.src), dExpiry.note);
    if (!dIssue && !dExpiry) {
      smDates(T)
        .filter(d => !SM_NOT_DATE.test(T.slice(Math.max(0, d.idx - 40), d.idx)))
        .slice(0, 3)
        .forEach(d => add(['issue', 'expiry'], smIso(d.p, false), snip(d.idx, d.end - d.idx), 'Check which date this is'));
    }
  }

  // Other details, as one suggestion for the Notes field
  const extra = smOtherDetails(T, v);
  if (extra.length) add(['notes'], extra.join(' · ').slice(0, 400), snip(0, 60), 'Other details (approve to add to notes)');

  return out;
}

// The form and the tests use this name
buildSuggestions = smBuild;

/* ---------- 10. Photos: enlarge small text and stretch contrast before OCR ---------- */
async function smPrepare(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('the photo could not be opened'));
      i.src = url;
    });
    const scale = Math.min(2.5, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < px.length; i += 4) {
      const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      px[i] = px[i + 1] = px[i + 2] = g;
      hist[g]++;
    }
    const total = w * h;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      const g = Math.max(0, Math.min(255, Math.round((px[i] - lo) * 255 / span)));
      px[i] = px[i + 1] = px[i + 2] = g;
    }
    ctx.putImageData(data, 0, 0);
    return await new Promise(res => canvas.toBlob(res, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Photos now go through the preparation step; PDFs keep the existing path
const smBaseReadDocument = readDocument;
readDocument = async function (file) {
  if (!file.type || !file.type.startsWith('image/')) return smBaseReadDocument(file);
  if (!(await pkLoadOcr())) return { error: 'Could not load the OCR engine. Check internet and try again.' };
  const prepared = await smPrepare(file);
  return { text: await pkOcrBlob(prepared, true) };
};

/* ---------- 11. Tests on your card text and a non-standard certificate ---------- */
const SM_VOTER_SAMPLE = "ELECTION COMMISSION OF INDIA IDENTITY CARD GDH9779703 Elector's Name :LALEET Father's Name :HARKISHOR Sex / MALE Age as on 1.1.2003 :66 Years Address : HNO. 3106/2 COLLEGE WARD Date : 10-02-2003";
const SM_COLLEGE_SAMPLE = "GOVERNMENT MODEL COLLEGE OF SCIENCE RAIPUR IDENTITY CARD S. No. Name LALIT KUMAR SRIVASTAVA Father/Husband Name SRI H.K. SRIVASTAVA Date of Birth 15.10.1938 Designation PROFESSOR PHYSICS Bearer Principal";
const SM_CERT_SAMPLE = "CERTIFICATE OF PARTICIPATION\nThis is to certify that Priya Sharma has successfully completed the Advanced Python Workshop conducted by Tech Institute Bangalore for the purpose of professional development.\nDate of Issue: 14th March 2024   Valid Upto: Mar 2026   Certificate No. TI/2024/0456";

const SM_TESTS = [
  { name: 'Driving licence (your card text)', text: PK_DL_SAMPLE,
    expect: { title: 'Driving licence - Kshitij Shrivastava', type: 'Identity', number: 'MH1320090023095', issue: '2009-07-02', expiry: '2034-08-10' },
    contains: { notes: 'Date of birth' }, absent: [] },
  { name: 'Car insurance (policy PDF text)', text: PK_CAR_SAMPLE,
    expect: { title: 'Car insurance - WB06L2307', type: 'Insurance', number: '0157681764 09 00', issue: '2026-10-30', expiry: '2027-10-29' },
    contains: {}, absent: [] },
  { name: 'Voter ID (photo text)', text: SM_VOTER_SAMPLE,
    expect: { title: 'Voter ID card - Laleet', type: 'Identity', number: 'GDH9779703', issue: '2003-02-10' },
    contains: {}, absent: ['expiry'] },
  { name: 'College ID (handwritten, no expiry)', text: SM_COLLEGE_SAMPLE,
    expect: { title: 'College ID card - Lalit Kumar Srivastava', type: 'Identity' },
    contains: {}, absent: ['number', 'issue', 'expiry'] },
  { name: 'Certificate (non-standard wording)', text: SM_CERT_SAMPLE,
    expect: { title: 'Certificate - Priya Sharma', type: 'Certificate', number: 'TI/2024/0456', issue: '2024-03-14', expiry: '2026-03-31' },
    contains: { notes: 'professional development' }, absent: [] }
];

function smSelfTest() {
  const lines = [];
  for (const t of SM_TESTS) {
    const got = smBuild(t.text);
    const pick = key => got.find(s => s.targets.length === 1 && s.targets[0] === key);
    lines.push('-- ' + t.name + ' (detected: ' + (PK_LAST || 'none') + ')');
    for (const key of Object.keys(t.expect)) {
      const s = pick(key);
      const ok = !!s && s.value === t.expect[key];
      lines.push((ok ? 'PASS  ' : 'FAIL  ') + key + ': ' + (s ? s.value : 'nothing found') +
        (ok ? '' : '  (expected ' + t.expect[key] + ')'));
    }
    for (const [key, part] of Object.entries(t.contains)) {
      const s = pick(key);
      const ok = !!s && s.value.includes(part);
      lines.push((ok ? 'PASS  ' : 'FAIL  ') + key + ' includes "' + part + '"');
    }
    for (const key of t.absent) {
      const s = pick(key);
      lines.push((s ? 'FAIL  ' : 'PASS  ') + 'no ' + key + (s ? ' (got ' + s.value + ')' : ''));
    }
  }
  alert('Smart reader tests\n\n' + lines.join('\n'));
}

(function smButton() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('sm-test')) return;
  const b = document.createElement('button');
  b.id = 'sm-test';
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Run smart reader tests';
  b.onclick = smSelfTest;
  bk.appendChild(b);
})();
