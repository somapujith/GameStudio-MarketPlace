// Tiffin Centre dialogue: the public face. The HUD, the scene (speech bubbles, mouths) and the settings screen import from here.
//   createDialogueDirector({ lang, seed, subtitles }).update(state, events) -> Utterance[]
//   formatSubtitle(utterance, 'native' | 'roman' | 'english' | 'both'), fillTemplate(line, { dish, dish2, n })
// Pure, deterministic, no network, no clock, no Math.random.
export { createDialogueDirector, formatSubtitle, fillTemplate, ttlFor, linesFor, MIN_GAP, MAX_ACTIVE, LANG_MODES, SUBTITLE_MODES } from './director.js';
export { DISH_NAMES, dishName } from './dishNames.js';
export { LANGS, MOODS, SITUATIONS, MIN_PER_SIT, ALLOWED_PLACEHOLDERS } from './lineKit.js';
export { UI_EN } from './lines.en.js';
export { LINES_TE } from './lines.te.js';
export { LINES_HI } from './lines.hi.js';
export { LINES_DK } from './lines.dk.js';

import { LINES_TE } from './lines.te.js';
import { LINES_HI } from './lines.hi.js';
import { LINES_DK } from './lines.dk.js';

/** Every line, all languages. */
export const ALL_LINES = Object.freeze([...LINES_TE, ...LINES_HI, ...LINES_DK]);
/** Lookup by id. */
export const LINE_BY_ID = Object.freeze(Object.fromEntries(ALL_LINES.map((l) => [l.id, l])));
