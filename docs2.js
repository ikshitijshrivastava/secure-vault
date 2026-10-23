/* ===== docs2.js PART 1 of 2. Create the file with this part. View and download for stored and new pages. ===== */
'use strict';

const dvStyle = document.createElement('style');
dvStyle.textContent = `
#view-vault .page-row { flex-wrap: wrap; }
#view-vault .page-row .meta { flex: 1 1 100%; }
#view-vault .page-row button { flex: 0 0 auto; }
`;
document.head.appendChild(dvStyle);

function dvSafe(s) {
  return String(s || 'document').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '_').slice(0, 60);
}
function dvExt(mime, name) {
  const m = /\.[A-Za-z0-9]{2,4}$/.exec(name || '');
  if (m) return m[0].toLowerCase();
  if (/pdf/i.test(mime || '')) return '.pdf';
  if (/png/i.test(mime || '')) return '.png';
  if (/jpe?g/i.test(mime || '')) return '.jpg';
  return '';
}

// Opens a blob in a new window. Called straight from a click, so the browser allows it.
function dvViewBlob(blob) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) alert('Your browser blocked the new window. Allow pop-ups for this app, or use Download.');
  setTimeout(() => URL.revokeObjectURL(url), 300000);
}

// Saves a blob to the Downloads folder
function dvSaveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Reads one stored page, decrypted
async function dvStored(pid) {
  const p = await v2GetPage(pid);
  if (!p) throw new Error('This page could not be found.');
  return { blob: new Blob([p.bytes], { type: p.meta.mime || 'application/octet-stream' }), meta: p.meta };
}

// Opens the window first (allowed on click), then loads the page into it
async function dvViewStored(pid) {
  const w = window.open('', '_blank');
  try {
    const f = await dvStored(pid);
    const url = URL.createObjectURL(f.blob);
    if (w) w.location.href = url;
    else alert('Your browser blocked the new window. Allow pop-ups for this app, or use Download.');
    setTimeout(() => URL.revokeObjectURL(url), 300000);
  } catch (e) {
    if (w) w.close();
    alert(e.message);
  }
}

async function dvDownloadStored(pid, base, n) {
  try {
    const f = await dvStored(pid);
    dvSaveBlob(f.blob, dvSafe(base) + '-page' + n + dvExt(f.meta.mime, f.meta.name));
  } catch (e) { alert(e.message); }
}

// Detail screen: View and Download for every stored page
vuPagesRow = function (d) {
  const pages = d.pageIds || [];
  const row = vuEl('div', { cls: 'row' });
  if (!pages.length) {
    row.append(vuEl('small', { text: 'No pages stored' }));
    return row;
  }
  pages.forEach((pid, i) => {
    row.append(vuBtn('View page ' + (i + 1), () => dvViewStored(pid), true));
    row.append(vuBtn('Download page ' + (i + 1), () => dvDownloadStored(pid, d.title || d.kind, i + 1), true));
  });
  return row;
};
/* ===== docs2.js PART 2 of 2. Append to the end. Add or edit form with uploads at the top. ===== */
vuForm = async function (body, editId) {
  const all = await vuLoadAll();
  const cur = editId ? all.docs.find(d => d.id === editId) || null : null;
  const pages = [];          // { file, text, error } for pages added in this form
  let sugg = [];

  /* upload controls */
  const picker = vuEl('input', { type: 'file', accept: 'image/*,application/pdf' });
  picker.setAttribute('multiple', '');
  picker.style.display = 'none';
  const pageBox = vuEl('div', {});
  const status = vuEl('p', { cls: 'hint', text: 'Add photos or a PDF first. Tap View to open a page in a new window while you fill in the details.' });
  const detected = vuEl('p', { cls: 'hint' });
  const suggBox = vuEl('div', {});

  /* details */
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
      pageBox.append(vuEl('p', { cls: 'hint', text: 'No new pages yet.' }));
      return;
    }
    pages.forEach((p, i) => {
      const th = uiThumb(p.file);
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => dvViewBlob(p.file));
      pageBox.append(vuEl('div', { cls: 'page-row' }, [
        th,
        vuEl('div', { cls: 'meta', text: 'Page ' + (i + 1) + ': ' + p.file.name + (p.error ? ' (' + p.error + ')' : '') }),
        vuBtn('View', () => dvViewBlob(p.file), true),
        vuBtn('Download', () => dvSaveBlob(p.file, p.file.name), true),
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
          if (t === 'notes') notes.focus();
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

  // Rebuilds suggestions and owner ticks from every new page
  const rebuild = () => {
    const text = pages.filter(p => !p.error).map(p => p.text || '').join('\n');
    sugg = text.trim() ? buildSuggestions(text) : [];
    if (text.trim()) {
      const hits = new Set([...uiPeopleIn(text, all.people), ...vuMatchVehicles(text, all.vehicles)]);
      ownerUI.list.forEach(o => { if (hits.has(o.id)) o.cb.checked = true; });
    }
    detected.textContent = PK_LAST ? 'Detected: ' + PK_LAST : '';
    if (pages.length) {
      const ok = pages.filter(p => !p.error).length;
      const bad = pages.length - ok;
      status.textContent = ok + ' page(s) read' + (bad ? ', ' + bad + ' could not be read' : '') +
        '. Approve, edit or dismiss the suggestions, then tap Save.';
    }
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

  /* layout: pages first, then details, then owners */
  body.append(vuEl('h2', { text: cur ? 'Edit document' : 'Add document' }));
  body.append(vuEl('h2', { text: 'Pages' }));
  body.append(vuEl('div', { cls: 'row' }, [vuBtn('+ Add photo or PDF', () => picker.click())]));
  body.append(picker);
  if (cur) {
    body.append(vuEl('p', { cls: 'hint', text: 'Stored pages (view or download):' }));
    body.append(vuPagesRow(cur));
  }
  body.append(pageBox, status, detected, suggBox);

  body.append(vuEl('h2', { text: 'Details' }));
  body.append(vuEl('form', { on: { submit: e => e.preventDefault() } }, [
    vuField('Title', title), vuField('Kind', kind), vuField('Type', type),
    vuField('Issuer / provider', issuer),
    vuField('Document number', number), vuField('Issue date', issue), vuField('Expiry date', expiry),
    vuField('Other details', notes), vuField('Renewal or group', renew)
  ]));

  body.append(vuEl('h2', { text: 'Owners' }));
  body.append(vuEl('p', { cls: 'hint', text: 'Tick every person or vehicle this document belongs to. Ticks are added automatically when a name or number matches.' }));
  body.append(ownerUI.box);

  body.append(vuEl('div', { cls: 'row' }, [
    vuBtn('Save document', saveDoc),
    vuBtn('Cancel', () => vuGo('dash'), true)
  ]));

  drawPages();
  rebuild();
};
