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
// Engine secrets: the random-number state and the shuffled card decks. A client that holds them could compute the
// next die, the next Nawabi Luck / City Drama card and the next city event; nothing in the client reads them.
// One stripped copy is cached per authoritative state object, so it costs one spread per action, not per viewer.
const stripped = new WeakMap();
function withoutSecrets(state) {
  if (!('rng' in state) && !('deck' in state)) return state;
  let copy = stripped.get(state);
  if (!copy) {
    copy = { ...state, rng: 0, deck: [] };
    stripped.set(state, copy);
  }
  return copy;
}

/** Returns `state` itself when nothing is secret or sealed, else a copy safe to send to `userId`. */
export function maskStateFor(state, userId) {
  if (!state) return state;
  let out = withoutSecrets(state);
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
