// The card reveal, centred over the board while a card event plays.
// Source: `session.card` ({ player, deck: 'luck'|'drama', title, text, kind, cardId }) from the presenter; until the
// presenter provides it, the card bubble (`session.bubble.card`) is used. The card back flips to its face
// (Nawabi Luck = gold / emerald, City Drama = rose / indigo). Tap or Escape dismisses it early; it also hides itself
// after the card's time (cardMs: long enough to read the title and sentence, at the playback speed). Reduced motion: a plain fade.
// Screen readers: the reveal itself is not live; GameView announces `cardAnnouncement()` through the table's one
// polite live region (useCardAnnouncer).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardMs } from '@shared/timing.js';
import { useSettings } from '@/lib/storage.js';
import EventCardArt from '@/components/art/EventCardArt.jsx';
import CardBack from '@/components/art/CardBack.jsx';
import { getPlayer, motionMs, useReducedMotion } from '../ui/helpers.js';
import '@/styles/turn.css';

export const DECKS = {
  luck: { name: 'Nawabi Luck', mark: '✦' },
  drama: { name: 'City Drama', mark: '❖' },
};

const TONES = {
  good: { label: 'Good news', icon: '▲' },
  bad: { label: 'Ouch', icon: '▼' },
  neutral: { label: 'Twist', icon: '◆' },
};

/** The card to show, normalised. Pure; exported for tests. -> null | { ref, deck, deckName, title, text, kind, player } */
export function cardOf(session) {
  const c = session && 'card' in session ? session.card : session?.bubble?.type === 'card' ? session.bubble.card : null;
  if (!c || (!c.title && !c.text)) return null;
  const deck = c.deck === 'drama' ? 'drama' : 'luck';
  const kind = TONES[c.kind] ? c.kind : 'neutral';
  return {
    ref: session && 'card' in session ? c : session.bubble, // identity: a new object = a new reveal
    deck,
    deckName: DECKS[deck].name,
    title: c.title || DECKS[deck].name,
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

export default function CardReveal({ session }) {
  const [settings] = useSettings();
  const reduced = useReducedMotion();
  const speed = Number(settings?.playbackSpeed) > 0 ? Number(settings.playbackSpeed) : 1;
  const card = cardOf(session);
  const [held, setHeld] = useState(null); // { card, leaving }
  const lastRef = useRef(null);
  const sequence = useRef(0);
  const leave = () => {
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

  // the card's time, then the exit (--dur-2 + a frame), then gone; armed from the held state so it survives remounts
  const heldRef = held?.card?.ref || null;
  const leaving = !!held?.leaving;
  useEffect(() => {
    if (!heldRef) return undefined;
    const ms = leaving
      ? motionMs('--dur-2', 220) + 40
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

  if (!held) return null;
  const c = held.card;
  const drawer = c.player != null ? getPlayer(session, c.player) : null;
  const who = drawer ? (String(drawer.id) === String(session.me) ? 'You drew' : `${drawer.name} drew`) : 'Card drawn';
  const tone = TONES[c.kind];

  const reveal = (
    <div className={`cr-root cr-illustrated${held.leaving ? ' is-leaving' : ''}`} data-deck={c.deck} data-kind={c.kind} data-rm={reduced ? '' : undefined}>
      <button type="button" className="cr-hit" onClick={leave} aria-label={`${c.deckName} card: ${c.title}. ${c.text} Tap to close.`}>
        <span className="cr-card" aria-hidden="true">
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
              <span className="cr-front__tone">
                <i>{tone.icon}</i>
                {tone.label}
              </span>
            </span>
          </span>
        </span>
        <span className="cr-tap" aria-hidden="true">Tap to close</span>
      </button>
    </div>
  );
  // The phone board is height-constrained and clips its table. A card must have
  // enough viewport space for the complete rule, independent of the wallet dock.
  return typeof document === 'undefined' ? reveal : createPortal(reveal, document.body);
}
