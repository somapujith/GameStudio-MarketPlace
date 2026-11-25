// Tiffin Centre: a scripted PLAYER for the tutorial, for tests (the tutorial's own, and the session / HUD tests that need to play it to the end).
// `tutorialBotAction(state, driver, playerId)` is the action a competent person would send right now, given the step the driver stands on:
// it does what each lesson asks (walks to the tawa, prepares batter at the back counter, tends the tawa, swaps the cylinder, flips the board,
// serves the special orders ...) through the real engine, never sends an action the engine would refuse, and returns null while the lesson
// wants the player to wait. It does NOT press "Got it" and does NOT turn the head: the caller does that (`driver.ack()` when `driver.ackable`;
// a look of more than LOOK_TURN_RAD on the 'look' step), exactly like a real HUD. The plain greedy bot (`chooseAutoAction`) cannot finish the
// tutorial any more: the operations chapters need these specific actions at these specific steps.
import { chooseAutoAction } from './bot.js';

const MASK = { stock: false, gas: false, heat: false, market: false };

/** The greedy bot with the operations branches switched off (the lesson, not the bot, decides when to prep, tend or swap). */
function basicAction(state, me) {
  const cfg = state.cfg;
  const masked = cfg.stock || cfg.gas || cfg.heat ? { ...state, cfg: { ...cfg, ...MASK } } : state;
  return chooseAutoAction(masked, me);
}
const prepSlots = (s) => (s.stations.prep1 ? s.stations.prep1.slots : []);
const hasJob = (s, item) => prepSlots(s).some((j) => j.st !== 'empty' && j.item === item);
const startPrep = (s, item) => {
  if (hasJob(s, item)) return null;
  const slot = prepSlots(s).findIndex((j) => j.st === 'empty');
  return slot >= 0 ? { type: 'prep', station: 'prep1', slot, item } : null;
};
const collectReady = (s) => {
  const slot = prepSlots(s).findIndex((j) => j.st === 'ready');
  return slot >= 0 ? { type: 'collectPrep', station: 'prep1', slot } : null;
};
const slotsOf = (s, dish) => {
  const out = [];
  for (const sid of s.cfg.stations) {
    if (s.stations[sid].kind === 'prep') continue;
    s.stations[sid].slots.forEach((sl, slot) => { if (sl.dish === dish && sl.st !== 'empty') out.push({ sid, slot, st: sl.st }); });
  }
  return out;
};
const heldDish = (s, me, dish) => s.players[me].hands.findIndex((h) => h.dish === dish);
/** Take a ready or burnt demo dish, or bin the one in hand. */
const clearDemo = (s, me, dish) => {
  const r = slotsOf(s, dish).find((x) => x.st === 'ready' || x.st === 'burnt');
  if (r && s.players[me].hands.length < 2) return { type: 'take', station: r.sid, slot: r.slot };
  const h = heldDish(s, me, dish);
  return h >= 0 ? { type: 'discard', hand: h } : null;
};
const stockN = (s, item) => (s.stock && typeof s.stock[item] === 'number' ? s.stock[item] : 0);

/** undefined = no script for this step (the generic bot plays it), null = wait, or an action. */
function lessonAction(s, step, me) {
  switch (step) {
    case 'walk': return { type: 'move', to: 'tawa1' };
    case 'stock-turn': return { type: 'move', to: 'prep1' };
    case 'stock-batter': case 'stock-out-prep': return startPrep(s, 'batter_dosa');
    case 'stock-grind': case 'stock-sides-collect': case 'stock-out-collect': case 'power-batter': return collectReady(s);
    case 'stock-sides': return startPrep(s, 'sambar') || startPrep(s, 'coconut_chutney');
    case 'stock-out-cook': {
      // exactly one dosa: the batter is for one
      if (slotsOf(s, 'dosa').length || heldDish(s, me, 'dosa') >= 0 || stockN(s, 'batter_dosa') < 1) return null;
      const slot = s.stations.tawa1.slots.findIndex((sl) => sl.st === 'empty');
      return slot >= 0 ? { type: 'cook', station: 'tawa1', slot, dish: 'dosa' } : null;
    }
    case 'stock-out-serve': {
      const c = s.customers.find((x) => x.st === 'waiting');
      const h = heldDish(s, me, 'dosa');
      if (h >= 0 && c) return { type: 'serve', customer: c.id, hand: h };
      const r = slotsOf(s, 'dosa').find((x) => x.st === 'ready');
      return r ? { type: 'take', station: r.sid, slot: r.slot } : null;
    }
    case 'heat-tend': return { type: 'tend', station: 'tawa1' };
    case 'heat-others': return { type: 'tend', station: s.stations.kadai1.tendAt > 0 ? 'steamer1' : 'kadai1' };
    case 'gas-swap': return { type: 'swapGas' };
    case 'gas-low': case 'gas-wait': return null;
    case 'board-off': return { type: 'board', dish: 'dosa', on: false };
    case 'board-on': return { type: 'board', dish: 'dosa', on: true };
    case 'power-cut': return startPrep(s, 'batter_dosa');
    case 'inspect-drill': {
      const t = s.stations.tawa1;
      if (s.tick - t.tendAt > 20) return { type: 'tend', station: 'tawa1' };
      return clearDemo(s, me, 'masala_dosa');
    }
    case 'inspect-clean': return clearDemo(s, me, 'masala_dosa');
    case 'profit-bin': return clearDemo(s, me, 'osmania');
    case 'rush': return chooseAutoAction(s, me); // the real bot: it preps the batter and tends the tawa itself
    default: return undefined;
  }
}

/** The action (without `playerId`) the scripted player sends now, or null to wait. Add `playerId` before `applyAction`. */
export function tutorialBotAction(state, driver, playerId = 'me') {
  if (!state || !driver || !state.players || !state.players[playerId] || state.status !== 'playing') return null;
  let a = lessonAction(state, driver.step.id, playerId);
  if (a === undefined) a = basicAction(state, playerId);
  return a || null;
}
