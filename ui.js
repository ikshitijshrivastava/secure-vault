/* ===== ui.js PART 1 of 2. Create the file with this part. Colours, layout fixes, owner matching. ===== */
'use strict';

const UI_PERSON = ['#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a', '#c62828', '#00838f', '#4e342e', '#ad1457'];
const UI_VEHICLE = ['#37474f', '#558b2f', '#8d6e63', '#455a64'];
const UI_STATUS = { expired: '#c62828', soon: '#b26a00', ok: '#2e7d32', none: '#667085' };
let UI_COLORS = new Map();
VU_LBL.notes = 'Notes';

/* Layout fixes: owner rows, cards, touch-friendly buttons, wrapping text */
const uiStyle = document.createElement('style');
uiStyle.textContent = `
#view-vault h2 { margin: 18px 0 8px; font-size: 20px; }
#view-vault button { min-height: 44px; }
#view-vault .card { background:#fff; border-radius:12px; padding:12px; margin:10px 0; box-shadow:0 1px 3px #0002; display:flex; flex-direction:column; gap:6px; border-left:6px solid #d0d5dd; cursor:pointer; list-style:none; }
#view-vault .chip { display:inline-block; margin:2px 6px 2px 0; padding:4px 12px; border-radius:999px; color:#fff; font-size:13px; font-weight:600; }
#view-vault .owner-row { display:flex; flex-direction:row; align-items:center; gap:12px; background:#fff; border-radius:10px; padding:8px 10px; min-height:48px; margin:6px 0; font-weight:400; }
#view-vault .owner-row input[type=checkbox] { width:22px; height:22px; margin:0; padding:0; flex:0 0 auto; }
#view-vault .page-row { display:flex; flex-direction:row; align-items:center; gap:8px; background:#fff; border-radius:10px; padding:8px; margin:6px 0; }
#view-vault .page-row .meta { flex:1; min-width:0; word-break:break-word; font-size:14px; }
#view-vault .page-row button { padding:6px 10px; font-size:13px; min-height:36px; }
#view-vault dl { background:#fff; border-radius:10px; padding:12px; }
#view-vault dd { word-break:break-word; white-space:pre-line; margin:2px 0 8px; }
#view-vault .toolbar { flex-wrap:wrap; }
#view-vault .toolbar select { flex:1; min-width:160px; }
`;
document.head.appendChild(uiStyle);

/* Colours: each person and vehicle keeps a stable colour, assigned in order of creation */
function uiColorMap(all) {
  const m = new Map();
  [...all.people].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((p, i) => m.set(p.id, UI_PERSON[i % UI_PERSON.length]));
  [...all.vehicles].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((v, i) => m.set(v.id, UI_VEHICLE[i % UI_VEHICLE.length]));
  return m;
}
const uiColor = id => UI_COLORS.get(id) || '#667085';
const uiChip = (text, color) => vuEl('span', { cls: 'chip', text, style: 'background:' + color });

// Every load refreshes the colour map, so every screen agrees
const uiBaseLoadAll = vuLoadAll;
vuLoadAll = async function () {
  const all = await uiBaseLoadAll();
  UI_COLORS = uiColorMap(all);
  return all;
};

/* Name matching that tolerates spelling differences (LALEET / LALIT) */
function uiLev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
function uiWordMatch(a, b) {
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  return len >= 4 && uiLev(a, b) <= (len >= 6 ? 2 : 1);
}
// A person is ticked when two name words match, or one word plus the same date of birth
function uiPeopleIn(text, people) {
  const words = text.toUpperCase().split(/[^A-Z]+/).filter(w => w.length >= 2);
  const dates = pkFindDates(text).map(d => d.value);
  const ids = [];
  for (const p of people) {
    const parts = (p.name || '').toUpperCase().split(/[^A-Z]+/).filter(w => w.length >= 2);
    if (!parts.length) continue;
    const hits = parts.filter(pw => words.some(w => uiWordMatch(pw, w))).length;
    const dobHit = !!p.dob && dates.includes(p.dob);
    if (hits >= 2 || (hits >= 1 && dobHit)) ids.push(p.id);
  }
  return ids;
}

/* Owner checkboxes, one row per person or vehicle */
function uiOwnerChecks(all, preset) {
  const list = [];
  const box = vuEl('div', {});
  const add = (id, label) => {
    const cb = vuEl('input', { type: 'checkbox' });
    cb.checked = preset.includes(id);
    list.push({ id, cb });
    box.append(vuEl('label', { cls: 'owner-row' }, [cb, uiChip(label, uiColor(id))]));
  };
  all.people.forEach(p => add(p.id, p.name));
  all.vehicles.forEach(v => add(v.id, v.number));
  if (!list.length) box.append(vuEl('p', { cls: 'hint', text: 'Add a person or vehicle first in Profiles.' }));
  return { box, list };
}

/* Page thumbnail: photo preview, or a PDF tile */
function uiThumb(file) {
  if (file.type && file.type.startsWith('image/')) {
    return vuEl('img', { src: URL.createObjectURL(file), alt: '',
      style: 'width:56px;height:56px;object-fit:cover;border-radius:8px;flex:0 0 auto' });
  }
  return vuEl('div', { text: 'PDF',
    style: 'width:56px;height:56px;display:flex;align-items:center;justify-content:center;background:#eef1f6;border-radius:8px;font-weight:700;color:#1f3a5f;flex:0 0 auto' });
}

/* Adds a suggested detail to the notes without wiping what is there */
function uiAppendNote(current, value) {
  const cur = (current || '').trim();
  if (!cur) return value;
  return cur.includes(value) ? cur : cur + '\n' + value;
  }
/* ===== ui.js PART 2A of 2. Append to the end. Dashboard, profile cards, detail. ===== */

vuDashboard = async function (body) {
  const all = await vuLoadAll();
  const map = vuNameMap(all);

  body.append(vuEl('h2', { text: 'Dashboard' }));
  body.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Import old documents', async () => {
      try {
        const n = await v2ImportOld();
        alert('Imported ' + n + ' old document(s).');
        vuGo('dash');
      } catch (e) { alert('Import failed: ' + e.message); }
    }, true)
  ]));

  if (all.people.length || all.vehicles.length) {
    body.append(vuEl('p', { cls: 'hint', text: 'Colours identify people and vehicles:' }));
    body.append(vuEl('div', { cls: 'row' }, [
      ...all.people.map(p => uiChip(p.name, uiColor(p.id))),
      ...all.vehicles.map(v => uiChip(v.number, uiColor(v.id)))
    ]));
  }

  const search = vuEl('input', { type: 'search', placeholder: 'Search title, number, owner' });
  const filter = vuEl('select', {}, [
    vuEl('option', { value: '', text: 'Everyone' }),
    ...all.people.map(p => vuEl('option', { value: p.id, text: 'Person: ' + p.name })),
    ...all.vehicles.map(v => vuEl('option', { value: v.id, text: 'Vehicle: ' + v.number }))
  ]);
  const list = vuEl('ul', { style: 'list-style:none;padding:0;margin:0' });
  body.append(vuEl('div', { cls: 'toolbar' }, [search, filter]), list);

  // Latest version first: soonest expiry at the top, undated documents last
  const groups = v2Dashboard(all.docs).sort((a, b) =>
    (a.latest.expiry || '9999-12-31').localeCompare(b.latest.expiry || '9999-12-31'));

  const draw = () => {
    list.innerHTML = '';
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const g of groups) {
      const L = g.latest;
      const owners = vuOwnersOf(L);
      if (filter.value && !owners.includes(filter.value)) continue;
      const ownerText = vuOwnerLabel(map, owners);
      if (q && ![L.title, L.kind, L.number, ownerText].join(' ').toLowerCase().includes(q)) continue;
      const s = statusOf(daysLeft(L.expiry));
      const edge = owners.length ? uiColor(owners[0]) : '#98a2b3';
      list.append(vuEl('li', {
        cls: 'card',
        style: 'border-left-color:' + edge,
        on: { click: () => vuGo('detail', g.groupId) }
      }, [
        vuEl('strong', { text: L.title || L.kind }),
        vuEl('div', {}, owners.length
          ? owners.map(id => uiChip(map.get(id) || 'Removed', uiColor(id)))
          : [vuEl('small', { text: 'Unassigned' })]),
        vuEl('small', { text: L.kind + (L.number ? ' · ' + L.number : '') }),
        vuEl('span', { cls: 'badge', text: s.label, style: 'color:' + UI_STATUS[s.cls] }),
        g.older.length ? vuEl('small', { text: g.older.length + ' older version(s) kept' }) : ''
      ]));
      shown++;
    }
    if (!shown) list.append(vuEl('p', { cls: 'hint', text: 'No documents match. Tap + Add document.' }));
  };
  search.addEventListener('input', draw);
  filter.addEventListener('change', draw);
  draw();
};

vuDocInfo = function (d, map) {
  const s = statusOf(daysLeft(d.expiry));
  const owners = vuOwnersOf(d);
  const dl = vuEl('dl', {});
  dl.append(vuEl('dt', { text: 'Owners' }), vuEl('dd', {}, owners.length
    ? owners.map(id => uiChip(map.get(id) || 'Removed', uiColor(id)))
    : [vuEl('span', { text: 'Unassigned' })]));
  const rows = [
    ['Kind', d.kind], ['Type', d.type], ['Number', d.number],
    ['Issue date', d.issue ? smShow(d.issue) : ''], ['Expiry date', d.expiry ? smShow(d.expiry) : ''],
    ['Status', s.label], ['Other details', d.notes], ['Pages stored', String((d.pageIds || []).length)]
  ];
  for (const [k, val] of rows) if (val) dl.append(vuEl('dt', { text: k }), vuEl('dd', { text: val }));
  return dl;
};

vuPersonCard = async function (p, all) {
  const url = await vuPhotoUrl(p.photoId);
  const count = all.docs.filter(d => vuOwnersOf(d).includes(p.id)).length;
  const col = uiColor(p.id);
  const photo = url
    ? vuEl('img', { src: url, alt: '', style: 'width:72px;height:72px;object-fit:cover;border-radius:10px;border:3px solid ' + col })
    : vuEl('div', {
        text: (p.name || '?').charAt(0).toUpperCase(),
        style: 'width:72px;height:72px;border-radius:10px;background:' + col + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;flex:0 0 auto'
      });
  const del = vuBtn('Delete', async () => {
    const solo = all.docs.filter(d => { const o = vuOwnersOf(d); return o.length === 1 && o[0] === p.id; }).length;
    if (!confirm(`Delete ${p.name}? ${solo} document(s) that belong only to this person will be deleted. Shared documents stay with the others.`)) return;
    try { await vuDeleteOwner('people', p); vuGo('profiles'); } catch (e) { alert('Delete failed: ' + e.message); }
  }, true);
  return vuEl('li', { cls: 'card', style: 'border-left-color:' + col }, [
    vuEl('div', { style: 'display:flex;gap:12px;align-items:center' }, [
      photo,
      vuEl('div', {}, [
        vuEl('strong', { text: p.name }),
        vuEl('small', { text: [p.relation, p.dob ? 'DOB ' + smShow(p.dob) : '', count + ' document(s)'].filter(Boolean).join(' · ') }),
        p.notes ? vuEl('small', { text: p.notes }) : ''
      ])
    ]),
    vuEl('div', { cls: 'row' }, [vuBtn('Edit', () => vuGo('person', p.id), true), del])
  ]);
};

vuVehicleCard = function (v, all) {
  const count = all.docs.filter(d => vuOwnersOf(d).includes(v.id)).length;
  const col = uiColor(v.id);
  const del = vuBtn('Delete', async () => {
    const solo = all.docs.filter(d => { const o = vuOwnersOf(d); return o.length === 1 && o[0] === v.id; }).length;
    if (!confirm(`Delete vehicle ${v.number}? ${solo} document(s) that belong only to it will be deleted.`)) return;
    try { await vuDeleteOwner('vehicles', v); vuGo('profiles'); } catch (e) { alert('Delete failed: ' + e.message); }
  }, true);
  return vuEl('li', { cls: 'card', style: 'border-left-color:' + col }, [
    vuEl('strong', { text: v.number }),
    vuEl('small', { text: [v.make, count + ' document(s)'].filter(Boolean).join(' · ') }),
    v.notes ? vuEl('small', { text: v.notes }) : '',
    vuEl('div', { cls: 'row' }, [vuBtn('Edit', () => vuGo('vehicle', v.id), true), del])
  ]);
};
/* ===== ui.js PART 2B of 2. Append to the end. Add or edit document form. ===== */

vuForm = async function (body, editId) {
  const all = await vuLoadAll();
  const cur = editId ? all.docs.find(d => d.id === editId) || null : null;
  const pages = [];          // { file, text, error } for each page added in this form
  let sugg = [];

  /* fields */
  const kindVal = cur ? cur.kind || 'Other' : 'Other';
  const title = vuEl('input', { value: cur ? cur.title || '' : '', placeholder: 'Title, e.g. Car insurance - WB06L2307' });
  const kind = vuEl('select', {}, VU_KINDS.map(k => vuEl('option', { value: k.kind, text: k.kind })));
  if (!VU_KINDS.some(k => k.kind === kindVal)) kind.append(vuEl('option', { value: kindVal, text: kindVal }));
  kind.value = kindVal;
  const type = vuEl('select', {}, VU_TYPES.map(t => vuEl('option', { value: t, text: t })));
  type.value = cur ? cur.type || 'Other' : 'Other';
  const number = vuEl('input', { value: cur ? cur.number || '' : '', placeholder: 'Document number' });
  const issue = vuEl('input', { type: 'date', value: cur ? cur.issue || '' : '' });
  const expiry = vuEl('input', { type: 'date', value: cur ? cur.expiry || '' : '' });
  const notes = vuEl('textarea', { rows: 3, placeholder: 'Other details: date of birth, address, purpose, issuer' });
  notes.value = cur ? cur.notes || '' : '';
  const fields = { title, type, number, issue, expiry, notes };

  /* owners */
  const ownerUI = uiOwnerChecks(all, cur ? vuOwnersOf(cur) : []);

  /* renewal or group */
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
          fields[t].focus();
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
        kind: kind.value, type: type.value, title: t, number: number.value.trim(),
        issue: issue.value, expiry: expiry.value, notes: notes.value.trim(),
        pageIds, groupId, createdAt: cur ? cur.createdAt : Date.now(), updatedAt: Date.now()
      });
      vuGo('detail', groupId);
    } catch (e) { alert('Save failed: ' + e.message); }
  };

  /* layout */
  body.append(vuEl('h2', { text: cur ? 'Edit document' : 'Add document' }));
  body.append(vuEl('form', { on: { submit: e => e.preventDefault() } }, [
    vuField('Title', title), vuField('Kind', kind), vuField('Type', type),
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
