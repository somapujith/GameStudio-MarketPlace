// OWNER: HUD agent. Toast stack (game.on 'toast') and the floating "+Rs 120" bursts near the wallet (game.on 'wallet'). Props: { game }.
// The queue rules (cap, merge, expiry) live in hud/toastQueue.js; this file only subscribes, schedules one timer and renders.
import { useEffect, useRef, useState } from 'react';
import { BoltIcon, CheckIcon, CoinIcon, FlagIcon } from './hud/icons.jsx';
import { expireBursts, expireToasts, nextExpiry, pushBurst, pushToast } from './hud/toastQueue.js';
import { toastCap } from './hud/layoutLogic.js';
import { useHudLayout } from './hud/useHudLayout.js';
import './hud/toasts.css';

const TONE_ICON = { good: CheckIcon, gold: CoinIcon, bad: BoltIcon, info: FlagIcon };

export default function Toasts({ game }) {
  const [toasts, setToasts] = useState([]);
  const [bursts, setBursts] = useState([]);
  const live = useRef({ toasts: [], bursts: [], id: 0, timer: 0 });
  const cap = toastCap(useHudLayout()); // 4 on desktop, 3 on phones and tablets (1 on a short portrait phone)
  const capRef = useRef(cap);
  capRef.current = cap;

  useEffect(() => {
    if (!game) return undefined;
    const L = live.current;
    L.toasts = [];
    L.bursts = [];
    const push = () => {
      setToasts(L.toasts);
      setBursts(L.bursts);
    };
    const schedule = () => {
      clearTimeout(L.timer);
      const now = performance.now();
      const a = nextExpiry(L.toasts, now);
      const b = L.bursts.length ? Math.max(0, Math.min(...L.bursts.map((x) => x.until)) - now) : null;
      const wait = a == null ? b : b == null ? a : Math.min(a, b);
      if (wait == null) return;
      L.timer = setTimeout(() => {
        const t = performance.now();
        L.toasts = expireToasts(L.toasts, t);
        L.bursts = expireBursts(L.bursts, t);
        push();
        schedule();
      }, wait + 16);
    };
    const off = game.on((e) => {
      const now = performance.now();
      if (e.type === 'toast') L.toasts = pushToast(expireToasts(L.toasts, now), e, now, ++L.id, capRef.current);
      else if (e.type === 'wallet') L.bursts = pushBurst(L.bursts, e, now, ++L.id);
      else return;
      push();
      schedule();
    });
    return () => {
      off();
      clearTimeout(L.timer);
      L.toasts = [];
      L.bursts = [];
    };
  }, [game]);

  return (
    <>
      <div className="aw-bursts" aria-hidden="true">
        {bursts.map((b) => (
          <div key={b.id} className={`aw-burst tone-${b.tone}`}>
            <b>{b.text}</b>
            {b.label && <small>{b.label}</small>}
          </div>
        ))}
      </div>
      <div className="aw-toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone] || FlagIcon;
          return (
            <div key={t.id} className={`aw-toast tone-${t.tone} ${t.leaving ? 'is-leaving' : ''}`}>
              <span className="aw-toast__icon">{t.icon ? <span aria-hidden="true">{t.icon}</span> : <Icon size={16} />}</span>
              <span className="aw-toast__text">{t.text}</span>
              {t.count > 1 && <em className="aw-toast__count">x{t.count}</em>}
            </div>
          );
        })}
      </div>
    </>
  );
}
