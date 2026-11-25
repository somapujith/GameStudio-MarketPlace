// Tiffin Centre: the scripted tutorial (level 0). ONE lesson that teaches everything: the first-person view, the order TOKENS,
// every station (tawa, idly steamer, kadai, chai counter), every dish with its recipe card, hands, serving, collecting, tips,
// the REAL-LIFE OPERATIONS of a Hyderabad tiffin centre (stock and the back counter, a tawa that needs tending, the LPG cylinder, the sold-out
// board, special orders, rain / power cut / the food-safety inspector, and what profit means), hearts, stars, the clock, the practice
// shifts, co-op, and a final timed rush that uses prep and tend. Pure data + a deterministic driver: no DOM, no clock, no randomness.
//
// The operations chapters switch their mechanic ON for the training shift with `tutorial-flags` actions (`{ stock, gas, heat, events,
// market, stage }`, engine.js / ops.js `trainingFlags`) the moment their lesson starts, and let the player DO it through the real engine:
// prep, collectPrep, tend, swapGas, board and the staged events are real engine actions, so every refusal ("Out of dosa batter", "The
// cylinder is still heavy", "Already clean") is the engine's own.
//
// The driver never touches the engine itself. A session calls `driver.advance(state, events, { meId, look })` after every
// engine change (tick or action) and applies the `actions` it returns (spawn a customer, collect for the player, tutorial-flags)
// through `applyAction`, with the acting `playerId` added. Everything the driver decides comes from the engine state, the events
// and the camera's `look` ({ yaw, pitch } in radians), so a bot scripted against the real engine drives it exactly like a person
// does (and the tests do exactly that).
//
// Voice: the host is Chotu, the stall helper. Every step has a short Hyderabadi street line (`say`, Hindi/Telugu words in Latin
// letters) and the plain English (`text`) right after it, plus the Telugu line (`te`) for the coach mark. Every step has a keyboard
// variant (`text`, `hint`) and a touch variant (`textTouch`, `hintTouch`), plus `controls: { kb, touch }`, a one-line reminder of
// the controls. The HUD picks by pointer type (`driver.setPointer('touch' | 'keyboard')`, or the explicit `textFor(pointer)` ...).
//
// Step done conditions only use state/events/look (never "the walk finished"): the HUD walks the avatar to the target and sends
// the real action on arrival, so a step simply waits until the action has landed.
//
// Step shape (all optional unless noted):
//   id (req), chapter (req), speaker, say, te, recipe (a dish id: the HUD shows its recipe card, RECIPES in recipes.js)
//   text / textTouch (string | (state, ctx) => string), controls { kb, touch }
//   hint [{ after, text }] / hintTouch [...]   shown once the step has run `after` ticks (= seconds) without finishing
//   allow: ['move', 'cook', ...]  the game actions the player may do in this step; the HUD refuses the rest with the toast
//          'Chotu says: not yet!' (driver.allowed / driver.allows(type)). `move` is allowed in every step; looking around always is.
//   spotlight: { kind, id?, slot?, look? } | null | (state, ctx) => same. `look: true` = the target may be off-screen: the scene
//          turns the head to it (scene.lookAt). Kinds: 'station' (id: tawa1 steamer1 kadai1 chai1, and the BACK COUNTER 'prep1', which is behind
//          the cook), 'slot' (id + slot), 'customer' (id), 'hands', 'bin', 'gas' (the LPG cylinder stand, no id), 'board' (the price / sold-out
//          board by the counter, no id).
//   prepRecipe: an ingredient id (INGREDIENTS): the HUD shows its back-counter card (PREP_RECIPES in recipes.js: what goes in, how it is made)
//   flags: { patience, pay } | (ctx) => same   the tutorial clocks while this step runs (true = the clock RUNS)
//   onEnter: action[] | (state, ctx) => action[] | { actions, set: { demo?, kv? } }   applied once when the step starts (`kv` is the driver's
//          scratch memory: ctx.kv). A spawn action may carry
//          `tag: 'A'`: the driver remembers which customer it became (ctx.cust('A')), and sends the spawn again (every few ticks)
//          if the stall had no free spot, so a lesson cannot be lost
//   autoCollect (default true; false in serve2, collect and rush)  Chotu collects money for the player in this step, so a lesson
//          customer never blocks a spot; the steps that teach collecting turn it off
//   ack: true  the step waits for the player to press "Got it" (driver.ack()); ackAfter: n  ... but only n ticks after it started
//   when(state, ctx) -> false skips the step; done(state, events, ctx) -> boolean
//   failed(state, ctx) -> { to, attempt? } | null   a recoverable failure: go back to step `to` (and count an attempt)
//   recover(state, ctx) -> stepId | null            the situation became unwinnable: go back to that step
//   needsTags: ['R', ...]   the customer tags this step's own onEnter seats: when one of them is gone without having paid (walked out,
//          sold out, pruned unseen) the step is entered again, which seats whoever is missing (frozen clocks, same lesson)
//   rescue(state, ctx) -> action[] | null   the stall itself became unwinnable (the cylinder ran dry, the shelf emptied, the steamer boiled
//          dry, the board was flipped ...) without anything to go back to: Chotu re-stages it with `tutorial-flags` actions. Asked at most every
//          RESCUE_EVERY ticks while the step is not done, and only ever answers with actions when the lesson cannot go on as it is.
//   hint entries may carry a `when(state, ctx)` (the 4th item of the compact form): the entry only shows while it is true, and then beats the
//          plain timed entries (it names the situation the player is actually in: hands jammed, a station full, the prep counter busy ...)
import { CUSTOMER_KINDS, DISHES, GAS, INGREDIENTS, PACE, PATIENCE_BASE, PREP_STATION, REQUEST, STATIONS, STATION_KINDS, STOCK_CAP, levelDef } from './catalog.js';
import { PREP_RECIPES, RECIPES, ingredientsOf } from './recipes.js';

export const TUTORIAL_LEVEL = 0;
export const TUTORIAL_SETTINGS = Object.freeze({ level: 0, pace: 'normal' });
export const TUTORIAL_HOST = 'Chotu';
export const RUSH_RETRIES = 1; // after a failed live rush the clocks freeze, so it cannot fail again
export const LOOK_TURN_RAD = 0.35; // the head must have turned more than this (yaw) for the "look around" step
export const TUTORIAL_NOT_YET = 'Chotu says: not yet!'; // the toast for a refused action
/** The actions `allow` gates. The first six are the cooking basics; the rest belong to the operations chapters (a step that does not list them refuses them). */
export const TUTORIAL_ACTIONS = Object.freeze(['move', 'cook', 'take', 'serve', 'collect', 'discard', 'prep', 'collectPrep', 'tend', 'swapGas', 'board']);
const SPAWN_RETRY = 3; // ticks before a spawn that did not produce a customer is sent again
const RESCUE_EVERY = 4; // ticks between two rescues of the same stall (a rescue that did not help is not spammed)
export const TUTORIAL_RESCUE_NOTE = 'Chotu topped up the stall so the lesson can carry on.';

// ---------------------------------------------------------------------------------------------------------------------
// chapters: the progress meter groups the steps (driver.chapters / driver.chapter)

export const TUTORIAL_CHAPTERS = Object.freeze([
  { id: 'look', label: 'Look', te: 'చూడండి' },
  { id: 'tokens', label: 'Tokens', te: 'టోకెన్లు' },
  { id: 'tawa', label: 'Tawa', te: 'పెనం' },
  { id: 'idly', label: 'Idly', te: 'ఇడ్లీ' },
  { id: 'kadai', label: 'Kadai', te: 'కడాయి' },
  { id: 'chai', label: 'Chai', te: 'చాయ్' },
  { id: 'serve', label: 'Serve and collect', te: 'వడ్డన, వసూలు' },
  { id: 'stock', label: 'Stock and the prep counter', te: 'స్టాక్, వెనుక కౌంటర్' },
  { id: 'heat', label: 'Keep the tawa happy', te: 'పెనం జాగ్రత్త' },
  { id: 'gas', label: 'Gas', te: 'గ్యాస్' },
  { id: 'board', label: 'Sold out board', te: 'సోల్డ్ అవుట్ బోర్డు' },
  { id: 'special', label: 'Special orders', te: 'ప్రత్యేక ఆర్డర్లు' },
  { id: 'weather', label: 'Weather and the inspector', te: 'వాతావరణం, ఇన్‌స్పెక్టర్' },
  { id: 'profit', label: 'Money: profit', te: 'డబ్బు: లాభం' },
  { id: 'flow', label: 'Game flow', te: 'ఆట తీరు' },
  { id: 'rush', label: 'Rush', te: 'రష్' },
].map((c) => Object.freeze(c)));

// ---------------------------------------------------------------------------------------------------------------------
// small read helpers over the engine state

const SLOT_BUSY = new Set(['cooking', 'ready']);

/** Every station slot as { station, slot, st, dish }. */
function allSlots(state) {
  const out = [];
  for (const sid of Object.keys(state.stations || {})) {
    state.stations[sid].slots.forEach((sl, slot) => out.push({ station: sid, slot, st: sl.st, dish: sl.dish }));
  }
  return out;
}
const slotAt = (state, ref) => (ref && state.stations[ref.station] ? state.stations[ref.station].slots[ref.slot] || null : null);
const heldCount = (me, dish) => (me ? me.hands.filter((h) => h.dish === dish).length : 0);
const cookingCount = (state, dish) => allSlots(state).filter((s) => s.dish === dish && SLOT_BUSY.has(s.st)).length;
const readySlot = (state, dish) => allSlots(state).find((s) => s.dish === dish && s.st === 'ready') || null;
const slotOfDish = (state, dish) => allSlots(state).find((s) => s.dish === dish && s.st !== 'empty') || null;
/** Is every spot of station `sid` taken (cooking, ready or smoking)? Then nothing can be started there. */
const stationFull = (state, sid) => !!state.stations[sid] && state.stations[sid].slots.every((sl) => sl.st !== 'empty');
/** When station `sid` is full: the spot to clear first (a smoking one needs no free hand), else a ready one; null when it has room or only cooks. */
function clearSpot(state, sid) {
  if (!stationFull(state, sid)) return null;
  const slots = state.stations[sid].slots;
  let i = slots.findIndex((sl) => sl.st === 'burnt');
  if (i < 0) i = slots.findIndex((sl) => sl.st === 'ready');
  return i < 0 ? null : { kind: 'slot', id: sid, slot: i, look: true };
}
/** Is `dish` held, cooking or ready somewhere (so it is on its way to a customer)? */
const haveDish = (state, me, dish) => heldCount(me, dish) + cookingCount(state, dish) > 0;
const needsOf = (c) => {
  const out = c.order.slice();
  for (const d of c.got) {
    const i = out.indexOf(d);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
};
const live = (c) => !!c && c.st !== 'left' && c.outcome === null;
const dishNames = (order) => order.map((d) => DISHES[d].name).join(' and ');
const tokenOf = (c) => (c ? `Token #${c.id}` : 'the next token');

/** The first station of each kind in the training stall (tawa -> tawa1 ...). */
const KIND_STATION = {};
for (const id of levelDef(0).stations) if (!KIND_STATION[STATIONS[id].kind]) KIND_STATION[STATIONS[id].kind] = id;
const stationLabel = (dish) => STATION_KINDS[DISHES[dish].station].name;

/** A spawn action. `patienceMax` is computed like the schedule does (level 0, normal pace) so it matches a real customer. `tag` is the driver's own bookkeeping (stripped before the action leaves the driver). */
export function spawnAction({ kind = 'student', name, order, look, tag, parcel, extra, spice, regular, loyal, big, delivery, fit }) {
  const k = CUSTOMER_KINDS[kind];
  const lv = levelDef(TUTORIAL_LEVEL);
  let patienceMax = Math.max(1, Math.round(PATIENCE_BASE * k.patience * lv.patience * PACE.normal.patience));
  // special requests (the engine's `spawn` takes them in the training shift): patience as the schedule gives it
  if (delivery) patienceMax = Math.max(1, Math.round(REQUEST.delivery.patience * PACE.normal.patience));
  else if (big) patienceMax = Math.max(1, Math.round(patienceMax * REQUEST.big.patience));
  else if (parcel) patienceMax = Math.max(1, Math.round(patienceMax * REQUEST.parcelPatience));
  const c = { kind, name, look: look || k.look, order: order.slice(), patienceMax };
  if (parcel) c.parcel = true;
  if (extra) c.extra = extra;
  if (spice) c.spice = spice;
  if (regular) { c.regular = true; if (loyal !== undefined) c.loyal = loyal; }
  if (big) c.big = true;
  if (delivery) c.delivery = true;
  if (fit) c.fit = true;
  const a = { type: 'spawn', customer: c };
  if (tag) a.tag = tag;
  return a;
}

/** The tutorial-flags action for `{patience, pay}` (true = that clock runs). */
export const flagsAction = (f) => ({ type: 'tutorial-flags', patience: !!f.patience, pay: !!f.pay });

/**
 * The tutorial-flags action for the operations layer: `{ stock, gas, heat, events, market }` booleans (switch that mechanic on / off for the
 * training shift) and `stage` (exact values for a lesson, see ops.js `trainingFlags`). It leaves the patience / pay clocks alone.
 */
export const trainAction = (spec) => ({ type: 'tutorial-flags', ...spec });

const FROZEN = Object.freeze({ patience: false, pay: false });
const LIVE = Object.freeze({ patience: true, pay: true });

// what the player may do in a step (looking around and `move` are always fine)
const A_NONE = Object.freeze(['move']);
const A_COOK = Object.freeze(['move', 'cook', 'take']); // `take` also clears a burnt spot
const A_TAKE = Object.freeze(['move', 'take', 'discard']);
const A_SERVE = Object.freeze(['move', 'serve', 'discard']);
const A_COLLECT = Object.freeze(['move', 'collect']);
const A_CARRY = Object.freeze(['move', 'take', 'serve', 'discard']);
const A_ORDERS = Object.freeze(['move', 'serve', 'collect', 'discard']);
const A_PLAY = Object.freeze(['move', 'cook', 'take', 'serve', 'collect', 'discard']); // free play at the stations (no operations jobs)
const A_PREP = Object.freeze(['move', 'prep', 'collectPrep']); // `collectPrep` clears a finished job that is in the way (only two job slots)
const A_PICKUP = Object.freeze(['move', 'collectPrep']);
const A_TEND = Object.freeze(['move', 'tend']);
const A_BOARD = Object.freeze(['move', 'board']);
const A_ALL = TUTORIAL_ACTIONS;

// one-line reminders of the controls, per kind of step
const CONTROLS = {
  none: { kb: 'Q / E or the arrow keys turn your head', touch: 'Drag on empty space to turn your head' },
  ack: { kb: 'Click "Got it" to carry on', touch: 'Tap "Got it" to carry on' },
  look: { kb: 'Q / E or the arrow keys turn your head', touch: 'Drag on empty space to turn your head' },
  walk: { kb: 'A / D walk along the counter, Space works at the glowing spot', touch: 'Tap a station and your cook walks there' },
  cook: { kb: 'A / D to walk, Space to cook at the glowing station', touch: 'Tap the glowing station, then pick the dish' },
  take: { kb: 'Space at the glowing dish picks it up', touch: 'Tap the glowing dish to pick it up' },
  serve: { kb: 'A / D to face a token, Space to serve', touch: 'Tap the customer or their chit to serve' },
  collect: { kb: 'Space at the customer holding the money', touch: 'Tap the customer holding the money note' },
  prep: { kb: 'Face the glowing back counter behind you and press Space to work there', touch: 'Tap the glowing back counter and pick the job' },
  tend: { kb: 'Space at the glowing pan wipes it clean', touch: 'Tap the glowing pan to wipe it clean' },
  gas: { kb: 'Walk to the cylinder stand at the left end, Space changes the cylinder', touch: 'Tap the cylinder stand and your cook walks there' },
  board: { kb: 'Space at the price board, then pick the dish', touch: 'Tap the price board, then pick the dish' },
  play: { kb: 'A / D to walk, Space to cook, pick up, serve and collect', touch: 'Tap stations, dishes and customers: your cook walks and works' },
};

/** Build a step from a compact definition: `text: [kb, touch]` and `hint: [[after, kb, touch], ...]` (touch defaults to kb). */
function S(def) {
  const [kb, touch] = Array.isArray(def.text) ? def.text : [def.text, def.text];
  const hints = def.hint || [];
  return {
    flags: FROZEN,
    allow: A_NONE,
    spotlight: null,
    autoCollect: true,
    ...def,
    text: kb,
    textTouch: touch === undefined ? kb : touch,
    hint: hints.map(([after, k, , when]) => (when ? { after, text: k, when } : { after, text: k })),
    hintTouch: hints.map(([after, k, t, when]) => (when ? { after, text: t === undefined ? k : t, when } : { after, text: t === undefined ? k : t })),
    controls: CONTROLS[def.controls || (def.ack ? 'ack' : 'none')],
    speaker: TUTORIAL_HOST,
  };
}

/** A spotlight that may be off-screen: the scene turns the head to it. */
const sp = (kind, id, slot) => (slot === undefined ? { kind, id, look: true } : { kind, id, slot, look: true });
const custSp = (c) => (c ? sp('customer', c.id) : null);
const ACK_HINT = [14, 'Click "Got it" when you are ready.', 'Tap "Got it" when you are ready.'];
const clearHands = (ctx) => (ctx.me ? ctx.me.hands.map((_, i) => ({ type: 'discard', hand: ctx.me.hands.length - 1 - i })) : []);
/**
 * The customer `tag` waits for a dish that is no longer held or cooking (or walked out without it): the lesson goes back to `to`, and to
 * `card` (the step that seats the customer, default `to`) when the customer is gone for good.
 */
const lostDish = (tag, dish, to, card = to) => (s, ctx) => {
  const c = ctx.cust(tag);
  if (!live(c)) {
    const o = ctx.outcome(tag);
    return o && o !== 'paid' ? card : null;
  }
  if (c.st !== 'waiting' || c.got.includes(dish)) return null;
  return haveDish(s, ctx.me, dish) ? null : to;
};
/** Has customer `tag` been served `dish` (or is already past waiting; a customer served, paid and pruned is remembered by the driver)? */
const servedTag = (ctx, tag, dish) => {
  const c = ctx.cust(tag);
  return c ? c.got.includes(dish) || c.st !== 'waiting' : ctx.outcome(tag) === 'paid';
};
/** Hands full of dishes nobody waiting wants: nothing can be picked up until some are thrown in the bin. */
const junkHands = (s, ctx) => !!ctx.me && ctx.me.hands.length >= 2
  && ctx.me.hands.some((h) => !s.customers.some((c) => c.st === 'waiting' && needsOf(c).includes(h.dish)));
const BIN_SPOT = Object.freeze({ kind: 'bin', look: true });
const BIN_HINT = 'Your hands are full, and a dish you hold is one nobody ordered. Throw it away: go to the bin at the right end of the counter and press Space.';
const BIN_HINT_TOUCH = 'Your hands are full, and a dish you hold is one nobody ordered. Tap the bin at the right end of the counter to throw it away.';
/** Hands full of dishes and not one of them is wanted by anybody waiting (so there is nothing to serve either). */
const allJunkHands = (s, ctx) => !!ctx.me && ctx.me.hands.length >= 2
  && ctx.me.hands.every((h) => !s.customers.some((c) => c.st === 'waiting' && needsOf(c).includes(h.dish)));
/** The gated "your hands are jammed" hint entry (kb and touch text differ, so it is two entries in the compact hint form). */
const BIN_HINT_ENTRY = [8, BIN_HINT, BIN_HINT_TOUCH, junkHands];

// ---------------------------------------------------------------------------------------------------------------------
// one dish, one mini-lesson: recipe card -> cook -> take -> serve (the customer pays by Chotu's hand; collecting has its own lesson)

const LESSON_CUSTOMERS = {
  masala_dosa: ['office', 'Padma'], podi_dosa: ['family', 'Lakshmi akka'], set_dosa: ['uncle', 'Srinivas garu'], pesarattu: ['student', 'Swathi'],
  idly: ['uncle', 'Gopal garu'], poori: ['family', 'Fatima aapa'], vada: ['autowala', 'Raju'], mysore_bonda: ['techie', 'Mahesh'],
  mirchi_bajji: ['office', 'Imran bhai'], irani_chai: ['student', 'Naseer miyan'], filter_coffee: ['techie', 'Anitha'], osmania: ['uncle', 'Zubeida bi'],
};

function dishLesson(dish, { tag = dish, prefix = dish, spawn = true, intro = '', introTe = '', cookSay } = {}) {
  const d = DISHES[dish];
  const sid = KIND_STATION[d.station];
  const label = stationLabel(dish);
  const [kind, name] = LESSON_CUSTOMERS[dish] || ['student', 'Kiran'];
  const id = (x) => `${prefix}-${x}`;
  const cookId = id('cook');
  const takeText = (touch) => (s) => {
    const r = slotOfDish(s, dish);
    const act = touch ? 'Tap it' : 'Press Space at it';
    if (r && r.st === 'cooking') return `${d.name} is cooking. Watch its bar fill: you hear a ping when it is ready. Then ${act.toLowerCase()} at once: the fresher, the bigger the tip.`;
    if (r && r.st === 'ready') return `${d.name} is READY! ${act} to pick it up now, before it burns.`;
    if (r && r.st === 'burnt') return `Burnt! Smoke means the dish is ruined. ${act} to clear the spot, then cook a fresh one.`;
    return `Pick up the ${d.name} as soon as it is ready.`;
  };
  const serveText = (touch) => (s, ctx) => {
    const c = ctx.cust(tag);
    return touch
      ? `Serve ${tokenOf(c)}: tap their chit or the customer, and the ${d.name} goes across the counter.`
      : `Serve ${tokenOf(c)}: face them with A / D and press Space. The ${d.name} goes across the counter.`;
  };
  const stationOrSlot = (s, ctx) => {
    if (junkHands(s, ctx)) return BIN_SPOT;
    const r = slotOfDish(s, dish);
    return r && r.st !== 'burnt' ? sp('slot', r.station, r.slot) : sp('station', sid);
  };
  const cardId = id('card');
  const full = (s) => stationFull(s, sid);
  return {
    card: S({
      id: id('card'), say: `Recipe dekho anna: ${d.name}!`, te: `${introTe}${d.te} తయారీ చూడండి`,
      recipe: dish,
      text: [
        (s, ctx) => `${intro}${tokenOf(ctx.cust(tag))} wants one ${d.name} (${d.te}). Read the recipe card: every line is one move of your hands.`,
        (s, ctx) => `${intro}${tokenOf(ctx.cust(tag))} wants one ${d.name} (${d.te}). Read the recipe card: every line is one move of your hands.`,
      ],
      spotlight: () => sp('station', sid),
      ack: true,
      onEnter: (s, ctx) => {
        const acts = ctx.visits === 1 ? clearHands(ctx) : [];
        if (spawn && !live(ctx.cust(tag))) acts.push(spawnAction({ kind, name, order: [dish], tag }));
        return acts;
      },
      done: (s, e, ctx) => ctx.acked,
      hint: [ACK_HINT],
    }),
    cook: S({
      id: cookId, say: cookSay || `Chalo anna, ${d.name} banao!`, te: `${d.te} మొదలుపెట్టండి`,
      text: [
        `Walk to the glowing ${label} with A / D, press Space and choose ${d.name}. Your own hands start it.`,
        `Tap the glowing ${label} and choose ${d.name}: you walk there and start it with your own hands.`,
      ],
      controls: 'cook',
      allow: A_COOK,
      spotlight: (s) => clearSpot(s, sid) || sp('station', sid),
      done: (s, e, ctx) => haveDish(s, ctx.me, dish) || (!!ctx.cust(tag) && ctx.cust(tag).got.includes(dish)),
      recover: lostDish(tag, dish, cookId, cardId), // the customer is gone: seat them again at the card
      hint: [
        [10, `Walk to the glowing ${label} (A / D), press Space, then pick ${d.name}.`, `Tap the glowing ${label}, then pick ${d.name} from the menu.`],
        [30, `Pick an empty spot on the ${label}, then choose ${d.name}.`],
        [8, `Every spot on the ${label} is busy. Pick up the ready dishes, or clear the smoking ones, to make room.`, undefined, full],
      ],
    }),
    take: S({
      id: id('take'), say: 'Ready hone do, phir jaldi uthao!', te: 'సిద్ధం అవ్వగానే వెంటనే తీసుకోండి',
      text: [takeText(false), takeText(true)],
      controls: 'take',
      allow: A_TAKE,
      spotlight: stationOrSlot,
      done: (s, e, ctx) => heldCount(ctx.me, dish) > 0 || (!!ctx.cust(tag) && ctx.cust(tag).got.includes(dish)),
      recover: lostDish(tag, dish, cookId, cardId),
      hint: [
        [6, 'Press Space at the glowing dish to pick it up.', 'Tap the glowing dish to pick it up.'],
        [20, 'If a dish burns, clear the smoking spot and cook a fresh one.'],
        BIN_HINT_ENTRY,
      ],
    }),
    serve: S({
      id: id('serve'), say: 'Ab token ko do anna, jaldi!', te: 'టోకెన్‌కు వడ్డించండి',
      text: [serveText(false), serveText(true)],
      controls: 'serve',
      allow: A_SERVE,
      spotlight: (s, ctx) => custSp(ctx.cust(tag)),
      done: (s, e, ctx) => servedTag(ctx, tag, dish),
      recover: lostDish(tag, dish, cookId, cardId),
      hint: [[8, 'Face the glowing customer with A / D and press Space.', 'Tap the glowing customer. Your dish goes to them.']],
    }),
  };
}

const lessonSteps = (dish, opts) => Object.values(dishLesson(dish, opts));

// ---------------------------------------------------------------------------------------------------------------------
// the steps, chapter by chapter

const chapter = (id, steps) => steps.map((s) => ({ ...s, chapter: id }));

const LOOK_STEPS = [
  S({
    id: 'welcome', say: 'Namaste anna! Main Chotu, tumhara stall helper.',
    text: 'Welcome to your own tiffin centre. I am Chotu, your helper. This one training shift teaches everything: every station, every dish, the order tokens, money, and a real rush at the end. The clock waits while you learn.',
    te: 'నమస్తే! మీ టిఫిన్ సెంటర్‌కు స్వాగతం.',
    ack: true,
    hint: [[12, 'Click "Got it" to carry on.', 'Tap "Got it" to carry on.']],
    done: (s, e, ctx) => ctx.acked,
  }),
  S({
    id: 'look', say: 'Pehle idhar-udhar dekho anna!',
    text: [
      'You are standing behind the counter and you see through your own eyes. Turn your head: press Q or E, or the left and right arrow keys, and look around the stall.',
      'You are standing behind the counter and you see through your own eyes. Turn your head: drag a finger on empty space and look around the stall.',
    ],
    te: 'తల తిప్పి చుట్టూ చూడండి.',
    controls: 'look',
    ack: true,
    ackAfter: 20, // if the head cannot be turned on this device, Got it appears after a while
    done: (s, e, ctx) => ctx.lookDelta > LOOK_TURN_RAD || ctx.acked,
    hint: [
      [8, 'Hold Q or E, or the arrow keys, to turn your head left and right.', 'Put a finger on empty space and drag sideways to turn your head.'],
      [20, 'Click "Got it" if your head will not turn.', 'Tap "Got it" if your head will not turn.'],
    ],
  }),
  S({
    id: 'hands', say: 'Ye dekho, tumhare haath!',
    text: 'Those are YOUR hands at the bottom of the view. In the right hand is the ladle for batter, in the left the flat spatula for lifting. They do all the work, and they carry the plates too, two at a time.',
    te: 'ఇవి మీ చేతులు: గరిటె, అట్లకాడ.',
    spotlight: { kind: 'hands' },
    ack: true,
    hint: [ACK_HINT],
    done: (s, e, ctx) => ctx.acked,
  }),
  S({
    id: 'tour', say: 'Dekho anna, ye apna stall hai.',
    text: 'This is your stall. From the left: the TAWA makes dosas, the IDLY STEAMER steams idlis, the KADAI fries, and the CHAI COUNTER pours chai. Customers stand across the counter, in front of you. We will cook on every one of them.',
    te: 'ఇది మీ స్టాల్: పెనం, ఇడ్లీ పాత్ర, కడాయి, చాయ్ కౌంటర్.',
    spotlight: (s, ctx) => sp('station', ['tawa1', 'steamer1', 'kadai1', 'chai1'][Math.floor(ctx.stepTicks / 3) % 4]),
    ack: true,
    hint: [[14, 'Click "Got it" when you have looked around.', 'Tap "Got it" when you have looked around.']],
    done: (s, e, ctx) => ctx.acked,
  }),
];

const TOKEN_STEPS = [
  S({
    id: 'token', say: 'Anna, customer aa gaya! Token number dekho!',
    text: (s, ctx) => {
      const a = ctx.cust('A');
      return `Your first customer is here. Every customer gets a numbered TOKEN: this is ${tokenOf(a)}. Their order chit (and the bubble over their head) shows ${a ? dishNames(a.order) : 'what they want'}, a coin ring for their patience, and later a money note.`;
    },
    te: 'మొదటి కస్టమర్! టోకెన్ నంబర్ మరియు ఆర్డర్ చూడండి.',
    spotlight: (s, ctx) => custSp(ctx.cust('A')),
    onEnter: (s, ctx) => (live(ctx.cust('A')) ? [] : [spawnAction({ kind: 'student', name: 'Kiran', order: ['dosa'], tag: 'A' })]),
    ack: true,
    needsTags: ['A'],
    done: (s, e, ctx) => !!ctx.cust('A') && (ctx.acked || ctx.visits > 1),
    hint: [[10, 'Look at the customer across the counter, read the chit, then click "Got it".', 'Look at the customer across the counter, read the chit, then tap "Got it".']],
  }),
  S({
    id: 'token-states', say: 'Token ke teen haal hote hain, samjho!',
    text: (s, ctx) => `${tokenOf(ctx.cust('A'))} is WAITING: hungry, and the coin ring slowly drains. Once you serve every dish they ordered they are EATING for a few seconds, then PAYING: the money note comes out and you must collect it fast. Patience, tokens and money are all on the chit.`,
    te: 'టోకెన్ మూడు స్థితులు: వేచి ఉన్నారు, తింటున్నారు, చెల్లిస్తున్నారు.',
    spotlight: (s, ctx) => custSp(ctx.cust('A')),
    ack: true,
    hint: [ACK_HINT],
    done: (s, e, ctx) => ctx.acked,
  }),
];

// The tawa: walk, the dosa recipe (the first customer), the burn demo, then the four variants
const DOSA = dishLesson('dosa', {
  tag: 'A', prefix: 'dosa', intro: 'The TAWA is your dosa pan. ', introTe: 'పెనం: ', cookSay: 'Chalo, dosa daalo tawa pe!',
});

const TAWA_STEPS = [
  S({
    id: 'walk', say: 'Pehle tawa pe chalo!',
    text: [
      'First, walk to the tawa. Use A / D (or the arrow keys) to walk along the counter until the tawa is in front of you.',
      'First, go to the tawa. Tap it: you walk there along the counter, and the view follows you.',
    ],
    te: 'పెనం దగ్గరకు వెళ్ళండి. నొక్కితే మీరు నడిచి వెళ్తారు.',
    controls: 'walk',
    spotlight: () => sp('station', 'tawa1'),
    done: (s, e, ctx) => !!ctx.me && ctx.me.at === 'tawa1',
    hint: [
      [8, 'Press A, or the left arrow, until you stand at the glowing tawa.', 'Tap the glowing tawa and you walk there.'],
      [24, 'The tawa is on the far left. Keep walking left with A or the left arrow.', 'The tawa is on the far left. Turn your head to find it, then tap it.'],
    ],
  }),
  DOSA.card,
  DOSA.cook,
  S({
    id: 'dosa-watch', say: 'Dekho, dosa pak raha hai!',
    text: 'See the bar fill? When the dosa is ready you hear a ping and it glows. Wait for it. (I also put a masala dosa on the tawa for nobody. Leave that one alone, you will see why.)',
    te: 'దోశ వేగుతోంది. సిద్ధమయ్యే వరకు చూడండి.',
    spotlight: (s) => {
      const r = allSlots(s).find((x) => x.dish === 'dosa' && SLOT_BUSY.has(x.st));
      return r ? sp('slot', r.station, r.slot) : sp('station', 'tawa1');
    },
    // The demo: a masala dosa nobody is waiting for, left to burn so the burn step can show what smoke means.
    onEnter: (s, ctx) => {
      if (ctx.demo) return [];
      const station = s.stations.tawa1;
      if (!station) return [];
      let slot = -1;
      station.slots.forEach((sl, i) => { if (sl.st === 'empty') slot = i; });
      if (slot < 0) return [];
      return { actions: [{ type: 'cook', station: 'tawa1', slot, dish: 'masala_dosa' }], set: { demo: { station: 'tawa1', slot } } };
    },
    done: (s, e, ctx) => !!readySlot(s, 'dosa') || heldCount(ctx.me, 'dosa') > 0 || (!!ctx.cust('A') && ctx.cust('A').got.includes('dosa')),
    recover: lostDish('A', 'dosa', 'dosa-cook', 'dosa-card'),
    hint: [[12, 'Just wait: the dosa needs a few seconds. Watch its bar.']],
  }),
  DOSA.take,
  DOSA.serve,
  S({
    id: 'burn', say: 'Arre, wo masala dosa dekho!',
    text: (s, ctx) => {
      const sl = slotAt(s, ctx.demo);
      if (sl && sl.st === 'burnt') return 'Burnt! Smoke means the dish is ruined: it cannot be served. Clear the smoking spot, and pick dishes up in time. (Token #1 paid, I took the money for you this once.)';
      if (sl && sl.st === 'ready') return 'That masala dosa is ready but nobody picked it up. Wait a little and watch what happens: every dish has a short time before it burns.';
      return 'That masala dosa is still cooking. Dishes you forget on the tawa burn. Watch it.';
    },
    te: 'మాడిపోయింది! కాలిన దోశను తీసేయండి.',
    controls: 'take',
    allow: A_TAKE,
    when: (s, ctx) => {
      const sl = slotAt(s, ctx.demo);
      return !!sl && sl.st !== 'empty';
    },
    spotlight: (s, ctx) => (ctx.demo ? sp('slot', ctx.demo.station, ctx.demo.slot) : null),
    done: (s, e, ctx) => {
      const sl = slotAt(s, ctx.demo);
      return !sl || sl.st === 'empty';
    },
    hint: [
      [6, 'Waiting for the dosa to burn. It takes a few more seconds.'],
      [20, 'Press Space at the smoking dish to clear it (or at the ready one to pick it up).', 'Tap the smoking dish to clear it (or the ready one to pick it up).'],
    ],
  }),
  ...['masala_dosa', 'podi_dosa', 'set_dosa', 'pesarattu'].flatMap((d) => lessonSteps(d, d === 'masala_dosa' ? { intro: 'Now each dosa variant on its own. ', introTe: 'ప్రతి దోశ రకం: ' } : {})),
];

const IDLY_STEPS = lessonSteps('idly', { intro: 'The IDLY STEAMER holds four plates at a time. Idlis take longer than a dosa, but they wait in the steam for a good while. ', introTe: 'ఇడ్లీ పాత్ర: ' });

const KADAI_STEPS = ['poori', 'vada', 'mysore_bonda', 'mirchi_bajji'].flatMap((d) => lessonSteps(d, d === 'poori'
  ? { intro: 'The KADAI is the deep-fry pan. Oil heat matters: too cold and food stays pale, too hot and it burns outside and stays raw inside. You skim food out with the JHARA, the long slotted spoon. ', introTe: 'కడాయి: ' }
  : {}));

const CHAI_STEPS = ['irani_chai', 'filter_coffee', 'osmania'].flatMap((d) => lessonSteps(d, d === 'irani_chai'
  ? { intro: 'The CHAI COUNTER pours chai and coffee and hands out biscuits. ', introTe: 'చాయ్ కౌంటర్: ' }
  : {}));

// Serve and collect: two tokens, two hands, the right dish to the right token, the money
const needCovered = (s, ctx, tag) => {
  const c = ctx.cust(tag);
  // a token that is already past waiting needs nothing more (and one served, paid and gone is remembered by its outcome)
  if (!c) return !!ctx.outcome(tag);
  return c.st !== 'waiting' || needsOf(c).every((d) => haveDish(s, ctx.me, d));
};
// a customer of the pair is past waiting (served, paid or gone): pruned customers are remembered by their outcome
const pairPast = (ctx, tag) => {
  const c = ctx.cust(tag);
  return c ? c.st !== 'waiting' : !!ctx.outcome(tag);
};
const pairLost = (s, ctx) => {
  for (const tag of ['B', 'C']) {
    const c = ctx.cust(tag);
    const o = ctx.outcome(tag);
    if (o && o !== 'paid') return 'orders'; // this token left without being served or paid: new customers
    if (live(c) && c.st === 'waiting' && !needsOf(c).every((d) => haveDish(s, ctx.me, d))) return 'cook2';
  }
  return null;
};
const pairHeld = (s, ctx) => ['B', 'C'].every((tag) => {
  const c = ctx.cust(tag);
  return c ? c.st !== 'waiting' || needsOf(c).every((d) => heldCount(ctx.me, d) > 0) : !!ctx.outcome(tag);
});
const firstUnpaid = (ctx) => {
  const c = ['B', 'C'].map((t) => ctx.cust(t)).find((x) => x && x.st === 'paying') || ctx.cust('B') || ctx.cust('C');
  return c || null;
};
const B_ORDER = ['dosa'];
const C_ORDER = ['idly'];

const SERVE_STEPS = [
  S({
    id: 'orders', say: 'Do token ek saath! Sahi dish, sahi token ko!',
    text: (s, ctx) => `Two tokens now: ${tokenOf(ctx.cust('B'))} wants a Plain Dosa, ${tokenOf(ctx.cust('C'))} wants an Idly. Serve the RIGHT dish to the RIGHT token: a wrong dish is refused. You have two hands, so you can carry two dishes at once.`,
    te: 'ఇద్దరు టోకెన్లు. సరైన వంటకం సరైన టోకెన్‌కు.',
    spotlight: (s, ctx) => custSp(ctx.cust('B')),
    onEnter: (s, ctx) => {
      const acts = clearHands(ctx);
      if (!live(ctx.cust('B'))) acts.push(spawnAction({ kind: 'office', name: 'Padma', order: B_ORDER, tag: 'B' }));
      if (!live(ctx.cust('C'))) acts.push(spawnAction({ kind: 'uncle', name: 'Venkat uncle', order: C_ORDER, tag: 'C' }));
      return acts;
    },
    ack: true,
    needsTags: ['B', 'C'],
    done: (s, e, ctx) => !!ctx.cust('B') && !!ctx.cust('C') && ctx.acked,
    hint: [ACK_HINT],
  }),
  S({
    id: 'cook2', say: 'Dono shuru karo: tawa pe dosa, steamer mein idly!',
    text: [
      'Start both: a Plain Dosa on the tawa and an Idly in the steamer. Walk with A / D and press Space at each station.',
      'Start both: tap the tawa for a Plain Dosa and the steamer for an Idly. You walk to each one.',
    ],
    te: 'రెండూ మొదలుపెట్టండి: దోశ మరియు ఇడ్లీ.',
    controls: 'cook',
    allow: A_COOK,
    spotlight: (s, ctx) => {
      const need = ['B', 'C'].map((t) => ctx.cust(t)).filter(Boolean).flatMap((c) => needsOf(c)).find((d) => !haveDish(s, ctx.me, d));
      if (!need) return null;
      const sid = KIND_STATION[DISHES[need].station];
      return clearSpot(s, sid) || sp('station', sid);
    },
    done: (s, e, ctx) => needCovered(s, ctx, 'B') && needCovered(s, ctx, 'C'),
    recover: pairLost, // a token that walked out (or a pair spawned short) goes back to `orders`, which seats whoever is missing
    hint: [
      [12, 'Start a Plain Dosa on the tawa and an Idly in the steamer.', 'Tap the tawa for the dosa and the steamer for the idly.'],
      [34, 'You need both a dosa and an idly cooking. One more to start?'],
      [8, 'The station you need is full. Pick up the ready dishes, or clear the smoking ones, to make room.', undefined, (s, ctx) => needStationFull(s, ctx, ['B', 'C'])],
    ],
  }),
  S({
    id: 'carry', say: 'Dono haath bhar lo anna!',
    text: [
      'Pick up the dosa and the idly as they get ready: one in each hand. You can carry two dishes at once, no more.',
      'Tap the dosa and the idly as they get ready: one in each hand. You can carry two dishes at once, no more.',
    ],
    te: 'రెండు చేతులతో రెండు వంటకాలు మోయండి.',
    controls: 'take',
    allow: A_CARRY,
    spotlight: (s, ctx) => {
      if (junkHands(s, ctx)) return BIN_SPOT;
      const r = ['dosa', 'idly'].map((d) => readySlot(s, d)).find((x) => x && heldCount(ctx.me, x.dish) === 0);
      return r ? sp('slot', r.station, r.slot) : { kind: 'hands' };
    },
    done: (s, e, ctx) => pairHeld(s, ctx),
    recover: pairLost,
    hint: [
      [14, 'Press Space at each ready dish to pick it up.', 'Tap each ready dish to pick it up.'],
      [40, 'Hands full? One dish in each hand: dosa and idly.'],
      BIN_HINT_ENTRY,
    ],
  }),
  S({
    id: 'serve2', say: 'Ab sahi token ko sahi dish do!',
    text: (s, ctx) => `Serve the dosa to ${tokenOf(ctx.cust('B'))} and the idly to ${tokenOf(ctx.cust('C'))}. Read the chits: a dish for the wrong token is refused.`,
    te: 'సరైన టోకెన్‌కు సరైన వంటకం వడ్డించండి.',
    controls: 'serve',
    allow: A_ORDERS,
    autoCollect: false,
    spotlight: (s, ctx) => {
      const c = ['B', 'C'].map((t) => ctx.cust(t)).find((x) => x && x.st === 'waiting' && needsOf(x).every((d) => heldCount(ctx.me, d) > 0));
      return custSp(c) || { kind: 'hands' };
    },
    done: (s, e, ctx) => ['B', 'C'].every((t) => pairPast(ctx, t)),
    recover: pairLost,
    hint: [[10, 'Face a glowing customer with A / D and press Space.', 'Tap the customer whose chit matches the dish you hold.']],
  }),
  S({
    id: 'collect', say: 'Paisa nikalo, jaldi! Late hua toh bhaag jayega!',
    text: [
      'They eat, then hold the money out. COLLECT it fast: press Space at each customer holding a money note. If you are late, the customer walks away WITHOUT paying and you lose a heart!',
      'They eat, then hold the money out. COLLECT it fast: tap each customer holding a money note. If you are late, the customer walks away WITHOUT paying and you lose a heart!',
    ],
    te: 'డబ్బు తీసుకోండి, త్వరగా! ఆలస్యమైతే చెల్లించకుండా వెళ్ళిపోతారు.',
    controls: 'collect',
    allow: A_COLLECT,
    autoCollect: false,
    spotlight: (s, ctx) => custSp(firstUnpaid(ctx)),
    // the pay window is real the first time (that is the lesson); after a miss it is frozen so the lesson cannot be failed twice
    flags: (ctx) => ({ patience: false, pay: ctx.attempts.collect === 0 }),
    done: (s, e, ctx) => ctx.outcome('B') === 'paid' && ctx.outcome('C') === 'paid',
    // retry only once both tokens are decided (nobody is left paying): the new pair is then spawned from scratch
    failed: (s, ctx) => (['B', 'C'].every((t) => ctx.outcome(t)) && ['B', 'C'].some((t) => ctx.outcome(t) !== 'paid') ? { to: 'orders', attempt: 'collect' } : null),
    hint: [
      [14, 'Press Space at the customer holding the money note.', 'Tap the customer holding the money note.'],
      [30, 'Wait for the money note to appear, then collect it.'],
    ],
  }),
  S({
    id: 'tips', say: 'Tip aur combo ka khel, samjho anna!',
    text: 'Every dish you serve fills the coin ring back by a quarter, so a busy token can be saved. A perfect pickup (taken within two seconds of ready) and a happy customer earn a TIP. Collect customers one after another without a miss and your COMBO bonus grows.',
    te: 'త్వరగా వడ్డిస్తే టిప్. వరుసగా వసూలు చేస్తే కాంబో బోనస్.',
    ack: true,
    hint: [ACK_HINT],
    done: (s, e, ctx) => ctx.acked,
  }),
];

// Game flow: ack-only pages (nothing to cook), one idea each
const infoStep = (id, say, text, te) => S({ id, say, text, te, ack: true, hint: [ACK_HINT], done: (s, e, ctx) => ctx.acked });

// ---------------------------------------------------------------------------------------------------------------------
// the operations chapters. Each one switches its mechanic ON for the training shift (tutorial-flags) when its lesson starts and lets the player
// DO the real thing; every failure has a way back, and nothing here is finished by waiting.

const train = trainAction;
/** Chotu brings a fresh delivery: every ingredient back to 10 portions and every batter fresh again (with exceptions). */
const restock = (stock = {}, fresh = {}) => trainAction({ stage: { stock: { '*': 10, ...stock }, fresh: { '*': 100, ...fresh } } });
const fmt = (n) => String(Math.round(n * 100) / 100);
const rs = (n) => `Rs ${Math.round(n)}`;
const stockN = (s, item) => (s.stock && typeof s.stock[item] === 'number' ? s.stock[item] : 0);
const prepSlots = (s) => (s.stations[PREP_STATION] ? s.stations[PREP_STATION].slots : []);
const prepJobs = (s, item) => prepSlots(s).filter((j) => j.st !== 'empty' && j.item === item);
const usesLine = (dish) => ingredientsOf(dish).map((u) => `${u.label} ${u.name.toLowerCase()}`).join(', ');
const prepSp = () => sp('station', PREP_STATION);
const gasSp = () => ({ kind: 'gas', look: true });
const boardSp = () => ({ kind: 'board', look: true });
const stationSp = (dish) => sp('station', KIND_STATION[DISHES[dish].station]);
const clearOnce = (ctx) => (ctx.visits === 1 ? clearHands(ctx) : []);
/** Text that differs only in the verb: f(touch) gives the string or the (state, ctx) function. */
const both = (f) => [f(false), f(true)];
const pressAt = (touch) => (touch ? 'Tap' : 'Press Space at');

// what is on the stations or in the hands, as a dish -> count map (the supply of a lesson)
function supplyMap(state, me) {
  const m = {};
  const add = (d) => { m[d] = (m[d] || 0) + 1; };
  if (me) for (const h of me.hands) add(h.dish);
  for (const x of allSlots(state)) if (x.dish && SLOT_BUSY.has(x.st)) add(x.dish);
  return m;
}
/** The first dish a waiting customer of `tags` needs that nothing held or cooking covers, or null. */
function firstUncovered(state, ctx, tags) {
  const sup = supplyMap(state, ctx.me);
  for (const t of tags) {
    const c = ctx.cust(t);
    if (!live(c) || c.st !== 'waiting') continue;
    for (const d of needsOf(c)) {
      if (sup[d] > 0) sup[d] -= 1;
      else return d;
    }
  }
  return null;
}
const allCovered = (state, ctx, tags) => tags.every((t) => ctx.cust(t) || ctx.outcome(t)) && firstUncovered(state, ctx, tags) === null;
const allPast = (ctx, tags) => tags.every((t) => pairPast(ctx, t));
const coverSpot = (tags) => (state, ctx) => {
  const d = firstUncovered(state, ctx, tags);
  return d ? stationSp(d) : { kind: 'hands' };
};
/** A held or ready dish for one of `tags` to carry over: the ready slot first, else the customer who can be served. */
const serveSpot = (tags) => (state, ctx) => {
  if (allJunkHands(state, ctx)) return BIN_SPOT;
  const c = tags.map((t) => ctx.cust(t)).find((x) => live(x) && x.st === 'waiting' && needsOf(x).some((d) => heldCount(ctx.me, d) > 0));
  if (c) return custSp(c);
  const r = allSlots(state).find((x) => x.st === 'ready' && x.dish);
  return r ? sp('slot', r.station, r.slot) : { kind: 'hands' };
};
const spawnTags = (ctx, list) => list.filter((r) => !live(ctx.cust(r.tag))).map((r) => spawnAction(r));
/** Is the station the first uncovered dish of `tags` needs full (nothing can be started there until a spot is cleared)? */
function needStationFull(state, ctx, tags) {
  const d = firstUncovered(state, ctx, tags);
  return !!d && stationFull(state, KIND_STATION[DISHES[d].station]);
}

// ---------------------------------------------------------------------------------------------------------------------
// rescues: the stall ran out of something the lesson needs, because of the player's own extra actions (junk dishes eat stock and gas, an extra
// idly batch boils the steamer dry) or just because time passed (batter sours and is thrown away). Chotu re-stages it, once, with the very
// same `tutorial-flags` stage the lesson used to set it up; a power cut or a busy spot clear by themselves and are never "rescued".

const gasDead = (s) => !!s.cfg.gas && !!s.gas && s.gas.u <= 0 && s.gas.sw === 0;
const steamerDry = (s) => {
  const st = s.stations[KIND_STATION.steamer];
  return !!s.cfg.heat && !!st && typeof st.water === 'number' && st.water <= 0;
};
const shortItems = (s, dish) => (s.cfg.stock ? Object.entries(DISHES[dish].uses).filter(([item, q]) => !(s.stock[item] >= q)).map(([item]) => item) : []);

/** The stage that lets every dish of `dishes` be cooked again (`skip`: ingredients a lesson keeps short on purpose), or null when nothing blocks them. */
function refillFor(s, dishes, skip = [], gasTo = 800) {
  const stock = {};
  const fresh = {};
  let gas = false;
  let water = false;
  for (const d of dishes) {
    if (!DISHES[d]) continue;
    if (gasDead(s)) gas = true;
    if (DISHES[d].station === 'steamer' && steamerDry(s)) water = true;
    for (const item of shortItems(s, d)) {
      if (skip.includes(item)) continue;
      stock[item] = 10;
      if (INGREDIENTS[item].ferments) fresh[item] = 100;
    }
  }
  const stage = {};
  if (Object.keys(stock).length) {
    stage.stock = stock;
    if (Object.keys(fresh).length) stage.fresh = fresh;
  }
  if (gas) stage.gas = gasTo;
  if (water) stage.pans = { steamer: { water: 100, gunk: 0 } };
  return Object.keys(stage).length ? [trainAction({ stage })] : null;
}
/** Rescue for a step whose customers `tags` still wait for dishes: whatever blocks the first dish nothing covers is topped up. */
const keepCookable = (tags, skip = [], gasTo = 800) => (s, ctx) => {
  const d = firstUncovered(s, ctx, tags);
  return d ? refillFor(s, [d], skip, gasTo) : null;
};
/** Rescue for a step that makes `items` at the back counter: a shelf so full that the job would be refused ("The shelf is full") goes back to a low one. */
const keepRoomFor = (items) => (s) => {
  const stock = {};
  for (const item of items) {
    if (prepJobs(s, item).length || !(item in s.stock)) continue;
    if (s.stock[item] + INGREDIENTS[item].prep.yield > STOCK_CAP) stock[item] = 2;
  }
  return Object.keys(stock).length ? [trainAction({ stage: { stock } })] : null;
};
/** Every dish back on the board (a wrong dish marked sold out must not leave a customer with nothing to order). */
const boardRestore = (s, except = []) => (s.off || []).filter((d) => !except.includes(d)).map((dish) => ({ type: 'board', dish, on: true }));
/** Is `tag` a customer who was seated and is gone without having paid (walked out, sold out, pruned unseen)? */
const tagLost = (ctx, tag) => {
  const o = ctx.outcome(tag);
  return !!o && o !== 'paid';
};
/** Steps that teach (or let the player fix) the burners and the steamer themselves: Chotu does not lend a hand there. */
const NO_STALL_RESCUE = new Set(['gas-intro', 'gas-low', 'gas-swap', 'gas-wait', 'heat-others', 'inspect-drill', 'rush', 'outro']);
/**
 * Every step, whatever it teaches: a dish that is cooking on a burner with no gas (or in a steamer with no water) never gets ready, and the player
 * may not be allowed to fix it in this step: the cylinder / the water is put back (the dish simply carries on).
 */
function stallRescue(s, step) {
  if (NO_STALL_RESCUE.has(step.id) || !s.cfg.stations) return null;
  const cooking = (kind) => s.cfg.stations.some((sid) => s.stations[sid].kind !== 'prep' && (!kind || s.stations[sid].kind === kind) && s.stations[sid].slots.some((sl) => sl.st === 'cooking'));
  const stage = {};
  if (gasDead(s) && cooking()) stage.gas = 800;
  if (steamerDry(s) && cooking('steamer')) stage.pans = { steamer: { water: 100, gunk: 0 } };
  return Object.keys(stage).length ? [trainAction({ stage })] : null;
}
const prepJam = (s) => prepSlots(s).length > 0 && prepSlots(s).every((j) => j.st !== 'empty');
const TAWA_FULL_HINT = [8, 'Every spot on the tawa is busy. Pick up the ready dishes, or clear the smoking ones, to make room.', undefined, (s) => stationFull(s, KIND_STATION.tawa)];
const PREP_JAM_HINT = [8, 'Both job slots at the back counter are busy. Collect a finished job (or wait for it) to free a slot.', undefined, prepJam];

// ---------------------------------------------------------------------------------------------------------------------
// Chapter: Stock and the prep counter

const SHELF = Object.freeze({ batter_dosa: 6, sambar: 2, coconut_chutney: 2 });
const BATTER = INGREDIENTS.batter_dosa;
const SIDE_ITEMS = ['sambar', 'coconut_chutney'];
const OUT_ORDER = ['dosa', 'dosa'];

const STOCK_STEPS = [
  S({
    id: 'stock-turn', say: 'Peeche mudo anna, ek aur counter hai!',
    text: [
      'A real stall never cooks from an empty shelf. Behind you is the BACK COUNTER: the wet grinder, the chutney stone, the sambar pot and the dough tray. Turn round and walk to it.',
      'A real stall never cooks from an empty shelf. Behind you is the BACK COUNTER: the wet grinder, the chutney stone, the sambar pot and the dough tray. Tap the glowing counter and you turn round and walk to it.',
    ],
    te: 'వెనక్కి తిరగండి: వెనుక కౌంటర్ ఉంది.',
    controls: 'prep',
    spotlight: prepSp,
    onEnter: (s, ctx) => [...clearOnce(ctx), train({ stock: true, stage: { stock: SHELF, fresh: { batter_dosa: 31 } } })],
    done: (s, e, ctx) => !!ctx.me && ctx.me.at === PREP_STATION,
    hint: [
      [8, 'Face the glowing back counter behind you and press Space.', 'Tap the glowing back counter behind you.'],
      [24, 'The back counter is behind your cooking row. Turn right round to find it.'],
    ],
  }),
  S({
    id: 'stock-bars', say: 'Shelf dekho: har dish ka saaman lagta hai!',
    text: (s) => `Look at the shelf bars. Every dish eats ingredients: one Plain Dosa takes ${usesLine('dosa')}. Right now the shelf has dosa batter ${fmt(stockN(s, 'batter_dosa'))}, sambar ${fmt(stockN(s, 'sambar'))} and chutney ${fmt(stockN(s, 'coconut_chutney'))} portions. A bar goes red at 3 portions or less, and when one ingredient is short that dish cannot be cooked at all.`,
    te: 'ప్రతి వంటకానికి సరుకు కావాలి. షెల్ఫ్ బార్లు చూడండి.',
    spotlight: prepSp,
    ack: true,
    hint: [ACK_HINT],
    done: (s, e, ctx) => ctx.acked,
  }),
  S({
    id: 'stock-batter', say: 'Dosa ka batter banao anna, chakki chalao!',
    text: [
      `Make a fresh batch of DOSA BATTER. Press Space at the back counter and choose Dosa batter: rice and urad dal, ground in the wet grinder. The ingredients are paid up front (${rs(BATTER.cost * BATTER.prep.yield)} for ${BATTER.prep.yield} portions) and the job takes ${BATTER.prep.ticks} seconds. The counter has two job slots, so two things can be made at once.`,
      `Make a fresh batch of DOSA BATTER. Tap the back counter and choose Dosa batter: rice and urad dal, ground in the wet grinder. The ingredients are paid up front (${rs(BATTER.cost * BATTER.prep.yield)} for ${BATTER.prep.yield} portions) and the job takes ${BATTER.prep.ticks} seconds. The counter has two job slots, so two things can be made at once.`,
    ],
    te: 'దోశ పిండి తయారు చేయండి: గ్రైండర్ నడపండి.',
    prepRecipe: 'batter_dosa',
    controls: 'prep',
    allow: A_PREP,
    spotlight: prepSp,
    done: (s) => prepJobs(s, 'batter_dosa').length > 0,
    rescue: keepRoomFor(['batter_dosa']),
    hint: [
      [10, 'Press Space at the glowing back counter, then choose Dosa batter.', 'Tap the glowing back counter, then choose Dosa batter.'],
      [30, 'Pick an empty job slot on the back counter and choose Dosa batter.'],
      PREP_JAM_HINT,
    ],
  }),
  S({
    id: 'stock-grind', say: 'Batter jaldi khatta ho jata hai, garmi mein!',
    text: both((touch) => (s) => {
      const j = prepJobs(s, 'batter_dosa')[0];
      const fresh = s.fresh && typeof s.fresh.batter_dosa === 'number' ? s.fresh.batter_dosa : 100;
      if (j && j.st === 'ready') return `The new batter is READY on the counter. ${pressAt(touch)} it to collect: it joins the shelf and mixes with the old batter, so the freshness of the jar goes UP (it is ${fresh} now, out of 100).`;
      const left = j ? Math.max(0, j.readyAt - s.tick) : 0;
      return `The grinder is turning, ${left} seconds to go. Why batter goes SOUR: it ferments in the Hyderabad heat, a little more every few seconds. Freshness now ${fresh} of 100. Under 30 it is SOUR: dosas from it come out only OK and tip less. At zero the whole jar is thrown away and the money is wasted. Fresh batter mixed in lifts the average.`;
    }),
    te: 'పిండి ఎండలో త్వరగా పులుస్తుంది. కొత్త పిండి తీసుకోండి.',
    controls: 'prep',
    allow: A_PICKUP,
    spotlight: prepSp,
    done: (s) => prepJobs(s, 'batter_dosa').length === 0,
    hint: [
      [12, 'Wait for the batter to be ready, then press Space at the back counter.', 'Wait for the batter to be ready, then tap the back counter.'],
      [30, 'The job slot glows when it is ready. Collect it.'],
    ],
  }),
  S({
    id: 'stock-sides', say: 'Sambar aur chutney bhi banao, dono ek saath!',
    text: [
      'Sambar and coconut chutney run low too (see the bars). Start BOTH: the sambar pot needs the stove (gas) and takes 10 seconds, the chutney stone takes 6. The two jobs run at the same time. Press Space at the back counter and choose each one.',
      'Sambar and coconut chutney run low too (see the bars). Start BOTH: the sambar pot needs the stove (gas) and takes 10 seconds, the chutney stone takes 6. The two jobs run at the same time. Tap the back counter and choose each one.',
    ],
    te: 'సాంబార్, చట్నీ రెండూ ఒకేసారి మొదలుపెట్టండి.',
    prepRecipe: 'sambar',
    controls: 'prep',
    allow: A_PREP,
    spotlight: prepSp,
    done: (s) => SIDE_ITEMS.every((i) => prepJobs(s, i).length > 0),
    rescue: keepRoomFor(SIDE_ITEMS),
    hint: [
      [10, 'Start Sambar, then Coconut chutney: two jobs at once.', 'Tap the back counter and start Sambar, then Coconut chutney.'],
      [30, 'Each job needs its own empty slot on the back counter.'],
      PREP_JAM_HINT,
    ],
  }),
  S({
    id: 'stock-sides-collect', say: 'Jab ready ho jaye, utha lo anna!',
    text: both((touch) => (s) => {
      const parts = SIDE_ITEMS.map((i) => {
        const j = prepJobs(s, i)[0];
        const name = INGREDIENTS[i].name;
        if (!j) return `${name} is on the shelf`;
        return j.st === 'ready' ? `${name} is READY` : `${name} needs ${Math.max(0, j.readyAt - s.tick)} more seconds`;
      });
      return `${parts.join('; ')}. ${pressAt(touch)} each finished job to move it to the shelf. Nothing here goes to waste: the portions you paid for are yours.`;
    }),
    te: 'సిద్ధమైనవి షెల్ఫ్‌లోకి తీసుకోండి.',
    controls: 'prep',
    allow: A_PICKUP,
    spotlight: prepSp,
    done: (s) => SIDE_ITEMS.every((i) => prepJobs(s, i).length === 0),
    hint: [
      [12, 'Press Space at the back counter when a job is ready.', 'Tap the back counter when a job is ready.'],
      [30, 'Sambar takes 10 seconds, chutney 6. Collect both.'],
    ],
  }),
  S({
    id: 'stock-out-order', say: 'Ab dekho jab batter khatam ho jaye!',
    text: (s, ctx) => `Now see what happens when an ingredient RUNS OUT. ${tokenOf(ctx.cust('S'))} wants TWO Plain Dosas, but the shelf has only ${fmt(stockN(s, 'batter_dosa'))} portion of dosa batter (see the bar).`,
    te: 'పిండి అయిపోతే ఏమవుతుందో చూడండి.',
    spotlight: (s, ctx) => custSp(ctx.cust('S')),
    onEnter: (s, ctx) => [
      train({ stage: { stock: { batter_dosa: 1 } } }),
      ...(live(ctx.cust('S')) ? [] : [spawnAction({ kind: 'office', name: 'Padma', order: OUT_ORDER, tag: 'S' })]),
    ],
    ack: true,
    needsTags: ['S'],
    hint: [ACK_HINT],
    done: (s, e, ctx) => !!ctx.cust('S') && ctx.acked,
  }),
  S({
    id: 'stock-out-cook', say: 'Pehla dosa daalo, ek hi ka batter hai!',
    text: [
      'Cook the first Plain Dosa on the tawa: walk there with A / D, press Space and choose it. It takes the last portion of batter.',
      'Cook the first Plain Dosa: tap the tawa and choose it. It takes the last portion of batter.',
    ],
    te: 'మొదటి దోశ వేయండి: ఇదే చివరి పిండి.',
    controls: 'cook',
    allow: A_COOK,
    spotlight: (s) => clearSpot(s, KIND_STATION.tawa) || stationSp('dosa'),
    done: (s) => stockN(s, 'batter_dosa') < 1,
    // the batter is short on purpose; anything else the dosa needs (chutney, sambar, oil, gas) is topped up if junk dishes used it
    rescue: keepCookable(['S'], ['batter_dosa']),
    // a customer who is gone (or a dosa lost) is dealt with by the next step's recover: batter used up -> this step is done
    hint: [
      [10, 'Walk to the glowing tawa, press Space and choose Plain Dosa.', 'Tap the glowing tawa and choose Plain Dosa.'],
      [8, 'Every spot on the tawa is busy. Pick up the ready dishes, or clear the smoking ones, to make room.', undefined, (s) => stationFull(s, KIND_STATION.tawa)],
    ],
  }),
  S({
    id: 'stock-out-serve', say: 'Ek dosa tayyar hai, pehle usko do!',
    text: both((touch) => (s, ctx) => `The batter is gone (the bar is empty). Pick up the first dosa and serve it to ${tokenOf(ctx.cust('S'))}: they still wait for a second one. ${touch ? 'Tap' : 'Press Space at'} the glowing dish, then the customer.`),
    te: 'మొదటి దోశ వడ్డించండి.',
    controls: 'take',
    allow: A_CARRY,
    spotlight: serveSpot(['S']),
    done: (s, e, ctx) => !!ctx.cust('S') && ctx.cust('S').got.length > 0,
    recover: (s, ctx) => {
      const c = ctx.cust('S');
      if (tagLost(ctx, 'S')) return 'stock-out-order'; // seated again there, with the one last portion of batter
      return live(c) && c.st === 'waiting' && c.got.length === 0 && !haveDish(s, ctx.me, 'dosa') ? 'stock-out-order' : null;
    },
    hint: [[10, 'Press Space at the glowing dosa, then at the customer.', 'Tap the glowing dosa, then the customer.'], BIN_HINT_ENTRY],
  }),
  S({
    id: 'stock-out-refused', say: 'Dusra dosa? Batter nahi hai, machine mana karegi!',
    text: [
      'Try it: walk to the tawa and cook the second dosa. The stall refuses with "Out of dosa batter". No batter, no dosa: you cannot cook it however hard you try. The customer is waiting, so you must make more batter.',
      'Try it: tap the tawa and cook the second dosa. The stall refuses with "Out of dosa batter". No batter, no dosa: you cannot cook it however hard you try. The customer is waiting, so you must make more batter.',
    ],
    te: 'పిండి లేదు: రెండో దోశ వేయలేరు. కొత్త పిండి చేయండి.',
    controls: 'cook',
    allow: A_COOK,
    spotlight: () => stationSp('dosa'),
    ack: true,
    hint: [
      [8, 'Try cooking a Plain Dosa. It is refused, and that is the lesson.', 'Try cooking a Plain Dosa. It is refused, and that is the lesson.'],
      [16, 'Click "Got it" when you have seen the refusal.', 'Tap "Got it" when you have seen the refusal.'],
    ],
    done: (s, e, ctx) => ctx.acked,
  }),
  S({
    id: 'stock-out-prep', say: 'Wapas peeche jao, naya batter pisao!',
    text: [
      `Recover: make dosa batter again. Turn round, press Space at the back counter and choose Dosa batter (${BATTER.prep.ticks} seconds). A good cook starts the batch BEFORE the bar is empty, and watches the red warning at 3 portions. (In the bigger shifts you can also send a runner to the market: instant, but 40% dearer.)`,
      `Recover: make dosa batter again. Turn round, tap the back counter and choose Dosa batter (${BATTER.prep.ticks} seconds). A good cook starts the batch BEFORE the bar is empty, and watches the red warning at 3 portions. (In the bigger shifts you can also send a runner to the market: instant, but 40% dearer.)`,
    ],
    te: 'మళ్లీ పిండి తయారు చేయండి.',
    prepRecipe: 'batter_dosa',
    controls: 'prep',
    allow: A_PREP,
    spotlight: prepSp,
    done: (s) => prepJobs(s, 'batter_dosa').length > 0 || stockN(s, 'batter_dosa') >= 1,
    rescue: keepRoomFor(['batter_dosa']),
    hint: [[10, 'Press Space at the glowing back counter and choose Dosa batter.', 'Tap the glowing back counter and choose Dosa batter.'], PREP_JAM_HINT],
  }),
  S({
    id: 'stock-out-collect', say: 'Batter ready hote hi utha lo!',
    text: both((touch) => (s) => {
      const j = prepJobs(s, 'batter_dosa')[0];
      if (!j) return 'The batter is on the shelf again.';
      return j.st === 'ready' ? `Ready! ${pressAt(touch)} the back counter to collect the batter, then the customer can have the second dosa.` : `The grinder is turning: ${Math.max(0, j.readyAt - s.tick)} seconds to go. The customer waits (Chotu keeps the patience clock still while you learn).`;
    }),
    te: 'కొత్త పిండి షెల్ఫ్‌లోకి తీసుకోండి.',
    controls: 'prep',
    allow: A_PICKUP,
    spotlight: prepSp,
    done: (s) => prepJobs(s, 'batter_dosa').length === 0 && stockN(s, 'batter_dosa') >= 1,
    // the batch is neither under way nor on the shelf (it was thrown away behind the lesson's back): the shelf gets it back
    rescue: (s) => (prepJobs(s, 'batter_dosa').length === 0 && stockN(s, 'batter_dosa') < 1 ? [train({ stage: { stock: { batter_dosa: 10 }, fresh: { batter_dosa: 100 } } })] : null),
    hint: [[14, 'Press Space at the back counter when the batter is ready.', 'Tap the back counter when the batter is ready.']],
  }),
  S({
    id: 'stock-out-finish', say: 'Ab dusra dosa banao aur do!',
    text: both((touch) => (s, ctx) => `Back in business. Cook the second Plain Dosa, pick it up and serve ${tokenOf(ctx.cust('S'))}. ${touch ? 'Tap the tawa, the dish and the customer.' : 'Press Space at the tawa, at the dish and at the customer.'}`),
    te: 'రెండో దోశ వేసి వడ్డించండి.',
    controls: 'cook',
    allow: A_CARRY.concat(['cook']),
    spotlight: (s, ctx) => {
      const c = ctx.cust('S');
      if (!live(c) || c.st !== 'waiting') return null;
      if (heldCount(ctx.me, 'dosa') > 0) return custSp(c);
      const r = readySlot(s, 'dosa');
      return r ? sp('slot', r.station, r.slot) : stationSp('dosa');
    },
    done: (s, e, ctx) => pairPast(ctx, 'S'),
    recover: (s, ctx) => {
      const c = ctx.cust('S');
      if (tagLost(ctx, 'S')) return 'stock-out-order';
      return live(c) && c.st === 'waiting' && c.got.length === 1 && !haveDish(s, ctx.me, 'dosa') && stockN(s, 'batter_dosa') < 1 ? 'stock-out-prep' : null;
    },
    // the batter is made now; whatever else the second dosa needs is topped up if junk dishes used it
    rescue: keepCookable(['S']),
    hint: [
      [12, 'Cook a Plain Dosa, pick it up, serve it.', 'Tap the tawa, then the dish, then the customer.'],
      BIN_HINT_ENTRY,
      [8, 'Every spot on the tawa is busy. Pick up the ready dishes, or clear the smoking ones, to make room.', undefined, (s) => stationFull(s, KIND_STATION.tawa)],
    ],
  }),
];

// ---------------------------------------------------------------------------------------------------------------------
// Chapter: Keep the tawa happy

const TAWA_FOUL = Object.freeze({ heat: 26, gunk: 72 }); // cold and caked
const PANS = Object.freeze({ tawa: TAWA_FOUL, kadai: { heat: 52, gunk: 30 }, steamer: { water: 55, gunk: 0 } });
const flawOf = (sl) => (!sl || !sl.fl ? null : sl.fl & 2 ? 'torn' : sl.fl & 1 ? 'stuck' : sl.fl & 4 ? 'sour' : null);
const tendAtOf = (s, id) => (s.stations[id] && typeof s.stations[id].tendAt === 'number' ? s.stations[id].tendAt : 0);
const tended = (s, id) => tendAtOf(s, id) > 0;

const HEAT_STEPS = [
  S({
    id: 'heat-intro', say: 'Tawa ko khush rakho anna, warna dosa phat jayega!',
    text: (s) => {
      const t = s.stations.tawa1;
      const band = t && typeof t.heat === 'number' ? (t.heat < 30 ? 'COLD' : t.heat > 72 ? 'too HOT' : 'ideal') : 'ideal';
      return `A tawa is not just a plate: it has a HEAT (cold, ideal, hot) and GUNK, the old batter that cakes on it with every dosa. Look at this tawa's dials: it is ${band} and caked with gunk. A cold pan cooks at half speed, a dirty pan sticks or tears the dosa. Let us cook one anyway and see.`;
    },
    te: 'పెనం వేడి, మురికి చూడండి. ఈ పెనం చల్లగా, మురికిగా ఉంది.',
    spotlight: () => stationSp('dosa'),
    onEnter: (s, ctx) => [
      ...clearOnce(ctx),
      restock(),
      train({ heat: true, stage: { pans: PANS } }),
      ...spawnTags(ctx, [{ tag: 'H1', kind: 'student', name: 'Kiran', order: ['dosa'] }]),
    ],
    ack: true,
    needsTags: ['H1'],
    hint: [ACK_HINT],
    done: (s, e, ctx) => !!ctx.cust('H1') && ctx.acked,
  }),
  S({
    id: 'heat-cook', say: 'Isi gande tawa pe dosa daalo, dekho kya hota hai!',
    text: [
      'Cook the Plain Dosa on this dirty tawa: walk there with A / D, press Space and choose it. Notice it takes twice as long, because a cold pan runs at half speed.',
      'Cook the Plain Dosa on this dirty tawa: tap the tawa and choose it. Notice it takes twice as long, because a cold pan runs at half speed.',
    ],
    te: 'ఈ మురికి పెనంపై దోశ వేయండి.',
    controls: 'cook',
    allow: A_COOK,
    spotlight: (s) => clearSpot(s, KIND_STATION.tawa) || stationSp('dosa'),
    done: (s, e, ctx) => haveDish(s, ctx.me, 'dosa') || (!!ctx.cust('H1') && ctx.cust('H1').got.length > 0),
    recover: lostDish('H1', 'dosa', 'heat-cook', 'heat-intro'),
    rescue: keepCookable(['H1']),
    hint: [
      [10, 'Walk to the glowing tawa, press Space and choose Plain Dosa.', 'Tap the glowing tawa and choose Plain Dosa.'],
      TAWA_FULL_HINT,
    ],
  }),
  S({
    id: 'heat-take', say: 'Dekho, dosa phat gaya na!',
    text: both((touch) => (s) => {
      const r = slotOfDish(s, 'dosa');
      const sl = r ? slotAt(s, r) : null;
      if (sl && sl.st === 'ready') return `Look: the dosa came off TORN. Gunk of 70 or more tears the batter, and a torn dosa is only worth HALF. ${pressAt(touch)} the dish to pick it up.`;
      if (sl && sl.st === 'cooking') return 'Slow, isn\'t it? The cold pan is cooking at half speed, and the gunk will tear this dosa when it comes off. Wait for it.';
      return 'Pick up the dosa.';
    }),
    te: 'దోశ చిరిగింది: సగం ధరే వస్తుంది.',
    controls: 'take',
    allow: A_TAKE,
    spotlight: (s) => {
      const r = slotOfDish(s, 'dosa');
      return r && r.st !== 'burnt' ? sp('slot', r.station, r.slot) : stationSp('dosa');
    },
    done: (s, e, ctx) => heldCount(ctx.me, 'dosa') > 0 || (!!ctx.cust('H1') && ctx.cust('H1').got.length > 0),
    recover: lostDish('H1', 'dosa', 'heat-cook', 'heat-intro'),
    hint: [[8, 'Press Space at the dosa when it is ready.', 'Tap the dosa when it is ready.'], BIN_HINT_ENTRY],
  }),
  S({
    id: 'heat-serve', say: 'Phate hue dosa ka aadha paisa milega!',
    text: both((touch) => (s, ctx) => {
      const c = ctx.cust('H1');
      const price = DISHES.dosa.price;
      if (c && c.got.length > 0) return `${tokenOf(c)} pays ${rs(c.total)} instead of ${rs(price)}: a torn dish pays half and earns no perfect tip.`;
      return `Serve it to ${tokenOf(c)}. They will still take it, but a torn dosa pays only half of its ${rs(price)} price. ${touch ? 'Tap the customer.' : 'Face them with A / D and press Space.'}`;
    }),
    te: 'చిరిగిన దోశకు సగం డబ్బు మాత్రమే.',
    controls: 'serve',
    allow: A_SERVE,
    spotlight: (s, ctx) => custSp(ctx.cust('H1')),
    done: (s, e, ctx) => pairPast(ctx, 'H1'),
    recover: lostDish('H1', 'dosa', 'heat-cook', 'heat-intro'),
    hint: [[8, 'Face the glowing customer with A / D and press Space.', 'Tap the glowing customer.']],
  }),
  S({
    id: 'heat-tend', say: 'Ab tawa saaf karo: pyaaz tel mein dubo ke ragdo!',
    text: [
      'Now TEND the tawa, the way every Hyderabad dosa-wala does: rub it with half an onion dipped in oil, then sprinkle a little water so it hisses. Press Space at the glowing tawa. That sets the heat right and clears the gunk.',
      'Now TEND the tawa, the way every Hyderabad dosa-wala does: rub it with half an onion dipped in oil, then sprinkle a little water so it hisses. Tap the glowing tawa. That sets the heat right and clears the gunk.',
    ],
    te: 'ఉల్లిపాయ, నూనెతో పెనం తుడవండి, నీళ్లు చల్లండి.',
    controls: 'tend',
    allow: A_TEND,
    spotlight: () => stationSp('dosa'),
    done: (s) => tended(s, 'tawa1'),
    hint: [[8, 'Press Space at the glowing tawa to wipe it.', 'Tap the glowing tawa to wipe it.']],
  }),
  S({
    id: 'heat-others', say: 'Kadai aur idli ka paani bhi dekho!',
    text: both((touch) => (s) => {
      const todo = [];
      if (!tended(s, 'kadai1')) todo.push('skim the scum off the KADAI oil');
      if (!tended(s, 'steamer1')) todo.push('top up the water in the IDLY STEAMER');
      return `The other pans need care too: ${todo.join(' and ') || 'both are done'}. The steamer boils its water away while it cooks, and below 30 it runs slow and sticks. ${pressAt(touch)} each glowing pan.`;
    }),
    te: 'కడాయి నురగ తీయండి, ఇడ్లీ పాత్రలో నీళ్లు నింపండి.',
    controls: 'tend',
    allow: A_TEND,
    spotlight: (s) => (!tended(s, 'kadai1') ? sp('station', 'kadai1') : sp('station', 'steamer1')),
    done: (s) => tended(s, 'kadai1') && tended(s, 'steamer1'),
    hint: [
      [8, 'Press Space at the kadai and at the steamer.', 'Tap the kadai and the steamer.'],
      [24, 'Both pans glow when they need care.'],
    ],
  }),
  S({
    id: 'heat-cook2', say: 'Saaf tawa pe dosa daalo, farak dekho!',
    text: (s, ctx) => `Now the same dosa on a clean, hot tawa for ${tokenOf(ctx.cust('H2'))}. Cook it and watch the difference: it is quicker and comes off whole.`,
    te: 'శుభ్రమైన పెనంపై మళ్లీ దోశ వేయండి.',
    controls: 'cook',
    allow: A_COOK,
    spotlight: () => stationSp('dosa'),
    onEnter: (s, ctx) => spawnTags(ctx, [{ tag: 'H2', kind: 'uncle', name: 'Srinivas garu', order: ['dosa'] }]),
    needsTags: ['H2'],
    done: (s, e, ctx) => haveDish(s, ctx.me, 'dosa') || (!!ctx.cust('H2') && ctx.cust('H2').got.length > 0),
    rescue: keepCookable(['H2']),
    hint: [[10, 'Walk to the tawa, press Space and choose Plain Dosa.', 'Tap the tawa and choose Plain Dosa.'], TAWA_FULL_HINT],
  }),
  S({
    id: 'heat-serve2', say: 'Poora paisa aur tip, dekha anna!',
    text: both((touch) => (s, ctx) => `A whole dosa, a full ${rs(DISHES.dosa.price)} bill and a perfect-pickup tip if you are quick. ${pressAt(touch)} the dish, then the customer.`),
    te: 'పూర్తి దోశ: పూర్తి ధర, టిప్.',
    controls: 'take',
    allow: A_CARRY,
    spotlight: serveSpot(['H2']),
    done: (s, e, ctx) => pairPast(ctx, 'H2'),
    recover: lostDish('H2', 'dosa', 'heat-cook2'),
    hint: [[10, 'Press Space at the glowing dosa, then at the customer.', 'Tap the glowing dosa, then the customer.'], BIN_HINT_ENTRY],
  }),
  infoStep(
    'heat-rules', 'Tawa ke teen niyam: garam, saaf, samay pe!',
    'Pan rules: gunk of 40 or more makes dishes STICK (only OK quality, smaller tips), 70 or more TEARS them (half price, no perfect tip). A cold pan (under 30) cooks at half speed, a too-hot pan (over 72) burns food faster. Every dish chills the pan and adds gunk, so tend when the dial turns amber, not when the dosa tears. Wiping an already clean pan is refused: "Already clean".',
    'గంక్ 40 దాటితే అంటుకుంటుంది, 70 దాటితే చిరిగిపోతుంది. సమయానికి తుడవండి.',
  ),
];

// ---------------------------------------------------------------------------------------------------------------------
// Chapter: Gas

const gasPct = (s) => (s.gas ? Math.round((s.gas.u / GAS.cap) * 100) : 100);

const GAS_STEPS = [
  S({
    id: 'gas-intro', say: 'Silinder dekho anna, gas khatam toh sab band!',
    text: (s) => `Every burner drinks LPG from the cylinder at the left end of the counter (it is ${gasPct(s)}% full). Each station with a dish cooking uses gas, and the sambar pot too. When the gauge falls to 20% the flame turns red: that is the low-gas warning. At zero EVERY burner goes cold. You change the cylinder in ${GAS.swapTicks} seconds for ${rs(GAS.swapCost)}, but only when it is under 70%: a heavy cylinder is refused.`,
    te: 'ప్రతి పొయ్యి గ్యాస్ తాగుతుంది. 20% కింద ఎరుపు హెచ్చరిక.',
    controls: 'gas',
    spotlight: gasSp,
    onEnter: (s, ctx) => [...clearOnce(ctx), restock(), train({ gas: true, stage: { gas: 800 } })],
    ack: true,
    hint: [ACK_HINT],
    done: (s, e, ctx) => ctx.acked,
  }),
  S({
    id: 'gas-cook', say: 'Dosa daalo, gas jaltee dekho!',
    text: [
      `Time passes at a busy stall. The cylinder is nearly empty now (about ${Math.round((206 / GAS.cap) * 100)}%). Cook a Plain Dosa for the customer and watch the gauge: the red low-gas warning will show up in a few seconds.`,
      `Time passes at a busy stall. The cylinder is nearly empty now (about ${Math.round((206 / GAS.cap) * 100)}%). Tap the tawa and cook a Plain Dosa for the customer, and watch the gauge: the red low-gas warning will show up in a few seconds.`,
    ],
    te: 'సిలిండర్ దాదాపు ఖాళీ. దోశ వేసి గేజ్ చూడండి.',
    controls: 'cook',
    allow: A_COOK,
    spotlight: () => stationSp('dosa'),
    onEnter: (s, ctx) => [train({ stage: { gas: 206 } }), ...spawnTags(ctx, [{ tag: 'G1', kind: 'office', name: 'Imran bhai', order: ['dosa'] }])],
    needsTags: ['G1'],
    done: (s, e, ctx) => haveDish(s, ctx.me, 'dosa') || (!!ctx.cust('G1') && ctx.cust('G1').got.length > 0),
    // junk dishes drain the nearly empty cylinder to nothing before the lesson dosa is on: back to the nearly empty cylinder the lesson is about
    rescue: keepCookable(['G1'], [], 206),
    hint: [[10, 'Walk to the tawa, press Space and choose Plain Dosa.', 'Tap the glowing tawa and choose Plain Dosa.'], TAWA_FULL_HINT],
  }),
  S({
    id: 'gas-low', say: 'Dekho, lal batti jal gayi: gas kam hai!',
    text: (s) => `Watch the gauge while the dosa cooks: it is at ${gasPct(s)}% and dropping. At 20% the flame turns RED with a warning bell: that is your signal to change the cylinder before it runs dry.`,
    te: 'గేజ్ చూడండి: 20% దాటితే ఎరుపు హెచ్చరిక.',
    allow: A_TAKE,
    spotlight: gasSp,
    done: (s) => !!s.gas && s.gas.u <= GAS.cap * GAS.lowFrac,
    recover: lostDish('G1', 'dosa', 'gas-cook'),
    // a cylinder that is already full (changed early) goes back to nearly empty: the warning is the lesson
    rescue: (s) => (s.gas && s.gas.sw === 0 && s.gas.u > GAS.cap * 0.4 ? [train({ stage: { gas: Math.round(GAS.cap * GAS.lowFrac) - 10 } })] : null),
    hint: [[8, 'Wait a few seconds for the red low-gas warning. The dosa is cooking, so the burner drinks gas.']],
  }),
  S({
    id: 'gas-swap', say: 'Silinder badlo, abhi!',
    text: both((touch) => (s) => `LOW GAS! The gauge says ${gasPct(s)}%. Change the cylinder now: ${touch ? 'tap the cylinder stand at the left end of the counter and your cook walks there' : 'walk to the cylinder stand at the left end of the counter with A / D and press Space'}. It costs ${rs(GAS.swapCost)} and takes ${GAS.swapTicks} seconds.`),
    te: 'గ్యాస్ తక్కువ! సిలిండర్ మార్చండి.',
    controls: 'gas',
    allow: ['move', 'swapGas', 'take'],
    spotlight: gasSp,
    done: (s) => !!s.gas && (s.gas.sw > 0 || s.gas.u >= GAS.cap),
    recover: lostDish('G1', 'dosa', 'gas-cook'),
    hint: [
      [8, 'Walk to the cylinder at the far left and press Space.', 'Tap the cylinder stand at the far left.'],
      [24, 'The cylinder stand glows. Change the cylinder before the burners go cold.'],
    ],
  }),
  S({
    id: 'gas-wait', say: 'Chhe second burner band, intezaar karo!',
    text: both((touch) => (s) => `The new cylinder is going in: ${s.gas ? s.gas.sw : 0} seconds. Every burner is OFF meanwhile: nothing cooks, and nothing burns either, because the dishes wait. Cooking is refused until it is done ("The cylinder is being changed").`),
    te: 'సిలిండర్ మారుతోంది: అప్పటిదాకా పొయ్యిలు ఆరిపోయి ఉంటాయి.',
    allow: ['move', 'take'],
    done: (s) => !!s.gas && s.gas.sw === 0 && s.gas.u >= GAS.cap,
    recover: lostDish('G1', 'dosa', 'gas-cook'),
    // no swap under way and the cylinder still not full (it was emptied again behind the lesson's back): the new cylinder goes in
    rescue: (s) => (s.gas && s.gas.sw === 0 && s.gas.u < GAS.cap ? [train({ stage: { gas: GAS.cap } })] : null),
    hint: [[10, 'Wait a few seconds: the burners come back on their own.']],
  }),
  S({
    id: 'gas-serve', say: 'Burner wapas, ab dosa do!',
    text: both((touch) => (s, ctx) => `Full cylinder, burners back. Pick up the dosa and serve it to ${tokenOf(ctx.cust('G1'))}. ${touch ? 'Tap the dish, then the customer.' : 'Press Space at the dish, then at the customer.'}`),
    te: 'పొయ్యి మళ్లీ వెలిగింది: దోశ వడ్డించండి.',
    controls: 'take',
    allow: A_CARRY,
    spotlight: serveSpot(['G1']),
    done: (s, e, ctx) => pairPast(ctx, 'G1'),
    recover: lostDish('G1', 'dosa', 'gas-cook'),
    hint: [[10, 'Press Space at the glowing dosa, then at the customer.', 'Tap the glowing dosa, then the customer.']],
  }),
  S({
    id: 'gas-cost', say: 'Silinder ka kharcha bhi hisaab mein!',
    text: (s) => `That cylinder cost ${rs(GAS.swapCost)}, and it is already in your cost book (cost so far: ${rs(s.cost || 0)}). A cylinder lasts a few busy shifts, so change it early, in a quiet moment, never in the middle of a rush: ${GAS.swapTicks} seconds with cold burners is a long time when five tokens are waiting. The sambar and tea pots at the back counter stop without gas too.`,
    te: 'సిలిండర్ ఖర్చు ఖర్చు పుస్తకంలో ఉంది.',
    spotlight: gasSp,
    ack: true,
    hint: [ACK_HINT],
    done: (s, e, ctx) => ctx.acked,
  }),
];

// ---------------------------------------------------------------------------------------------------------------------
// Chapter: Sold out board

const BOARD_TAGS = ['B1', 'B2'];
const dishList = (c) => (c ? needsOf(c).map((d) => DISHES[d].name).join(' and ') : 'something else');

const BOARD_STEPS = [
  S({
    id: 'board-intro', say: 'Board pe likh do: khatam!',
    text: (s, ctx) => `When something runs out you do not make the customer wait for nothing: you mark it SOLD OUT on the board. ${tokenOf(ctx.cust('B1'))} is waiting for a Plain Dosa. Let us see what the board does.`,
    te: 'అయిపోయినది బోర్డులో సోల్డ్ అవుట్ అని రాయండి.',
    controls: 'board',
    spotlight: boardSp,
    // (a second visit starts the whole lesson again: every dish back on the board, the shelf full, Swathi seated if she walked out)
    onEnter: (s, ctx) => [...clearOnce(ctx), ...boardRestore(s), restock(), ...spawnTags(ctx, [{ tag: 'B1', kind: 'student', name: 'Swathi', order: ['dosa'] }])],
    ack: true,
    needsTags: ['B1'],
    hint: [ACK_HINT],
    done: (s, e, ctx) => !!ctx.cust('B1') && ctx.acked,
  }),
  S({
    id: 'board-off', say: 'Plain dosa khatam, board pe daalo!',
    text: [
      'Mark Plain Dosa as SOLD OUT: press Space at the price board and switch Plain Dosa off.',
      'Mark Plain Dosa as SOLD OUT: tap the price board and switch Plain Dosa off.',
    ],
    te: 'సాదా దోశను సోల్డ్ అవుట్ చేయండి.',
    controls: 'board',
    allow: A_BOARD,
    spotlight: boardSp,
    done: (s) => (s.off || []).includes('dosa'),
    recover: (s, ctx) => (tagLost(ctx, 'B1') ? 'board-intro' : null), // she left politely (nothing she could order): seat her again, board restored
    // only Plain Dosa is the lesson: any other dish marked off by mistake goes back on before the waiting customers look at the board
    rescue: (s) => {
      const acts = boardRestore(s, ['dosa']);
      return acts.length ? acts : null;
    },
    hint: [[8, 'Press Space at the glowing board and switch Plain Dosa off.', 'Tap the glowing board and switch Plain Dosa off.']],
  }),
  S({
    id: 'board-react', say: 'Dekho, customer ne kya kiya!',
    text: (s, ctx) => `${ctx.cust('B1') ? `${ctx.cust('B1').name} was waiting for a Plain Dosa. Seeing the board, they changed their order to ${dishList(ctx.cust('B1'))}.` : 'The waiting customer changed their order.'} A NEW customer, ${ctx.cust('B2') ? ctx.cust('B2').name : 'Gopal garu'}, walked up wanting a Plain Dosa too: the board stopped them, and they picked ${dishList(ctx.cust('B2'))}. Nobody storms off angry and nobody costs you a heart. If nothing else were available they would just go home politely.`,
    te: 'బోర్డు చూసి కస్టమర్లు ఆర్డర్ మార్చుకున్నారు.',
    spotlight: (s, ctx) => custSp(ctx.cust('B1')),
    // (anything else marked off by mistake goes back on first: a customer who finds NOTHING to order leaves, and Gopal would never be seated)
    onEnter: (s, ctx) => [...boardRestore(s, ['dosa']), ...spawnTags(ctx, [{ tag: 'B2', kind: 'uncle', name: 'Gopal garu', order: ['dosa'], fit: true }])],
    ack: true,
    needsTags: ['B2'],
    recover: (s, ctx) => (tagLost(ctx, 'B1') ? 'board-intro' : null),
    hint: [ACK_HINT],
    done: (s, e, ctx) => !!ctx.cust('B1') && !!ctx.cust('B2') && ctx.acked,
  }),
  S({
    id: 'board-cook', say: 'Jo naya order hai, wohi banao!',
    text: (s, ctx) => `Cook what they ordered now: ${tokenOf(ctx.cust('B1'))} wants ${dishList(ctx.cust('B1'))}, ${tokenOf(ctx.cust('B2'))} wants ${dishList(ctx.cust('B2'))}. Read the chits.`,
    te: 'కొత్త ఆర్డర్లు వండండి.',
    controls: 'cook',
    allow: A_COOK,
    spotlight: (s, ctx) => {
      const d = firstUncovered(s, ctx, BOARD_TAGS);
      return (d && clearSpot(s, KIND_STATION[DISHES[d].station])) || coverSpot(BOARD_TAGS)(s, ctx);
    },
    done: (s, e, ctx) => allCovered(s, ctx, BOARD_TAGS),
    recover: (s, ctx) => (BOARD_TAGS.some((t) => tagLost(ctx, t)) ? 'board-intro' : null),
    rescue: keepCookable(BOARD_TAGS),
    hint: [
      [12, 'Walk to the glowing station, press Space and choose the dish on the chit.', 'Tap the glowing station and choose the dish on the chit.'],
      [34, 'Both customers need a dish cooking or in your hands.'],
      [8, 'The station you need is full. Pick up the ready dishes, or clear the smoking ones, to make room.', undefined, (s, ctx) => needStationFull(s, ctx, BOARD_TAGS)],
    ],
  }),
  S({
    id: 'board-serve', say: 'Dono ko sahi dish do!',
    text: [
      'Pick the dishes up and serve each customer the dish on THEIR chit. Press Space at a ready dish, then at the customer.',
      'Pick the dishes up and serve each customer the dish on THEIR chit. Tap a ready dish, then the customer.',
    ],
    te: 'ప్రతి ఒక్కరికి వారి ఆర్డర్ వడ్డించండి.',
    controls: 'serve',
    allow: A_CARRY,
    spotlight: serveSpot(BOARD_TAGS),
    done: (s, e, ctx) => allPast(ctx, BOARD_TAGS),
    recover: (s, ctx) => {
      if (BOARD_TAGS.some((t) => tagLost(ctx, t))) return 'board-intro';
      return BOARD_TAGS.every((t) => ctx.cust(t) || ctx.outcome(t)) && firstUncovered(s, ctx, BOARD_TAGS) ? 'board-cook' : null;
    },
    hint: [[12, 'Press Space at each ready dish, then at its customer.', 'Tap each ready dish, then its customer.'], BIN_HINT_ENTRY],
  }),
  S({
    id: 'board-on', say: 'Batter aa gaya, wapas board pe daalo!',
    text: [
      'The batter is back, so put Plain Dosa back ON the board: press Space at the price board and switch it on again. A good cook marks a dish off when the stock is out and nothing is coming, and puts it back the moment it is.',
      'The batter is back, so put Plain Dosa back ON the board: tap the price board and switch it on again. A good cook marks a dish off when the stock is out and nothing is coming, and puts it back the moment it is.',
    ],
    te: 'పిండి వచ్చింది: దోశను బోర్డులో మళ్లీ ఆన్ చేయండి.',
    controls: 'board',
    allow: A_BOARD,
    spotlight: boardSp,
    done: (s) => !(s.off || []).includes('dosa'),
    // the lesson is Plain Dosa only: anything else marked off is put back so it cannot hide a dish from the later customers
    rescue: (s) => {
      const acts = boardRestore(s, ['dosa']);
      return acts.length ? acts : null;
    },
    hint: [[8, 'Press Space at the glowing board and switch Plain Dosa on.', 'Tap the glowing board and switch Plain Dosa on.']],
  }),
];

// ---------------------------------------------------------------------------------------------------------------------
// Chapter: Special orders (free play at the stations: the lesson is the order, not the walk)

const playStep = (def) => S({ allow: A_PLAY, controls: 'play', ...def });
/** The hints of a free-play order step: the plain one, then the situations that need a different word (hands jammed, a station full). */
const orderHints = (tags) => [
  [16, 'Cook what the chit asks for, carry it, serve it.', 'Tap the stations, the dishes and the customer.'],
  BIN_HINT_ENTRY,
  [8, 'The station you need is full. Pick up the ready dishes, or clear the smoking ones, to make room.', undefined, (s, ctx) => needStationFull(s, ctx, tags)],
];
/** Free-play order steps: the order's customers are seated by the step itself (and again if one walks out), and the stall is kept cookable for them. */
const orderStep = (tags, def) => playStep({ needsTags: tags, rescue: keepCookable(tags), hint: orderHints(tags), ...def });

const SPECIAL_STEPS = [
  orderStep(['P'], {
    id: 'parcel', say: 'Parcel order hai: pack karke do, jaldi!',
    text: (s, ctx) => `PARCEL: ${ctx.cust('P') ? ctx.cust('P').name : 'Imran bhai'} wants it takeaway, packed. A parcel costs Rs ${REQUEST.parcelFee} extra per dish for the packing, the customer is in a hurry (patience ${Math.round((1 - REQUEST.parcelPatience) * 100)}% shorter), and instead of eating at the counter they wait while it is packed. Cook and serve the whole order.`,
    te: 'పార్సెల్: ప్యాకింగ్ ఖర్చు ఎక్కువ, తొందర ఎక్కువ.',
    spotlight: (s, ctx) => (allPast(ctx, ['P']) ? null : serveSpot(['P'])(s, ctx)),
    onEnter: (s, ctx) => [...clearOnce(ctx), restock(), ...spawnTags(ctx, [{ tag: 'P', kind: 'office', name: 'Imran bhai', order: ['masala_dosa', 'irani_chai'], parcel: true }])],
    done: (s, e, ctx) => pairPast(ctx, 'P'),
  }),
  orderStep(['X'], {
    id: 'extra', say: 'Thoda extra chutney, bhaiya!',
    text: (s, ctx) => `EXTRA and SPICE: ${ctx.cust('X') ? ctx.cust('X').name : 'Gopal garu'} asks for extra coconut chutney and wants it spicier. The extra comes out of your chutney stock (half a portion), and when the dish is served well he tips ${rs(REQUEST.extraTip)} more. A spice request is a small bonus tip when you serve it fresh. Look for the little tags on the chit.`,
    te: 'ఎక్స్‌ట్రా చట్నీ, కారం ఎక్కువ: చిన్న టిప్.',
    spotlight: (s, ctx) => (allPast(ctx, ['X']) ? null : serveSpot(['X'])(s, ctx)),
    onEnter: (s, ctx) => spawnTags(ctx, [{ tag: 'X', kind: 'uncle', name: 'Gopal garu', order: ['dosa'], extra: 'coconut_chutney', spice: 'more' }]),
    done: (s, e, ctx) => pairPast(ctx, 'X'),
  }),
  orderStep(['R'], {
    id: 'regular', say: 'Pehchaano, ye apna regular customer hai!',
    text: (s, ctx) => `A REGULAR: ${ctx.cust('R') ? ctx.cust('R').name : 'Raju'} comes every day. Regulars remember how you treated them: serve them well and they come back LOYAL, and a loyal regular tips more each visit. Serve them badly and the loyalty is gone. Look for the star on the chit. This is the first visit.`,
    te: 'రెగ్యులర్ కస్టమర్: బాగా చూసుకుంటే రోజూ వస్తారు, ఎక్కువ టిప్.',
    spotlight: (s, ctx) => (allPast(ctx, ['R']) ? null : serveSpot(['R'])(s, ctx)),
    onEnter: (s, ctx) => spawnTags(ctx, [{ tag: 'R', kind: 'autowala', name: 'Raju', order: ['vada'], regular: true, loyal: 0 }]),
    done: (s, e, ctx) => ctx.outcome('R') === 'paid',
  }),
  orderStep(['R2'], {
    id: 'regular-back', say: 'Raju wapas aaya, ab loyal hai!',
    text: (s) => `Raju is BACK, and now he is a loyal regular (loyalty ${s.regs && s.regs[0] ? s.regs[0][0] : 1}). His tip is multiplied: every loyalty level adds 30% to what he tips when you serve him well and quickly. Keep him happy visit after visit.`,
    te: 'రాజు మళ్లీ వచ్చాడు: ఇప్పుడు లాయల్, టిప్ ఎక్కువ.',
    spotlight: (s, ctx) => (allPast(ctx, ['R2']) ? null : serveSpot(['R2'])(s, ctx)),
    onEnter: (s, ctx) => spawnTags(ctx, [{ tag: 'R2', kind: 'autowala', name: 'Raju', order: ['vada'], regular: true }]),
    done: (s, e, ctx) => ctx.outcome('R2') === 'paid',
  }),
  orderStep(['Q'], {
    id: 'big', say: 'Office ka bada parcel, chaar dish ek saath!',
    text: (s, ctx) => `The BIG OFFICE PARCEL: ${ctx.cust('Q') ? ctx.cust('Q').name : 'Ravi anna'} is ordering for the whole office. Real ones are 4 to 10 dishes, and this one is 4. The customer is patient (about ${REQUEST.big.patience} times as long) and pays a bonus tip of ${rs(REQUEST.big.bonus)} when it is done. You only have two hands, so plan the trips and start the slow dishes first.`,
    te: 'ఆఫీస్ పెద్ద పార్సెల్: ఓపిక ఎక్కువ, బోనస్ టిప్.',
    spotlight: (s, ctx) => (allPast(ctx, ['Q']) ? null : serveSpot(['Q'])(s, ctx)),
    onEnter: (s, ctx) => spawnTags(ctx, [{ tag: 'Q', kind: 'office', name: 'Ravi anna', order: ['dosa', 'dosa', 'idly', 'irani_chai'], big: true }]),
    done: (s, e, ctx) => pairPast(ctx, 'Q'),
  }),
  orderStep(['D'], {
    id: 'delivery', say: 'Delivery boy aaya, paanch parcel jaldi!',
    text: (s, ctx) => `The TIFFIN DELIVERY BOY: he wants ${REQUEST.delivery.dishes} parcels at once for his customers, he is in a big hurry (in a real shift his patience is ${REQUEST.delivery.patience} seconds), and he tips ${rs(REQUEST.delivery.bonus)} extra if you are in time. Cook the dishes of different stations side by side, and carry two at a time.`,
    te: 'డెలివరీ బాయ్: ఐదు పార్సెల్స్, తొందర, బోనస్.',
    spotlight: (s, ctx) => (allPast(ctx, ['D']) ? null : serveSpot(['D'])(s, ctx)),
    onEnter: (s, ctx) => spawnTags(ctx, [{ tag: 'D', kind: 'autowala', name: 'Delivery boy', order: ['idly', 'osmania', 'irani_chai', 'vada', 'dosa'], delivery: true }]),
    done: (s, e, ctx) => pairPast(ctx, 'D'),
  }),
];

// ---------------------------------------------------------------------------------------------------------------------
// Chapter: Weather and the inspector

const DRILL_DEMO = 'masala_dosa';
const drillFuse = (ctx) => Math.min(60, 20 + 10 * (ctx.attempts.inspect || 0)); // each failed drill gets a longer warning

const WEATHER_STEPS = [
  orderStep(['W1'], {
    id: 'rain', say: 'Baarish aa gayi, chai bajji ka mausam!',
    text: (s, ctx) => `RAIN! The sky just opened over the street. Fewer people walk by (about 60% of the usual crowd) but those who stop want chai, coffee, bajji, bonda and vada, hot. ${ctx.cust('W1') ? ctx.cust('W1').name : 'Naseer miyan'} wants an Irani chai and a mirchi bajji. In the real shifts the weather changes what the crowd orders: read it and cook ahead.`,
    te: 'వర్షం: జనం తగ్గుతారు, కానీ చాయ్, బజ్జీ ఎక్కువ.',
    spotlight: (s, ctx) => (allPast(ctx, ['W1']) ? null : serveSpot(['W1'])(s, ctx)),
    onEnter: (s, ctx) => [
      ...clearOnce(ctx),
      restock(),
      train({ events: true, stage: { event: { id: 'rain', ticks: 60 } } }),
      ...spawnTags(ctx, [{ tag: 'W1', kind: 'student', name: 'Naseer miyan', order: ['irani_chai', 'mirchi_bajji'] }]),
    ],
    done: (s, e, ctx) => pairPast(ctx, 'W1'),
  }),
  infoStep(
    'power-card', 'Current gayi toh chakki aur steamer band!',
    'A POWER CUT is coming. When the current goes the lights, the idly steamer and the wet grinder stop: idly cooking is refused, and any batter you are grinding pauses until the power is back. The gas burners (tawa, kadai, the sambar pot) carry on. Keep working with what still runs.',
    'కరెంట్ కట్: గ్రైండర్, ఇడ్లీ పాత్ర ఆగుతాయి. గ్యాస్ పొయ్యిలు నడుస్తాయి.',
  ),
  S({
    id: 'power-cut', say: 'Light gayi! Chakki ruk gayi!',
    text: [
      'POWER CUT! Start a batch of dosa batter at the back counter anyway: the grinder is silent, so the job will pause until the power comes back. Press Space at the back counter and choose Dosa batter.',
      'POWER CUT! Start a batch of dosa batter at the back counter anyway: the grinder is silent, so the job will pause until the power comes back. Tap the back counter and choose Dosa batter.',
    ],
    te: 'కరెంట్ పోయింది! గ్రైండర్ ఆగింది, పిండి ఆగి ఆగి సాగుతుంది.',
    prepRecipe: 'batter_dosa',
    controls: 'prep',
    allow: A_PREP,
    spotlight: prepSp,
    onEnter: (s, ctx) => [
      train({ stage: { event: { id: 'power', ticks: 18 } } }),
      ...spawnTags(ctx, [{ tag: 'W2', kind: 'office', name: 'Ravi anna', order: ['masala_dosa', 'idly'] }]),
    ],
    needsTags: ['W2'],
    done: (s) => prepJobs(s, 'batter_dosa').length > 0,
    rescue: keepRoomFor(['batter_dosa']),
    hint: [[10, 'Press Space at the back counter and choose Dosa batter.', 'Tap the back counter and choose Dosa batter.'], PREP_JAM_HINT],
  }),
  orderStep(['W2'], {
    id: 'power-serve',
    needsTags: undefined, // Ravi is seated by the power-cut step, so a customer who walked out sends the lesson back there
    recover: (s, ctx) => (tagLost(ctx, 'W2') ? 'power-cut' : null), say: 'Jo chal raha hai woh karo: tawa chalu hai!',
    text: both((touch) => (s, ctx) => {
      const down = (s.events || []).some((e) => e.id === 'power');
      return down
        ? `The power is still OFF: the steamer is dead, so the idly cannot start (the stall refuses it). The tawa runs on gas, so cook the Masala Dosa now and wait for the current for the idly. ${tokenOf(ctx.cust('W2'))} waits.`
        : `The power is back! The steamer works again, the grinder carries on. Finish ${tokenOf(ctx.cust('W2'))}'s order: ${touch ? 'tap the idly steamer' : 'press Space at the steamer'} and cook the idly.`;
    }),
    te: 'కరెంట్ లేకపోయినా తవా నడుస్తుంది. ముందు దోశ.',
    allow: A_PLAY.concat(['collectPrep']),
    spotlight: (s, ctx) => (allPast(ctx, ['W2']) ? null : coverSpot(['W2'])(s, ctx)),
    done: (s, e, ctx) => pairPast(ctx, 'W2'),
  }),
  S({
    id: 'power-batter', say: 'Batter ab bana, utha lo!',
    text: both((touch) => (s) => {
      const j = prepJobs(s, 'batter_dosa')[0];
      if (!j) return 'The batter is on the shelf. A power cut only delays the grinder, it does not ruin the batch.';
      return j.st === 'ready' ? `The grinder finished once the power was back. ${pressAt(touch)} the back counter and collect the batter.` : `The grinder is turning again: ${Math.max(0, j.readyAt - s.tick)} seconds to go.`;
    }),
    te: 'కరెంట్ వచ్చాక పిండి తయారైంది: తీసుకోండి.',
    controls: 'prep',
    allow: A_PICKUP,
    spotlight: prepSp,
    done: (s) => prepJobs(s, 'batter_dosa').length === 0,
    hint: [[12, 'Press Space at the back counter when the batter is ready.', 'Tap the back counter when the batter is ready.']],
  }),
  infoStep(
    'inspect-card', 'GHMC inspector aa raha hai, tawa chamkao!',
    'The GHMC FOOD-SAFETY INSPECTOR does the rounds of every street stall. He gives a short warning, then checks: no burnt food lying on the counter, and the dosa tawa wiped clean in the last 30 seconds. Pass and you get a bonus tip; fail and you pay a fine and, in a real shift, lose a heart. This is a drill: the fine is real money in your books, but no heart is lost.',
    'GHMC ఇన్‌స్పెక్టర్: కాలిన ఆహారం ఉండకూడదు, పెనం శుభ్రంగా ఉండాలి.',
  ),
  S({
    id: 'inspect-drill', say: 'Inspector gate pe hai! Jala hua hatao, tawa saaf karo!',
    text: both((touch) => (s, ctx) => {
      const left = Math.max(0, ((s.events || []).find((e) => e.id === 'inspector') || { until: s.tick }).until - s.tick);
      const retry = ctx.attempts.inspect > 0 ? ' The inspector came back for a second look, with more warning this time.' : '';
      return `The inspector is at the gate: ${left} seconds. Do TWO things: clear any burnt or forgotten dish from the counter (${touch ? 'tap' : 'press Space at'} the smoking dish, or pick up a ready one and bin it), and wipe the dirty tawa clean.${retry}`;
    }),
    te: 'ఇన్‌స్పెక్టర్ వస్తున్నాడు: కాలిన వాటిని తీసేయండి, పెనం తుడవండి.',
    controls: 'tend',
    allow: ['move', 'take', 'tend', 'discard'],
    spotlight: (s) => {
      for (const x of allSlots(s)) if (x.st === 'burnt') return sp('slot', x.station, x.slot); // the inspector minds ANY smoking dish
      for (const x of allSlots(s)) if (x.dish === DRILL_DEMO && x.st !== 'empty') return sp('slot', x.station, x.slot);
      return !tended(s, 'tawa1') || (s.stations.tawa1 && s.tick - tendAtOf(s, 'tawa1') > 25) ? stationSp('dosa') : null;
    },
    flags: FROZEN,
    onEnter: (s, ctx) => {
      const acts = [
        train({ stage: { pans: { tawa: { heat: 52, gunk: 55 } }, event: { id: 'inspector', ticks: drillFuse(ctx) } } }),
      ];
      const station = s.stations.tawa1;
      const slot = station ? station.slots.findIndex((sl) => sl.st === 'empty') : -1;
      if (slot >= 0) acts.push({ type: 'cook', station: 'tawa1', slot, dish: DRILL_DEMO });
      return { actions: acts, set: { kv: { fines0: s.fines || 0, drillAt: s.tick } } };
    },
    done: (s, e, ctx) => inspectorOver(s, ctx) && (s.fines || 0) === (ctx.kv.fines0 || 0),
    failed: (s, ctx) => (inspectorOver(s, ctx) && (s.fines || 0) > (ctx.kv.fines0 || 0) ? { to: 'inspect-drill', attempt: 'inspect' } : null),
    hint: [
      [8, 'Wipe the tawa (press Space at it) and bin or clear the dish on the counter.', 'Wipe the tawa (tap it) and bin or clear the dish on the counter.'],
      [20, 'Pick up the ready dish and throw it in the bin, then tend the tawa before the inspector checks.'],
      BIN_HINT_ENTRY,
    ],
  }),
  S({
    id: 'inspect-clean', say: 'Counter se bacha hua saaf kar do!',
    text: both((touch) => () => `Passed, with a bonus tip! One last tidy: the drill dish is still lying about. ${touch ? 'Tap' : 'Press Space at'} the smoking or ready dish and clear it. A tidy counter is half of the food-safety rules.`),
    te: 'మిగిలిన వంటకాన్ని తీసేయండి.',
    controls: 'take',
    allow: A_TAKE,
    when: (s) => allSlots(s).some((x) => x.dish === DRILL_DEMO && x.st !== 'empty'),
    spotlight: (s) => {
      const r = allSlots(s).find((x) => x.dish === DRILL_DEMO && x.st !== 'empty');
      return r ? sp('slot', r.station, r.slot) : null;
    },
    done: (s, e, ctx) => !allSlots(s).some((x) => x.dish === DRILL_DEMO && x.st !== 'empty') || heldCount(ctx.me, DRILL_DEMO) > 0,
    hint: [[10, 'Press Space at the dish to clear it.', 'Tap the dish to clear it.']],
  }),
];

// the inspector has had its say: his event ran out (and the drill began a moment ago)
function inspectorOver(s, ctx) {
  return ctx.stepTicks >= 2 && !(s.events || []).some((e) => e.id === 'inspector');
}

// ---------------------------------------------------------------------------------------------------------------------
// Chapter: Money: profit

const PROFIT_DEMO = 'osmania';

const PROFIT_STEPS = [
  S({
    id: 'profit-books', say: 'Paisa kahan se aata hai, aur kahan jaata hai!',
    text: (s) => `Your BOOKS so far. REVENUE is the bills you collected: ${rs(s.revenue || 0)}. TIPS are the extras, combo bonuses and the inspector's reward: ${rs(s.tips || 0)}. Together that is the cash in hand at the top of the screen: ${rs(s.money || 0)}. But there is a COST side too, ${rs(s.cost || 0)} so far: every dish eats ingredients (a Masala Dosa sells for ${rs(DISHES.masala_dosa.price)} and its ingredients cost about ${rs(Object.entries(DISHES.masala_dosa.uses).reduce((n, [i, q]) => n + q * INGREDIENTS[i].cost, 0))}), the batches you prepared were paid up front, the gas cylinder was ${rs(GAS.swapCost)}, and food-safety fines (${rs(s.fines || 0)} so far) count as cost too.`,
    te: 'ఆదాయం: బిల్లులు, టిప్స్. ఖర్చు: సరుకు, గ్యాస్, జరిమానా.',
    onEnter: (s, ctx) => clearOnce(ctx),
    ack: true,
    hint: [ACK_HINT],
    done: (s, e, ctx) => ctx.acked,
  }),
  S({
    id: 'profit-bin', say: 'Phenka hua khana bhi kharcha hai!',
    text: both((touch) => (s, ctx) => `WASTE is money you spent on food nobody ate: burnt dishes, dishes you throw away, batter that went bad. Let us see it: Chotu put a biscuit plate on the chai counter. ${pressAt(touch)} it to pick it up, then throw it in the bin at the right end of the counter, and watch the waste number grow (it is ${rs(s.waste || 0)} now).`),
    te: 'వృథా: పారవేసిన ఆహారం కూడా ఖర్చే.',
    controls: 'take',
    allow: A_TAKE,
    spotlight: (s) => {
      const r = allSlots(s).find((x) => x.dish === PROFIT_DEMO && x.st !== 'empty');
      return r ? sp('slot', r.station, r.slot) : { kind: 'bin', look: true };
    },
    onEnter: (s) => {
      const station = s.stations.chai1;
      const slot = station ? station.slots.findIndex((sl) => sl.st === 'empty') : -1;
      return { actions: slot >= 0 ? [{ type: 'cook', station: 'chai1', slot, dish: PROFIT_DEMO }] : [], set: { kv: { waste0: s.waste || 0 } } };
    },
    // the waste must be real AND the dish gone (binned, or burnt and cleared): the player has to act
    done: (s, e, ctx) => (s.waste || 0) > (ctx.kv.waste0 || 0) && !allSlots(s).some((x) => x.dish === PROFIT_DEMO && x.st !== 'empty'),
    hint: [
      [8, 'Pick up the biscuits, then press Space at the bin.', 'Tap the biscuits, then tap the bin.'],
      [24, 'Take the biscuit dish and discard it into the bin.'],
      BIN_HINT_ENTRY,
    ],
    // nothing left to throw away (the biscuit plate could not be put on, or was lost): Chotu puts a fresh one on the chai counter
    rescue: (s, ctx) => {
      if (ctx.me.hands.length || (s.waste || 0) > (ctx.kv.waste0 || 0) || allSlots(s).some((x) => x.dish && x.st !== 'empty')) return null;
      const station = s.stations.chai1;
      const slot = station ? station.slots.findIndex((sl) => sl.st === 'empty') : -1;
      if (slot < 0) return null;
      return [...(refillFor(s, [PROFIT_DEMO]) || []), { type: 'cook', station: 'chai1', slot, dish: PROFIT_DEMO }];
    },
  }),
  S({
    id: 'profit-profit', say: 'Asli kamaai: profit! Sitare profit se milte hain.',
    text: (s) => `PROFIT is what is left: cash in hand ${rs(s.money || 0)} minus cost ${rs(s.cost || 0)} = ${rs((s.money || 0) - (s.cost || 0))}. That is the number the STARS are measured on, not the cash. So wasting food, a skipped tend that tears dosas, an empty-batter walk-out, a fine or a cylinder changed at the wrong moment all take stars away, while tips and a full, happy stall bring them. Half the value of unused paid-for stock comes back at closing time.`,
    te: 'స్టార్లు లాభంపై ఆధారపడతాయి: డబ్బు మైనస్ ఖర్చు.',
    ack: true,
    hint: [ACK_HINT],
    done: (s, e, ctx) => ctx.acked,
  }),
];


const FLOW_STEPS = [
  infoStep('money', 'Paisa ka hisaab, anna!', 'Every token pays the price of its dishes, plus a tip for perfect pickups, quick service and a happy face. Your money for the shift is at the top of the screen. What you keep is the PROFIT, money minus cost, as you saw in the books.', 'ప్రతి టోకెన్ వంటకాల ధర చెల్లిస్తుంది, టిప్ అదనం.'),
  infoStep('hearts', 'Paanch dil hain anna, sambhal ke!', 'You have 5 hearts. A customer who storms off angry, or walks away without paying, costs one heart. At zero the centre closes for the day. This training shift has no hearts, but every real shift does.', 'ఐదు హృదయాలు: కోపంగా వెళ్ళినా, చెల్లించకుండా వెళ్ళినా ఒకటి పోతుంది.'),
  infoStep('stars', 'Har shift mein sitare milte hain!', 'Each shift has PROFIT targets for one, two and three stars: money collected minus what you spent on ingredients, gas and fines. Reach the first target and the next shift unlocks, reach the third and you are a star cook.', 'ప్రతి షిఫ్ట్‌లో ఒకటి, రెండు, మూడు స్టార్ల లక్ష్యాలు.'),
  infoStep('clock', 'Ghadi dekho, din badalta hai!', 'The shift clock runs at the top, and the sky changes with it: morning, afternoon, evening and night. Customers keep coming until the shift ends, so serve everyone before closing.', 'షిఫ్ట్ గడియారం నడుస్తుంది, ఆకాశం మారుతుంది.'),
  infoStep('levels', 'Practice shifts aur menu board!', 'After this training there are 12 practice shifts in the menu, each one unlocking when you clear the one before. The availability board by the counter shows which dishes and stations are open today: a dish that is not on it will not be ordered.', '12 ప్రాక్టీస్ షిఫ్ట్‌లు, ఒక్కొక్కటి తెరుచుకుంటుంది. బోర్డులో ఈరోజు వంటకాలు ఉంటాయి.'),
  infoStep('walkcost', 'Ek baat yaad rakhna: chalna bhi time leta hai!', 'Walking takes time. In a rush a long walk can cost you a customer, so cook the dishes that go together side by side, and pick up before you walk to serve.', 'నడవడానికి కూడా సమయం పడుతుంది.'),
  infoStep('coop', 'Dost ko bulao, saath mein stall chalao!', 'When you finish this training, CO-OP unlocks: invite friends and run one stall together, up to four cooks on the same counter. One cooks, one serves, one collects, and the customers come faster for a bigger crew.', 'శిక్షణ పూర్తయ్యాక స్నేహితులతో కలిసి నడపండి.'),
];

// The final rush: three customers, four stations
const RUSH_ORDERS = [
  { tag: 'R1', kind: 'student', name: 'Swathi', order: ['masala_dosa', 'irani_chai'] },
  { tag: 'R2', kind: 'uncle', name: 'Venkat uncle', order: ['idly', 'vada'] },
  { tag: 'R3', kind: 'office', name: 'Ravi anna', order: ['filter_coffee', 'dosa'] },
];

const RUSH_STEPS = [
  S({
    id: 'rush', say: 'Rush aa gaya! Teen customer ek saath!',
    text: 'RUSH time: three tokens at once, and the order needs the tawa, steamer, kadai and chai counter. Everything you learned is in play: the dosa batter is nearly out (make more at the back counter and collect it), the tawa is caked (tend it before it tears your dosas), and the cylinder, the board and the power are yours to watch. Cook, carry two at a time, serve the right token and collect. The clock and the pay window are real now, but you have enough time.',
    te: 'రష్ టైమ్! పిండి దాదాపు అయిపోయింది, పెనం మురికిగా ఉంది: తయారు చేయండి, తుడవండి.',
    allow: A_ALL,
    autoCollect: false,
    controls: 'cook',
    flags: (ctx) => (ctx.attempts.rush === 0 ? LIVE : FROZEN),
    onEnter: (s, ctx) => {
      const acts = ctx.visits === 1 ? clearHands(ctx) : [];
      // the stall the rush needs prep and tend for: one portion of dosa batter on the shelf, a tawa on the edge of tearing
      acts.push(restock({ batter_dosa: 1 }), train({ stage: { pans: { tawa: { heat: 52, gunk: 68 } } } }));
      for (const r of RUSH_ORDERS) if (!live(ctx.cust(r.tag))) acts.push(spawnAction(r));
      return acts;
    },
    done: (s, e, ctx) => {
      const o = RUSH_ORDERS.map((r) => ctx.outcome(r.tag));
      return o.every(Boolean) && o.some((x) => x === 'paid');
    },
    failed: (s, ctx) => {
      const o = RUSH_ORDERS.map((r) => ctx.outcome(r.tag));
      return o.every(Boolean) && o.every((x) => x !== 'paid') ? { to: 'rush', attempt: 'rush' } : null;
    },
    hint: [
      [20, 'Cook what the order chits ask for. Out of batter? Make more at the back counter. Dirty tawa? Wipe it. Then serve each token and collect the money.'],
      [60, 'Press Space at a station to cook, at ready dishes to pick up, at a customer to serve or collect.', 'Tap a station to cook, ready dishes to pick up, a customer to serve or collect.'],
      BIN_HINT_ENTRY,
      [8, 'The burners are cold: no gas. Walk to the cylinder stand at the left end of the counter and change the cylinder.', 'The burners are cold: no gas. Tap the cylinder stand at the left end of the counter and change the cylinder.', (s) => gasDead(s)],
      [8, 'The idly steamer is dry. Wipe it (top up its water) before cooking an idly.', 'The idly steamer is dry. Tap it to top up its water before cooking an idly.', (s, ctx) => steamerDry(s) && !!firstUncovered(s, ctx, RUSH_ORDERS.map((r) => r.tag))],
    ],
  }),
  S({
    id: 'outro', say: 'Shabash anna! Ab tum pakke tiffin wale ho!',
    text: 'You are ready! Training is done, the practice shifts are open and CO-OP is unlocked: invite your friends and run the centre together.',
    te: 'మీరు సిద్ధం! స్నేహితులతో కలిసి నడపండి.',
    allow: A_ALL,
    flags: LIVE,
    ack: true,
    complete: true, // reaching this step IS finishing the tutorial
    done: (s, e, ctx) => ctx.acked,
    hint: [],
  }),
];

export const TUTORIAL_STEPS = [
  ...chapter('look', LOOK_STEPS),
  ...chapter('tokens', TOKEN_STEPS),
  ...chapter('tawa', TAWA_STEPS),
  ...chapter('idly', IDLY_STEPS),
  ...chapter('kadai', KADAI_STEPS),
  ...chapter('chai', CHAI_STEPS),
  ...chapter('serve', SERVE_STEPS),
  ...chapter('stock', STOCK_STEPS),
  ...chapter('heat', HEAT_STEPS),
  ...chapter('gas', GAS_STEPS),
  ...chapter('board', BOARD_STEPS),
  ...chapter('special', SPECIAL_STEPS),
  ...chapter('weather', WEATHER_STEPS),
  ...chapter('profit', PROFIT_STEPS),
  ...chapter('flow', FLOW_STEPS),
  ...chapter('rush', RUSH_STEPS),
];

export const TUTORIAL_STEP_IDS = Object.freeze(TUTORIAL_STEPS.map((s) => s.id));
/** The dishes that get their own recipe lesson (every dish of the catalogue). */
export const TUTORIAL_RECIPE_DISHES = Object.freeze(TUTORIAL_STEPS.filter((s) => s.recipe).map((s) => s.recipe));
/** The back-counter ingredients that get a prep card (PREP_RECIPES). */
export const TUTORIAL_PREP_RECIPES = Object.freeze([...new Set(TUTORIAL_STEPS.filter((s) => s.prepRecipe).map((s) => s.prepRecipe))]);

// ---------------------------------------------------------------------------------------------------------------------
// the driver

const MAX_CHAIN = 24; // steps that may complete inside one advance (the state can already satisfy several)

const resolve = (v, ...args) => (typeof v === 'function' ? v(...args) : v);
const isTouch = (p) => p === 'touch';

/**
 * `createTutorialDriver()` -> the tutorial's brain. Fully deterministic: same states, events and looks in, same actions out.
 *
 *   driver.steps / index / step / progress {index, total, done, fraction}
 *   driver.chapters [{id, label, te, count, done, active, complete}], driver.chapter {id, label, te, index, step, count, done}
 *   driver.say / te                 Chotu's street line and the Telugu line
 *   driver.text / hint / controls   the current step's variant for the pointer set with setPointer('touch' | 'keyboard')
 *   driver.textFor(p) / hintFor(p) / controlsFor(p)   the same for an explicit pointer
 *   driver.recipe                   { dish, name, nameTe, station, steps, te, hi, tip, uses ... } for the recipe card of this step, or null. A back-counter
 *                                   step (`prepRecipe`) gives { dish: <ingredient id>, prep: true, name, nameTe, goes, goesTe, goesHi, steps, te, hi, tip ... }
 *   driver.allowed                  the game actions the player may do now (array), or null when anything goes (skipped, finished)
 *   driver.allows(type)             may the player do this action now? the HUD refuses the rest with driver.notYet
 *   driver.spotlight                { kind, id?, slot?, look? } for the scene/HUD; `look: true` = turn the head to it (scene.lookAt)
 *   driver.look                     the last look {yaw, pitch} given to advance(), `lookTurned` is how far (yaw) it has turned this step
 *   driver.notice                   'No worries anna, one more try!' after a recoverable failure, or a note about Chotu's help
 *   driver.done                     true once the tutorial is COMPLETED (the outro was reached)
 *   driver.finished                 true once the player pressed "Got it" on the outro
 *   driver.skipped                  true after skip()
 *   driver.advance(state, events, { meId, look }) -> { actions, completed }   `completed` is true exactly once
 *   driver.ack()                    the player pressed "Got it" (only counts on a step with `ack: true`, once its ackAfter has passed)
 *   driver.skip()
 */
export function createTutorialDriver({ steps = TUTORIAL_STEPS } = {}) {
  const idx = (id) => steps.findIndex((s) => s.id === id);
  const mem = {
    index: 0,
    furthest: 0, // the furthest step entered (the progress meter never goes back)
    entered: false,
    enterTick: 0,
    lastTick: 0,
    acked: false,
    pointer: 'keyboard',
    visits: {}, // step id -> times entered
    attempts: { collect: 0, rush: 0, inspect: 0 },
    seen: new Set(), // customer ids already accounted for
    tags: {}, // 'A' -> customer id
    pending: [], // [{ tag, action }] spawns whose customer has not appeared yet, in order
    spawnTick: 0,
    rescueAt: -Infinity, // the tick of the last rescue
    outcomes: {}, // customer id -> 'paid' | 'angry' | 'unpaid'
    auto: new Set(), // customers Chotu already collected from
    demo: null,
    kv: {}, // scratch memory a step's onEnter may set (set: { kv })
    flags: null, // the last flags sent to the engine
    notice: null,
    look: null, // the last { yaw, pitch }
    lookBase: null,
    lookDelta: 0,
    completed: false,
    finished: false,
    skipped: false,
    lastState: null,
  };

  const meOf = (state, hint) => {
    if (!state || !state.players) return null;
    if (hint && state.players[hint]) return state.players[hint];
    return state.order && state.order.length ? state.players[state.order[0]] : null;
  };

  /** Which pending spawn a new customer came from: the same name and order (a sold-out swap may change the order), else the oldest. */
  function pendingFor(c) {
    const same = (p) => p.action.customer.name === c.name;
    const i = mem.pending.findIndex((p) => same(p) && p.action.customer.order.join() === c.order.join());
    if (i >= 0) return i;
    const j = mem.pending.findIndex(same);
    return j >= 0 ? j : 0;
  }

  function observe(state, events) {
    mem.lastState = state;
    mem.lastTick = state.tick;
    for (const c of state.customers) {
      if (!mem.seen.has(c.id)) {
        mem.seen.add(c.id);
        if (mem.pending.length) mem.tags[mem.pending.splice(pendingFor(c), 1)[0].tag] = c.id;
      }
      if (c.outcome && !mem.outcomes[c.id]) mem.outcomes[c.id] = c.outcome;
    }
    for (const e of events || []) {
      if (e.type === 'collect') mem.outcomes[e.customer] = 'paid';
      else if (e.type === 'customer-angry') mem.outcomes[e.customer] = mem.outcomes[e.customer] || 'angry';
      else if (e.type === 'customer-unpaid') mem.outcomes[e.customer] = mem.outcomes[e.customer] || 'unpaid';
    }
  }

  function observeLook(look) {
    if (!look || !Number.isFinite(look.yaw)) return;
    mem.look = { yaw: look.yaw, pitch: Number.isFinite(look.pitch) ? look.pitch : 0 };
    if (mem.lookBase === null) mem.lookBase = look.yaw;
    mem.lookDelta = Math.max(mem.lookDelta, Math.abs(look.yaw - mem.lookBase));
  }

  function makeCtx(state, meHint) {
    const me = meOf(state, meHint);
    const byId = (id) => (id == null ? null : state.customers.find((c) => c.id === id) || null);
    const step = steps[mem.index];
    return {
      meId: me ? me.id : null,
      me,
      tick: state.tick,
      stepTicks: state.tick - mem.enterTick,
      visits: (step && mem.visits[step.id]) || 0,
      acked: mem.acked,
      attempts: mem.attempts,
      demo: mem.demo,
      kv: mem.kv,
      look: mem.look,
      lookDelta: mem.lookDelta,
      cust: (tag) => byId(mem.tags[tag]),
      outcome: (tag) => {
        const id = mem.tags[tag];
        if (id == null) return null;
        const c = byId(id);
        return mem.outcomes[id] || (c && c.outcome) || (c ? null : 'gone');
      },
    };
  }

  /** Enter step `i`: returns the actions its entry needs (flags first, then onEnter). */
  function enter(i, state, meHint) {
    mem.index = i;
    mem.furthest = Math.max(mem.furthest, i);
    const step = steps[i];
    mem.visits[step.id] = (mem.visits[step.id] || 0) + 1;
    mem.enterTick = state.tick;
    mem.acked = false;
    mem.lookBase = mem.look ? mem.look.yaw : null; // the head must turn from where it is now
    mem.lookDelta = 0;
    const ctx = makeCtx(state, meHint);
    const actions = [];
    const flags = resolve(step.flags, ctx) || FROZEN;
    if (!mem.flags || mem.flags.patience !== !!flags.patience || mem.flags.pay !== !!flags.pay) {
      actions.push(flagsAction(flags));
      mem.flags = { patience: !!flags.patience, pay: !!flags.pay };
    }
    let on = resolve(step.onEnter, state, ctx) || [];
    if (!Array.isArray(on)) {
      if (on.set && Object.hasOwn(on.set, 'demo')) mem.demo = on.set.demo;
      if (on.set && on.set.kv) mem.kv = { ...mem.kv, ...on.set.kv };
      on = on.actions || [];
    }
    // tagged spawns: remember which customer each becomes (a retry brings new customers, so old tags must not point at the ones who left)
    const tagged = on.filter((a) => a.type === 'spawn' && a.tag);
    if (tagged.length) {
      const tags = new Set(tagged.map((a) => a.tag));
      mem.pending = mem.pending.filter((p) => !tags.has(p.tag));
      for (const a of tagged) {
        delete mem.tags[a.tag];
        const { tag, ...bare } = a;
        mem.pending.push({ tag, action: bare });
      }
      mem.spawnTick = state.tick;
    }
    for (const a of on) {
      if (a.tag) {
        const { tag, ...bare } = a; // eslint-disable-line no-unused-vars
        actions.push(bare);
      } else actions.push(a);
    }
    return actions;
  }

  function stepFrom(from, state, ctx) {
    for (let i = from; i < steps.length; i++) {
      const st = steps[i];
      if (!st.when || st.when(state, i === mem.index ? ctx : makeCtxFor(i, state))) return i;
    }
    return -1;
  }
  // `when` is asked about steps that are not current yet: give it a ctx whose visits/stepTicks belong to that step
  function makeCtxFor(i, state) {
    const c = makeCtx(state);
    c.visits = mem.visits[steps[i].id] || 0;
    return c;
  }

  const doneIdx = () => (mem.finished ? steps.length : mem.furthest);
  const variant = (step, key, touchKey, pointer) => (isTouch(pointer) ? step[touchKey] : step[key]);
  const textOf = (pointer) => {
    const step = steps[mem.index];
    const t = variant(step, 'text', 'textTouch', pointer);
    if (typeof t !== 'function') return t || '';
    return mem.lastState ? t(mem.lastState, makeCtx(mem.lastState)) : '';
  };
  const hintOf = (pointer) => {
    const step = steps[mem.index];
    const list = variant(step, 'hint', 'hintTouch', pointer);
    if (!list || !list.length || !mem.lastState || mem.completed) return null;
    const t = mem.lastState.tick - mem.enterTick;
    let h = null;
    for (const x of list) if (!x.when && t >= x.after) h = x.text;
    // an entry with a condition that holds right now is the more useful word, whatever the timer says
    let ctx = null;
    for (const x of list) {
      if (!x.when || t < x.after) continue;
      ctx = ctx || makeCtx(mem.lastState);
      if (x.when(mem.lastState, ctx)) h = x.text;
    }
    return h;
  };
  const controlsOf = (pointer) => {
    const c = steps[mem.index].controls;
    if (!c) return '';
    return isTouch(pointer) ? c.touch : c.kb;
  };

  const driver = {
    steps,
    get index() { return mem.index; },
    get step() { return steps[mem.index]; },
    get done() { return mem.completed; },
    get finished() { return mem.finished; },
    get skipped() { return mem.skipped; },
    get notice() { return mem.notice; },
    get flags() { return mem.flags; },
    get attempts() { return { ...mem.attempts }; },
    get visits() { return { ...mem.visits }; },
    get progress() {
      const done = doneIdx();
      return { index: mem.index, total: steps.length, done, fraction: steps.length ? done / steps.length : 0 };
    },
    get chapters() {
      const done = doneIdx();
      const cur = steps[mem.index] && steps[mem.index].chapter;
      return TUTORIAL_CHAPTERS.map((c) => {
        let from = -1;
        let count = 0;
        steps.forEach((st, i) => { if (st.chapter === c.id) { if (from < 0) from = i; count += 1; } });
        const d = from < 0 ? 0 : Math.max(0, Math.min(count, done - from));
        return { id: c.id, label: c.label, te: c.te, count, done: d, active: cur === c.id && !mem.finished, complete: count > 0 && d >= count };
      }).filter((c) => c.count > 0);
    },
    get chapter() {
      const step = steps[mem.index];
      const list = driver.chapters;
      const index = list.findIndex((c) => c.id === (step && step.chapter));
      if (index < 0) return null;
      let from = steps.findIndex((s) => s.chapter === step.chapter);
      return { ...list[index], index, step: mem.index - from, from };
    },
    get say() { return steps[mem.index].say || ''; },
    get te() { return steps[mem.index].te || ''; },
    get pointer() { return mem.pointer; },
    setPointer(p) { mem.pointer = isTouch(p) ? 'touch' : 'keyboard'; },
    get text() { return textOf(mem.pointer); },
    textFor(pointer) { return textOf(pointer); },
    get controls() { return controlsOf(mem.pointer); },
    controlsFor(pointer) { return controlsOf(pointer); },
    get hint() { return hintOf(mem.pointer); },
    hintFor(pointer) { return hintOf(pointer); },
    get recipe() {
      const step = steps[mem.index];
      const id = step.recipe;
      if (id && Object.hasOwn(RECIPES, id)) return { dish: id, name: DISHES[id].name, nameTe: DISHES[id].te, ...RECIPES[id] };
      const item = step.prepRecipe;
      if (item && Object.hasOwn(PREP_RECIPES, item)) return { dish: item, prep: true, name: INGREDIENTS[item].name, nameTe: INGREDIENTS[item].te, ...PREP_RECIPES[item] };
      return null;
    },
    get ackable() {
      const step = steps[mem.index];
      if (!step.ack) return false;
      if (!step.ackAfter) return true;
      return !!mem.lastState && mem.lastState.tick - mem.enterTick >= step.ackAfter;
    },
    get allowed() {
      if (mem.skipped || mem.finished) return null;
      const step = steps[mem.index];
      const a = resolve(step.allow, mem.lastState, mem.lastState ? makeCtx(mem.lastState) : null);
      return a ? a.slice() : null;
    },
    allows(type) {
      const a = driver.allowed;
      return !a || !TUTORIAL_ACTIONS.includes(type) || a.includes(type);
    },
    get notYet() { return TUTORIAL_NOT_YET; },
    get look() { return mem.look; },
    get lookTurned() { return mem.lookDelta; },
    get spotlight() {
      const step = steps[mem.index];
      if (!mem.lastState || mem.skipped) return null;
      return resolve(step.spotlight, mem.lastState, makeCtx(mem.lastState)) || null;
    },
    /** The player pressed "Got it". Ignored unless the current step waits for it. */
    ack() {
      if (mem.skipped || !driver.ackable) return false;
      mem.acked = true;
      if (steps[mem.index].complete) mem.finished = true;
      return true;
    },
    skip() {
      mem.skipped = true;
      return true;
    },
    advance(state, events = [], opts = {}) {
      const out = { actions: [], completed: false };
      if (mem.skipped || mem.finished || !state || !state.players || !Array.isArray(state.customers)) return out;
      observe(state, events);
      observeLook(opts.look);
      if (!mem.entered) {
        mem.entered = true;
        out.actions.push(...enter(0, state, opts.meId));
        return out;
      }
      // a spawn that never produced a customer (no free spot yet) is sent again
      if (mem.pending.length && state.tick - mem.spawnTick >= SPAWN_RETRY) {
        for (const p of mem.pending) out.actions.push(p.action);
        mem.spawnTick = state.tick;
      }
      for (let guard = 0; guard < MAX_CHAIN; guard++) {
        const step = steps[mem.index];
        const ctx = makeCtx(state, opts.meId);

        const fail = step.failed && step.failed(state, ctx);
        if (fail) {
          if (fail.attempt) mem.attempts[fail.attempt] = (mem.attempts[fail.attempt] || 0) + 1;
          mem.notice = 'No worries anna, one more try!';
          const acts = enter(idx(fail.to), state, opts.meId);
          out.actions.push(...acts);
          if (acts.length) break;
          continue;
        }
        const back = step.recover && step.recover(state, ctx);
        if (back && idx(back) >= 0 && idx(back) < mem.index) {
          mem.notice = 'That one is gone. Let us make it again!';
          const acts = enter(idx(back), state, opts.meId);
          out.actions.push(...acts);
          if (acts.length) break;
          continue;
        }

        // a customer this step seated is gone without having paid: enter the step again (it seats whoever is missing, clocks still frozen)
        if (step.needsTags && step.needsTags.some((tag) => { const o = ctx.outcome(tag); return !!o && o !== 'paid'; })) {
          mem.notice = 'That one is gone. Let us make it again!';
          const acts = enter(mem.index, state, opts.meId);
          out.actions.push(...acts);
          if (acts.length) break;
          continue;
        }

        if (!step.done(state, events, ctx)) {
          // the stall ran out of something the lesson needs: Chotu re-stages it (never more often than every RESCUE_EVERY ticks)
          if (state.tick - mem.rescueAt >= RESCUE_EVERY) {
            const acts = (step.rescue && step.rescue(state, ctx)) || stallRescue(state, step);
            if (acts && acts.length) {
              mem.rescueAt = state.tick;
              mem.notice = step.rescueNote || TUTORIAL_RESCUE_NOTE;
              out.actions.push(...acts);
            }
          }
          break;
        }
        mem.notice = null;
        if (mem.index >= steps.length - 1) {
          mem.finished = true;
          break;
        }
        const next = stepFrom(mem.index + 1, state, ctx);
        if (next < 0) {
          mem.finished = true;
          break;
        }
        const acts = enter(next, state, opts.meId);
        if (steps[next].complete && !mem.completed) {
          mem.completed = true;
          out.completed = true;
        }
        out.actions.push(...acts);
        if (acts.length) break; // the state is stale until they are applied: the caller advances again
        events = [];
      }
      // Chotu takes the money in lessons whose point is not collecting (the collect lesson makes the player do it)
      const cur = steps[mem.index];
      if (cur && cur.autoCollect && !mem.finished) {
        let helped = false;
        for (const c of state.customers) {
          if (c.st !== 'paying' || mem.auto.has(c.id)) continue;
          mem.auto.add(c.id);
          out.actions.push({ type: 'collect', customer: c.id });
          helped = true;
        }
        if (helped) mem.notice = 'Chotu took the money for you this once. You will do it yourself soon!';
      }
      return out;
    },
  };
  return driver;
}

/** Station ids the tutorial uses, for tests and the HUD. */
export const TUTORIAL_STATIONS = Object.freeze(Object.keys(STATIONS).filter((id) => levelDef(TUTORIAL_LEVEL).stations.includes(id)));
export const TUTORIAL_DISHES = Object.freeze(levelDef(TUTORIAL_LEVEL).menu.filter((d) => DISHES[d]));
