/* ===== alltests.js. Replaces the earlier runner. Waits for each suite's result, so no suite shows NO RESULT. Load LAST. ===== */
'use strict';

const AL_SUITES = [
  ['Vault and profiles (v2)', 'v2SelfTest'],
  ['Reader screens: voter and college', 'vuSelfTest'],
  ['Smart reader', 'smSelfTest'],
  ['Picker (licence, car insurance)', 'pkSelfTest'],
  ['Issuers (v2)', 'ss2SelfTest'],
  ['Backup and restore', 'bkSelfTest'],
  ['Profile cards', 'pcSelfTest'],
  ['Search and sort', 'navSelfTest'],
  ['Passwords', 'pwSelfTest'],
  ['Learning', 'lnSelfTest'],
  ['Agent (v2)', 'atRun']
];

// Runs one suite and returns its report text, captured from its alert
async function alRunSuite(fn) {
  const real = window.alert;
  const seen = [];
  window.alert = msg => seen.push(String(msg));
  try {
    const r = fn();
    if (r && typeof r.then === 'function') await r;
  } finally {
    window.alert = real;
  }
  return seen.join('\n');
}

// PASS and FAIL lines in a report. Lines with no PASS or FAIL are not counted.
function alCount(text) {
  let pass = 0, fail = 0;
  const failLines = [];
  for (const line of String(text).split('\n')) {
    if (/^PASS\b/.test(line)) pass++;
    else if (/^(FAIL|ERROR)\b/.test(line)) { fail++; failLines.push(line.trim()); }
  }
  return { pass, fail, failLines };
}

async function alRunAll() {
  if (!key) return alert('Unlock the vault first, then run all tests.');
  const rows = [];
  for (const [label, fnName] of AL_SUITES) {
    const fn = window[fnName];
    if (typeof fn !== 'function') {
      rows.push({ label, status: 'MISSING', pass: 0, fail: 1,
        failLines: ['FAIL  ' + fnName + ' is not loaded.'] });
      continue;
    }
    let text = '';
    try {
      text = await alRunSuite(fn);
    } catch (e) {
      text = 'FAIL  stopped: ' + e.message;
    }
    const c = alCount(text);
    const status = c.fail ? 'FAIL' : (c.pass ? 'PASS' : 'NO RESULT');
    rows.push({ label, status, ...c });
  }
  if (typeof vuClose === 'function') vuClose();

  const pass = rows.reduce((n, r) => n + r.pass, 0);
  const fail = rows.reduce((n, r) => n + r.fail, 0);
  const lines = [(fail ? 'Some checks failed' : 'All checks passed') + ': ' + pass + ' PASS, ' + fail + ' FAIL', ''];
  for (const r of rows) {
    lines.push(r.status.padEnd(10) + r.label + '  (' + r.pass + ' pass, ' + r.fail + ' fail)');
  }
  const failures = rows.flatMap(r => r.failLines.map(l => r.label + ': ' + l));
  if (failures.length) {
    lines.push('', 'Failures:', ...failures.slice(0, 40));
  }
  window.alert('Full test run\n\n' + lines.join('\n'));
}

(function alWire() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('al-run')) return;
  const b = document.createElement('button');
  b.id = 'al-run';
  b.type = 'button';
  b.textContent = 'Run ALL tests';
  b.onclick = alRunAll;
  const summary = bk.querySelector('summary');
  if (summary) summary.after(b);
  else bk.prepend(b);
})();
