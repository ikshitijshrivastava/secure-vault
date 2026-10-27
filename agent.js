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
