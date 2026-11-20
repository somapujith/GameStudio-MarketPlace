// The card reveal, centred over the board while a card event plays.
// Source: `session.card` ({ player, deck: 'luck'|'drama', title, text, kind, cardId }) from the presenter; until the
// presenter provides it, the card bubble (`session.bubble.card`) is used. The card back flips to its face
// (Nawabi Luck = gold / emerald, City Drama = rose / indigo). Tap or Escape dismisses it early; it also hides itself
// after the card's time (cardMs: long enough to read the title and sentence, at the playback speed). Reduced motion: a plain fade.
// Moment layers (moments/moments.css): the card flies in as a deck back and flips in 3D, tilts toward the pointer on
// desktop, shows its effect as a coloured chip (+₹80,000 green / -₹50,000 red / "Snatch button" gold bolt), pops gold
// sparkles on good news or shakes under a red vignette on bad news, and on leaving eases toward the pod of the player it
// affects. Closing early is client-only: the table keeps its own pace (the presenter waits for cardMs regardless).
// Screen readers: the reveal itself is not live; GameView announces `cardAnnouncement()` through the table's one
// polite live region (useCardAnnouncer).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardMs } from '@shared/timing.js';
import { useSettings } from '@/lib/storage.js';
import EventCardArt from '@/components/art/EventCardArt.jsx';
import CardBack from '@/components/art/CardBack.jsx';
import { getPlayer, useReducedMotion } from '../ui/helpers.js';
import { BoltIcon } from '../ui/SnatchChip.jsx';
import { wordsOf } from '@/lib/mapWords.js';
import Confetti from '../moments/Confetti.jsx';
import { cardEffect } from '../moments/momentsModel.js';
import { GOLD_PALETTE } from '../moments/particles.js';
import '@/styles/turn.css';
import '../moments/moments.css';

export const DECKS = {
  luck: { name: 'Nawabi Luck', mark: '✦' },
  drama: { name: 'City Drama', mark: '❖' },
};

const TONES = {
  good: { label: 'Good news', icon: '▲' },
  bad: { label: 'Ouch', icon: '▼' },
  neutral: { label: 'Twist', icon: '◆' },
};

const LEAVE_MS = 400;
const SPARKS = [...GOLD_PALETTE, '#3ddc97'];
const SPARK_ORIGIN = [0.5, 0.5];

/** The card to show, normalised. Pure; exported for tests. -> null | { ref, deck, deckName, title, text, kind, player } */
export function cardOf(session) {
  const c = session && 'card' in session ? session.card : session?.bubble?.type === 'card' ? session.bubble.card : null;
  if (!c || (!c.title && !c.text)) return null;
  const deck = c.deck === 'drama' ? 'drama' : 'luck';
  const kind = TONES[c.kind] ? c.kind : 'neutral';
  return {
    ref: session && 'card' in session ? c : session.bubble, // identity: a new object = a new reveal
    deck,
    deckName: wordsOf()[deck], // "Nawabi Luck" / "Mana Adrushtam"
    title: c.title || wordsOf()[deck],
    text: c.text || '',
    kind,
    cardId: c.cardId || c.id || null,
    capped: !!c.capped, // a Snatch card drawn at the card cap: it pays money instead of a button (its text says so)
    player: c.player ?? null,
  };
}

/** "Nawabi Luck: An investor is impressed! +1,00,000" - the line the live region reads. Pure; exported for tests. */
export function cardAnnouncement(card) {
  if (!card) return '';
  return `${card.deckName}: ${card.title}.${card.text ? ` ${card.text}` : ''}`;
}

/** Calls `say(text)` once per new card (identity of the card object). */
export function useCardAnnouncer(session, say) {
  const card = cardOf(session);
  const ref = card?.ref || null;
  const last = useRef(null);
  const sayRef = useRef(say);
  sayRef.current = say;
  useEffect(() => {
    if (!ref || ref === last.current) return;
    last.current = ref;
    sayRef.current?.(cardAnnouncement(card));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
}

/** The pod / strip of a player (the element a card eases out toward), or null. */
function anchorOf(id) {
  if (typeof document === 'undefined' || id == null) return null;
  const sel = `[data-fx-player="${String(id).replace(/["\\]/g, '\\$&')}"]`;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return null;
}

export default function CardReveal({ session }) {
  const [settings] = useSettings();
  const reduced = useReducedMotion();
  const speed = Number(settings?.playbackSpeed) > 0 ? Number(settings.playbackSpeed) : 1;
  const card = cardOf(session);
  const [held, setHeld] = useState(null); // { card, leaving }
  const lastRef = useRef(null);
  const sequence = useRef(0);
  const rootRef = useRef(null);
  const hitRef = useRef(null);
  const tiltRef = useRef(null);
  const frame = useRef(0);

  // leaving: aim the exit at the pod of the player the card affects (set as CSS variables, read by mo-card-out)
  const leave = () => {
    const root = rootRef.current;
    const hit = hitRef.current;
    const target = held?.card?.player;
    if (root && hit && !reduced) {
      const a = anchorOf(target);
      const r = hit.getBoundingClientRect();
      if (a && r.width > 0) {
        root.style.setProperty('--cr-dx', `${Math.round(a.left + a.width / 2 - (r.left + r.width / 2))}px`);
        root.style.setProperty('--cr-dy', `${Math.round(a.top + a.height / 2 - (r.top + r.height / 2))}px`);
        root.style.setProperty('--cr-s', '0.16');
        root.style.setProperty('--cr-r', '-8deg');
      }
    }
    setHeld((h) => (h && !h.leaving ? { ...h, leaving: true } : h));
  };

  // a new card object -> a new reveal; the card going away -> exit
  const ref = card?.ref || null;
  useEffect(() => {
    if (ref && ref !== lastRef.current) {
      lastRef.current = ref;
      setHeld({ card, leaving: false, sequence: ++sequence.current });
    } else if (!ref && lastRef.current && session?.card === null) {
      lastRef.current = null;
      leave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  // the card's time, then the exit, then gone; armed from the held state so it survives remounts
  const heldRef = held?.card?.ref || null;
  const leaving = !!held?.leaving;
  useEffect(() => {
    if (!heldRef) return undefined;
    const ms = leaving
      ? (reduced ? 60 : LEAVE_MS + 40)
      : Math.max(1500, cardMs(held.card) / Math.max(0.75, speed)) + 400;
    const t = setTimeout(leaving ? () => setHeld(null) : leave, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldRef, leaving]);

  useEffect(() => {
    if (!held || held.leaving) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // the card follows the pointer a little (desktop mouse / pen only): a tilt and a glare, set straight on the element
  const onMove = (e) => {
    if (reduced || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
    const el = tiltRef.current;
    if (!el) return;
    const x = e.clientX;
    const y = e.clientY;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;
      const nx = Math.max(-1, Math.min(1, ((x - r.left) / r.width - 0.5) * 2));
      const ny = Math.max(-1, Math.min(1, ((y - r.top) / r.height - 0.5) * 2));
      el.classList.add('is-live');
      el.style.setProperty('--rx', `${(-ny * 7).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(nx * 9).toFixed(2)}deg`);
      el.style.setProperty('--gx', `${((x - r.left) / r.width) * 100}%`);
      el.style.setProperty('--gy', `${((y - r.top) / r.height) * 100}%`);
      el.style.setProperty('--gl', '1');
    });
  };
  const onLeave = () => {
    cancelAnimationFrame(frame.current);
    const el = tiltRef.current;
    if (!el) return;
    el.classList.remove('is-live');
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--gl', '0');
  };

  if (!held) return null;
  const c = held.card;
  const drawer = c.player != null ? getPlayer(session, c.player) : null;
  const who = drawer ? (String(drawer.id) === String(session.me) ? 'You drew' : `${drawer.name} drew`) : 'Card drawn';
  const tone = TONES[c.kind];
  const eff = cardEffect(c);

  const reveal = (
    <div
      ref={rootRef}
      className={`cr-root cr-illustrated${held.leaving ? ' is-leaving' : ''}`}
      data-deck={c.deck}
      data-kind={c.kind}
      data-rm={reduced ? '' : undefined}
    >
      {c.kind === 'good' ? <span className="mo-card-glow" aria-hidden="true" /> : null}
      {c.kind === 'bad' ? <span className="mo-card-vig" aria-hidden="true" /> : null}
      <button
        ref={hitRef}
        type="button"
        className="cr-hit"
        onClick={leave}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        aria-label={`${c.deckName} card: ${c.title}. ${c.text} Tap to close.`}
      >
        <span className="mo-card-shake" aria-hidden="true">
          <span className="mo-card-tilt" ref={tiltRef}>
            <span className="cr-card">
              <span className="cr-card__inner" key={held.sequence}>
                <span className="cr-face cr-back">
                  <span className="cr-back__art"><CardBack deck={c.deck} size={130} /></span>
                  <span className="cr-back__name">{c.deckName}</span>
                </span>
                <span className="cr-face cr-front">
                  <span className="cr-front__deck">{c.deckName}</span>
                  <span className="cr-front__who" style={drawer ? { '--pc': drawer.color } : undefined}>{who}</span>
                  <span className="cr-front__art"><EventCardArt cardId={c.cardId} kind={c.kind} deck={c.deck} animated={!reduced} capped={c.capped} /></span>
                  <b className="cr-front__title">{c.title}</b>
                  {c.text ? <span className="cr-front__text">{c.text}</span> : null}
                  <span className="mo-eff-row">
                    {eff ? (
                      <span className="mo-eff" data-tone={eff.tone}>
                        {eff.bolt ? <BoltIcon size={16} /> : null}
                        {eff.label}
                      </span>
                    ) : null}
                    <span className="cr-front__tone">
                      <i>{tone.icon}</i>
                      {tone.label}
                    </span>
                  </span>
                </span>
              </span>
            </span>
            <i className="mo-card-glare" />
          </span>
        </span>
        <span className="cr-tap" aria-hidden="true">Tap to close</span>
      </button>
      {c.kind === 'good' && !held.leaving ? (
        <Confetti key={held.sequence} kind="sparkle" count={36} origin={SPARK_ORIGIN} colors={SPARKS} delay={760} speed={2.6} />
      ) : null}
    </div>
  );
  // The phone board is height-constrained and clips its table. A card must have
  // enough viewport space for the complete rule, independent of the wallet dock.
  return typeof document === 'undefined' ? reveal : createPortal(reveal, document.body);
}
