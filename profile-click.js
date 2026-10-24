/* ===== profile-click.js v2. Person and vehicle cards open their documents.
   Replace the whole file with this. Load LAST in index.html. ===== */
'use strict';

let PC_OPEN_FOR = null;   // owner the dashboard should show next
let PC_ADD_FOR = null;    // owner to tick when the add form opens next

function pcLetter(name) {
  return (String(name || '').trim().charAt(0) || '?').toUpperCase();
}

// Shows the vault screen for a tab, even when opened from the main list
function pcShow(tab) {
  VU_OLD_VIEWS.forEach(v => $(v).classList.add('hidden'));
  vuRootEl().classList.remove('hidden');
  setTop(true);
  return vuGo(tab);
}

// Opens the dashboard filtered to one person or vehicle
async function pcOpen(owner) {
  PC_OPEN_FOR = owner;
  await pcShow('dash');
}

// One card. Tapping the card or "View documents" opens its documents.
// Buttons inside the card (Edit, Delete) keep their own action.
function pcCard(owner, color, avatar, subtitle, notes, count, actions) {
  const view = vuBtn('View documents (' + count + ')', () => pcOpen(owner));
  const li = vuEl('li', { cls: 'card', style: 'border-left-color:' + color }, [
    vuEl('div', { style: 'display:flex;gap:12px;align-items:center' }, [
      avatar,
      vuEl('div', { style: 'min-width:0' }, [
        vuEl('strong', { text: owner.name }),
        vuEl('small', { text: subtitle }),
        notes ? vuEl('small', { text: notes }) : ''
      ])
    ]),
    vuEl('div', { cls: 'row' }, [view, ...actions])
  ]);
  li.dataset.ownerId = owner.id;
  li.title = 'Tap to see documents';
  li.setAttribute('tabindex', '0');
  li.setAttribute('role', 'button');
  li.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    pcOpen(owner);
  });
  li.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.target.closest('button')) pcOpen(owner);
  });
  return li;
}

async function pcPersonCard(p, all) {
  const col = uiColor(p.id);
  const count = all.docs.filter(d => vuOwnersOf(d).includes(p.id)).length;
  const url = await vuPhotoUrl(p.photoId);
  const avatar = url
    ? vuEl('img', { src: url, alt: '', style: 'width:72px;height:72px;object-fit:cover;border-radius:10px;border:3px solid ' + col + ';flex:0 0 auto' })
    : vuEl('div', {
        text: pcLetter(p.name),
        style: 'width:72px;height:72px;border-radius:10px;background:' + col + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;flex:0 0 auto'
      });
  const del = vuBtn('Delete', async () => {
    const solo = all.docs.filter(d => { const o = vuOwnersOf(d); return o.length === 1 && o[0] === p.id; }).length;
    if (!confirm('Delete ' + p.name + '? ' + solo + ' document(s) that belong only to this person will be deleted. Shared documents stay with the others.')) return;
    try { await vuDeleteOwner('people', p); await vuGo('profiles'); }
    catch (e) { alert('Delete failed: ' + e.message); }
  }, true);
  const subtitle = [p.relation, p.dob ? 'DOB ' + smShow(p.dob) : '', count + ' document(s)'].filter(Boolean).join(' · ');
  return pcCard({ kind: 'person', id: p.id, name: p.name }, col, avatar, subtitle, p.notes, count,
    [vuBtn('Edit', () => vuGo('person', p.id), true), del]);
}

function pcVehicleCard(v, all) {
  const col = uiColor(v.id);
  const count = all.docs.filter(d => vuOwnersOf(d).includes(v.id)).length;
  const avatar = vuEl('div', {
    text: 'Car',
    style: 'width:72px;height:72px;border-radius:10px;background:' + col + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex:0 0 auto'
  });
  const del = vuBtn('Delete', async () => {
    const solo = all.docs.filter(d => { const o = vuOwnersOf(d); return o.length === 1 && o[0] === v.id; }).length;
    if (!confirm('Delete vehicle ' + v.number + '? ' + solo + ' document(s) that belong only to it will be deleted.')) return;
    try { await vuDeleteOwner('vehicles', v); await vuGo('profiles'); }
    catch (e) { alert('Delete failed: ' + e.message); }
  }, true);
  const subtitle = [v.make, count + ' document(s)'].filter(Boolean).join(' · ');
  return pcCard({ kind: 'vehicle', id: v.id, name: v.number }, col, avatar, subtitle, v.notes, count,
    [vuBtn('Edit', () => vuGo('vehicle', v.id), true), del]);
}

/* Profiles screen */
vuProfiles = async function (body) {
  const all = await vuLoadAll();
  body.append(vuEl('p', { cls: 'hint', text: "Tap a card, or its View documents button, to see that person's or vehicle's documents." }));

  body.append(vuEl('h2', { text: 'People' }));
  const pl = vuEl('ul', { style: VU_LIST });
  if (!all.people.length) pl.append(vuEl('p', { cls: 'hint', text: 'No people yet.' }));
  for (const p of all.people) pl.append(await pcPersonCard(p, all));
  body.append(pl, vuEl('div', { cls: 'row' }, [vuBtn('+ Add person', () => vuGo('person', null))]));

  body.append(vuEl('h2', { text: 'Vehicles' }));
  const vl = vuEl('ul', { style: VU_LIST });
  if (!all.vehicles.length) vl.append(vuEl('p', { cls: 'hint', text: 'No vehicles yet.' }));
  for (const v of all.vehicles) vl.append(pcVehicleCard(v, all));
  body.append(vl, vuEl('div', { cls: 'row' }, [vuBtn('+ Add vehicle', () => vuGo('vehicle', null))]));
};

/* Dashboard: applies the owner filter once the list has been drawn */
const pcBaseDashboard = vuDashboard;
vuDashboard = async function (body) {
  const owner = PC_OPEN_FOR;
  PC_OPEN_FOR = null;
  await pcBaseDashboard(body);
  if (!owner) return;

  const sel = body.querySelector('.toolbar select');
  const list = body.querySelector('ul');
  const banner = vuEl('div', {
    id: 'pc-banner',
    style: 'background:#eef4ff;border:1px solid #1565c0;border-radius:10px;padding:10px;margin:8px 0'
  });
  body.insertBefore(banner, body.firstChild);

  const hasOption = sel && Array.from(sel.options).some(o => o.value === owner.id);
  if (!hasOption) {
    banner.append(vuEl('strong', { text: owner.name + ' is no longer in the vault.' }));
    return;
  }

  sel.value = owner.id;
  sel.dispatchEvent(new Event('change'));
  const shown = list ? list.querySelectorAll('li.card').length : 0;

  banner.append(
    vuEl('strong', { text: 'Documents for ' + owner.name }),
    vuEl('small', { text: shown + ' document(s) shown' }),
    vuEl('div', { cls: 'row' }, [
      vuBtn('+ Add document for ' + owner.name, () => { PC_ADD_FOR = owner; vuGo('form'); }),
      vuBtn('Show everyone', () => {
        sel.value = '';
        sel.dispatchEvent(new Event('change'));
        banner.remove();
      }, true)
    ])
  );
  if (!shown) {
    banner.append(vuEl('p', { cls: 'hint', text: 'No documents are linked to ' + owner.name + ' yet. Tap + Add document to create one.' }));
  }
};

/* Add form: ticks the owner when opened from that owner's dashboard */
const pcBaseForm = vuForm;
vuForm = async function (body, editId) {
  const owner = PC_ADD_FOR;
  PC_ADD_FOR = null;
  await pcBaseForm(body, editId);
  if (!owner || editId) return;
  body.querySelectorAll('label.owner-row').forEach(row => {
    const chip = row.querySelector('.chip');
    const box = row.querySelector('input[type="checkbox"]');
    if (chip && box && chip.textContent.trim() === owner.name) box.checked = true;
  });
};

/* Tests: real taps on the real cards */
const pcWait = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
};

async function pcSelfTest() {
  const lines = [];
  const ok = (c, m) => lines.push((c ? 'PASS  ' : 'FAIL  ') + m);
  try {
    if (!key) throw new Error('unlock the vault first');
    const all = await vuLoadAll();
    const total = all.people.length + all.vehicles.length;
    const box = vuEl('div', {});
    await vuProfiles(box);
    const cards = Array.from(box.querySelectorAll('li.card[data-owner-id]'));
    ok(cards.length === total, 'one card per person and vehicle (' + cards.length + ' of ' + total + ')');
    ok(cards.length > 0 && cards.every(c => c.querySelectorAll('button').length >= 3),
      'every card has View, Edit and Delete buttons');

    if (!total) {
      lines.push('INFO  add a person or vehicle, then run this test again');
    } else {
      const ownerSelect = () => document.querySelector('#view-vault .toolbar select');

      // 1. Tap the card body on the first card
      const first = cards[0];
      const id1 = first.dataset.ownerId;
      await pcShow('profiles');
      first.querySelector('strong').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const sel1 = await pcWait(() => { const s = ownerSelect(); return s && s.value === id1 ? s : null; });
      ok(!!sel1, 'tapping a card body opens the dashboard filtered to that owner');
      ok(!!(await pcWait(() => document.getElementById('pc-banner'))), 'the owner banner is shown');

      // 2. Tap "View documents" on the last card
      const last = cards[cards.length - 1];
      const id2 = last.dataset.ownerId;
      const viewBtn = Array.from(last.querySelectorAll('button')).find(b => /^View documents/.test(b.textContent));
      ok(!!viewBtn, 'last card has a View documents button');
      if (viewBtn) viewBtn.click();
      const sel2 = await pcWait(() => { const s = ownerSelect(); return s && s.value === id2 ? s : null; });
      ok(!!sel2, 'the View documents button opens the same owner filter');

      // 3. Tap Edit on the first card: must open the edit form, not the dashboard
      await pcShow('profiles');
      const editPanel = await pcWait(() => document.querySelector('#view-vault ul li.card[data-owner-id]'));
      const freshFirst = editPanel
        ? Array.from(document.querySelectorAll('#view-vault li.card[data-owner-id]')).find(c => c.dataset.ownerId === id1)
        : null;
      const editBtn = freshFirst
        ? Array.from(freshFirst.querySelectorAll('button')).find(b => b.textContent === 'Edit')
        : null;
      ok(!!editBtn, 'first card has an Edit button');
      if (editBtn) editBtn.click();
      const editOpen = await pcWait(() => {
        const h = document.querySelector('#view-vault h2');
        return h && /^Edit (person|vehicle)$/.test(h.textContent) ? h : null;
      });
      ok(!!editOpen, 'the Edit button opens the edit form, not the document list');

      // Leave the user on the profiles screen
      await pcShow('profiles');
    }
  } catch (e) {
    lines.push('FAIL  test stopped: ' + e.message);
  }
  alert('Profile card tests\n\n' + lines.join('\n'));
}

(function pcButton() {
  const bk = document.querySelector('.backup');
  if (!bk || document.getElementById('pc-test')) return;
  const b = document.createElement('button');
  b.id = 'pc-test';
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Run profile card tests';
  b.onclick = pcSelfTest;
  bk.appendChild(b);
})();
