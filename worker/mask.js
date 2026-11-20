// What each viewer must not be told (docs/GAME_RULES.md 8.7).
//
// Sealed bids: the engine keeps every bid in `state.pending.bids` in clear; before a state goes to a client every
// OTHER player's amount is replaced by 0 (the key stays, so the UI can still tell who has already bid). The
// `auction_end` event legitimately reveals all bids.
//
// Snatch presses (docs/GAME_RULES.md 9.8): while a Snatch window is open `state.pending.claims` lists the players who
// pressed; a viewer only ever sees `[]` or `[viewerId]` (their own press). `snatch_end.claimants` reveals the pressers
// at the close. Once the sealed bidding that follows two or more presses starts, `pending.claimants` is public.
//
// Engine secrets: the random-number state, the Power Cards draw stream (`prng`) and the shuffled card decks. A client
// that holds them could compute the next die, the next Nawabi Luck / City Drama card, the next city event and the next
// power card; nothing in the client reads them. One stripped copy is cached per authoritative state object, so it
// costs one spread per action, not per viewer.
//
// Power Cards (docs/POWER_CARDS.md section 2): everyone sees HOW MANY cards a rival holds, never WHICH. For every
// viewer except the owner a hand becomes `[{ hidden: true }, ...]` of the same length (no id, uid or exp), so
// `hand.length` stays the public count. A viewer who is not a player (a spectator) sees every hand hidden. When the
// game is over every hand is revealed to everybody. `shield`, `doubleRent` and `powerPlayed` are public. A game with
// the rule off has no `hand` anywhere and takes the early returns below (nothing is copied for the hands).
const stripped = new WeakMap();
function withoutSecrets(state) {
  const hasPrng = 'prng' in state;
  if (!('rng' in state) && !('deck' in state) && !hasPrng) return state;
  let copy = stripped.get(state);
  if (!copy) {
    copy = { ...state, rng: 0, deck: [] };
    if (hasPrng) copy.prng = 0;
    stripped.set(state, copy);
  }
  return copy;
}

/** Count-only stand-in for a hand the viewer may not see. */
const hiddenHand = (hand) => (Array.isArray(hand) ? hand.map(() => ({ hidden: true })) : []);

/** `players` with every hand but the viewer's hidden; the same array when there is nothing to hide. */
function playersWithHiddenHands(players, userId) {
  if (!Array.isArray(players)) return players;
  let out = null;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || p.id === userId || !('hand' in p)) continue;
    if (Array.isArray(p.hand) && p.hand.length === 0) continue; // nothing to hide
    out ||= players.slice();
    out[i] = { ...p, hand: hiddenHand(p.hand) };
  }
  return out || players;
}

/** Returns `state` itself when nothing is secret or sealed, else a copy safe to send to `userId`. */
export function maskStateFor(state, userId) {
  if (!state) return state;
  let out = withoutSecrets(state);
  if (state.phase !== 'over') {
    const players = playersWithHiddenHands(out.players, userId);
    if (players !== out.players) out = { ...out, players };
  }
  const pend = state.pending;
  if (pend && pend.type === 'snatch' && Array.isArray(pend.claims)) {
    out = { ...out, pending: { ...pend, claims: pend.claims.includes(userId) ? [userId] : [] } };
  } else if (pend && pend.type === 'auction' && pend.bids && typeof pend.bids === 'object') {
    const bids = {};
    for (const [id, amount] of Object.entries(pend.bids)) bids[id] = id === userId ? amount : 0;
    out = { ...out, pending: { ...pend, bids } };
  }
  return out;
}

/** True when the state has something sealed (an auction or a Snatch window): per-recipient masking is needed. */
export const hasSealedBids = (state) => !!(state && state.pending && (state.pending.type === 'auction' || state.pending.type === 'snatch'));
