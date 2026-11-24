// Bubbles over customers' heads, positioned from scene.project() once per frame (transform only):
//   the ORDER bubble: TOKEN number + the dishes they still need (or the rupee note when they hold money out), tap to work on them;
//   the SPEECH bubble above it: what they just said (native script, with the English gloss under it when the subtitle mode says so),
//   coloured by mood: angry red, happy warm, impatient amber. At most three are shown; off-screen customers get none (their arrow chip
//   at the screen edge stands in for them).
import { useRef } from 'react';
import { formatINR } from '@shared/format.js';
import DishIcon from './DishIcon.jsx';
import HudIcon from './HudIcon.jsx';
import { subtitleLines, moodTone } from './dialogue.js';
import { useFrame } from './hooks.js';
import { activeCustomers, customerTarget, needsOf, tokenOf } from './hudLogic.js';

export default function WorldBubbles({ scene, state, onTarget, projector, getCookX, spotXOf, speech = [], bubbleIds = null, subs = 'both' }) {
  const els = useRef(new Map());
  const register = (id, el) => {
    if (el) els.current.set(id, { el, last: '' });
    else els.current.delete(id);
  };
  useFrame((t, _frac, st) => {
    if (!projector || !scene?.project) return;
    const map = projector.frame(t, scene, st?.customers, { cookX: getCookX?.() ?? 0, spotXOf });
    for (const [id, rec] of els.current) {
      const hit = map.get(id);
      const ok = !!hit && hit.on;
      const key = ok ? `${Math.round(hit.p.x)},${Math.round(hit.p.y)}` : 'off';
      if (key === rec.last) continue;
      rec.last = key;
      if (!ok) {
        rec.el.dataset.hidden = '1';
      } else {
        rec.el.dataset.hidden = '0';
        rec.el.style.transform = `translate3d(${Math.round(hit.p.x)}px, ${Math.round(hit.p.y)}px, 0) translate(-50%, -100%)`;
      }
    }
  });
  const list = activeCustomers(state).filter((c) => c.st === 'waiting' || c.st === 'paying');
  const say = new Map(speech.filter((s) => !bubbleIds || bubbleIds.has(s.u.id)).map((s) => [s.u.customer, s]));
  return (
    <div className="tc-hud-bubbles" aria-hidden="true">
      {list.map((c) => {
        const needs = needsOf(c).slice(0, 3);
        const s = say.get(c.id);
        return (
          <div key={c.id} ref={(el) => register(c.id, el)} className="tc-hud-anchor" data-hidden="1">
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
