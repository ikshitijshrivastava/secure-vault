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
/* ===== reader-v3.js PART 2 of 2. Append to the end. Mother's name in Other details, tests, registration. ===== */

/* 5. Mother's name is added to Other details, with the same title case as the father's */
const rdBaseBuild = buildSuggestions;
buildSuggestions = function (text) {
  const out = rdBaseBuild(text);
  let got = null;
  try { got = agExtract(String(text || '')); } catch (e) { return out; }
  const m = agBest(got, 'mother');
  if (!m) return out;
  const line = 'Mother: ' + (agName(m.value) || m.value);
  const note = out.find(s => s.targets.length === 1 && s.targets[0] === 'notes');
  if (note) {
    if (!note.value.includes('Mother:')) note.value += '\n' + line;
  } else {
    out.push({
      targets: ['notes'], value: line, snippet: m.snippet || '',
      note: 'Agent ' + Math.round(m.conf * 100) + '% · other details'
    });
  }
  return out;
};

/* 6. Tests: athlete ID card, real property document, stray word, college ID, voter ID */
const RD_ATHLETE = "THE NATIONAL RIFLE ASSOCIATION OF INDIA ATHLETE'S ID CARD SHOOTER'S ID NO. : SHF2508201105 ATHLETE'S NAME : AISHANYAA SHRIVASTAVA MOTHER'S NAME : SANTULA SHRIVASTAVA FATHER'S NAME : KSHITIJ SHRIVASTAVA DATE OF BIRTH : 25-08-2011 STATE/UNIT : KARNATAKA Para/Deaf : NONE Approved At - 2025-12-12 11:45:48 Valid Till- 12-12-2030 Secretary, NRAI Note:- 1. This card does not confer any type of membership. 3. This card is the property of NRAI and shall be returned as and when required by NRAI.";

function rdSelfTest() {
  const lines = [];
  const ok = (c, m) => lines.push((c ? 'PASS  ' : 'FAIL  ') + m);
  try {
    const kindA = smKind(smClean(RD_ATHLETE));
    ok(!!kindA && kindA.kind === "Athlete's ID Card", "kind comes from the printed heading: " + (kindA ? kindA.kind : 'none'));
    ok(!!kindA && kindA.kind !== 'Property document', 'a stray word "property" does not set the type');

    const sug = buildSuggestions(RD_ATHLETE);
    const pick = f => sug.find(s => s.targets.length === 1 && s.targets[0] === f);
    const t = pick('title');
    ok(!!t && t.value === "Athlete's ID Card - Aishanyaa Shrivastava", 'title: ' + (t ? t.value : 'nothing'));
    ok(!!pick('type') && pick('type').value === 'Identity', 'type is Identity');
    ok(!!pick('number') && pick('number').value === 'SHF2508201105', 'number is the shooter ID');
    ok(!!pick('expiry') && pick('expiry').value === '2030-12-12', 'expiry comes from Valid Till');
    ok(!!pick('issue') && pick('issue').value === '2025-12-12', 'issue comes from Approved At');

    const notes = pick('notes') ? pick('notes').value : '';
    ok(notes.includes('Father/Husband: Kshitij Shrivastava'), 'father is Kshitij Shrivastava');
    ok(notes.includes('Mother: Santula Shrivastava'), 'mother is Santula Shrivastava, not the father');
    ok(notes.includes('Date of birth: 25/08/2011'), 'date of birth is in Other details');

    const kindP = smKind('Sale deed of property. Property owner Ravi Kumar. Registration office Bengaluru.');
    ok(!!kindP && kindP.kind === 'Property document', 'a real property document is still a property document');

    const kindS = smKind('Your ID card. This card is the property of NRAI and shall be returned.');
    ok(!kindS || kindS.kind !== 'Property document', 'one stray "property" word is not a property document');

    const kindC = smKind('GOVERNMENT MODEL COLLEGE OF SCIENCE RAIPUR IDENTITY CARD Name LALIT KUMAR SRIVASTAVA');
    ok(!!kindC && kindC.kind === 'College ID card', 'college ID is still recognised');

    const kindV = smKind('ELECTION COMMISSION OF INDIA IDENTITY CARD Elector Name LALEET');
    ok(!!kindV && kindV.kind === 'Voter ID card', 'voter ID is still recognised');
  } catch (e) {
    lines.push('FAIL  test stopped: ' + e.message);
  }
  alert('Reader v3 tests\n\n' + lines.join('\n'));
}

// Adds this suite to "Run ALL tests"
if (typeof AL_SUITES !== 'undefined') {
  AL_SUITES.push(['Reader v3 (athlete ID, property, mother)', 'rdSelfTest']);
}
