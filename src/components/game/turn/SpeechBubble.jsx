// Speech bubbles next to a player's avatar (the scoreboard row / phone strip element with `data-fx-player`):
//   <SpeechBubble session />  the presenter's `session.bubble` (what just happened), for ~2.6 s at playback speed 1
//   <EmoteFloats session />   quick reactions from chat (`{ emote }` messages) pop up over the sender's avatar
// Both are fixed overlays, never take pointer events, and fall back to the top of the screen when no avatar is found.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSettings } from '@/lib/storage.js';
import { activePlayer, getPlayer } from '../ui/helpers.js';
import { emoteInfo } from './emotes.js';
import '@/styles/turn.css';

const BUBBLE_MS = 2600;
const EMOTE_MS = 1900;

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
    setShown({ id: b.id, text: b.text, tone: b.tone || 'info', player: bubbleSpeaker(session) });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), BUBBLE_MS / Math.max(0.75, speed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.id]);

  const pos = useAnchor(shown?.player, !!shown);
  if (!shown || !pos) return null;
  const p = getPlayer(session, shown.player);
  return (
    <div
      key={shown.id}
      className={`sb-bubble is-${shown.tone}${pos.below ? ' is-below' : ''}`}
      style={{ ...styleFor(pos), '--pc': p?.color || 'var(--gold)' }}
      aria-hidden="true"
    >
      {shown.text}
    </div>
  );
}

function EmoteFloat({ item, onDone }) {
  const pos = useAnchor(item.from, true);
  useEffect(() => {
    const t = setTimeout(onDone, EMOTE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!pos) return null;
  return (
    <div className={`sb-emote${pos.below ? ' is-below' : ''}`} style={styleFor(pos)} aria-hidden="true">
      <span className="sb-emote__emoji">{item.emoji}</span>
      <span className="sb-emote__label">{item.label}</span>
    </div>
  );
}

export function EmoteFloats({ session }) {
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
    setItems((cur) => [...cur, ...fresh.map((m) => ({ id: m.id, from: m.from, ...emoteInfo(m.emote) }))].slice(-6));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);

  return items.map((item) => (
    <EmoteFloat key={item.id} item={item} onDone={() => setItems((cur) => cur.filter((x) => x.id !== item.id))} />
  ));
}
