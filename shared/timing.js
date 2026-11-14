// Client animation timings, shared by the browser presenter (src/lib/session/usePresenter.js) and the
// server's estimate of how long an action takes to play out (worker/games/hyderabad-tycoon.js
// `estimateAnimMs`). Keeping them in one place stops the server's turn timer and auto-play from
// starting before the client has finished showing what happened.

/** Base delays in ms at playback speed 1 (the presenter scales them down when the queue backs up). */
export const ANIM_MS = Object.freeze({
  dice: 900,
  afterDice: 620,
  step: 260, // one tile: lift, carry, set down
  teleportPre: 220,
  teleport: 300,
  land: 380,
  rentOut: 520,
  rentIn: 240,
  cash: 380,
  own: 520,
  quiet: 120,
  level: 600,
  jail: 850,
  jailStay: 1000,
  card: 2200,
  auctionStart: 900,
  auctionEnd: 1500,
  bankrupt: 1300,
  round: 1000,
  finalRound: 1700,
  win: 3200,
  setComplete: 1100,
  mortgage: 650,
  trade: 800,
  debt: 1000,
  cityEvent: 1200,
  ride: 900, // transport shortcut (Auto / Metro / MMTS)
  chai: 700, // chai token gained or spent
  turn: 900, // turn hand-off banner
});

/** A pawn move longer than this many squares hops faster so the whole trip stays short. */
export const LONG_TRIP = 12;

/** Cap on how long the server waits for one action's animation. */
export const MAX_ANIM_MS = 12000; // card chains (dice, move, card, second move, rent...) reach ~10 s
