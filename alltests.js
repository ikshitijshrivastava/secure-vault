/* ===== alltests.js. Create this file. Adds one button that runs every test suite and reports one summary. Load LAST. ===== */
'use strict';

// Each suite is named by its function, which is looked up when the test runs.
// A suite that is not loaded is reported as MISSING rather than breaking the run.
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

// Counts PASS and FAIL lines in a test report
function alCount(text) {
  let pass = 0, fail = 0;
  const failLines = [];
  for (const line of String(text).split('\n')) {
    if (/^PASS\b/.test(line)) pass++;
    else if (/^(FAIL|ERROR)\b/.test(line)) { fail++; failLines.push(line.trim()); }
  }
  return { pass, fail, failLines };
}

// Runs every suite in turn. Each suite's own alert is captured, then one summary is shown.
async function alRunAll() {
  if (!key) return alert('Unlock the vault first, then run all tests.');
  const realAlert = window.alert;
  const captured = {};
  let current = null;
  window.alert = msg => {
    if (current) (captured[current] = captured[current] || []).push(String(msg));
  };
  const rows = [];
  try {
    for (const [label, fnName] of AL_SUITES) {
      current = label;
      const fn = window[fnName];
      if (typeof fn !== 'function') {
        rows.push({ label, status: 'MISSING', pass: 0, fail: 1,
          failLines: ['FAIL  ' + fnName + ' is not loaded. Check index.html.'] });
        continue;
      }
      try {
        await fn();
      } catch (e) {
        (captured[label] = captured[label] || []).push('FAIL  stopped: ' + e.message);
      }
      const c = alCount((captured[label] || []).join('\n'));
      const status = c.fail ? 'FAIL' : (c.pass ? 'PASS' : 'NO RESULT');
      rows.push({ label, status, ...c });
    }
  } finally {
    current = null;
    window.alert = realAlert;
  }

  // Return to the normal vault screen once all suites have finished
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
    if (failures.length > 40) lines.push('...and ' + (failures.length - 40) + ' more');
  }
  realAlert('Full test run\n\n' + lines.join('\n'));
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
