// Power cards on the player surfaces (docs/POWER_CARDS.md sections 2, 3.2 and 3.4): pure helpers, no React.
//   * the PUBLIC count of a hand: other players' hands arrive as [{ hidden: true }, ...] (length = the count), your own as real cards
//   * the armed effects (player.shield / player.doubleRent = the round up to which the effect lasts, 0 = none) with the rounds left
//   * the copy (stack label, chip text, sheet note, guide and rules prose)
// Stored games may lack every one of these fields: everything reads with fallbacks and never throws.

/** The rule flag (`state.cfg.powerCards`); the display cfg mirrors the state's. */
export const powerOn = (cfg) => !!(cfg && cfg.powerCards);

/** How many cards a hand holds, as everybody can see it: the length of the (possibly masked) array; junk -> 0. */
export function handCount(hand) {
  return Array.isArray(hand) ? hand.length : 0;
}

/** Rounds an effect armed `until` (the last round it lasts) still has in `round`, this round included; never negative, 0 = none. */
export function roundsLeft(until, round) {
  const u = Number(until);
  if (!Number.isFinite(u) || u <= 0) return 0;
  const r = Number(round);
  return Math.max(0, u - (Number.isFinite(r) && r > 0 ? r : 1) + 1);
}

/** The two public armed effects, in display order: Shield first (it beats Double Rent). */
export const ARMED = Object.freeze([
  { id: 'shield', field: 'shield', label: 'Shield', what: 'blocks the next rent or tax' },
  { id: 'double', field: 'doubleRent', label: 'Double rent', what: 'doubles the next rent they collect' },
]);

/** "last round" / "2 rounds left". */
export const roundsText = (n) => (n <= 1 ? 'last round' : `${n} rounds left`);

/** The armed chips of a player in `round`: `[{ id, label, rounds, text, title }]`, only the ones that still last. */
export function armedChips(player, round) {
  if (!player) return [];
  const out = [];
  for (const a of ARMED) {
    const rounds = roundsLeft(player[a.field], round);
    if (rounds > 0) out.push({ id: a.id, label: a.label, rounds, text: roundsText(rounds), title: `${a.label} armed, ${roundsText(rounds)}` });
  }
  return out;
}

/** Ids that were in `prev` and are not in `next` (a chip that was consumed or expired): drives the little flash. */
export function goneChips(prev, next) {
  const now = new Set((next || []).map((c) => c.id));
  return (prev || []).filter((c) => !now.has(c.id));
}

/** "Ravi holds 2 power cards" / "You hold 1 power card". */
export function stackLabel(name, count, isMe = false) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const noun = n === 1 ? 'power card' : 'power cards';
  return isMe ? `You hold ${n} ${noun}` : `${name || 'A player'} holds ${n} ${noun}`;
}

/** The part of a pod / row button label that says it in words ("holds 2 power cards, Shield armed, 2 rounds left"); '' when nothing. */
export function powerWords(info) {
  if (!info) return '';
  const bits = [];
  if (info.count > 0) bits.push(info.isMe ? `you hold ${info.count} power ${info.count === 1 ? 'card' : 'cards'}` : `holds ${info.count} power ${info.count === 1 ? 'card' : 'cards'}`);
  for (const c of info.chips) bits.push(c.title);
  return bits.join(', ');
}

/**
 * Everything a surface needs for one player, or null when the rule is off (then nothing is rendered at all) or the player is out.
 * `player` is the shown player (the presenter's display copy); a field it does not carry is read from the live view's copy.
 * Returns { on, count, chips, round, isMe, name }.
 */
export function powerOf(session, player) {
  if (!player) return null;
  const cfg = session?.display?.cfg?.powerCards !== undefined ? session.display.cfg : session?.view?.cfg;
  if (!powerOn(cfg) || player.bankrupt) return null;
  const live = Array.isArray(session?.view?.players) ? session.view.players.find((x) => x.id === player.id) : null;
  const pick = (k) => (player[k] !== undefined ? player[k] : live ? live[k] : undefined);
  const round = session?.display?.round ?? session?.view?.round;
  const chipsOf = { shield: pick('shield'), doubleRent: pick('doubleRent') };
  return {
    on: true,
    count: handCount(pick('hand')),
    chips: armedChips(chipsOf, round),
    round,
    isMe: !!session && player.id === session.me,
    name: player.name,
  };
}

/** Copy. */
export const SHEET_NOTE_ME = 'Others can see how many cards you hold, not which.';
export const sheetNote = (name, isMe) => (isMe ? SHEET_NOTE_ME : `You can see how many cards ${name || 'they'} hold${name ? 's' : ''}, not which.`);
export const SHEET_EMPTY = 'No power cards right now.';
export const countText = (n) => `${n} ${n === 1 ? 'card' : 'cards'} held`;

/** The guide sheet's rules, in plain language (docs/POWER_CARDS.md section 1). */
export const GUIDE_RULES = Object.freeze([
  'Play one card per turn, before you roll.',
  'You can hold 2 cards at most. A draw when your hand is full gives nothing.',
  'Cards last 3 rounds. An unplayed card expires, and so does an armed Shield or Double Rent.',
  'Others can see how many cards you hold, not which, until you play one.',
  'Shield beats Double Rent: if the payer has a Shield, the rent is waived.',
  'You draw a card when you land on a card tile, and sometimes at the start of your turn (more often when you are behind).',
]);

export const GUIDE_INTRO = 'An optional rule: short-lived cards that add surprise and bluffing.';

/** The Rules sheet's short section. */
export const RULES_PROSE = Object.freeze([
  'Power cards are an optional rule: each player can hold up to 2 short-lived cards (Shield, Double Rent, Steal a Roll, Swap Tiles).',
  'Play one before you roll, once per turn. Everyone can see how many cards you hold, nobody sees which until you play one.',
]);
export const GUIDE_BUTTON = 'See the power cards guide';

/** The DOM event that opens the guide (the tray's info button dispatches it). */
export const POWER_GUIDE_EVENT = 'hg:power-guide';
