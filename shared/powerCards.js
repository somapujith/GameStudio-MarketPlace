// Power Cards: pure metadata and tuning constants (the rules live in shared/engine.js, the spec in docs/POWER_CARDS.md).
// Shared by the engine, the bots, the server mask/validation and every client surface, so keep it free of logic that
// needs engine state. Ids never change once shipped.

export const POWER_IDS = Object.freeze(['shield', 'double', 'steal', 'swap']);

/**
 * The four cards. `tone` picks the colour family (never the only cue: each card also has its own icon and name),
 * `short` is the one-line effect on the card face, `long` the full text for the detail panel and the guide.
 */
export const POWER_CARDS = Object.freeze([
  {
    id: 'shield', name: 'Shield', tone: 'blue',
    short: 'Block your next rent or tax.',
    long: 'Play it before you roll. For 3 rounds the next rent or municipal tax you would pay is waived in full.',
  },
  {
    id: 'double', name: 'Double Rent', tone: 'gold',
    short: 'Your next rent earns double.',
    long: 'Play it before you roll. For 3 rounds the next rent you collect is doubled. A rival Shield still blocks it.',
  },
  {
    id: 'steal', name: 'Steal a Roll', tone: 'teal',
    short: 'Roll again this turn.',
    long: 'Play it before you roll. You get one extra roll this turn, just like rolling a six.',
  },
  {
    id: 'swap', name: 'Swap Tiles', tone: 'violet',
    short: 'Trade places with a rival.',
    long: 'Play it before you roll and pick a rival: you trade board positions. No landing is played and nobody passes START. Not possible if either pawn is stuck in the Traffic Jam.',
  },
]);

export const powerCardById = (id) => POWER_CARDS.find((c) => c.id === id) || null;
export const isPowerId = (id) => typeof id === 'string' && POWER_IDS.includes(id);

/** Tuning (balance with `npm run sim`, see docs/POWER_CARDS.md section 4). */
export const POWER = Object.freeze({
  HAND_MAX: 2,
  /** A card drawn in round r can be played up to and including round r + LIFE_ROUNDS. */
  LIFE_ROUNDS: 3,
  /** Armed effects (shield / doubleRent) last this many rounds after being played. */
  ARMED_ROUNDS: 3,
  /**
   * Turn-start bonus chance when the hand has room; the trailing chance applies below TRAILING_RATIO x the active average worth.
   * Tuned with the simulator (docs/POWER_CARDS.md section 4): card tiles always draw (about 1.3 cards per player per 10 rounds),
   * the turn-start bonus adds about 0.7, so a bot that plays at once draws about 2 per 10 rounds (a human holding cards draws fewer).
   */
  TURN_START_CHANCE: 0.06,
  TRAILING_CHANCE: 0.15,
  TRAILING_RATIO: 0.8,
  /** Draw weights (relative). */
  WEIGHTS: Object.freeze({ shield: 30, double: 30, steal: 25, swap: 15 }),
});
