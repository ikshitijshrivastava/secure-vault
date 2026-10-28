/* ===== agent-fix.js. Create this file. Load it after learn.js. Separates extraction from display, so names always reach the title. ===== */
'use strict';

// Pulls every candidate value out of the text, keyed by field
function agExtract(text) {
  const docLines = agDoc(text);
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
        const v = pkVehicleFromSquashed(take.raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20));
        put('vehicle', v, base, why, snippet);
      } else if (f === 'issuer') {
        put('issuer', agIssuer(take.raw), base, why, snippet);
      } else {
        put(f, take.raw.slice(0, f === 'address' ? 120 : 80).trim(), base - 0.1, why, snippet);
      }
    }
  });
  return got;
}

// Highest-confidence candidate for a field, or null
function agBest(got, f) {
  return (got[f] || []).slice().sort((a, b) => b.conf - a.conf)[0] || null;
}

// Builds the suggestions shown on the form
agBuild = function (text) {
  const T = String(text || '');
  const got = agExtract(T);
  const best = f => agBest(got, f);
  const kind = smKind(smClean(T));
  PK_LAST = kind ? kind.kind : null;

  // Vehicle number: from a labelled field first, then from the text for vehicle documents
  let veh = best('vehicle');
  if (!veh && kind && kind.vehicle) {
    const p = pkVehicle(T);
    if (p) veh = { value: p.value, conf: 0.6, why: 'vehicle number found in the text', snippet: '' };
  }
  const holder = best('holder');

  const out = [];
  const add = (targets, value, snippet, conf, why) => {
    if (!value) return;
    const pct = Math.round(Math.min(1, Math.max(0, conf)) * 100);
    out.push({ targets, value, snippet: snippet || '', note: 'Agent ' + pct + '% · ' + why });
  };

  // Title: document kind, then the owner.
  // Vehicle documents use the vehicle number; everything else uses the holder's name.
  // Documents with no recognised kind use the printed heading, or "Document".
  const kindName = kind ? kind.kind : (smHeading(smClean(T)) || 'Document');
  const isVehicle = !!(kind && kind.vehicle);
  const subject = isVehicle ? veh : holder;
  const subjectWhy = isVehicle ? 'vehicle number' : 'name';
  add(['title'], kindName + (subject ? ' - ' + subject.value : ''),
    subject ? subject.snippet : '',
    subject ? Math.min(0.95, subject.conf) : 0.5,
    subject ? kindName + ' with ' + subjectWhy : 'document kind, no ' + subjectWhy + ' found');

  add(['type'], kind ? kind.type : 'Other', '', 0.9, 'document kind');

  // Number: the labelled number, or the vehicle number for vehicle documents
  const numC = best('number') || (isVehicle ? veh : null);
  if (numC) add(['number'], numC.value, numC.snippet, numC.conf, numC.why);

  for (const f of ['issue', 'expiry']) {
    const c = best(f);
    if (c) add([f], c.value, c.snippet, c.conf, c.why);
  }

  const iss = best('issuer');
  if (iss) {
    add(['issuer'], iss.value, iss.snippet, iss.conf, iss.why);
  } else {
    const fb = typeof ssIssuer === 'function' ? ssIssuer(T) : null;
    if (fb) add(['issuer'], fb.value, fb.snippet, 0.5, 'pattern match, please check');
  }

  // Other details: name (when the title shows a vehicle), dates of birth, father, and the rest
  const lines = [];
  if (holder && subject !== holder) lines.push('Name: ' + holder.value);
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
};

/* ---------- tests: check the extracted values and the suggestions, on the same texts as before ---------- */
const AG2_CASES = [
  { name: '1. "Holder\'s full name" and "Valid up to"',
    text: "Holder's full name: Ananya Rao\nDate of Birth: 04-07-1990\nValid up to: 03.07.2030\nPolicy Number: AB/2291/77",
    fields: { holder: 'Ananya Rao', expiry: '2030-07-03', number: 'AB/2291/77', dob: '1990-07-04' },
    suggest: { title: 'Insurance policy - Ananya Rao', notes: 'Date of birth: 04/07/1990' }, absent: [] },
  { name: '2. Name on the line below its label',
    text: 'Name of the Insured\nSHRI RAJESH KUMAR\nDate of Issue : 14th March 2024',
    fields: { holder: 'Rajesh Kumar', issue: '2024-03-14' },
    suggest: { title: 'Document - Rajesh Kumar' }, absent: [] },
  { name: '3. Table layout with bars',
    text: 'Policy No | 0157681764 09 00\nValid From | 30/10/2026\nValid Till | 29/10/2027',
    fields: { number: '0157681764 09 00', issue: '2026-10-30', expiry: '2027-10-29' },
    suggest: {}, absent: [] },
  { name: '4. Marksheet with board, roll number and year',
    text: 'Board : Maharashtra State Board\nRoll No : MH4451234\nStudent Name : Priya Patil\nYear of Passing : March 2019',
    fields: { issuer: 'Maharashtra State Board', number: 'MH4451234', holder: 'Priya Patil', issue: '2019-03-01' },
    suggest: { title: 'Document - Priya Patil' }, absent: [] },
  { name: '5. Label with no colon, and other details',
    text: "Ananya's date of birth 04/07/1990 Blood group B+",
    fields: { dob: '1990-07-04' },
    suggest: { notes: 'Date of birth: 04/07/1990' }, absent: [] },
  { name: '6. "Name of Institution" and a bare "Name" line',
    text: 'Name of Institution: GOVERNMENT MODEL COLLEGE OF SCIENCE RAIPUR\nIDENTITY CARD\nName LALIT KUMAR SRIVASTAVA',
    fields: { issuer: 'GOVERNMENT MODEL COLLEGE OF SCIENCE RAIPUR', holder: 'Lalit Kumar Srivastava' },
    suggest: { title: 'College ID card - Lalit Kumar Srivastava' }, absent: [] },
  { name: '7. Legal wording must not become an issuer',
    text: 'Chapter 7 of the IRDAI (Protection of Policyholders Interests, Operations and Allied Matters of Insurers) Regulations, 2024.',
    fields: {}, suggest: {}, absent: ['issuer'] },
  { name: '8. Father/Husband name with a slash',
    text: 'Father/Husband Name : Harkishor Sharma\nDate of Birth : 11/08/1974',
    fields: { father: 'Harkishor Sharma', dob: '1974-08-11' },
    suggest: { notes: 'Father/Husband: Harkishor Sharma' }, absent: [] }
];

function agSelfTest() {
  const lines = [];
  for (const t of AG2_CASES) {
    const got = agExtract(t.text);
    const sug = agBuild(t.text);
    const pick = f => sug.find(s => s.targets.length === 1 && s.targets[0] === f);
    lines.push('-- ' + t.name);

    for (const [f, want] of Object.entries(t.fields || {})) {
      const b = agBest(got, f);
      const ok = !!b && b.value === want;
      lines.push((ok ? 'PASS  ' : 'FAIL  ') + 'read ' + f + ': ' + (b ? b.value : 'nothing found') +
        (ok ? '' : '  (expected ' + want + ')'));
    }
    for (const [f, want] of Object.entries(t.suggest || {})) {
      const s = pick(f);
      const ok = !!s && (f === 'notes' ? s.value.includes(want) : s.value === want);
      lines.push((ok ? 'PASS  ' : 'FAIL  ') + 'suggest ' + f + ': ' + (s ? s.value.split('\n')[0] : 'nothing') +
        (ok ? '' : '  (expected ' + want + ')'));
    }
    for (const f of t.absent || []) {
      const s = pick(f);
      lines.push((s ? 'FAIL  ' : 'PASS  ') + 'no ' + f + (s ? ' (got ' + s.value + ')' : ''));
    }
  }
  alert('Agent tests v2\n\n' + lines.join('\n'));
}

// Re-attach the Run agent tests button to the new test function
(function agRewire() {
  const b = document.getElementById('ag-test');
  if (b) b.onclick = () => agSelfTest();
})();
