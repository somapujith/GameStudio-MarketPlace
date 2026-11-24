// Tiffin Centre HUD: public surface for the glue (TiffinGame / TiffinSolo / OnlineGame).
export { default as Hud, default } from './Hud.jsx';
export { default as HudLayer } from './HudLayer.jsx';
export { default as RecipeCard } from './RecipeCard.jsx';
export { useActionRunner } from './hooks.js';
export { useDialogue } from './useDialogue.js';
export { createActionRunner } from './actionRunner.js';
export { usePrefs, prefsStore, PREFS_KEY, DEFAULT_PREFS, LANG_OPTIONS, SUB_OPTIONS, voiceAvailable, voiceNotice } from './prefs.js';
export { KEY_HELP, LOOK } from './look.js';
export { getRecipe } from './recipeData.js';
export {
  availability, availabilityLabel, chipTone, bestTarget, decideAction, spotKeys, nearestTarget, walkStops, ticketFrame, eventNotice,
  stationDishes, formatClock, hourFromState, tokenOf, tokenText, isActionAllowed, GATE_TEXT,
} from './hudLogic.js';
