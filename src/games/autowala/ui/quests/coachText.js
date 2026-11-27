// The tutorial card says what to PRESS; on a touch screen there is no keyboard, so the keyboard steps are re-worded for the on-screen
// controls (the steps themselves live in gameplay/quest-defs.js and stay keyboard-worded there). Pure, unit-tested in coachText.test.js.

const TOUCH_TEXT = {
  W: { label: 'Drive: hold GAS on the right, steer with the wheel on the left', te: 'నడపండి: కుడివైపు GAS నొక్కి ఉంచండి, ఎడమవైపు చక్రం తిప్పండి' },
  H: { label: 'Honk the horn: tap HORN', te: 'హార్న్ కొట్టండి: HORN నొక్కండి' },
  Esc: { label: 'Tap the pause button at the top, then tap Resume', te: 'పైన ఉన్న పాజ్ బటన్ నొక్కి, మళ్ళీ కొనసాగండి' },
};
// "press E" -> "tap E" in the steps that only mention the key inside a longer sentence
const SENTENCE_FIXES = [
  [/\bpress E\b/i, 'tap E'],
  [/E నొక్కండి/, 'E బటన్ నొక్కండి'],
];

/**
 * `step` = { label, te, key } from the tutorial snapshot (the current step); `touch` = is the player on a touch screen.
 * Returns { label, te, key } to show: on touch the key badge is dropped (there is no key to press) and the keyboard wording is replaced.
 */
// the tutorial snapshot only carries the key of the CURRENT step; the other steps (BRIEF, quest log) are recognised by their wording
const KEY_BY_LABEL = [
  [/^Drive\. W or the up arrow/i, 'W'],
  [/^Honk the horn\. Press H/i, 'H'],
  [/^Press Esc to pause/i, 'Esc'],
];
export const inferKey = (label) => (KEY_BY_LABEL.find(([re]) => re.test(String(label || ''))) || [])[1] || '';

export function coachStepText(step, touch) {
  const s = step || {};
  const key = s.key || (touch ? inferKey(s.label) : '');
  if (!touch) return { label: s.label || '', te: s.te || '', key };
  const swap = key && TOUCH_TEXT[key];
  if (swap) return { label: swap.label, te: swap.te, key: '' };
  let label = s.label || '';
  let te = s.te || '';
  for (const [re, to] of SENTENCE_FIXES) {
    label = label.replace(re, to);
    te = te.replace(re, to);
  }
  return { label, te, key: '' };
}
