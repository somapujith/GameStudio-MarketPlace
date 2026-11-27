// The interaction prompt chip, the drift flair and the full-screen effects (speed vignette + lines, crash flash, low-fuel edge).
import { useState } from 'react';
import { crashFlash, driftTier, promptAction, touchPromptText } from './hudLogic.js';
import { shallowEqual, useView } from './snapStore.js';
import { selDrift, selFx, selPrompt } from './views.js';
import { useGameEvent } from './useGameMenu.js';

export function Prompt({ prompt, touch, onTap }) {
  if (!prompt || !prompt.text) return null;
  const key = String(prompt.key || 'E').toUpperCase();
  const tappable = touch && !!promptAction(key);
  const body = (
    <>
      <kbd className="aw-keycap">{key}</kbd>
      <span>{tappable ? touchPromptText(prompt.text) : prompt.text}</span>
    </>
  );
  return tappable ? (
    <button type="button" className="aw-prompt is-tap" onClick={() => onTap(promptAction(key))}>
      {body}
    </button>
  ) : (
    <div className="aw-prompt" role="status">
      {body}
    </div>
  );
}

export function DriftFlair({ drifting, charge }) {
  if (!drifting) return null;
  const d = driftTier(charge);
  const C = 2 * Math.PI * 26;
  return (
    <div className={`aw-drift tier-${d.tier}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" width="64" height="64">
        <circle cx="32" cy="32" r="26" className="aw-drift__track" />
        <circle cx="32" cy="32" r="26" className="aw-drift__ring" strokeDasharray={`${(C * d.c).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 32 32)" />
      </svg>
      <div className="aw-drift__txt">
        <b>DRIFT</b>
        {d.label && <small>{d.label}</small>}
      </div>
    </div>
  );
}

/** The screen-edge effects. Reads the store's effects view (selFx: opacities in percents), so it renders when a percent moves, not on every km/h. */
export function Effects({ game }) {
  const [crash, setCrash] = useState({ n: 0, s: 0, soft: false });
  // kerb / lake scrapes are a faint amber spark; real crashes (buildings, landmarks, traffic) flash red
  useGameEvent(game, 'crash', (e) => {
    const f = crashFlash(e);
    setCrash((c) => ({ n: c.n + 1, s: f.strength, soft: f.soft }));
  });
  const fx = useView(selFx, shallowEqual);
  if (!fx) return null;
  return (
    <div className="aw-fx" aria-hidden="true">
      <div className={`aw-fx-vig ${fx.boosting ? 'is-boost' : ''}`} style={{ opacity: fx.vignette.toFixed(3) }} />
      {fx.lines > 0.03 && <div className={`aw-fx-lines ${fx.boosting ? 'is-boost' : ''}`} style={{ opacity: (fx.lines * 0.55).toFixed(3) }} />}
      {fx.fuelPulse && <div className="aw-fx-fuel" />}
      {fx.rage && <div className="aw-fx-rage" style={{ '--h': (0.35 + 0.65 * fx.rageHeat).toFixed(2) }} />}
      {crash.n > 0 && <div key={crash.n} className={`aw-fx-crash ${crash.soft ? 'is-soft' : ''}`} style={{ '--s': crash.soft ? Math.min(crash.s, 0.35) : crash.s }} />}
    </div>
  );
}

/** The interaction prompt, fed from the store (it changes when the game sets or clears one). */
export function PromptSlot({ touch, onTap }) {
  const prompt = useView(selPrompt);
  return <Prompt prompt={prompt} touch={touch} onTap={onTap} />;
}

/** The drift flair, fed from the store (it changes at the 2 % steps of the charge, and only while drifting). */
export function DriftSlot() {
  const d = useView(selDrift, shallowEqual);
  if (!d) return null;
  return <DriftFlair drifting={d.drifting} charge={d.charge} />;
}
