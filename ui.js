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
