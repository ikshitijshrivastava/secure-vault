/* ===== agent-test.js. Load LAST. Replaces the old agent test button and reports which engine is running. ===== */
'use strict';

const AT_BUILD = 'build 7';

const AT_CASES = [
  { name: '1. "Holder\'s full name" and "Valid up to"',
    text: "Holder's full name: Ananya Rao\nDate of Birth: 04-07-1990\nValid up to: 03.07.2030\nPolicy Number: AB/2291/77",
    read: { holder: 'Ananya Rao', expiry: '2030-07-03', number: 'AB/2291/77', dob: '1990-07-04' },
    sug: { notes: 'Date of birth: 04/07/1990' }, absent: [] },
  { name: '2. Name on the line below its label',
    text: 'Name of the Insured\nSHRI RAJESH KUMAR\nDate of Issue : 14th March 2024',
    read: { holder: 'Rajesh Kumar', issue: '2024-03-14' }, sug: {}, absent: [] },
  { name: '3. Table layout with bars',
    text: 'Policy No | 0157681764 09 00\nValid From | 30/10/2026\nValid Till | 29/10/2027',
    read: { number: '0157681764 09 00', issue: '2026-10-30', expiry: '2027-10-29' }, sug: {}, absent: [] },
  { name: '4. Marksheet with board, roll number and year',
    text: 'Board : Maharashtra State Board\nRoll No : MH4451234\nStudent Name : Priya Patil\nYear of Passing : March 2019',
    read: { issuer: 'Maharashtra State Board', number: 'MH4451234', holder: 'Priya Patil', issue: '2019-03-01' },
    sug: {}, absent: [] },
  { name: '5. Label with no colon, and other details',
    text: "Ananya's date of birth 04/07/1990 Blood group B+",
    read: { dob: '1990-07-04' }, sug: { notes: 'Date of birth: 04/07/1990' }, absent: [] },
  { name: '6. "Name of Institution" and a bare "Name" line',
    text: 'Name of Institution: GOVERNMENT MODEL COLLEGE OF SCIENCE RAIPUR\nIDENTITY CARD\nName LALIT KUMAR SRIVASTAVA',
    read: { issuer: 'GOVERNMENT MODEL COLLEGE OF SCIENCE RAIPUR', holder: 'Lalit Kumar Srivastava' },
    sug: {}, absent: [] },
  { name: '7. Legal wording must not become an issuer',
    text: 'Chapter 7 of the IRDAI (Protection of Policyholders Interests, Operations and Allied Matters of Insurers) Regulations, 2024.',
    read: {}, sug: {}, absent: ['issuer'] },
  { name: '8. Father/Husband name with a slash',
    text: 'Father/Husband Name : Harkishor Sharma\nDate of Birth : 11/08/1974',
    read: { father: 'Harkishor Sharma', dob: '1974-08-11' },
    sug: { notes: 'Father/Husband: Harkishor Sharma' }, absent: [] }
];

// Which engine is loaded: v2 needs agent-fix.js, which defines agExtract
function atEngine() {
  if (typeof agExtract !== 'function' || typeof agBest !== 'function') return 'v1';
  return /agExtract/.test(String(agBuild)) ? 'v2' : 'v1';
}

function atRun() {
  const engine = atEngine();
  if (engine !== 'v2') {
    alert('Engine: v1 (agent-fix.js is not loaded)\n\n' +
      'Check that agent-fix.js exists in the repository, and that index.html lists it as ' +
      'agent-fix.js?v=7 before agent-test.js. Then close the app, reopen it online, and run again.');
    return;
  }
  const lines = ['Engine: v2 (' + AT_BUILD + ')', ''];
  for (const t of AT_CASES) {
    const extracted = agExtract(t.text);
    const suggestions = agBuild(t.text);
    const pick = f => suggestions.find(s => s.targets.length === 1 && s.targets[0] === f);
    lines.push('-- ' + t.name);
    for (const [f, want] of Object.entries(t.read)) {
      const b = agBest(extracted, f);
      const ok = !!b && b.value === want;
      lines.push((ok ? 'PASS  ' : 'FAIL  ') + 'read ' + f + ': ' + (b ? b.value : 'nothing found') +
        (ok ? '' : '  (expected ' + want + ')'));
    }
    for (const [f, want] of Object.entries(t.sug)) {
      const s = pick(f);
      const ok = !!s && (f === 'notes' ? s.value.includes(want) : s.value === want);
      lines.push((ok ? 'PASS  ' : 'FAIL  ') + 'suggest ' + f + ': ' + (s ? s.value.split('\n')[0] : 'nothing') +
        (ok ? '' : '  (expected ' + want + ')'));
    }
    for (const f of t.absent) {
      const s = pick(f);
      lines.push((s ? 'FAIL  ' : 'PASS  ') + 'no ' + f + (s ? ' (got ' + s.value + ')' : ''));
    }
  }
  alert('Agent tests v2\n\n' + lines.join('\n'));
}

// Replace the old v1 button with the v2 button, so there is only one
(function atWire() {
  const bk = document.querySelector('.backup');
  if (!bk) return;
  const old = document.getElementById('ag-test');
  if (old) old.remove();
  if (document.getElementById('at-test')) return;
  const b = document.createElement('button');
  b.id = 'at-test';
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Run agent tests (v2)';
  b.onclick = atRun;
  bk.appendChild(b);
})();
