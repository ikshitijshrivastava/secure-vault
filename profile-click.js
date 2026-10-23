/* ===== profile-click.js: tap a person or vehicle card to see its documents. Load after backup.js. ===== */
'use strict';

// Makes a card clickable. Buttons on the card (Edit, Delete) keep their own action.
function pcMakeClickable(li, ownerId) {
  li.style.cursor = 'pointer';
  li.setAttribute('role', 'button');
  li.setAttribute('tabindex', '0');
  li.title = 'Tap to see documents';
  li.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    pcOpenOwner(ownerId);
  });
  li.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.target.closest('button')) pcOpenOwner(ownerId);
  });
  return li;
}

// Opens the dashboard already filtered to this person or vehicle
async function pcOpenOwner(ownerId) {
  await vuGo('dash');
  const sel = document.querySelector('#view-vault .toolbar select');
  if (sel) {
    sel.value = ownerId;
    sel.dispatchEvent(new Event('change'));
  }
}

const pcBasePersonCard = vuPersonCard;
vuPersonCard = async function (p, all) {
  const li = await pcBasePersonCard(p, all);
  return pcMakeClickable(li, p.id);
};

const pcBaseVehicleCard = vuVehicleCard;
vuVehicleCard = function (v, all) {
  return pcMakeClickable(pcBaseVehicleCard(v, all), v.id);
};

const pcBaseProfiles = vuProfiles;
vuProfiles = async function (body) {
  body.append(vuEl('p', { cls: 'hint', text: "Tap a coloured card to see that person's or vehicle's documents. Use Edit or Delete on the card for changes." }));
  return pcBaseProfiles(body);
};
