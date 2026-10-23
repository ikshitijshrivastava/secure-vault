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
/* ===== issuer.js PART 2 of 3. Append to the end. Issuer review screen for existing documents, and tests. ===== */

// Reads every stored page of a document and returns the combined text
async function ssDocText(d) {
  let text = '';
  for (const pid of d.pageIds || []) {
    const p = await v2GetPage(pid);
    if (!p) continue;
    const file = new File([p.bytes], p.meta.name || 'page', { type: p.meta.mime || '' });
    const r = await readDocument(file);
    if (!r.error) text += '\n' + (r.text || '');
  }
  return text;
}

// Review screen: suggests an issuer for each document, which you can edit before saving
async function ssIssuerScreen(body) {
  const all = await vuLoadAll();
  const map = vuNameMap(all);

  body.append(vuEl('h2', { text: 'Issuer suggestions' }));
  body.append(vuEl('p', { cls: 'hint', text: 'Reads the stored pages of each document and suggests who issued it. Nothing changes until you tap Save issuers. Photos take about 30 seconds each.' }));
  const status = vuEl('p', { cls: 'hint' });
  const list = vuEl('ul', { style: 'list-style:none;padding:0;margin:0' });
  body.append(status, list);

  const rows = all.docs
    .slice()
    .sort((a, b) => (a.title || a.kind || '').localeCompare(b.title || b.kind || ''))
    .map(d => {
      const input = vuEl('input', { value: d.issuer || '', placeholder: 'Issuer name' });
      const note = vuEl('small', { text: d.issuer ? 'Issuer already saved' : 'Not set' });
      list.append(vuEl('li', { cls: 'card', style: 'border-left-color:' + (d.issuer ? '#2e7d32' : '#b26a00') }, [
        vuEl('strong', { text: d.title || d.kind }),
        vuEl('small', { text: vuOwnerLabel(map, vuOwnersOf(d)) + ' · ' + (d.kind || '') }),
        note,
        input
      ]));
      return { d, input, note };
    });

  if (!rows.length) list.append(vuEl('p', { cls: 'hint', text: 'No documents yet.' }));

  const readBtn = vuBtn('Read pages and suggest', async () => {
    readBtn.disabled = true;
    let found = 0;
    for (const r of rows) {
      if (r.d.issuer) continue;
      status.textContent = 'Reading ' + (r.d.title || r.d.kind) + '...';
      try {
        const text = await ssDocText(r.d);
        const s = text.trim() ? ssIssuer(text) : null;
        if (s) {
          r.input.value = s.value;
          r.note.textContent = 'Suggested from: "' + s.snippet + '"';
          found++;
        } else {
          r.note.textContent = 'No issuer found. Type it in.';
        }
      } catch (e) {
        r.note.textContent = 'Could not read: ' + e.message;
      }
    }
    status.textContent = 'Done. ' + found + ' suggestion(s). Check each one, then tap Save issuers.';
    readBtn.disabled = false;
  });

  const saveBtn = vuBtn('Save issuers', async () => {
    let changed = 0;
    try {
      for (const r of rows) {
        const val = r.input.value.trim();
        if (!val || val === (r.d.issuer || '')) continue;
        await v2Put('docs', { ...r.d, issuer: val, updatedAt: Date.now() });
        changed++;
      }
      alert(changed ? 'Saved ' + changed + ' issuer(s).' : 'Nothing new to save.');
      vuGo('issuers');
    } catch (e) { alert('Save failed: ' + e.message); }
  });

  body.append(vuEl('div', { cls: 'row' }, [readBtn, saveBtn]));
}

// Adds the "issuers" screen to the existing navigation
const ssBaseGo = vuGo;
vuGo = async function (tab, arg) {
  if (tab !== 'issuers') return ssBaseGo(tab, arg);
  const root = vuRootEl();
  root.innerHTML = '';
  root.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Dashboard', () => vuGo('dash'), true),
    vuBtn('Profiles', () => vuGo('profiles'), true),
    vuBtn('+ Add document', () => vuGo('form'), true),
    vuBtn('Close', () => vuClose(), true)
  ]));
  const body = vuEl('div', {});
  root.append(body);
  try { await ssIssuerScreen(body); }
  catch (e) { body.append(vuEl('p', { cls: 'error', text: 'Something went wrong: ' + e.message })); }
};

// Adds a button to the dashboard that opens the issuer review screen
const ssBaseDash = vuDashboard;
vuDashboard = async function (body) {
  await ssBaseDash(body);
  body.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Suggest issuers for existing documents', () => vuGo('issuers'), true)
  ]));
};

/* ---------- tests: each line should show PASS ---------- */
const SS_TESTS = [
  { name: 'Car insurance', expect: 'TATA AIG GENERAL INSURANCE COMPANY LIMITED',
    text: 'Auto Secure - Private Car Package Policy Registered office : Peninsula Business Park, Mumbai. TATA AIG GENERAL INSURANCE COMPANY LIMITED' },
  { name: 'Marksheet', expect: 'CENTRAL BOARD OF SECONDARY EDUCATION',
    text: 'CENTRAL BOARD OF SECONDARY EDUCATION MARKS SHEET Roll No 123456 Name RAHUL' },
  { name: 'Birth certificate', expect: 'Municipal Corporation of Bengaluru',
    text: 'BIRTH CERTIFICATE issued by Municipal Corporation of Bengaluru Registration No 4567 dated 12/03/2001' },
  { name: 'Certificate', expect: 'Tech Institute Bangalore',
    text: 'This is to certify that Priya Sharma has completed the course conducted by Tech Institute Bangalore for the purpose of training' },
  { name: 'Driving licence', expect: 'Licensing Authority, BENGALURU',
    text: 'Sign. Licencing Authority BENGALURU(S) CDOI : 23-08-2024' },
  { name: 'Voter ID', expect: 'Election Commission of India',
    text: 'ELECTION COMMISSION OF INDIA IDENTITY CARD Elector Name LALEET' }
];

function ssSelfTest() {
  const lines = SS_TESTS.map(t => {
    const s = ssIssuer(t.text);
    const got = s ? s.value : 'nothing found';
    const ok = got === t.expect;
    return (ok ? 'PASS  ' : 'FAIL  ') + t.name + ': ' + got + (ok ? '' : '  (expected ' + t.expect + ')');
  });
  alert('Issuer tests\n\n' + lines.join('\n'));
}

(function ssButton() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('ss-test')) return;
  const b = document.createElement('button');
  b.id = 'ss-test';
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Run issuer tests';
  b.onclick = ssSelfTest;
  bk.appendChild(b);
})();
