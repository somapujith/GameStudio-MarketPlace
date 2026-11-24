// Tiffin Centre host settings: the lobby schema and the one-line summary. Pure (no React), so the manifest stays tiny
// and tests run in node. Limits and defaults come from shared/tiffin-centre/catalog.js (SETTINGS_SPEC), the same source
// the server's validateSettings uses, so the two cannot drift (enforced by settings.test.js).
import { DEFAULT_SETTINGS, LEVELS, MAX_LEVEL, PACE, SETTINGS_SPEC } from '@shared/tiffin-centre/catalog.js';

export { DEFAULT_SETTINGS };

/** Pace ids the host can pick, in order (relaxed, normal, rush). */
export const PACE_IDS = SETTINGS_SPEC.pace.options;

/** Host settings schema (docs/ADDING_A_GAME.md section 2). */
export const SETTINGS_SCHEMA = [
  {
    key: 'level',
    label: 'Level',
    type: 'stepper',
    min: SETTINGS_SPEC.level.min,
    max: SETTINGS_SPEC.level.max,
    step: 1,
    format: 'number',
    default: SETTINGS_SPEC.level.default,
    help: 'Each level is a shift at a different time of day, with a bigger menu, more stations and a faster crowd as you go up.',
  },
  {
    key: 'pace',
    label: 'Pace',
    type: 'segmented',
    options: PACE_IDS.map((value) => ({ value, label: PACE[value].label })),
    default: SETTINGS_SPEC.pace.default,
    help: 'Relaxed: customers wait longer and arrive slower. Rush hour: they arrive fast and lose patience sooner.',
  },
];

/** The schema keys the lobby renders (manifest `lobbySettings`). */
export const LOBBY_SETTINGS = ['level', 'pace'];

/** "Level 3: Poori Morning, Rush hour pace" (a missing or illegal value shows the default). */
export function settingsSummary(s = {}) {
  const src = s && typeof s === 'object' ? s : {};
  const n = Number.isInteger(src.level) && src.level >= 1 && src.level <= MAX_LEVEL ? src.level : DEFAULT_SETTINGS.level;
  const pace = PACE[src.pace] ? src.pace : DEFAULT_SETTINGS.pace;
  return `Level ${n}: ${LEVELS[n].name}, ${PACE[pace].label} pace`;
}
