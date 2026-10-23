/* ===== issuer.js PART 1 of 3. Create the file with this part. Finds who issued a document. ===== */
'use strict';

VU_LBL.issuer = 'Issuer / provider';

// Well-known issuers, matched wherever they appear in the text
const SS_KNOWN = [
  'TATA AIG', 'ICICI Lombard', 'HDFC ERGO', 'Bajaj Allianz', 'New India Assurance',
  'National Insurance', 'United India Insurance', 'Oriental Insurance', 'SBI General',
  'Digit Insurance', 'Acko', 'Reliance General', 'Care Health', 'Star Health', 'Niva Bupa',
  'HDFC Life', 'SBI Life', 'ICICI Prudential', 'Max Life', 'Life Insurance Corporation', 'LIC',
  'Central Board of Secondary Education', 'CBSE', 'CISCE', 'ICSE',
  'Election Commission of India', 'Unique Identification Authority of India',
  'Income Tax Department', 'Ministry of External Affairs', 'Passport Seva',
  'Regional Passport Office', 'Transport Department', 'Regional Transport Office'
];

// Cleans a candidate issuer and cuts it where the next field starts
function ssClean(v) {
  return String(v || '')
    .split(/[\n\r\d|]|\s+(?:for|on|has|with|dated|at|from|to|no|number|registration|date|identity|card|certificate|marks|statement|receipt|bill|invoice|policy|schedule)\b/i)[0]
    .replace(/[^A-Za-z&.,()'\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[,.\-:]+$/, '')
    .trim()
    .slice(0, 60);
}

// Returns { value, snippet } for the most likely issuer, or null
function ssIssuer(text) {
  const T = String(text || '').replace(/\s+/g, ' ');
  const at = i => T.slice(Math.max(0, i - 20), i + 80).trim().slice(0, 110);
  const pick = (raw, i) => {
    const v = ssClean(raw);
    return v.length >= 5 ? { value: v, snippet: at(i) } : null;
  };

  // Licensing authority with its place, e.g. "Licencing Authority BENGALURU(S)"
  const lic = /licen[cs]ing\s+authority\s+([A-Za-z][A-Za-z ]{2,25})/i.exec(T);
  if (lic) {
    const place = ssClean(lic[1]);
    return { value: 'Licensing Authority' + (place ? ', ' + place : ''), snippet: at(lic.index) };
  }

  // Labelled values: "Issued by : X", "Insurer : X", "Conducted by X"
  const lab = /(?:issued\s+by|issuing\s+authority|issuer|insurer|insurance\s+company|provider|institution|awarded\s+by|conducted\s+by|presented\s+by|offered\s+by|registering\s+authority|registered\s+by)\s*[:\-]?\s*([A-Za-z][A-Za-z&.,()'\- ]{3,70})/i.exec(T);
  if (lab) {
    const r = pick(lab[1], lab.index);
    if (r) return r;
  }

  // Full insurer name, e.g. "TATA AIG GENERAL INSURANCE COMPANY LIMITED"
  const co = /((?:[A-Z][A-Za-z&.]*\s+){1,4}(?:GENERAL\s+|LIFE\s+|HEALTH\s+|General\s+|Life\s+|Health\s+)?(?:Insurance|INSURANCE|Assurance|ASSURANCE)\s+(?:Co\.?|CO\.?|Company|COMPANY)(?:\s+(?:Ltd\.?|LTD\.?|Limited|LIMITED))?)/.exec(T);
  if (co) {
    const r = pick(co[1], co.index);
    if (r) return r;
  }

  // Known issuers
  for (const k of SS_KNOWN) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const m = new RegExp('\\b' + esc + '\\b', 'i').exec(T);
    if (m) return { value: k, snippet: at(m.index) };
  }

  // Boards, universities, councils, institutes, municipal bodies, banks, hospitals
  const bd = /((?:[A-Z][A-Za-z&.]*\s+){0,5}(?:Board|BOARD|University|UNIVERSITY|Council|COUNCIL|Institute|INSTITUTE|Academy|ACADEMY|College|COLLEGE|Commission|COMMISSION|Authority|AUTHORITY|Corporation|CORPORATION|Municipality|MUNICIPALITY|Hospital|HOSPITAL|Bank|BANK)(?:\s+(?:of|OF)\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,2})?)/.exec(T);
  if (bd) {
    const r = pick(bd[1], bd.index);
    if (r) return r;
  }

  return null;
}

// Adds an issuer suggestion to the normal suggestions for each document
const ssBaseBuild = buildSuggestions;
buildSuggestions = function (text) {
  const out = ssBaseBuild(text);
  const iss = ssIssuer(text);
  if (iss && !out.some(s => s.targets.includes('issuer'))) {
    out.push({ targets: ['issuer'], value: iss.value, snippet: iss.snippet, note: 'Issuer or provider' });
  }
  return out;
};

// Shows the issuer on the detail screen
const ssBaseDocInfo = vuDocInfo;
vuDocInfo = function (d, map) {
  const el = ssBaseDocInfo(d, map);
  el.append(
    vuEl('dt', { text: 'Issuer / provider' }),
    vuEl('dd', { text: d.issuer || 'Not set. Use Suggest issuers on the dashboard.' })
  );
  return el;
};
