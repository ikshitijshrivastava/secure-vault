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
/* ===== learn.js PART 2 of 2. Append to the end. Connects learning to the form, loads it on unlock, screen, tests. ===== */

// Remember the suggestions and text of the form currently on screen
const lnBaseBuild = buildSuggestions;
buildSuggestions = function (text) {
  const out = lnBaseBuild(text);
  LN_LAST = {
    text: String(text || ''),
    sugg: out
      .filter(s => /Agent \d+%/.test(s.note || ''))
      .map(s => ({ ...s, label: lnLabelOf(s.note) }))
      .filter(s => s.label)
  };
  return out;
};

// Learn when a document is saved from the form
const lnBaseV2Put = v2Put;
v2Put = async function (store, obj) {
  const result = await lnBaseV2Put(store, obj);
  if (store === 'docs' && obj && LN_LAST.text) {
    try { await lnLearnFromSave(obj, true); } catch (e) { /* learning never blocks a save */ }
    LN_LAST = { text: '', sugg: [] };
  }
  return result;
};

// Leaving the form forgets the form's text, so nothing is learned from the wrong document
const lnBaseGo = vuGo;
vuGo = async function (tab, arg) {
  if (tab !== 'form') LN_LAST = { text: '', sugg: [] };
  return lnBaseGo(tab, arg);
};

// Load what has been learned as soon as the vault unlocks
const lnBaseEnter = enterApp;
enterApp = function () {
  lnLoad().catch(() => {});
  lnBaseEnter();
};

/* ---------- learned wording: show and reset ---------- */
function lnDescribe() {
  const rows = [];
  for (const [label, fields] of Object.entries(LN_DATA.labels || {})) {
    for (const [field, c] of Object.entries(fields)) {
      const active = c.good >= 1 && c.good - c.bad > 0;
      rows.push((active ? 'USED  ' : 'off   ') + '"' + label + '" -> ' + field +
        '  (good ' + c.good + ', bad ' + c.bad + ')');
    }
  }
  return rows;
}
function lnScreen() {
  const rows = lnDescribe();
  alert('Learned wording\n\n' + (rows.length
    ? rows.join('\n') + '\n\nUSED entries are applied to new documents. Reset to clear everything.'
    : 'Nothing learned yet. Correct a suggestion, or type a value the agent missed, and save the document.'));
}
async function lnResetUI() {
  if (!confirm('Forget everything learned from your corrections?')) return;
  try { await lnReset(); alert('Learned wording cleared.'); }
  catch (e) { alert('Reset failed: ' + e.message); }
}

(function lnButtons() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('ln-show')) return;
  const show = document.createElement('button');
  show.id = 'ln-show';
  show.type = 'button';
  show.className = 'ghost';
  show.textContent = 'Learned wording';
  show.onclick = lnScreen;
  const reset = document.createElement('button');
  reset.id = 'ln-reset';
  reset.type = 'button';
  reset.className = 'ghost';
  reset.textContent = 'Reset learned wording';
  reset.onclick = lnResetUI;
  bk.append(show, reset);
})();

/* ---------- tests: change nothing permanent ---------- */
async function lnSelfTest() {
  const lines = [];
  const ok = (c, m) => lines.push((c ? 'PASS  ' : 'FAIL  ') + m);
  const savedData = JSON.parse(JSON.stringify(LN_DATA));
  const savedLast = LN_LAST;
  try {
    if (!key) throw new Error('unlock the vault first');

    ok(lnLabelFromPrefix('Membership Reference : ') === 'membership reference',
      'a label is read from the text before a colon');
    ok(lnLabelFromPrefix('Policy Number ') === 'policy number',
      'a label with no colon is read from the words before the value');
    ok(lnLabelFromPrefix('1234 ') === '', 'a bare number is not taken as a label');

    LN_LAST = { text: 'Membership Reference : REF-88-2291\nValid till 03.07.2030', sugg: [] };
    ok(lnFindLabel('number', 'REF-88-2291') === 'membership reference',
      'a typed number is linked to the label printed before it');
    ok(lnFindLabel('expiry', '2030-07-03') === 'valid till',
      'a typed expiry date is linked to its printed label');

    // Learning: after one good example, the agent reads the new label
    LN_DATA = { labels: {} };
    lnBump('membership reference', 'number', 'good');
    lnActivate();
    const got = agBuild('Membership Reference : REF-88-2291').find(s => s.targets[0] === 'number');
    ok(!!got && got.value === 'REF-88-2291', 'after learning, the agent reads "Membership Reference" as the number');

    // A correction moves a value to another field and counts against the old one
    LN_DATA = { labels: {} };
    LN_LAST = {
      text: 'Holder code : ZX-902',
      sugg: [{ targets: ['number'], value: 'ZX-902', label: 'holder code', snippet: '', note: '' }]
    };
    await lnLearnFromSave({ number: '', expiry: 'ZX-902' }, false);
    const row = LN_DATA.labels['holder code'] || {};
    ok(!!row.expiry && row.expiry.good === 1, 'a value moved to another field teaches the new field');
    ok(!!row.number && row.number.bad === 1, 'the rejected field is counted as a bad example');

    // Enough rejections switches a learned label off
    LN_DATA = { labels: { 'membership reference': { number: { good: 1, bad: 3 } } } };
    lnActivate();
    ok(!AG_PHRASES.some(p => p.learned && p.text === 'membership reference'),
      'a label rejected more often than it was right is not used');
  } catch (e) {
    lines.push('FAIL  test stopped: ' + e.message);
  } finally {
    LN_DATA = savedData;
    LN_LAST = savedLast;
    lnActivate();
  }
  alert('Learning tests\n\n' + lines.join('\n'));
}

(function lnTestButton() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('ln-test')) return;
  const b = document.createElement('button');
  b.id = 'ln-test';
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Run learning tests';
  b.onclick = lnSelfTest;
  bk.appendChild(b);
})();
