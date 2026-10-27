/* ===== learn.js PART 1 of 2. Create the file with this part. Learns label wording from corrections and typed values. ===== */
'use strict';

const LN_FIELDS = ['number', 'issue', 'expiry', 'issuer'];   // form fields the agent learns from
const LN_MAX_WORDS = 4;
let LN_DATA = { labels: {} };    // { 'membership reference': { number: { good: 1, bad: 0 } } }
let LN_ACTIVE = [];              // phrases currently added to the agent
let LN_LAST = { text: '', sugg: [] };   // the text and suggestions of the form on screen

/* ---------- storage: encrypted, kept in the vault ---------- */
async function lnSave() {
  if (!key) throw new Error('Vault is locked.');
  const s = await encrypt(key, enc.encode(JSON.stringify(LN_DATA)));
  await dbPut('meta', { id: 'learned', iv: s.iv, data: s.data });
}
async function lnLoad() {
  if (!key) return;
  const r = await dbGet('meta', 'learned');
  LN_DATA = r
    ? JSON.parse(dec.decode(await decrypt(key, r.iv, r.data)))
    : { labels: {} };
  if (!LN_DATA.labels) LN_DATA.labels = {};
  lnActivate();
}
async function lnReset() {
  LN_DATA = { labels: {} };
  lnActivate();
  await lnSave();
}

/* ---------- the label printed just before a value ---------- */
// Takes the words after the last ":" or "|" (or the words just before the value when there is none)
function lnLabelFromPrefix(prefix) {
  const parts = String(prefix || '').split(/[:|]/);
  let seg = parts[parts.length - 1];
  if (!seg.trim() && parts.length > 1) seg = parts[parts.length - 2];
  const words = agNorm(seg).split(' ').filter(Boolean).slice(-LN_MAX_WORDS);
  while (words.length && /\d/.test(words[0])) words.shift();
  if (!words.length || words.some(w => /\d/.test(w))) return '';
  const label = words.join(' ');
  if (label.length < 4 || !/[a-z]{2}/.test(label)) return '';
  return label;
}

// Finds the label printed next to a value in the scanned text
function lnFindLabel(field, value) {
  const lines = String(LN_LAST.text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const want = String(value).toUpperCase();
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let cut = -1;
    if (field === 'number' || field === 'issuer') {
      const i = line.toUpperCase().indexOf(want);
      if (i >= 0) cut = i;
    } else {
      for (const h of smDates(line)) {
        if (smIso(h.p, field === 'expiry') === value) { cut = h.idx; break; }
      }
    }
    if (cut < 0) continue;
    const lab = lnLabelFromPrefix(line.slice(0, cut)) || (li > 0 ? lnLabelFromPrefix(lines[li - 1]) : '');
    if (lab) return lab;
  }
  return '';
}

/* ---------- recording evidence ---------- */
function lnBump(label, field, kind) {
  if (!label || !field) return;
  const e = (LN_DATA.labels[label] = LN_DATA.labels[label] || {});
  const c = (e[field] = e[field] || { good: 0, bad: 0 });
  c[kind] += 1;
}

// Turns evidence into active phrases: a label is used for a field only when it has more good than bad
function lnActivate() {
  for (const p of LN_ACTIVE) {
    const i = AG_PHRASES.indexOf(p);
    if (i >= 0) AG_PHRASES.splice(i, 1);
  }
  LN_ACTIVE = [];
  for (const [label, fields] of Object.entries(LN_DATA.labels || {})) {
    let best = null;
    for (const [field, c] of Object.entries(fields)) {
      const score = c.good - c.bad;
      if (c.good >= 1 && score > 0 && (!best || score > best.score)) best = { field, score };
    }
    if (!best) continue;
    const phrase = {
      field: best.field, text: label,
      words: label.split(' ').filter(Boolean), strict: false, learned: true
    };
    AG_PHRASES.push(phrase);
    LN_ACTIVE.push(phrase);
  }
}

// The label the agent used for a suggestion, read from its note, e.g. Agent 90% · "Policy No" (same line)
function lnLabelOf(note) {
  const m = /"([^"]+)"/.exec(String(note || ''));
  return m ? agNorm(m[1]) : '';
}

// Compares the saved document with the suggestions shown, and with the text the values came from
async function lnLearnFromSave(doc, persist) {
  let changed = false;

  // 1. Suggestions the user approved, edited, moved or rejected
  for (const s of LN_LAST.sugg) {
    const f = s.targets[0];
    if (s.targets.length !== 1 || !LN_FIELDS.includes(f) || !s.label) continue;
    const got = doc[f] || '';
    if (got === s.value) { lnBump(s.label, f, 'good'); changed = true; continue; }
    const moved = LN_FIELDS.find(g => g !== f && doc[g] === s.value);
    if (moved) lnBump(s.label, moved, 'good');
    lnBump(s.label, f, 'bad');
    changed = true;
  }

  // 2. Values the agent did not suggest, typed or fixed by hand
  for (const f of LN_FIELDS) {
    const v = doc[f];
    if (!v) continue;
    if (LN_LAST.sugg.some(s => s.targets[0] === f && s.value === v)) continue;
    const lab = lnFindLabel(f, String(v));
    if (lab) { lnBump(lab, f, 'good'); changed = true; }
  }

  if (changed) {
    lnActivate();
    if (persist !== false) await lnSave();
  }
  return changed;
    }
