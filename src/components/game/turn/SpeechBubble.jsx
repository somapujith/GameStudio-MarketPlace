// Speech bubbles next to a player's avatar (the scoreboard row / phone strip element with `data-fx-player`):
//   <SpeechBubble session />  the presenter's `session.bubble` (what just happened), for ~4 s at playback speed 1: it pops out
//                             of its tail (anchored on the avatar), settles with a spring and fades out
//   <EmoteFloats session />   quick reactions from chat (`{ emote }` messages): the emoji is thrown up over the sender's
//                             avatar with a spring pop, a wobble and a sideways sway, and a small burst of its own flies out
// Both are fixed overlays, never take pointer events, and fall back to the top of the screen when no avatar is found.
// Reduced motion: no pop, no burst; the bubble / emoji just fade.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSettings } from '@/lib/storage.js';
import { activePlayer, getPlayer, motionMs, motionToken, useMedia, useReducedMotion } from '../ui/helpers.js';
import { burstPath, swayPath } from '../fx/burst.js';
import { emoteInfo } from './emotes.js';
import '@/styles/turn.css';
import '@/styles/fx.css';

const BUBBLE_MS = 4200;
const LEAVE_MS = 240;
const EMOTE_MS = 2600;
const MAX_EMOTES = 4;

function findAnchor(id) {
  if (typeof document === 'undefined' || id == null) return null;
  const sel = `[data-fx-player="${String(id).replace(/["\\]/g, '\\$&')}"]`;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return null;
}

/** Where a bubble goes for an anchor rect. Pure; exported for tests. */
export function placeBubble(rect, vw, vh, maxHalf = 130) {
  const half = Math.max(60, Math.min(maxHalf, vw / 2 - 12));
  if (!rect) return { left: vw / 2, top: 72, below: true, tail: 0, half };
  const x = rect.left + rect.width / 2;
  const left = Math.min(Math.max(x, half + 12), vw - half - 12);
  const below = rect.top < 96;
  return below
    ? { left, top: rect.bottom + 10, below: true, tail: x - left, half }
    : { left, bottom: vh - rect.top + 10, below: false, tail: x - left, half };
}

function useAnchor(playerId, active) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!active || typeof window === 'undefined') {
      setPos(null);
      return undefined;
    }
    let raf = 0;
    const measure = () => setPos(placeBubble(findAnchor(playerId), window.innerWidth, window.innerHeight));
    measure();
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', later);
    window.addEventListener('scroll', later, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', later);
      window.removeEventListener('scroll', later, true);
    };
  }, [playerId, active]);
  return pos;
}

const styleFor = (pos) => {
  if (!pos) return undefined;
  const s = { left: `${pos.left}px`, '--tail': `${pos.tail}px`, '--half': `${pos.half}px` };
  if (pos.below) s.top = `${pos.top}px`;
  else s.bottom = `${pos.bottom}px`;
  return s;
};

/** Which player a presenter bubble belongs to: its own `player`, else the newest log line's, else the active player. */
export function bubbleSpeaker(session) {
  const b = session?.bubble;
  if (!b) return null;
  if (b.player != null) return String(b.player);
  const log = session.log || [];
  const last = log[log.length - 1];
  if (last && last.player != null) return String(last.player);
  const p = activePlayer(session);
  return p ? String(p.id) : null;
}

export default function SpeechBubble({ session }) {
  const [settings] = useSettings();
  const reduced = useReducedMotion();
  const speed = Number(settings?.playbackSpeed) > 0 ? Number(settings.playbackSpeed) : 1;
  const b = session?.bubble;
  const [shown, setShown] = useState(null);
  const timer = useRef(null);
  const lastId = useRef(b?.id ?? null); // the bubble that was up when the table mounted is not replayed

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!b || b.id === lastId.current) return;
    lastId.current = b.id;
    if (b.type === 'card' || !b.text) return; // the card reveal shows cards
    setShown({ id: b.id, text: b.text, tone: b.tone || 'info', icon: b.icon || null, player: bubbleSpeaker(session), leaving: false });
    clearTimeout(timer.current);
    const life = BUBBLE_MS / Math.max(0.75, speed);
    timer.current = setTimeout(() => {
      if (reduced) {
        setShown(null);
        return;
      }
      setShown((s) => (s ? { ...s, leaving: true } : s));
      timer.current = setTimeout(() => setShown(null), LEAVE_MS);
    }, life);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.id]);

  // portrait phones already get the toast, the centre caption and the floating amount for the same news: no fourth copy
  const phone = useMedia('(max-width: 599px)');
  const pos = useAnchor(shown?.player, !!shown && !phone);
  if (!shown || !pos || phone) return null;
  const p = getPlayer(session, shown.player);
  return (
    <div
      key={shown.id}
      className={`sb-bubble is-${shown.tone}${pos.below ? ' is-below' : ''}${shown.leaving ? ' is-leaving' : ''}`}
      style={{ ...styleFor(pos), '--pc': p?.color || 'var(--gold)' }}
      aria-hidden="true"
    >
      {shown.icon ? <span className="sb-bubble__ico">{shown.icon}</span> : null}
      <span className="sb-bubble__text">{shown.text}</span>
    </div>
  );
}

function EmoteFloat({ item, onDone, reduced }) {
  const pos = useAnchor(item.from, true);
  const burst = useRef(null);
  const big = useRef(null);
  useEffect(() => {
    const t = setTimeout(onDone, EMOTE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the throw: a spring pop with a wobble and a sway (the CSS animation does the rise), plus the burst of small emoji
  const ready = !!pos;
  useEffect(() => {
    if (!ready || reduced) return undefined;
    const anims = [];
    const ease = motionToken('--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)');
    const d3 = motionMs('--dur-3', 360);
    const host = burst.current;
    if (host && typeof host.animate === 'function') {
      const kids = host.children;
      for (let i = 0; i < kids.length; i += 1) {
        const pts = burstPath(i, kids.length, { radius: 40 + (i % 2) * 14, gravity: 34 });
        anims.push(
          kids[i].animate(
            pts.map((p) => ({ transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${p.s.toFixed(2)})`, opacity: p.o })),
            { duration: d3 * 2.6, delay: 60 + i * 28, easing: ease, fill: 'both' },
          ),
        );
      }
    }
    const el = big.current;
    if (el && typeof el.animate === 'function') {
      const sway = swayPath(6, 8);
      anims.push(
        el.animate(
          sway.map((x, k) => ({ transform: `translateX(${x.toFixed(1)}px) rotate(${(x * 1.6).toFixed(1)}deg)`, offset: k / (sway.length - 1) })),
          { duration: EMOTE_MS - 300, easing: 'ease-in-out', fill: 'both' },
        ),
      );
    }
    return () => anims.forEach((a) => { try { a.cancel(); } catch { /* ignore */ } });
  }, [ready, reduced]);

  if (!pos) return null;
  return (
    <div className={`sb-emote${pos.below ? ' is-below' : ''}`} style={styleFor(pos)} aria-hidden="true">
      <span className="sb-emote__stage" ref={big}>
        <span className="sb-emote__ring" />
        <span className="sb-emote__emoji">{item.emoji}</span>
        {reduced ? null : (
          <span className="sb-emote__burst" ref={burst}>
            {[0, 1, 2, 3, 4].map((k) => <i key={k}>{item.emoji}</i>)}
          </span>
        )}
      </span>
      <span className="sb-emote__label">{item.label}</span>
    </div>
  );
}

export function EmoteFloats({ session }) {
  const reduced = useReducedMotion();
  const chat = session?.chat || [];
  const last = chat[chat.length - 1];
  const seen = useRef(last?.id ?? null);
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!last || last.id === seen.current) return;
    // everything after the last one we handled (several can arrive in one render)
    const from = chat.findIndex((m) => m.id === seen.current);
    seen.current = last.id;
    const fresh = chat.slice(from + 1).filter((m) => m.emote && emoteInfo(m.emote));
    if (!fresh.length) return;
    setItems((cur) => [...cur, ...fresh.map((m) => ({ id: m.id, from: m.from, ...emoteInfo(m.emote) }))].slice(-MAX_EMOTES));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);

  return items.map((item) => (
    <EmoteFloat key={item.id} item={item} reduced={reduced} onDone={() => setItems((cur) => cur.filter((x) => x.id !== item.id))} />
  ));
}
