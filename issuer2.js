/* ===== issuer2.js: smarter issuer reader. Load after issuer.js. Replaces ssIssuer. ===== */
'use strict';

// Known issuers. Left: how it appears in text. Right: the name stored.
const SS2_ALIASES = {
  'TATA AIG': 'TATA AIG General Insurance Company Limited',
  'ICICI Lombard': 'ICICI Lombard General Insurance Company Limited',
  'HDFC ERGO': 'HDFC ERGO General Insurance Company Limited',
  'Bajaj Allianz': 'Bajaj Allianz General Insurance Company Limited',
  'New India Assurance': 'New India Assurance Company Limited',
  'National Insurance': 'National Insurance Company Limited',
  'United India Insurance': 'United India Insurance Company Limited',
  'Oriental Insurance': 'Oriental Insurance Company Limited',
  'SBI General': 'SBI General Insurance Company Limited',
  'Digit Insurance': 'Go Digit General Insurance Limited',
  'Acko': 'Acko General Insurance Limited',
  'Reliance General': 'Reliance General Insurance Company Limited',
  'Care Health': 'Care Health Insurance Limited',
  'Star Health': 'Star Health and Allied Insurance Company Limited',
  'Niva Bupa': 'Niva Bupa Health Insurance Company Limited',
  'HDFC Life': 'HDFC Life Insurance Company Limited',
  'SBI Life': 'SBI Life Insurance Company Limited',
  'ICICI Prudential': 'ICICI Prudential Life Insurance Company Limited',
  'Max Life': 'Max Life Insurance Company Limited',
  'LIC': 'Life Insurance Corporation of India',
  'Life Insurance Corporation': 'Life Insurance Corporation of India',
  'Central Board of Secondary Education': 'Central Board of Secondary Education',
  'CBSE': 'Central Board of Secondary Education',
  'CISCE': 'Council for the Indian School Certificate Examinations',
  'ICSE': 'Council for the Indian School Certificate Examinations',
  'Election Commission of India': 'Election Commission of India',
  'Unique Identification Authority of India': 'Unique Identification Authority of India',
  'Income Tax Department': 'Income Tax Department, Government of India',
  'Passport Seva': 'Ministry of External Affairs, Passport Seva',
  'Regional Passport Office': 'Regional Passport Office',
  'Regional Transport Office': 'Regional Transport Office'
};

// Words that can never be part of an issuer name
const SS2_HARD_BAD = /regulat|chapter|section|clause|allied\s+matters|policyholders?|irdai?\b|customer|support|helpline|registered\s+office|website|e-?mail|grievance|ombudsman|insured|holder|\bvalid|dated|premium|receipt|schedule|wording|\bterms?\b|\bpage\b|\bnote\b|\bact\b|\brules?\b/i;
// Words that cannot start or end an issuer name
const SS2_EDGE_BAD = /^(of|and|for|with|from|under|by|to|in|on|at|a|an|no|name|issue|date|sign|signature|authori[sz]ed|this|that|is|was)\b|\b(of|and|for|with|from|to|in|on|at|a|an|by)$/i;
const SS2_KW = ['Board', 'University', 'Council', 'Institute', 'Academy', 'College', 'Commission',
  'Corporation', 'Municipality', 'Hospital', 'Bank', 'Authority', 'Department'];

// Trims a raw match to a clean name, stopping at the next field
function ss2Clean(raw) {
  return String(raw || '')
    .split(/[\n\r|()\[\]{}]|\s{2,}|\s+(?:for|on|has|with|dated|at|from|policy|schedule|certificate|registration|regn|roll|date|no|number|valid|issued|issue|marks|statement|receipt)\b|\d/i)[0]
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/i, '')
    .replace(/[^A-Za-z&.\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[,.\-:]+$/, '')
    .trim()
    .slice(0, 70);
}
function ss2Valid(s) {
  if (!s || s.length < 5) return false;
  if (SS2_HARD_BAD.test(s) || SS2_EDGE_BAD.test(s)) return false;
  return s.replace(/[^A-Za-z]/g, '').length >= 5;
}
// Drops leading lower-case words when the name is printed in capitals, e.g. "Mumbai. TATA AIG..." becomes "TATA AIG..."
function ss2TrimCaps(name) {
  const w = name.split(/\s+/);
  if (!w.some(x => /^[A-Z&]{2,}\.?$/.test(x))) return name;
  while (w.length > 1 && !/^[A-Z&]{2,}\.?$/.test(w[0])) w.shift();
  return w.join(' ');
}

// Collects every possible issuer with a confidence score
function ss2Find(T) {
  const found = [];
  const add = (value, idx, score, len, known) => {
    if (!value) return;
    if (!known && !ss2Valid(value)) return;
    if (score < 90 && /regulat|chapter|section|under\s+the|allied\s+matters/i.test(T.slice(Math.max(0, idx - 60), idx))) return;
    found.push({
      value, score, idx,
      snippet: T.slice(Math.max(0, idx - 15), idx + len + 15).trim().slice(0, 100)
    });
  };

  // 1. Full legal name of an insurer, e.g. "TATA AIG GENERAL INSURANCE COMPANY LIMITED"
  const FULL = /((?:[A-Za-z&.]+\s+){0,5}?(?:General\s+|Life\s+|Health\s+)?(?:Insurance|Assurance)(?:\s+(?:Company|Co\.?))(?:\s+(?:Limited|Ltd\.?))?|(?:[A-Za-z&.]+\s+){0,5}?(?:General\s+|Life\s+|Health\s+)?(?:Insurance|Assurance)\s+(?:Limited|Ltd\.?))/gi;
  for (const m of T.matchAll(FULL)) {
    const v = ss2Clean(ss2TrimCaps(m[1]));
    if (!/^[A-Z&]/.test(v) || v.split(' ').length < 3) continue;
    add(v, m.index, 95, m[1].length);
  }

  // 2. Labelled issuer, e.g. "Issued by : X", "Insurer : X", "Conducted by X"
  const LAB = /\b(?:issued\s+by|issuing\s+authority|insurer|insurance\s+company|insurance\s+provider|provider|awarded\s+by|conducted\s+by|presented\s+by|offered\s+by|registering\s+authority|registered\s+by|issuer)\b\s*[:\-]?\s*([A-Za-z][A-Za-z&.,()'\- ]{3,70})/gi;
  for (const m of T.matchAll(LAB)) add(ss2Clean(m[1]), m.index, 85, m[0].length);

  // 3. Licensing authority with its place, e.g. "Licencing Authority BENGALURU(S)"
  const LIC = /licen[cs]ing\s+authority\s*[,:\-]?\s*([A-Za-z][A-Za-z ]{2,25})/gi;
  for (const m of T.matchAll(LIC)) {
    const place = ss2Clean(m[1]);
    if (place) add('Licensing Authority, ' + place, m.index, 85, m[0].length);
  }

  // 4. Boards, universities, municipal bodies, colleges and similar
  const INST = new RegExp(
    '((?:[A-Z][A-Za-z&.]*\\s+){0,5}(?:' + SS2_KW.map(k => k + '|' + k.toUpperCase()).join('|') +
    ')(?:\\s+(?:of|OF)\\s+[A-Za-z]+(?:\\s+[A-Za-z]+)?)?)', 'g');
  for (const m of T.matchAll(INST)) add(ss2Clean(m[1]), m.index, 60, m[1].length);

  // 5. Known names from the list above
  for (const [k, canon] of Object.entries(SS2_ALIASES)) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const re = new RegExp('(?<![A-Za-z])' + esc + '(?![A-Za-z])', k === 'LIC' ? 'g' : 'gi');
    for (const m of T.matchAll(re)) add(canon, m.index, 80, m[0].length, true);
  }
  return found;
}

// Removes a shorter candidate when a longer one with an equal or higher score contains it
function ss2Pick(found) {
  const low = s => s.toLowerCase();
  const kept = found.filter(c => !found.some(d =>
    d !== c && low(d.value).includes(low(c.value)) && d.value.length > c.value.length && d.score >= c.score));
  kept.sort((a, b) => b.score - a.score || b.value.length - a.value.length || a.idx - b.idx);
  return kept[0] || null;
}

// Replaces the issuer reader from issuer.js
function ssIssuer(text) {
  const T = String(text || '').replace(/\s+/g, ' ');
  const best = ss2Pick(ss2Find(T));
  return best ? { value: best.value, snippet: best.snippet } : null;
}

/* ---------- tests ---------- */
const SS2_TESTS = [
  { name: 'Car insurance (footer)', expect: 'TATA AIG GENERAL INSURANCE COMPANY LIMITED',
    text: 'Auto Secure - Private Car Package Policy Registered office : Peninsula Business Park, Tower A, Mumbai. TATA AIG GENERAL INSURANCE COMPANY LIMITED Regulations, 2024' },
  { name: 'Regulation wording only', expect: null,
    text: 'Chapter 7 of the IRDAI (Protection of Policyholders Interests, Operations and Allied Matters of Insurers) Regulations, 2024. Auto Secure - Private Car Package Policy' },
  { name: 'Marksheet', expect: 'Central Board of Secondary Education',
    text: 'CENTRAL BOARD OF SECONDARY EDUCATION MARKS SHEET Roll No 123456 Name RAHUL' },
  { name: 'Birth certificate', expect: 'Municipal Corporation of Bengaluru',
    text: 'BIRTH CERTIFICATE issued by Municipal Corporation of Bengaluru Registration No 4567 dated 12/03/2001' },
  { name: 'Certificate', expect: 'Tech Institute Bangalore',
    text: 'This is to certify that Priya Sharma has completed the course conducted by Tech Institute Bangalore for the purpose of training' },
  { name: 'Driving licence', expect: 'Licensing Authority, BENGALURU',
    text: 'Sign. Licencing Authority BENGALURU(S) CDOI : 23-08-2024' },
  { name: 'Voter ID', expect: 'Election Commission of India',
    text: 'ELECTION COMMISSION OF INDIA IDENTITY CARD Elector Name LALEET' },
  { name: 'College ID', expect: 'GOVERNMENT MODEL COLLEGE OF SCIENCE RAIPUR',
    text: 'GOVERNMENT MODEL COLLEGE OF SCIENCE RAIPUR IDENTITY CARD S. No. Name LALIT KUMAR SRIVASTAVA' }
];

function ss2SelfTest() {
  const lines = SS2_TESTS.map(t => {
    const s = ssIssuer(t.text);
    const got = s ? s.value : null;
    const ok = got === t.expect;
    return (ok ? 'PASS  ' : 'FAIL  ') + t.name + ': ' + (got || 'nothing found') +
      (ok ? '' : '  (expected ' + (t.expect || 'nothing') + ')');
  });
  alert('Issuer tests v2\n\n' + lines.join('\n'));
}
(function ss2Button() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('ss2-test')) return;
  const b = document.createElement('button');
  b.id = 'ss2-test';
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Run issuer tests (v2)';
  b.onclick = ss2SelfTest;
  bk.appendChild(b);
})();
