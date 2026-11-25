// Bubbles over customers' heads, positioned from scene.project() once per frame (transform only):
//   the ORDER bubble: TOKEN number + the dishes they still need (or the rupee note when they hold money out), tap to work on them;
//   the SPEECH bubble above it: what they just said (native script, with the English gloss under it when the subtitle mode says so),
//   coloured by mood: angry red, happy warm, impatient amber. At most three are shown; off-screen customers get none (their arrow chip
//   at the screen edge stands in for them).
import { useRef } from 'react';
import { freeBounds } from './EdgeIndicators.jsx';
import { clampBubble } from './offscreen.js';
import { formatINR } from '@shared/format.js';
import DishIcon from './DishIcon.jsx';
import HudIcon from './HudIcon.jsx';
import { subtitleLines, moodTone } from './dialogue.js';
import { useFrame } from './hooks.js';
import { activeCustomers, customerTarget, needsOf, tokenOf } from './hudLogic.js';

// `subId` is the id of the utterance the subtitle bar is showing right now: its world bubble is not drawn (the same line twice, one of them
// half behind a panel, was noise). The order bubble under it stays.
export default function WorldBubbles({ scene, state, onTarget, projector, getCookX, spotXOf, speech = [], bubbleIds = null, subs = 'both', rootRef = null, subId = null }) {
  const els = useRef(new Map());
  const bounds = useRef({ top: 0, bottom: 0, left: 0, right: 0, at: -1e9 });
  const register = (id, el) => {
    if (el) els.current.set(id, { el, last: '' });
    else els.current.delete(id);
  };
  useFrame((t, _frac, st) => {
    if (!projector || !scene?.project) return;
    const map = projector.frame(t, scene, st?.customers, { cookX: getCookX?.() ?? 0, spotXOf });
    // bubbles never paint over a HUD panel: they are held inside the free scene rectangle (re-measured a few times a second)
    const b = bounds.current;
    const w = projector.size.w || (typeof window !== 'undefined' ? window.innerWidth : 0);
    const h = projector.size.h || (typeof window !== 'undefined' ? window.innerHeight : 0);
    const remeasure = t - b.at > 400;
    if (remeasure) Object.assign(b, rootRef?.current ? freeBounds(rootRef.current, w, h) : { top: 0, bottom: h, left: 0, right: w }, { at: t });
    for (const [id, rec] of els.current) {
      const hit = map.get(id);
      const ok = !!hit && hit.on;
      // a speech bubble appearing or going makes the anchor taller: measure again then (a stale height let the bubble slide behind the top bar)
      const sayNow = rec.el.dataset.say || '0';
      if (remeasure || !rec.w || rec.say !== sayNow) {
        rec.w = rec.el.offsetWidth || 0;
        rec.h = rec.el.offsetHeight || 0;
        rec.say = sayNow;
      }
      const at = ok ? clampBubble(hit.p, { w: rec.w, h: rec.h }, b) : null;
      const key = at ? `${Math.round(at.x)},${Math.round(at.y)},${rec.w},${rec.h},${b.left},${b.right},${b.top},${b.bottom}` : 'off';
      if (key === rec.last) continue;
      rec.last = key;
      if (!at) {
        rec.el.dataset.hidden = '1';
      } else {
        rec.el.dataset.hidden = '0';
        rec.el.style.transform = `translate3d(${Math.round(at.x)}px, ${Math.round(at.y)}px, 0) translate(-50%, -100%)`;
      }
    }
  });
  const list = activeCustomers(state).filter((c) => c.st === 'waiting' || c.st === 'paying');
  const say = new Map(speech.filter((s) => (!bubbleIds || bubbleIds.has(s.u.id)) && (subId === null || s.u.id !== subId)).map((s) => [s.u.customer, s]));
  return (
    <div className="tc-hud-bubbles" aria-hidden="true">
      {list.map((c) => {
        const needs = needsOf(c).slice(0, 3);
        const s = say.get(c.id);
        return (
          <div key={c.id} ref={(el) => register(c.id, el)} className="tc-hud-anchor" data-hidden="1" data-say={s ? '1' : '0'}>
            {s && (
              <div className="tc-hud-say" data-tone={moodTone(s.u.mood)} data-leaving={s.leaving ? '1' : '0'} lang={s.u.lang === 'dk' ? 'hi' : s.u.lang}>
                {subtitleLines(s.u, subs).map((l) => (
                  <span key={l.kind} className={`tc-hud-say-${l.kind}`}>{l.text}</span>
                ))}
              </div>
            )}
            <button type="button" tabIndex={-1} className={`tc-hud-bubble${c.st === 'paying' ? ' is-pay' : ''}`} onClick={() => onTarget(customerTarget(c.id))}>
              <span className="tc-hud-bubble-token">
                <small>TOKEN</small>
                <b>{tokenOf(c)}</b>
              </span>
              <span className="tc-hud-bubble-what">
                {c.st === 'paying' ? (
                  <>
                    <HudIcon name="rupee" size={16} />
                    <b>{formatINR(c.total)}</b>
                  </>
                ) : (
                  needs.map((d, i) => <DishIcon key={i} dish={d} size={28} />)
                )}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
