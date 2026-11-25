// Tiffin Centre HUD: public surface for the glue (TiffinGame / TiffinSolo / OnlineGame).
export { default as Hud, default } from './Hud.jsx';
export { default as HudLayer } from './HudLayer.jsx';
export { default as RecipeCard } from './RecipeCard.jsx';
export { default as PrepSheet } from './PrepSheet.jsx';
export { default as StallStatus } from './StallStatus.jsx';
export { default as BoardSheet } from './BoardSheet.jsx';
export { default as TendButton } from './TendButton.jsx';
export { useActionRunner } from './hooks.js';
export { useDialogue } from './useDialogue.js';
export { createActionRunner } from './actionRunner.js';
export { usePrefs, prefsStore, PREFS_KEY, DEFAULT_PREFS, LANG_OPTIONS, SUB_OPTIONS, voiceAvailable, voiceNotice } from './prefs.js';
export { KEY_HELP, LOOK } from './look.js';
export { getRecipe } from './recipeData.js';
export {
  availability, availabilityLabel, chipTone, bestTarget, decideAction, spotKeys, nearestTarget, walkStops, ticketFrame, eventNotice,
  stationDishes, formatClock, hourFromState, tokenOf, tokenText, isActionAllowed, GATE_TEXT, profitOf, booksView, cookReason,
} from './hudLogic.js';
export {
  opsOn, hasOps, stockGroups, stockRows, gasView, tendView, tendHotkeyTarget, prepView, prepBlock, buyPrice, buyBlock, boardView, boardMap, eventBanner, chitBadges,
} from './opsLogic.js';
