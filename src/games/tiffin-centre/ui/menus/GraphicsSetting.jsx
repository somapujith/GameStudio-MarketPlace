// The GRAPHICS setting (pause menu and the home screen): Auto / High / Medium / Low / Lite. The tier is chosen when the stall is built, so a change
// applies the next time the stall is opened (said in words under the picker). Imports ONLY the pure capabilities module,
// so the 3D engine stays out of the home chunk.
import { useState } from 'react';
import { GFX_PREFS, getGfxPref, setGfxPref } from '../../scene/capabilities.js';
import Segmented from './Segmented.jsx';
import './menus.css';

/** Label + one-line note per setting, in picker order (the ids are capabilities.GFX_PREFS). */
export const GFX_OPTIONS = [
  { id: 'auto', label: 'Auto', hint: 'Picks the best look this device can hold steady', note: 'Auto picks the best look this device can hold steady. Start here.' },
  { id: 'high', label: 'High', hint: 'Full lighting, shadows and glow', note: 'High: full lighting, shadows and glow. Needs a strong graphics card.' },
  { id: 'medium', label: 'Medium', hint: 'Lighting and glow at a lower cost', note: 'Medium: lights, shadows and glow at a lower cost. A good laptop or newer phone.' },
  { id: 'low', label: 'Low', hint: 'Simple lighting, smooth on most phones', note: 'Low: simple lighting, no glow. Smooth on most phones.' },
  { id: 'lite', label: 'Lite', hint: 'For the weakest phones, 30 fps', note: 'Lite: the plainest look, for the weakest phones. Capped at 30 fps to save the battery.' },
];

const WORD = { high: 'High', medium: 'Medium', low: 'Low', lite: 'Lite' };

/**
 * What the picker says about the tier the stall is running at (or null when nothing is known): `info` is `scene.getTierInfo()` =
 * { tier, start, pref, auto, ... }. Words only the facts that exist; the scaler may have stepped down from the starting tier.
 */
export function tierNote(info) {
  const t = info && WORD[info.tier];
  if (!t) return null;
  const start = info.start && info.start !== info.tier ? WORD[info.start] : null;
  const how = info.pref && info.pref !== 'auto' ? 'your choice' : 'picked by Auto';
  return start ? `Running at ${t} now (started at ${start}, stepped down to keep it smooth).` : `Running at ${t} now (${how}).`;
}

/**
 * What to tell the player when the picked setting is not what the running stall was built with (or null when they agree / nothing is known).
 * `info` is scene.getTierInfo(); `pref` the setting just picked; `canApply` is true when an "Apply now" button is offered. Honest in both directions:
 * the running tier is named, and so is when the pick takes effect.
 */
export function pendingNote(info, pref, canApply = false) {
  const running = info && WORD[info.tier];
  if (!running || !info.pref || info.pref === pref) return null;
  const picked = pref === 'auto' ? 'Auto' : WORD[pref] || pref;
  const when = canApply ? 'Press Apply now to rebuild the picture at once (the shift stays paused), or it starts the next time you open the stall.' : 'It starts the next time you open the stall.';
  return `You picked ${picked}, but the stall is still running at ${running}. ${when}`;
}

/** The note shown for the selected setting. */
export const gfxNote = (pref) => (GFX_OPTIONS.find((o) => o.id === pref) || GFX_OPTIONS[0]).note;

/** The hint that the choice is not instant. */
export const GFX_APPLY_HINT = 'Applies the next time you open the stall.';

function readInfo(tierInfo) {
  try {
    const v = typeof tierInfo === 'function' ? tierInfo() : tierInfo;
    if (v) return v;
    // the glue publishes the live scene for the console and screenshots; reading it here needs no import of the scene module
    return (typeof window !== 'undefined' && window.__tiffin?.scene?.getTierInfo?.()) || null;
  } catch {
    return null;
  }
}

/**
 * Props: { tierInfo? (object, or a function returning scene.getTierInfo()), idPrefix?, onApply? }. Saved on this device (localStorage via setGfxPref).
 * `onApply` (the pause menu passes it) rebuilds the picture at the picked tier right now; without it the choice starts the next time the stall opens.
 */
export default function GraphicsSetting({ tierInfo = null, idPrefix = 'tc-gfx', onApply = null }) {
  const [pref, setPref] = useState(() => getGfxPref());
  const info = readInfo(tierInfo);
  const now = tierNote(info);
  const pending = pendingNote(info, pref, typeof onApply === 'function');
  return (
    <div className="tc-menu-gfx" data-gfx={pref}>
      <p className="tc-menu-set__h" id={`${idPrefix}-h`}>Graphics</p>
      <Segmented
        wrap
        label="Graphics"
        options={GFX_OPTIONS.filter((o) => GFX_PREFS.includes(o.id))}
        value={pref}
        onChange={(v) => setPref(setGfxPref(v))}
      />
      <p className="tc-menu-set__small" id={`${idPrefix}-note`} aria-live="polite">{gfxNote(pref)}</p>
      {now && <p className="tc-menu-set__small tc-menu-gfx__now">{now}</p>}
      {pending ? (
        <>
          <p className="tc-menu-set__small tc-menu-gfx__apply" role="status">{pending}</p>
          {typeof onApply === 'function' && (
            <button type="button" className="tc-menu-btn tc-menu-btn--sm tc-menu-btn--plank" onClick={() => onApply(pref)}>
              Apply now
            </button>
          )}
        </>
      ) : (
        <p className="tc-menu-set__small tc-menu-gfx__apply">{GFX_APPLY_HINT}</p>
      )}
    </div>
  );
}
