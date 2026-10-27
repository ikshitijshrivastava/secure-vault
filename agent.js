/* ===== agent.js PART 1 of 2. Create the file with this part. Label meaning, phrase dictionary, value checks. ===== */
'use strict';

const AG_VERSION = 'Agent v1';

// Words that show a label names an organisation, not a person (e.g. "College name")
const AG_ORG = /^(college|school|company|bank|institute|institution|university|board|insurance|hospital|issued|issuing|organisation|organization|firm|employer|department|office|registered|course|branch|class|product|plan|scheme|authority|corporation)$/i;

// Single words that can never be part of a name or a value
const AG_NOT_NAME = new Set(['address','date','dob','birth','valid','till','upto','from','to','sign','signature','issue','issued','expiry','no','number','card','certificate','policy','father','husband','mother','spouse','son','daughter','wife','designation','bearer','principal','male','female','sex','age','blood','group','of','the','and','for','in','at','on','by','with','hrs','midnight','licence','license','licencing','authority','registration','regn','vehicle','chassis','engine','make','model','fuel','cover','premium','total','amount','course','branch','class','roll','marks','grade','college','school','university','institute','board','state','india','mobile','phone','contact','email','client','code','id','nationality','marital','status','pin','gstin','account','receipt','invoice','year','passing']);

function agNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').trim();
}
function agEdit(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/* ---------- meaning dictionary: many phrasings per field ---------- */
// strict: the value must pass a check (date or name), so the label can stand without a colon
const AG_LEX = {
  holder: { strict: true, phrases: [
    'name', 'full name', 'naam', 'holder name', 'card holder name', 'name of holder', 'name of the holder',
    'policy holder name', 'policyholder name', 'insured name', 'name of insured', 'name of the insured',
    'student name', 'name of student', 'name of the student', 'candidate name', 'name of candidate',
    'name of the candidate', 'employee name', 'name of employee', 'applicant name', 'name of applicant',
    'elector name', 'electors name', 'owner name', 'registered owner', 'name of person', 'name of the person'
  ]},
  father: { strict: true, phrases: [
    'father name', 'father s name', 'fathers name', 'father husband name', 'father or husband name',
    'husband name', 'husband s name', 'spouse name', 'guardian name', 'mother name',
    'pita ka naam', 'pita ka nam', 's o', 'son of', 'd o', 'daughter of', 'w o', 'wife of'
  ]},
  dob: { strict: true, phrases: ['date of birth', 'dob', 'd o b', 'birth date', 'born on'] },
  issue: { strict: true, phrases: [
    'date of issue', 'issue date', 'date issued', 'issued on', 'issued date', 'issue dt', 'doi',
    'date of registration', 'registration date', 'granted on', 'date of award', 'date of certification',
    'certified on', 'date of passing', 'year of passing', 'dated', 'issued'
  ]},
  validfrom: { strict: true, phrases: ['valid from', 'valid w e f', 'effective from', 'period from', 'validity from', 'cover from', 'w e f'] },
  expiry: { strict: true, phrases: [
    'valid till', 'valid until', 'valid upto', 'valid up to', 'valid through', 'valid to', 'valid thru',
    'validity till', 'validity upto', 'validity until', 'date of expiry', 'expiry date', 'expires on',
    'expiry', 'expiry dt', 'renewal due', 'due date', 'good till', 'valid till date'
  ]},
  number: { phrases: [
    'policy no', 'policy number', 'policy num', 'certificate no', 'certificate number', 'cert no',
    'roll no', 'roll number', 'dl no', 'dl number', 'licence no', 'licence number', 'license no',
    'license number', 'lic no', 'passport no', 'passport number', 'epic no', 'voter id', 'voter id no',
    'enrolment no', 'enrollment no', 'membership no', 'student id', 'student no', 'id no', 'serial no',
    'sr no', 's no', 'pan no', 'pan number', 'gstin', 'account no', 'account number', 'receipt no',
    'invoice no', 'bill no', 'reference no', 'ref no', 'application no', 'file no', 'client id',
    'employee id', 'emp id', 'document no', 'doc no', 'uin', 'member id', 'card no', 'card number'
  ]},
  vehicle: { phrases: [
    'registration no', 'registration number', 'regn no', 'reg no', 'reg number', 'vehicle no',
    'vehicle number', 'vehicle registration number', 'registration mark', 'reg mark',
    'chassis no', 'chassis number'
  ]},
  issuer: { phrases: [
    'issued by', 'issuing authority', 'issued from', 'issuing body', 'insurer', 'insurance company',
    'insurance provider', 'provider', 'provider name', 'issuer', 'issuer name', 'awarded by',
    'conducted by', 'offered by', 'registering authority', 'registered by', 'board', 'board name',
    'name of board', 'university', 'university name', 'name of university', 'institution',
    'institution name', 'name of institution', 'institute', 'name of institute', 'school',
    'school name', 'college name', 'name of college', 'organisation', 'organization', 'authority'
  ]},
  designation: { phrases: ['designation', 'post', 'rank', 'occupation', 'position', 'job title'] },
  course: { phrases: ['course', 'course name', 'class', 'grade', 'branch', 'programme', 'program', 'stream', 'subject', 'degree', 'trade', 'department'] },
  address: { phrases: ['address', 'permanent address', 'present address', 'residential address', 'correspondence address', 'communication address', 'pata', 'residence'] },
  purpose: { phrases: ['purpose', 'in recognition of'] },
  sex: { phrases: ['sex', 'gender'] },
  blood: { phrases: ['blood group', 'blood type'] },
  age: { phrases: ['age'] },
  amount: { phrases: ['total', 'amount', 'premium', 'net premium', 'sum insured', 'sum assured', 'percentage', 'percent', 'cgpa', 'sgpa', 'marks obtained', 'total marks', 'grade point', 'salary', 'net pay'] }
};
const AG_PHRASES = [];
for (const [field, def] of Object.entries(AG_LEX)) {
  for (const text of def.phrases) {
    const words = agNorm(text).split(' ').filter(Boolean);
    if (words.length) AG_PHRASES.push({ field, text, words, strict: !!def.strict });
  }
}

/* ---------- reading the layout: pieces, separators, labels ---------- */
// Splits a line into pieces. ":" and "|" become separators, so tables read like labels.
function agPieces(line) {
  return String(line).replace(/[:|]/g, ' : ').split(/\s+/).filter(Boolean).map(raw => {
    if (raw === ':') return { sep: true, raw: ':', words: [] };
    return { sep: false, raw, words: agNorm(raw).split(' ').filter(Boolean) };
  });
}
// The words just before a piece, used to avoid "College name" being read as a person's name
function agPrevWords(pieces, k, n) {
  const out = [];
  for (let j = k - 1; j >= 0 && out.length < n; j--) {
    if (pieces[j].sep) break;
    for (let x = pieces[j].words.length - 1; x >= 0 && out.length < n; x--) out.push(pieces[j].words[x]);
  }
  return out;
}
// Finds every label in one line. Fuzzy matches allow one letter of typo in longer words.
function agLabelsIn(pieces) {
  const found = [];
  for (let k = 0; k < pieces.length; k++) {
    if (pieces[k].sep || !pieces[k].words.length) continue;
    const flat = [];
    for (let j = k; j < pieces.length && !pieces[j].sep; j++) {
      for (const w of pieces[j].words) flat.push({ w, p: j });
    }
    let best = null;
    for (const ph of AG_PHRASES) {
      const m = ph.words.length;
      if (m > flat.length) continue;
      let exact = true;
      let ok = true;
      for (let i = 0; i < m; i++) {
        const a = flat[i].w, b = ph.words[i];
        if (a === b) continue;
        if (b.length >= 5 && Math.abs(a.length - b.length) <= 1 && agEdit(a, b) <= 1) { exact = false; continue; }
        ok = false;
        break;
      }
      if (!ok) continue;
      const endP = flat[m - 1].p;
      const next = pieces[endP + 1];
      const colon = !!next && next.sep;
      if (m === 1 && !ph.strict && !colon) continue;   // a single word needs a colon unless its value is checked
      if (ph.field === 'holder' && m === 1 && agPrevWords(pieces, k, 2).some(w => AG_ORG.test(w))) continue;
      const cand = { field: ph.field, from: k, to: endP, len: m, exact, strict: ph.strict };
      if (!best || m > best.len || (m === best.len && exact && !best.exact)) best = cand;
    }
    if (best) found.push(best);
  }
  // Keep the leftmost, longest labels; drop any label that sits inside another
  found.sort((a, b) => a.from - b.from || b.to - a.to);
  const out = [];
  let end = -1;
  for (const f of found) if (f.from > end) { out.push(f); end = f.to; }
  return out;
}
// Collects the value words after a label, stopping at the next label or separator
function agCollect(pieces, from, stops, max) {
  const raws = [];
  let started = false;
  for (let j = from; j < pieces.length && raws.length < max; j++) {
    const p = pieces[j];
    if (p.sep) { if (started) break; continue; }
    if (stops.has(j)) break;
    if (!p.words.length) { if (started) raws.push(p.raw); continue; }
    started = true;
    raws.push(p.raw);
  }
  return raws.join(' ').replace(/\s+/g, ' ').trim();
}

/* ---------- value checks: a value is kept only if it looks right for its field ---------- */
function agDateOf(raw, role) {
  const hits = smDates(String(raw || '').slice(0, 40));
  if (!hits.length) return null;
  const p = hits[0].p;
  return { iso: smIso(p, role === 'expiry'), precision: p.precision };
}
function agName(raw) {
  const cleaned = String(raw || '').split(/[\d(\[{@|]/)[0].replace(/[^A-Za-z.' \-]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = [];
  for (const piece of cleaned.split(' ')) {
    const w = piece.replace(/^[.'\-]+|[.'\-]+$/g, '');
    if (!w) continue;
    if (!words.length && /^(mr|mrs|ms|miss|dr|shri|smt|kumari|kum|sri)$/i.test(w)) continue;
    if (AG_NOT_NAME.has(w.toLowerCase())) break;
    if (w.length === 1 && !/^[A-Za-z]$/.test(w)) break;
    words.push(w);
    if (words.length === 5) break;
  }
  if (words.length < 2) return null;
  return words.map(w => (/\./.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}
function agNumber(raw) {
  const toks = [];
  for (const t of String(raw || '').split(/\s+/)) {
    if (!t) continue;
    if (!/^[A-Za-z0-9\/\-]+$/.test(t) || !/\d/.test(t)) break;
    toks.push(t.toUpperCase());
    if (toks.length === 4) break;
  }
  return toks.length ? toks.join(' ') : null;
}
function agIssuer(raw) {
  const v = String(raw || '').split(/[\d(\[{@|]/)[0].replace(/[^A-Za-z&.,' \-]/g, ' ')
    .replace(/\s+/g, ' ').replace(/[,.\-\s]+$/, '').trim();
  const words = v.split(' ').filter(Boolean);
  if (v.length < 4 || words.length > 9) return null;
  if (words.every(w => AG_NOT_NAME.has(w.toLowerCase()))) return null;
  if (/^(of|the|and|for|by)\b/i.test(v)) return null;
  return v;
                             }
/* ===== agent.js PART 2 of 2. Append to the end. Builds suggestions, merges them with the reader, runs tests. ===== */

const AG_MAXPIECES = { holder: 5, father: 5, address: 12, issuer: 10, notes: 10, amount: 4 };

// Reads the text into lines, pieces and labels
function agDoc(text) {
  return String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const pieces = agPieces(line);
    const labels = agLabelsIn(pieces);
    return { line, pieces, labels, stops: new Set(labels.map(l => l.from)) };
  });
}

// Value for a label: the same line first, or the next line when the label ends its line
function agTake(docLines, li, label) {
  const dl = docLines[li];
  const max = AG_MAXPIECES[label.field] || 8;
  let raw = agCollect(dl.pieces, label.to + 1, dl.stops, max);
  let source = 'same line';
  if (!raw && li + 1 < docLines.length && !docLines[li + 1].stops.has(0)) {
    const nx = docLines[li + 1];
    raw = agCollect(nx.pieces, 0, nx.stops, max);
    source = 'next line';
  }
  return { raw, source };
}

// Builds candidate values for each field, with confidence and the label they came from
function agBuild(text) {
  const T = String(text || '');
  const docLines = agDoc(T);
  const kind = smKind(smClean(T));
  PK_LAST = kind ? kind.kind : null;

  const got = {};
  const put = (field, value, conf, why, snippet) => {
    if (value) (got[field] = got[field] || []).push({ value, conf, why, snippet });
  };

  docLines.forEach((dl, li) => {
    for (const label of dl.labels) {
      const take = agTake(docLines, li, label);
      if (!take.raw) continue;
      const shown = dl.pieces.slice(label.from, label.to + 1).map(p => p.raw).join(' ');
      const why = '"' + shown + '" (' + take.source + ')';
      const snippet = (shown + ': ' + take.raw).slice(0, 110);
      const base = (label.exact ? 0.9 : 0.75) - (take.source === 'next line' ? 0.1 : 0);
      const f = label.field;
      if (f === 'holder' || f === 'father') {
        put(f, agName(take.raw), base, why, snippet);
      } else if (f === 'dob' || f === 'issue' || f === 'validfrom' || f === 'expiry') {
        const role = f === 'validfrom' ? 'issue' : f;
        const d = agDateOf(take.raw, role);
        if (d) put(role, d.iso, base - (d.precision === 'month' ? 0.1 : 0),
          why + (d.precision === 'month' ? ', month only' : ''), snippet);
      } else if (f === 'number') {
        put('number', agNumber(take.raw), base, why, snippet);
      } else if (f === 'vehicle') {
        put('vehicle', pkVehicleFromSquashed(take.raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)), base, why, snippet);
      } else if (f === 'issuer') {
        put('issuer', agIssuer(take.raw), base, why, snippet);
      } else {
        put(f, take.raw.slice(0, f === 'address' ? 120 : 80).trim(), base - 0.1, why, snippet);
      }
    }
  });

  const best = f => (got[f] || []).slice().sort((a, b) => b.conf - a.conf)[0] || null;
  const out = [];
  const add = (targets, value, snippet, conf, why) => {
    if (!value) return;
    const pct = Math.round(Math.min(1, Math.max(0, conf)) * 100);
    out.push({ targets, value, snippet: snippet || '', note: 'Agent ' + pct + '% · ' + why });
  };

  // Vehicle and name, used in the title
  let veh = best('vehicle');
  if (!veh && kind && kind.vehicle) {
    const p = pkVehicle(T);
    if (p) veh = { value: p.value, conf: 0.6, why: 'vehicle number found in the text', snippet: '' };
  }
  const holder = best('holder');

  if (kind) {
    const subject = kind.vehicle ? veh : (kind.person ? holder : null);
    add(['title'], kind.kind + (subject ? ' - ' + subject.value : ''),
      subject ? subject.snippet : '', subject ? Math.min(0.95, subject.conf) : 0.5,
      subject ? (kind.vehicle ? 'document kind and vehicle number' : 'document kind and name')
              : 'document kind, no name or vehicle number found');
    add(['type'], kind.type, '', 0.9, 'document kind');
  }

  const numC = best('number') || (kind && kind.vehicle ? veh : null);
  if (numC) add(['number'], numC.value, numC.snippet, numC.conf, numC.why);

  for (const f of ['issue', 'expiry']) {
    const c = best(f);
    if (c) add([f], c.value, c.snippet, c.conf, c.why);
  }

  const iss = best('issuer');
  if (iss) add(['issuer'], iss.value, iss.snippet, iss.conf, iss.why);
  else {
    const fb = typeof ssIssuer === 'function' ? ssIssuer(T) : null;
    if (fb) add(['issuer'], fb.value, fb.snippet, 0.5, 'pattern match, please check');
  }

  // Other details, one line each, for the Other details field
  const lines = [];
  const dob = best('dob');
  if (dob) lines.push('Date of birth: ' + smShow(dob.value));
  const fa = best('father');
  if (fa) lines.push('Father/Husband: ' + fa.value);
  const extras = [['sex', 'Sex'], ['age', 'Age'], ['blood', 'Blood group'], ['designation', 'Designation'],
    ['course', 'Course/class'], ['address', 'Address'], ['purpose', 'Purpose'], ['amount', 'Amount']];
  for (const [f, label] of extras) {
    const c = best(f);
    if (c) lines.push(label + ': ' + c.value);
  }
  if (lines.length) add(['notes'], lines.join('\n'), '', 0.7, 'other details');

  return out;
}

// Replaces the suggestion builder: agent results come first, the older readers fill any gaps
const agBaseBuild = buildSuggestions;
buildSuggestions = function (text) {
  let ag = [];
  try { ag = agBuild(text); } catch (e) { ag = []; }
  const taken = new Set();
  const out = [];
  for (const s of ag) {
    if (s.targets.some(t => taken.has(t))) continue;
    s.targets.forEach(t => taken.add(t));
    out.push(s);
  }
  for (const s of agBaseBuild(text)) {
    const free = s.targets.filter(t => !taken.has(t));
    if (!free.length) continue;
    free.forEach(t => taken.add(t));
    out.push({ ...s, targets: free });
  }
  return out;
};

/* ---------- tests: different phrasings, layouts and a negative case ---------- */
const AG_TESTS = [
  { name: '1. Different wording: "Holder\'s full name", "Valid up to"',
    text: "Holder's full name: Ananya Rao\nDate of Birth: 04-07-1990\nValid up to: 03.07.2030\nPolicy Number: AB/2291/77",
    expect: { holder: 'Ananya Rao', expiry: '2030-07-03', number: 'AB/2291/77' },
    contains: { notes: 'Date of birth: 04/07/1990' }, absent: [] },
  { name: '2. Name on the line below its label',
    text: 'Name of the Insured\nSHRI RAJESH KUMAR\nDate of Issue : 14th March 2024',
    expect: { holder: 'Rajesh Kumar', issue: '2024-03-14' }, contains: {}, absent: [] },
  { name: '3. Table layout with bars',
    text: 'Policy No | 0157681764 09 00\nValid From | 30/10/2026\nValid Till | 29/10/2027',
    expect: { number: '0157681764 09 00', issue: '2026-10-30', expiry: '2027-10-29' }, contains: {}, absent: [] },
  { name: '4. Marksheet with board, roll number and year',
    text: 'Board : Maharashtra State Board\nRoll No : MH4451234\nStudent Name : Priya Patil\nYear of Passing : March 2019',
    expect: { issuer: 'Maharashtra State Board', number: 'MH4451234', holder: 'Priya Patil', issue: '2019-03-01' },
    contains: {}, absent: [] },
  { name: '5. Label with no colon, and other details',
    text: "Ananya's date of birth 04/07/1990 Blood group B+",
    expect: {}, contains: { notes: 'Date of birth: 04/07/1990', notes2: '' }, absent: [] },
  { name: '6. "Name of Institution" and a bare "Name" line',
    text: 'Name of Institution: GOVERNMENT MODEL COLLEGE OF SCIENCE RAIPUR\nIDENTITY CARD\nName LALIT KUMAR SRIVASTAVA',
    expect: { issuer: 'GOVERNMENT MODEL COLLEGE OF SCIENCE RAIPUR', holder: 'Lalit Kumar Srivastava' },
    contains: {}, absent: [] },
  { name: '7. Legal wording must not become an issuer',
    text: 'Chapter 7 of the IRDAI (Protection of Policyholders Interests, Operations and Allied Matters of Insurers) Regulations, 2024.',
    expect: {}, contains: {}, absent: ['issuer'] }
];

function agSelfTest() {
  const lines = [];
  for (const t of AG_TESTS) {
    const got = agBuild(t.text);
    const pick = f => got.find(s => s.targets.length === 1 && s.targets[0] === f);
    lines.push('-- ' + t.name);
    for (const [f, want] of Object.entries(t.expect || {})) {
      const s = pick(f);
      const ok = !!s && s.value === want;
      lines.push((ok ? 'PASS  ' : 'FAIL  ') + f + ': ' + (s ? s.value : 'nothing found') +
        (ok ? '' : '  (expected ' + want + ')'));
    }
    for (const [f, part] of Object.entries(t.contains || {})) {
      if (f === 'notes2') continue;
      const s = pick(f);
      const ok = !!s && s.value.includes(part);
      lines.push((ok ? 'PASS  ' : 'FAIL  ') + f + ' includes "' + part + '"' + (ok ? '' : '  (got ' + (s ? s.value : 'nothing') + ')'));
    }
    for (const f of t.absent || []) {
      const s = pick(f);
      lines.push((s ? 'FAIL  ' : 'PASS  ') + 'no ' + f + (s ? ' (got ' + s.value + ')' : ''));
    }
  }
  alert(AG_VERSION + ' tests\n\n' + lines.join('\n'));
}

(function agButton() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('ag-test')) return;
  const b = document.createElement('button');
  b.id = 'ag-test';
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Run agent tests';
  b.onclick = agSelfTest;
  bk.appendChild(b);
})();
