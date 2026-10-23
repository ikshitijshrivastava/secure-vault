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
/* ===== issuer.js PART 3 of 3. Append to the end. Add or edit document form with the issuer field. ===== */
vuForm = async function (body, editId) {
  const all = await vuLoadAll();
  const cur = editId ? all.docs.find(d => d.id === editId) || null : null;
  const pages = [];
  let sugg = [];

  /* fields */
  const kindVal = cur ? cur.kind || 'Other' : 'Other';
  const title = vuEl('input', { value: cur ? cur.title || '' : '', placeholder: 'Title, e.g. Car insurance - WB06L2307' });
  const kind = vuEl('select', {}, VU_KINDS.map(k => vuEl('option', { value: k.kind, text: k.kind })));
  if (!VU_KINDS.some(k => k.kind === kindVal)) kind.append(vuEl('option', { value: kindVal, text: kindVal }));
  kind.value = kindVal;
  const type = vuEl('select', {}, VU_TYPES.map(t => vuEl('option', { value: t, text: t })));
  type.value = cur ? cur.type || 'Other' : 'Other';
  const issuer = vuEl('input', { value: cur ? cur.issuer || '' : '', placeholder: 'Who issued it, e.g. TATA AIG, CBSE, Municipal Corporation' });
  const number = vuEl('input', { value: cur ? cur.number || '' : '', placeholder: 'Document number' });
  const issue = vuEl('input', { type: 'date', value: cur ? cur.issue || '' : '' });
  const expiry = vuEl('input', { type: 'date', value: cur ? cur.expiry || '' : '' });
  const notes = vuEl('textarea', { rows: 3, placeholder: 'Other details: date of birth, address, purpose' });
  notes.value = cur ? cur.notes || '' : '';
  const fields = { title, type, number, issue, expiry, issuer };

  /* owners and renewal */
  const ownerUI = uiOwnerChecks(all, cur ? vuOwnersOf(cur) : []);
  const renew = vuEl('select', {}, [
    vuEl('option', { value: '', text: cur ? 'Keep current group' : 'Auto (same owner, type and number)' }),
    ...all.docs.filter(d => !cur || d.id !== cur.id)
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
      .map(d => vuEl('option', { value: d.id, text: 'Renewal of: ' + (d.title || d.kind) + ' (expiry ' + (d.expiry || '-') + ')' }))
  ]);

  /* pages */
  const picker = vuEl('input', { type: 'file', accept: 'image/*,application/pdf' });
  picker.setAttribute('multiple', '');
  picker.style.display = 'none';
  const pageBox = vuEl('div', {});
  const status = vuEl('p', { cls: 'hint' });
  const detected = vuEl('p', { cls: 'hint' });
  const suggBox = vuEl('div', {});

  const applyField = (f, value) => {
    if (f === 'notes') { notes.value = uiAppendNote(notes.value, value); return; }
    if (f === 'title') {
      title.value = value;
      const k = vuKindFromTitle(value);
      if (k) kind.value = k.kind;
      return;
    }
    if (fields[f]) fields[f].value = value;
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= pages.length) return;
    [pages[i], pages[j]] = [pages[j], pages[i]];
    drawPages();
    rebuild();
  };

  const drawPages = () => {
    pageBox.innerHTML = '';
    if (!pages.length) {
      pageBox.append(vuEl('p', { cls: 'hint', text: cur ? 'No new pages added yet.' : 'No pages yet. Tap + Add photo or PDF.' }));
      return;
    }
    pages.forEach((p, i) => {
      pageBox.append(vuEl('div', { cls: 'page-row' }, [
        uiThumb(p.file),
        vuEl('div', { cls: 'meta', text: 'Page ' + (i + 1) + ': ' + p.file.name + (p.error ? ' (' + p.error + ')' : '') }),
        vuBtn('▲', () => move(i, -1), true),
        vuBtn('▼', () => move(i, 1), true),
        vuBtn('Remove', () => { pages.splice(i, 1); drawPages(); rebuild(); }, true)
      ]));
    });
  };

  const drawSuggestions = () => {
    suggBox.innerHTML = '';
    if (!sugg.length) return;
    suggBox.append(vuBtn('Approve best suggestion for each field', () => {
      const used = new Set();
      sugg = sugg.filter(s => {
        const t = s.targets[0];
        if (s.targets.length === 1 && t !== 'notes' && !used.has(t)) {
          used.add(t);
          applyField(t, s.value);
          return false;
        }
        return true;
      });
      drawSuggestions();
    }));
    sugg.forEach((s, i) => {
      const done = field => {
        if (field) applyField(field, s.value);
        sugg.splice(i, 1);
        drawSuggestions();
      };
      const btns = vuEl('div', { cls: 'row' });
      if (s.targets.length > 1) {
        s.targets.forEach(t => btns.append(vuBtn('Use as ' + VU_LBL[t].toLowerCase(), () => done(t))));
      } else {
        const t = s.targets[0];
        btns.append(vuBtn('Approve', () => done(t)));
        btns.append(vuBtn('Edit', () => {
          applyField(t, s.value);
          sugg.splice(i, 1);
          drawSuggestions();
          if (fields[t]) fields[t].focus();
        }, true));
      }
      btns.append(vuBtn('Dismiss', () => done(null), true));
      suggBox.append(vuEl('div', { cls: 'sugg' }, [
        vuEl('strong', { text: s.targets.map(t => VU_LBL[t]).join(' or ') + ': ' + s.value }),
        vuEl('small', { text: (s.note ? s.note + ' · ' : '') + 'Found in: "' + s.snippet + '"' }),
        btns
      ]));
    });
  };

  // Rebuilds suggestions and owner ticks from every page currently in the list
  const rebuild = () => {
    const text = pages.filter(p => !p.error).map(p => p.text || '').join('\n');
    sugg = text.trim() ? buildSuggestions(text) : [];
    if (text.trim()) {
      const hits = new Set([...uiPeopleIn(text, all.people), ...vuMatchVehicles(text, all.vehicles)]);
      ownerUI.list.forEach(o => { if (hits.has(o.id)) o.cb.checked = true; });
    }
    detected.textContent = PK_LAST ? 'Detected: ' + PK_LAST : '';
    const ok = pages.filter(p => !p.error).length;
    const bad = pages.length - ok;
    status.textContent = !pages.length
      ? ''
      : ok + ' page(s) read' + (bad ? ', ' + bad + ' could not be read' : '') +
        '. Approve, edit or dismiss the suggestions, then tap Save.';
    drawSuggestions();
  };

  picker.addEventListener('change', async () => {
    const picked = Array.from(picker.files || []);
    picker.value = '';
    for (const f of picked) {
      status.textContent = 'Reading ' + f.name + ' on this device...';
      try {
        const r = await readDocument(f);
        pages.push({ file: f, text: r.text || '', error: r.error || '' });
      } catch (e) {
        pages.push({ file: f, text: '', error: 'could not read: ' + e.message });
      }
      drawPages();
    }
    rebuild();
  });

  const saveDoc = async () => {
    const t = title.value.trim();
    if (!t) return alert('Enter a title.');
    const newFiles = pages.filter(p => !p.error).map(p => p.file);
    if (!cur && !newFiles.length) return alert('Add at least one photo or PDF.');
    const ownerIds = ownerUI.list.filter(o => o.cb.checked).map(o => o.id);
    try {
      const id = cur ? cur.id : newId();
      const newPageIds = await vuStorePages(id, newFiles, cur ? (cur.pageIds || []).length : 0);
      const pageIds = [...(cur ? cur.pageIds || [] : []), ...newPageIds];
      let groupId;
      if (renew.value) {
        const target = all.docs.find(d => d.id === renew.value);
        groupId = target ? target.groupId : vuGroupKey(ownerIds, kind.value, number.value, id);
      } else if (cur) {
        groupId = cur.groupId;
      } else {
        groupId = vuGroupKey(ownerIds, kind.value, number.value, id);
      }
      await v2Put('docs', {
        id, owners: ownerIds, ownerId: ownerIds[0] || null,
        kind: kind.value, type: type.value, title: t, issuer: issuer.value.trim(),
        number: number.value.trim(), issue: issue.value, expiry: expiry.value,
        notes: notes.value.trim(), pageIds, groupId,
        createdAt: cur ? cur.createdAt : Date.now(), updatedAt: Date.now()
      });
      vuGo('detail', groupId);
    } catch (e) { alert('Save failed: ' + e.message); }
  };

  /* layout */
  body.append(vuEl('h2', { text: cur ? 'Edit document' : 'Add document' }));
  body.append(vuEl('form', { on: { submit: e => e.preventDefault() } }, [
    vuField('Title', title), vuField('Kind', kind), vuField('Type', type),
    vuField('Issuer / provider', issuer),
    vuField('Document number', number), vuField('Issue date', issue), vuField('Expiry date', expiry),
    vuField('Other details', notes), vuField('Renewal or group', renew)
  ]));
  body.append(vuEl('h2', { text: 'Owners' }));
  body.append(vuEl('p', { cls: 'hint', text: 'Tick every person or vehicle this document belongs to. Ticks are added automatically when a name or number matches.' }));
  body.append(ownerUI.box);
  body.append(vuEl('h2', { text: 'Pages' }));
  if (cur) body.append(vuEl('p', { cls: 'hint', text: (cur.pageIds || []).length + ' page(s) already stored.' }));
  body.append(vuEl('div', { cls: 'row' }, [vuBtn('+ Add photo or PDF', () => picker.click())]));
  body.append(picker, pageBox, detected, status, suggBox);
  body.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Save document', saveDoc),
    vuBtn('Cancel', () => vuGo('dash'), true)
  ]));
  drawPages();
  rebuild();
};
