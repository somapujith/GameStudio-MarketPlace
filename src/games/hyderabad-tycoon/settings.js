// Hyderabad Tycoon host settings (Hyderabad Hustle rules): the lobby schema (docs/MARKETPLACE.md section 4), the
// fixed table rules line and the one-line summary. Pure (no React), so the manifest stays tiny and tests run in node.
//
// The server is the source of truth: values here MUST equal worker/settings.js (enforced by settings.test.js).
// The lobby shows only the mode (`LOBBY_SETTINGS`); dice and the auction rule stay at their defaults unless a
// richer settings panel shows them. Seats (`maxPlayers`) are a room setting handled by the lobby itself.
import { MODES, MODE_IDS, DEFAULT_MODE, TARGET_OPTIONS, targetLabel, modeSummary } from '@shared/modes.js';

export { MODES, MODE_IDS, DEFAULT_MODE, TARGET_OPTIONS };
export const DICE_MODES = ['lucky', 'fair'];
export const DEFAULT_DICE = 'lucky';
export const DEFAULT_AUCTION_ON_DECLINE = true;
export const DEFAULT_TARGET_WORTH = MODES[DEFAULT_MODE].targetWorth;

/**
 * "Standard City Hustle · 20 rounds · richest wins · ₹50L target" / "Classic Long Game · first to ₹30L wins"
 * (a missing or unknown mode means the default; a missing target the mode's default).
 */
export function settingsSummary(s = {}) {
  return modeSummary(s && s.mode, s ? s.targetWorth : undefined);
}

/** The schema keys the lobby renders (manifest `lobbySettings`): the mode and the win target. */
export const LOBBY_SETTINGS = ['mode', 'targetWorth'];

/** The fixed table rules, one muted line under the mode picker (manifest `tableRules`). */
export const TABLE_RULES = 'One die · 3 business levels per district · Chai, Auto shortcuts and city rush hours';

/** Host settings schema. The lobby renders just `LOBBY_SETTINGS`; the full set is what the server validates. */
export const SETTINGS_SCHEMA = [
  {
    key: 'mode',
    label: 'Game mode',
    type: 'segmented',
    options: MODE_IDS.map((value) => ({ value, label: MODES[value].label, hint: MODES[value].blurb })),
    default: DEFAULT_MODE,
    help: 'Standard: 20 rounds, richest wins. Quick: 12 rounds with ₹20 lakh each. Classic: no round limit, first to the win target.',
  },
  {
    key: 'targetWorth',
    label: 'Win target (net worth)',
    type: 'segmented',
    // "Off" only makes sense with a round limit: Classic always plays to a target (the server insists on it too)
    options: TARGET_OPTIONS.map((value) => ({ value, label: targetLabel(value), ...(value === null ? { hideIf: { mode: ['classic'] } } : {}) })),
    default: DEFAULT_TARGET_WORTH,
    // switching the mode resets the target to the new mode's default (the server does the same)
    dependsOn: { key: 'mode', defaults: Object.fromEntries(MODE_IDS.map((m) => [m, MODES[m].targetWorth])) },
    help: 'First player to reach this net worth wins. Net worth = cash + districts + half the upgrades.',
  },
  {
    key: 'dice',
    label: 'Dice',
    type: 'segmented',
    options: [
      { value: 'lucky', label: 'Lucky' },
      { value: 'fair', label: 'Fair' },
    ],
    default: DEFAULT_DICE,
    help: 'Fair gives every face an equal chance; Lucky gently helps the player behind.',
  },
  {
    key: 'auctionOnDecline',
    label: 'Auction skipped districts',
    type: 'toggle',
    default: DEFAULT_AUCTION_ON_DECLINE,
    help: 'A skipped (or unaffordable) district goes to a sealed-bid auction, so everyone can bid.',
  },
];
