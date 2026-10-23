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
