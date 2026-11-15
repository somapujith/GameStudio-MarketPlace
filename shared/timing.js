// Client animation timings, shared by the browser presenter (src/lib/session/usePresenter.js) and the
// server's estimate of how long an action takes to play out (worker/games/hyderabad-tycoon.js
// `estimateAnimMs`). Keeping them in one place stops the server's turn timer and auto-play from
// starting before the client has finished showing what happened.
//
// Pacing rules (so people can follow and read what happens):
//   - a die roll needs a beat to tumble AND a beat for the number to sink in before the pawn moves;
//   - anything with words (a card, a city event) is held for the time it takes to READ it (see readMs);
//   - money moving (rent, purchases) is held long enough to see who paid whom and how much;
//   - other players' routine moves are shortened a little (QUICK in the presenter) but never below readable.
// Players who find it too slow can raise the playback speed in Settings; it never changes what the server waits.

/** Base delays in ms at playback speed 1 (the presenter scales them down when the queue backs up). */
export const ANIM_MS = Object.freeze({
  dice: 1100, // the die tumbles
  afterDice: 1000, // the number stays on screen before the pawn moves
  step: 300, // one tile: lift, carry, set down
  teleportPre: 350,
  teleport: 500,
  land: 700, // the pawn settles on the tile
  rentOut: 1500, // paying rent: see who pays whom and how much
  rentIn: 800,
  cash: 900,
  own: 1100, // a purchase
  quiet: 200,
  level: 1000, // an upgrade
  jail: 1400,
  jailStay: 1400,
  card: 4000, // fallback only: a card is held for readMs(title + text), see cardMs
  auctionStart: 1500,
  auctionEnd: 3000,
  bankrupt: 3000,
  round: 1800,
  finalRound: 3000,
  win: 5000,
  setComplete: 1800,
  mortgage: 1100,
  trade: 1500,
  debt: 1600,
  cityEvent: 3500, // fallback only: a city event is held for readMs(title + text), see eventMs
  ride: 1400, // transport shortcut (Auto / Metro / MMTS)
  chai: 1100, // chai token gained or spent
  turn: 1600, // turn hand-off banner
  snatchOpen: 300, // the Snatch window opening: short on purpose, the window itself is the phase (real time), not an animation
  snatchEnd: 1800, // the Snatch outcome (nobody / who snatched / who goes to the bidding) stays on screen long enough to read
  token: 1100, // a Snatch button gained from a card
});

/** A pawn move longer than this many squares hops faster so the whole trip stays short. */
export const LONG_TRIP = 12;

/** Cap on how long the server waits for one action's animation (card chains can add up to ~20 s now). */
export const MAX_ANIM_MS = 24000;

/** Reading speed used for timed text: about 3 words a second, plus a short lead-in. */
const MS_PER_WORD = 330;

const wordCount = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

/** Time to read `text`: `lead` ms to notice it, then ~330 ms a word, kept between `min` and `max`. */
export function readMs(text, { lead = 1500, min = 3500, max = 9000 } = {}) {
  const ms = lead + wordCount(text) * MS_PER_WORD;
  return Math.round(Math.max(min, Math.min(max, ms)));
}

/** How long a card is on screen: its title and sentence. Same on the client and the server. */
export function cardMs(ev) {
  const text = `${ev?.title || ''} ${ev?.text || ''}`;
  return wordCount(text) ? readMs(text, { lead: 1500, min: 4000, max: 9000 }) : ANIM_MS.card;
}

/** How long a city-event announcement is on screen. */
export function eventMs(ev) {
  const text = `${ev?.title || ''} ${ev?.text || ''}`;
  return wordCount(text) ? readMs(text, { lead: 1200, min: 3200, max: 7000 }) : ANIM_MS.cityEvent;
}

/** Human decision limits (ms). The server counts them from the moment the last animation ends. */
export const DECISION_MS = 60_000; // a turn decision: roll, buy or auction, upgrade, end turn
export const TRADE_MS = 45_000; // an unanswered trade offer is auto-rejected after this
export const WARN_MS = 15_000; // the "time is running out" warning
/** Snatch window: the server closes it this long after the on-screen countdown ends, so a press sent at the last moment still arrives. */
export const SNATCH_GRACE_MS = 400;

/**
 * The room's decision / trade timers follow the host rules `turnSeconds` / `tradeSeconds` (state.cfg, see
 * shared/ruleSettings.js); older games without them keep the defaults above. Always a finite number of ms >= 1 s.
 */
const secondsToMs = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) >= 1 ? Math.round(Number(v) * 1000) : fallback);
export const turnMsOf = (cfg) => secondsToMs(cfg && cfg.turnSeconds, DECISION_MS);
export const tradeMsOf = (cfg) => secondsToMs(cfg && cfg.tradeSeconds, TRADE_MS);
/** The "time is running out" warning point for a decision timer of `turnMs`: WARN_MS, but never more than half of it. */
export const warnMsFor = (turnMs = DECISION_MS) => Math.min(WARN_MS, Math.max(1000, Math.floor(turnMs / 2)));
export const AUTO_MOVE_MS = 1500; // pause before an idle / disconnected player's move is played for them
export const BID_MOVE_MS = 800; // sealed bids are a little quicker
export const START_ANIM_MS = 2500; // the "game start" intro
