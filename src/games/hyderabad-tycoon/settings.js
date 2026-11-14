// Hyderabad Tycoon host settings (Hyderabad Hustle rules): the lobby schema (docs/MARKETPLACE.md section 4), the
// fixed table rules line and the one-line summary. Pure (no React), so the manifest stays tiny and tests run in node.
//
// The server is the source of truth: values here MUST equal worker/settings.js (enforced by settings.test.js).
// The lobby shows only the mode (`LOBBY_SETTINGS`); dice and the auction rule stay at their defaults unless a
// richer settings panel shows them. Seats (`maxPlayers`) are a room setting handled by the lobby itself.
import { MODES, MODE_IDS, DEFAULT_MODE } from '@shared/modes.js';

export { MODES, MODE_IDS, DEFAULT_MODE };
export const DICE_MODES = ['lucky', 'fair'];
export const DEFAULT_DICE = 'lucky';
export const DEFAULT_AUCTION_ON_DECLINE = true;

/** "Standard City Hustle · 20 rounds · richest wins" (a missing or unknown mode means the default). */
export function settingsSummary(s = {}) {
  const m = MODES[s && s.mode] || MODES[DEFAULT_MODE];
  return m.rounds ? `${m.label} · ${m.rounds} rounds · richest wins` : `${m.label} · last one standing wins`;
}

/** The only schema keys the lobby renders (manifest `lobbySettings`): the mode. */
export const LOBBY_SETTINGS = ['mode'];

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
    help: 'Standard: 20 rounds, richest wins. Quick: 12 rounds with ₹20 lakh each. Classic: until one player is left.',
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
