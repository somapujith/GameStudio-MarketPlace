// Power Cards, player-facing hand: the pure view-model (no React, no DOM). Spec: docs/POWER_CARDS.md sections 2 and 3.
//   buildPowerView(session)   the tray's whole view: rule on/off, can I play, why not, the cards (state, reasons, expiry), the rivals
//   targetsFor(view, card)    the Swap Tiles rivals for one card: eligible ones first-class, ineligible ones with their reason
//   playAction(card, target)  the exact `PLAY_POWER` action. `target` is OMITTED unless the card is Swap Tiles (the server rejects
//                             `target: null` / '' / undefined-as-null before the engine runs)
//   expiryInfo(left, name)    the 3-pip meter, "Last round" and the aria label ("Shield, 2 rounds left")
//   selectionReducer          select -> confirm -> play (+ the Swap Tiles targeting steps), see `INITIAL_SELECTION`
//   stepIndex(i, key, n)      arrow-key / Home / End roving index
// Wire contract read here: session.options.power = { canPlay, reason?, cards: [{ uid, id, exp, ok, reason?, targets? }] },
// players[].hand / shield / doubleRent, state.powerPlayed, state.round. Stored games may lack all of it: every read has a fallback.
import { POWER, powerCardById } from '@shared/powerCards.js';

/** DOM CustomEvent names (window): the guide sheet listens for the first, the board layer may listen for the second. */
export const POWER_GUIDE_EVENT = 'hg:power-guide';
export const POWER_TARGET_EVENT = 'hg:power-target';
export const COACH_KEY = 'hg:power-coach';
export const COACH_TEXT = 'Play one power card before you roll. Others can see how many you hold, not which.';

export const PIPS = POWER.LIFE_ROUNDS;
const EMPTY = Object.freeze([]);

/** Rounds in which a card can still be played, this one included (`exp` is the LAST round it can be played). null = unknown. */
export function roundsLeft(exp, round) {
  if (exp == null || round == null) return null;
  const e = Number(exp);
  const r = Number(round);
  if (!Number.isFinite(e) || !Number.isFinite(r)) return null;
  return Math.max(0, Math.trunc(e) - Math.trunc(r) + 1);
}

/**
 * The expiry meter for `left` rounds. pips = PIPS booleans (more than PIPS left still shows a full meter; the text is honest).
 * -> { left, pips, last, text, aria }  text: "3 rounds left" | "1 round left" | "Last round"; aria: "Shield, 2 rounds left".
 */
export function expiryInfo(left, name = '') {
  if (left == null) return { left: null, pips: EMPTY, last: false, text: '', aria: name };
  const last = left === 1;
  const text = left <= 0 ? 'Expired' : last ? 'Last round' : `${left} rounds left`;
  const pips = Array.from({ length: PIPS }, (_, i) => left > i);
  const tail = left <= 0 ? 'expired' : last ? 'last round' : `${left} rounds left`;
  return { left, pips, last, text, aria: name ? `${name}, ${tail}` : tail };
}

export const playersOf = (session) => session?.display?.players ?? session?.view?.players ?? EMPTY;

/** Why a card cannot be played when the engine gave no reason (options blanked while the table animates, an old server, ...). */
export function fallbackReason({ myTurn, played, busy }) {
  if (!myTurn) return 'Not your turn';
  if (played) return 'Already played a card this turn';
  if (busy) return 'Wait for the moves to finish';
  return 'You can play a card before you roll';
}

/** Why a rival cannot be swapped with. */
export function rivalReason(rival, me) {
  if (rival.bankrupt) return 'Out of the game';
  if (rival.stuck) return 'Stuck in the Traffic Jam';
  if (me?.stuck) return 'You are stuck in the Traffic Jam';
  return 'Cannot swap with them right now';
}

/**
 * The tray's view of the game.
 * -> {
 *   on          the rule is on (options.power exists, or it is null/blank while cfg.powerCards says on)
 *   blank       on, but options.power is blanked (presenter animating / request in flight): nothing can be played now
 *   canPlay, reason, played (state.powerPlayed on my turn), myTurn, round,
 *   cards       [{ uid, id, name, tone, short, long, exp, left, expiry, ok, playable, reason, targetIds }]  (my hand order)
 *   rivals      [{ id, name, avatar, color, piece, bankrupt, stuck }]  everybody else
 *   me          my player (or null)
 * }
 */
export function buildPowerView(session) {
  const options = session?.options;
  const view = session?.view;
  const power = options && typeof options === 'object' ? options.power : undefined;
  const cfgOn = view?.cfg?.powerCards === true;
  const on = !!power || (power === null && (cfgOn || (options && 'power' in options))) || (power === undefined && cfgOn && !!options);
  if (!on) return { on: false, blank: false, canPlay: false, reason: '', played: false, myTurn: false, round: null, cards: EMPTY, rivals: EMPTY, me: null };

  const me = session?.me;
  const players = playersOf(session);
  // the hand comes from player state (display = in step with the animation, view = latest), NEVER from options.power, which is
  // blanked while the presenter animates; options only say what is playable
  const mineDisplay = players.find((p) => p.id === me) || null;
  const mine = Array.isArray(mineDisplay?.hand) ? mineDisplay : (view?.players || EMPTY).find((p) => p.id === me) || mineDisplay;
  const turnPlayer = players[view?.turn ?? session?.display?.turn];
  const myTurn = !!turnPlayer && turnPlayer.id === me;
  const round = view?.round ?? session?.display?.round ?? null;
  const played = !!(view?.powerPlayed || session?.display?.powerPlayed) && myTurn;
  const blank = !power;

  const optCards = Array.isArray(power?.cards) ? power.cards : EMPTY;
  const optOf = (uid) => optCards.find((c) => c && c.uid === uid) || null;
  const hand = Array.isArray(mine?.hand) ? mine.hand.filter((c) => c && !c.hidden && c.uid && powerCardById(c.id)) : EMPTY;
  const source = hand.length ? hand : optCards.filter((c) => c && c.uid && powerCardById(c.id));

  const canPlay = !!power && power.canPlay !== false && !played;
  const reason = canPlay ? '' : power?.reason || fallbackReason({ myTurn, played, busy: blank });

  const cards = source.map((c) => {
    const meta = powerCardById(c.id);
    const opt = optOf(c.uid);
    const exp = Number.isFinite(c.exp) ? c.exp : opt?.exp;
    const left = roundsLeft(exp, round);
    const ok = canPlay && (opt ? opt.ok !== false : true);
    return {
      uid: c.uid,
      id: c.id,
      name: meta.name,
      tone: meta.tone,
      short: meta.short,
      long: meta.long,
      exp,
      left,
      expiry: expiryInfo(left, meta.name),
      ok,
      playable: ok,
      reason: ok ? '' : (canPlay ? opt?.reason : '') || reason || 'Not playable right now',
      targetIds: Array.isArray(opt?.targets) ? opt.targets : EMPTY,
    };
  });

  const rivals = players.filter((p) => p.id !== me).map((p) => ({
    id: p.id, name: p.name, avatar: p.avatar, color: p.color, piece: p.piece, bankrupt: !!p.bankrupt, stuck: !!p.stuck,
  }));

  return { on: true, blank, canPlay, reason, played, myTurn, round, cards, rivals, me: mine };
}

/** Swap Tiles rivals for `card`: [{ ...rival, ok, reason }], the eligible ones (the engine's `targets`) first. */
export function targetsFor(view, card) {
  const ids = new Set(card?.targetIds || []);
  const list = (view?.rivals || []).map((r) => (ids.has(r.id)
    ? { ...r, ok: true, reason: '' }
    : { ...r, ok: false, reason: rivalReason(r, view?.me) }));
  return [...list.filter((r) => r.ok), ...list.filter((r) => !r.ok)];
}

/**
 * The action to dispatch. `target` is only ever present for Swap Tiles (worker/validate.js rejects a null / empty / non-string
 * `target`, so the key must be absent for Shield, Double Rent and Steal a Roll).
 */
export function playAction(card, target) {
  const action = { type: 'PLAY_POWER', card: card.uid };
  if (card.id === 'swap' && typeof target === 'string' && target) action.target = target;
  return action;
}

export const needsTarget = (card) => card?.id === 'swap';

/* ------------------------------------------------------------------ selection: select -> confirm -> play */

/**
 * step: idle -> detail (a card is lifted, its panel is open) -> [target -> confirm] -> pending (waiting for the server) -> idle.
 * A card that needs no target goes detail -> pending when Play is pressed.
 */
export const INITIAL_SELECTION = Object.freeze({ sel: null, step: 'idle', target: null, error: '' });

export function selectionReducer(s, a) {
  switch (a.type) {
    case 'select':
      if (s.step === 'pending') return s;
      return a.uid === s.sel && s.step !== 'idle' ? INITIAL_SELECTION : { sel: a.uid, step: 'detail', target: null, error: '' };
    case 'cancel':
      return s.step === 'pending' ? s : { ...INITIAL_SELECTION, error: s.error };
    case 'play':
      if (s.step !== 'detail') return s;
      return { ...s, step: a.needsTarget ? 'target' : 'pending', error: '' };
    case 'pick':
      return s.step === 'target' || s.step === 'confirm' ? { ...s, step: 'confirm', target: a.id } : s;
    case 'back':
      if (s.step === 'confirm') return { ...s, step: 'target', target: null };
      if (s.step === 'target') return { ...s, step: 'detail', target: null };
      return s;
    case 'confirm':
      return s.step === 'confirm' && s.target ? { ...s, step: 'pending' } : s;
    case 'resolved':
      return INITIAL_SELECTION;
    case 'failed':
      return { ...INITIAL_SELECTION, error: a.message || 'That card could not be played.' };
    case 'clearError':
      return s.error ? { ...s, error: '' } : s;
    default:
      return s;
  }
}

/** Roving focus across `n` cards: ArrowRight/Down next, ArrowLeft/Up previous (both wrap), Home, End. -1 = not a navigation key. */
export function stepIndex(i, key, n) {
  if (!n) return -1;
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': return (i + 1) % n;
    case 'ArrowLeft': case 'ArrowUp': return (i - 1 + n) % n;
    case 'Home': return 0;
    case 'End': return n - 1;
    default: return -1;
  }
}

/** uid list of a card array, as a stable string key. */
export const handKey = (cards) => cards.map((c) => c.uid).join('|');
