// Tiffin Centre: the public face of the shared engine. The server adapter, the local runner, the scene and the HUD import from here.
export * from './catalog.js';
export {
  createGame, applyAction, isOver, result, hourOf, daypartId, daypartInfo, shiftProgress, secondsLeft, livesLeft, slotInfo,
  customerInfo, needsOf, EMOTES, MAX_PLAYERS, STATE_VERSION,
} from './engine.js';
export { chooseAutoAction, actionCost } from './bot.js';
export { buildSchedule, menuFor, patienceFor, LOOKAHEAD, FIRST_ARRIVAL, crowdAtHour, kindWeight, dishWeight, isWeekend } from './schedule.js';
export { qualityOf, flawedQuality, priceOf, tipFor, comboBonus, starTargets, starsFor, standingsOf, billOf } from './scoring.js';
// the operations layer (docs/TIFFIN_CENTRE_PLAN.md section 3b)
export { stockInfo, gasInfo, tendInfo, needs, openingStock, levelItems, cookBlocker } from './ops.js';
export { eventsNow, eventPlan } from './events.js';
export { dishCost, foodCostFrac, profitOf } from './economy.js';
