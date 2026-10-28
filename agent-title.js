/* ===== agent-title.js. Create this file. Fixes voter/elector names and single-word names in the title. ===== */
'use strict';

// Name labels used on voter IDs and similar cards
for (const text of ['elector s name', 'elector name', 'electors name', 'voter name', 'name of elector']) {
  const words = agNorm(text).split(' ').filter(Boolean);
  const exists = AG_PHRASES.some(p => p.field === 'holder' && p.words.join(' ') === words.join(' '));
  if (!exists) AG_PHRASES.push({ field: 'holder', text, words, strict: true });
}

// Keeps the two-word rule, and accepts one clear name when a name label was used
const AT2_TWO_WORD_NAME = agName;
const AT2_NOT_A_NAME = /^(name|elector|electors|holder|owner|insured|student|candidate|employee|applicant|sri|shri)$/i;

agName = function (raw) {
  const full = AT2_TWO_WORD_NAME(raw);
  if (full) return full;
  const first = String(raw || '').split(/[\d(\[{@|:,]/)[0].trim().split(/\s+/)[0] || '';
  const word = first.replace(/[^A-Za-z]/g, '');
  if (word.length < 3) return null;
  if (AG_NOT_NAME.has(word.toLowerCase()) || AG_ORG.test(word) || AT2_NOT_A_NAME.test(word)) return null;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
};
