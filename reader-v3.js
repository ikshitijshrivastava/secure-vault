/* ===== reader-v3.js PART 1 of 2. Create the file with this part. Possessive labels, father/mother split, names, document type. ===== */
'use strict';

/* 1. Possessives: "ATHLETE'S NAME" and "MOTHER'S NAME" are read as plain labels */
const RD_NORM = s => agNorm(String(s || '').replace(/['’`]s\b/gi, ''));

agPieces = function (line) {
  return String(line).replace(/[:|]/g, ' : ').split(/\s+/).filter(Boolean).map(raw => {
    if (raw === ':') return { sep: true, raw: ':', words: [] };
    return { sep: false, raw, words: RD_NORM(raw).split(' ').filter(Boolean) };
  });
};

/* 2. Father and mother were mixed up. Remove mother from the father list, and add label phrases */
AG_LEX.father.phrases = AG_LEX.father.phrases.filter(t => !/mother/i.test(t));

const RD_EXTRA = [
  ['holder', true, ['athlete name', 'shooter name', 'member name', 'name of athlete',
    'elector name', 'electors name', 'voter name', 'name of elector']],
  ['mother', true, ['mother name', 'name of mother']],
  ['number', false, ['shooter id no', 'athlete id no', 'member id no']],
  ['issue', true, ['approved at', 'approved on', 'date of approval', 'approval date']]
];

// Rebuilds the label list with the same normalisation, keeping labels learned from corrections
function rdRebuildPhrases() {
  const learned = AG_PHRASES.filter(p => p.learned);
  AG_PHRASES.length = 0;
  const add = (field, text, strict) => {
    const words = RD_NORM(text).split(' ').filter(Boolean);
    if (words.length) AG_PHRASES.push({ field, text, words, strict: !!strict });
  };
  for (const [field, def] of Object.entries(AG_LEX)) {
    for (const t of def.phrases) add(field, t, def.strict);
  }
  for (const [field, strict, list] of RD_EXTRA) {
    for (const t of list) add(field, t, strict);
  }
  AG_PHRASES.push(...learned);
}
rdRebuildPhrases();

/* 3. Names: remove a trailing possessive before the name is cleaned */
const rdBaseName = agName;
agName = function (raw) {
  return rdBaseName(String(raw || '').replace(/['’`]s\b/gi, ''));
};

/* 4. Document type: printed heading and strength of evidence decide the kind */
const RD_KIND_HEAD = 120;   // a keyword this close to the top counts even on its own

// Keywords from the printed heading, such as "ATHLETE'S ID CARD"
const RD_HEAD_KW = /\b(ID\s+CARD|IDENTITY\s+CARD|MEMBERSHIP\s+CARD|CARD|CERTIFICATE|LICEN[CS]E|PASSPORT|PERMIT|MARK\s?SHEET|RECEIPT|INVOICE|STATEMENT)\b/i;
const RD_HEAD_STOP = /^(OF|THE|AND|FOR|FROM|BY|IN|AT|INDIA|GOVERNMENT|DEPARTMENT|MINISTRY|ASSOCIATION|LIMITED|LTD|PVT|PRIVATE|NATIONAL|STATE|NO|DATE|NAME)$/;

// Reads the printed heading: up to three capitalised words before the keyword, then the keyword
function rdCardHeading(T) {
  const s = String(T || '').slice(0, 400);
  const m = RD_HEAD_KW.exec(s);
  if (!m) return null;
  const before = s.slice(0, m.index).trim().split(/\s+/).filter(Boolean);
  const words = [];
  for (let i = before.length - 1; i >= 0 && words.length < 3; i--) {
    const w = before[i].replace(/[^A-Za-z'’&.\-]/g, '');
    const core = w.replace(/['’]S$/, '');
    if (!w || !/^[A-Z][A-Z'’&.\-]*$/.test(w) || RD_HEAD_STOP.test(core)) break;
    words.unshift(w);
  }
  const kw = m[0].replace(/\s+/g, ' ');
  const title = [...words, kw].join(' ').split(' ').map(w =>
    /^(ID|NRAI|PAN|DL|ATM)$/i.test(w) ? w.toUpperCase()
      : w.toLowerCase().replace(/^[a-z]/, c => c.toUpperCase())).join(' ');
  const K = kw.toUpperCase();
  const type = /CERTIF/.test(K) ? 'Certificate'
    : /MARK/.test(K) ? 'Education'
    : /RECEIPT|INVOICE|STATEMENT/.test(K) ? 'Financial'
    : 'Identity';
  return { title, type };
}

// How often a kind's keywords appear, and whether one appears near the top
function rdHits(k, T) {
  const re = new RegExp(k.re.source, 'gi');
  let n = 0, early = false, m;
  while ((m = re.exec(T))) {
    n++;
    if (m.index < RD_KIND_HEAD) early = true;
  }
  return { n, early };
}

// The "Property" keywords no longer include the bare word "property", which appears in many unrelated documents
const rdProp = SM_KINDS.find(k => k.kind === 'Property document');
if (rdProp) {
  rdProp.re = /sale\s+deed|land\s+record|khasra|khatauni|property\s+(?:tax|card|registration|owner|address|documents?)|registration\s+office/gi;
}

smKind = function (T) {
  T = String(T || '');
  let best = null, bestScore = 0;
  for (const k of SM_KINDS) {
    if (k.weak) continue;
    if (k.must && !k.must.test(T)) continue;
    const h = rdHits(k, T);
    if (h.n < 2 && !h.early) continue;          // one stray word is not enough
    const score = h.n + (h.early ? 2 : 0);
    if (score > bestScore) { best = k; bestScore = score; }
  }
  if (best) return best;
  const head = rdCardHeading(T);
  if (head) return { kind: head.title, type: head.type, person: head.type !== 'Financial', vehicle: false };
  return SM_KINDS.find(k => k.weak && new RegExp(k.re.source, 'i').test(T)) || null;
};
