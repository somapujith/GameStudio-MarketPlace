// Game modes (host setting `mode`, docs/HUSTLE_PLAN.md 3.4). Pure constants, no imports: the lobby schema and the
// game manifest read them without pulling in the engine.
//
//   rounds       number of rounds, or null = play until one player is left (the engine still stops at ROUND_CAP)
//   startCash    cash every player starts with
//   targetWorth  default WIN TARGET: the first player whose net worth reaches this wins at once (null = no target)

/**
 * The win targets a host may pick (host setting `targetWorth`, rupees of NET WORTH = cash + districts + half the
 * upgrades - debts). `null` = no target. Anything else from a client falls back to the mode default.
 */
export const TARGET_OPTIONS = Object.freeze([null, 2500000, 3000000, 4000000, 5000000, 7500000, 10000000]);

export const MODES = Object.freeze({
  standard: Object.freeze({ label: 'Standard City Hustle', rounds: 20, startCash: 1500000, targetWorth: 5000000, blurb: '20 rounds, richest wins' }),
  quick: Object.freeze({ label: 'Quick Chai Break', rounds: 12, startCash: 2000000, targetWorth: 5000000, blurb: '12 rounds, bigger wallets' }),
  classic: Object.freeze({ label: 'Classic Long Game', rounds: null, startCash: 1500000, targetWorth: 3000000, blurb: 'First to the net-worth target' }),
});

export const MODE_IDS = Object.freeze(Object.keys(MODES));
export const DEFAULT_MODE = 'standard';

/** Safety cap for a mode without a round limit (classic): the richest player wins after this many rounds. */
export const ROUND_CAP = 60;

/** "Off", "₹25L", "₹75L", "₹1Cr": the label of a win target. */
export function targetLabel(v) {
  if (v == null) return 'Off';
  const trim = (x) => String(Math.round(x * 10) / 10);
  return v >= 10000000 ? `₹${trim(v / 10000000)}Cr` : `₹${trim(v / 100000)}L`;
}

/**
 * One line for a table: "Standard City Hustle · 20 rounds · richest wins · ₹50L target" or, without a round limit,
 * "Classic Long Game · first to ₹30L wins". An unknown mode means the default one.
 */
export function modeSummary(mode, targetWorth) {
  const m = MODES[mode] || MODES[DEFAULT_MODE];
  const t = resolveTarget(MODES[mode] ? mode : DEFAULT_MODE, targetWorth === undefined ? m.targetWorth : targetWorth);
  if (m.rounds) return `${m.label} · ${m.rounds} rounds · richest wins${t == null ? '' : ` · ${targetLabel(t)} target`}`;
  return `${m.label} · first to ${targetLabel(t)} wins`;
}

/** Is `v` one of the allowed win targets (`null` = off included)? */
export const isTargetOption = (v) => TARGET_OPTIONS.includes(v);

/**
 * The win target a mode ends up with for a requested value: a listed option stays; anything else (unknown number,
 * string, `undefined`) becomes the mode default. A mode without a round limit never runs without a target, so `null`
 * is also replaced by its default there (the ROUND_CAP safety net stays, but a target is what ends the game).
 */
export function resolveTarget(mode, v) {
  const m = MODES[mode] || MODES[DEFAULT_MODE];
  if (v === null) return m.rounds == null ? m.targetWorth : null;
  return isTargetOption(v) ? v : m.targetWorth;
}
