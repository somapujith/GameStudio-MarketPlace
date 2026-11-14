// Game modes (host setting `mode`, docs/HUSTLE_PLAN.md 3.4). Pure constants, no imports: the lobby schema and the
// game manifest read them without pulling in the engine.
//
//   rounds     number of rounds, or null = play until one player is left (the engine still stops at ROUND_CAP)
//   startCash  cash every player starts with

export const MODES = Object.freeze({
  standard: Object.freeze({ label: 'Standard City Hustle', rounds: 20, startCash: 1500000, blurb: '20 rounds, richest wins' }),
  quick: Object.freeze({ label: 'Quick Chai Break', rounds: 12, startCash: 2000000, blurb: '12 rounds, bigger wallets' }),
  classic: Object.freeze({ label: 'Classic Long Game', rounds: null, startCash: 1500000, blurb: 'Until one player is left' }),
});

export const MODE_IDS = Object.freeze(Object.keys(MODES));
export const DEFAULT_MODE = 'standard';

/** Safety cap for a mode without a round limit (classic): the richest player wins after this many rounds. */
export const ROUND_CAP = 60;
