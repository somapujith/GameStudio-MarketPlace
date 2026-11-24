// Tiffin Centre: the scripted tutorial (level 0). Pure data + a deterministic driver, no DOM, no clock, no randomness.
//
// The driver never touches the engine itself. A session calls `driver.advance(state, events)` after every engine change
// (tick or action) and applies the `actions` it returns (spawn a customer, cook a demo dish, tutorial-flags ...) through
// `applyAction`, with the acting `playerId` added. Everything the driver decides comes from the engine state and events, so
// a bot scripted against the real engine drives it the same way a person does (and the tests do exactly that).
//
// Voice: the host is Chotu, the stall helper. Every step has a short Hyderabadi street line (`say`, Hindi/Telugu words in
// Latin letters) and the plain English (`text`) right after it, plus the Telugu line (`te`) for the coach mark.
//
// Step done conditions only use state/events (never "the walk finished"): the HUD walks the avatar to the target and sends
// the real action on arrival, so a step simply waits until the action has landed.
//
// Step shape (all optional unless noted):
//   id (req), speaker, say, text (string | (state, ctx) => string), te,
//   spotlight: { kind, id?, slot? } | null | (state, ctx) => same     -> what the HUD/scene should pulse
//   flags: { patience, pay } | (ctx) => same   -> the tutorial clocks while this step runs (true = the clock RUNS)
//   spawns: ['A', ...]  tags given to the customers the step's onEnter spawns, in order
//   onEnter: action[] | (state, ctx) => action[] | { actions, set }   -> applied once when the step starts
//   ack: true   the step waits for the player to press "Got it" (driver.ack())
//   when(state, ctx) -> false skips the step; done(state, events, ctx) -> boolean
//   failed(state, ctx) -> { to, attempt? } | null   a recoverable failure: go back to step `to` (and count an attempt)
//   recover(state, ctx) -> stepId | null            the situation became unwinnable: go back to that step
//   hint: [{ after, text }]  shown once the step has run `after` ticks without finishing (so nobody is stuck for ever)
import { CUSTOMER_KINDS, DISHES, PACE, PATIENCE_BASE, STATIONS, levelDef } from './catalog.js';

export const TUTORIAL_LEVEL = 0;
export const TUTORIAL_SETTINGS = Object.freeze({ level: 0, pace: 'normal' });
export const TUTORIAL_HOST = 'Chotu';
export const RUSH_RETRIES = 1; // after a failed live rush the clocks freeze, so it cannot fail again

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

/** A spawn action. `patienceMax` is computed like the schedule does (level 0, normal pace) so it matches a real customer. */
export function spawnAction({ kind = 'student', name, order, look }) {
  const k = CUSTOMER_KINDS[kind];
  const lv = levelDef(TUTORIAL_LEVEL);
  const patienceMax = Math.max(1, Math.round(PATIENCE_BASE * k.patience * lv.patience * PACE.normal.patience));
  return { type: 'spawn', customer: { kind, name, look: look || k.look, order: order.slice(), patienceMax } };
}

/** The tutorial-flags action for `{patience, pay}` (true = that clock runs). */
export const flagsAction = (f) => ({ type: 'tutorial-flags', patience: !!f.patience, pay: !!f.pay });

const FROZEN = Object.freeze({ patience: false, pay: false });
const LIVE = Object.freeze({ patience: true, pay: true });

const live = (c) => !!c && c.st !== 'left' && c.outcome === null;

// ---------------------------------------------------------------------------------------------------------------------
// the steps

const A_ORDER = ['dosa'];
const B_ORDER = ['irani_chai', 'dosa'];

export const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    speaker: TUTORIAL_HOST,
    say: 'Namaste anna! Main Chotu, tumhara stall helper.',
    text: 'Welcome to your own tiffin centre. I am Chotu, your helper. Let me show you the ropes.',
    te: 'నమస్తే! మీ టిఫిన్ సెంటర్‌కు స్వాగతం.',
    spotlight: null,
    flags: FROZEN,
    ack: true,
    done: (s, e, ctx) => ctx.acked,
    hint: [{ after: 12, text: 'Press "Got it" to carry on.' }],
  },
  {
    id: 'tour',
    speaker: TUTORIAL_HOST,
    say: 'Dekho anna, ye apna stall hai.',
    text: 'This is your stall. The tawa makes dosas, the chai counter pours irani chai, and customers stand at the counter. You can carry two dishes at once.',
    te: 'ఇది మీ స్టాల్. దోశ పెనం, చాయ్ కౌంటర్ ఇక్కడే.',
    spotlight: { kind: 'station', id: 'tawa1' },
    flags: FROZEN,
    ack: true,
    done: (s, e, ctx) => ctx.acked,
    hint: [{ after: 14, text: 'Press "Got it" when you have looked around.' }],
  },
  {
    id: 'walk',
    speaker: TUTORIAL_HOST,
    say: 'Pehle tawa pe chalo!',
    text: 'First, go to the tawa. Tap it and your cook walks there. On a keyboard, walk with A / D or the arrow keys, then press Space to work.',
    te: 'పెనం దగ్గరకు వెళ్ళండి. నొక్కితే మీ కుక్ నడిచి వెళ్తాడు.',
    spotlight: { kind: 'station', id: 'tawa1' },
    flags: FROZEN,
    done: (s, e, ctx) => !!ctx.me && ctx.me.at === 'tawa1',
    hint: [
      { after: 8, text: 'Tap the glowing tawa, or press A / the left arrow until you are at it.' },
      { after: 24, text: 'The tawa is on the left. Keep walking left with A or the left arrow.' },
    ],
  },
  {
    id: 'customer',
    speaker: TUTORIAL_HOST,
    say: 'Anna, customer aa gaya!',
    text: 'Your first customer is here. The bubble over their head says what they want: one Plain Dosa. Look at it, then press "Got it".',
    te: 'మొదటి కస్టమర్ వచ్చారు! ఆర్డర్ చూడండి.',
    spawns: ['A'],
    flags: FROZEN,
    spotlight: (s, ctx) => (ctx.cust('A') ? { kind: 'customer', id: ctx.cust('A').id } : null),
    onEnter: (s, ctx) => (live(ctx.cust('A')) ? [] : [spawnAction({ kind: 'student', name: 'Kiran', order: A_ORDER })]),
    ack: true,
    done: (s, e, ctx) => !!ctx.cust('A') && (ctx.acked || ctx.visits > 1),
    hint: [{ after: 10, text: 'Tap the customer to read the order, then press "Got it".' }],
  },
  {
    id: 'cook',
    speaker: TUTORIAL_HOST,
    say: 'Chalo, dosa daalo tawa pe!',
    text: 'Tap the tawa and choose Plain Dosa (దోశ). Your cook walks over and starts the dosa.',
    te: 'పెనం మీద నొక్కి, దోశ ఎంచుకోండి.',
    spotlight: { kind: 'station', id: 'tawa1' },
    flags: FROZEN,
    done: (s, e, ctx) => haveDish(s, ctx.me, 'dosa') || (!!ctx.cust('A') && ctx.cust('A').got.includes('dosa')),
    hint: [
      { after: 10, text: 'Tap the glowing tawa, then pick Plain Dosa from the menu.' },
      { after: 30, text: 'Pick an empty spot on the tawa, then choose Plain Dosa.' },
    ],
  },
  {
    id: 'watch',
    speaker: TUTORIAL_HOST,
    say: 'Dekho, dosa pak raha hai!',
    text: 'See the bar fill? When it is ready you hear a ping and the dosa glows. Wait for it. (I also put a masala dosa on the tawa. Leave that one alone for now.)',
    te: 'దోశ వేగుతోంది. సిద్ధమయ్యే వరకు చూడండి.',
    flags: FROZEN,
    spotlight: (s) => {
      const r = allSlots(s).find((x) => x.dish === 'dosa' && SLOT_BUSY.has(x.st));
      return r ? { kind: 'slot', id: r.station, slot: r.slot } : { kind: 'station', id: 'tawa1' };
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
    recover: (s, ctx) => lostFirstDosa(s, ctx),
    hint: [{ after: 12, text: 'Just wait: the dosa needs a few seconds. Watch its bar.' }],
  },
  {
    id: 'take',
    speaker: TUTORIAL_HOST,
    say: 'Ready hai! Jaldi uthao, nahi toh jal jayega!',
    text: 'The dosa is ready. Tap it to pick it up right now: the fresher it is, the bigger the tip. Left too long, it burns.',
    te: 'సిద్ధం! వెంటనే తీసుకోండి.',
    flags: FROZEN,
    spotlight: (s) => {
      const r = readySlot(s, 'dosa');
      return r ? { kind: 'slot', id: r.station, slot: r.slot } : { kind: 'hands' };
    },
    done: (s, e, ctx) => heldCount(ctx.me, 'dosa') > 0 || (!!ctx.cust('A') && ctx.cust('A').got.includes('dosa')),
    recover: (s, ctx) => lostFirstDosa(s, ctx),
    hint: [
      { after: 6, text: 'Tap the glowing dosa on the tawa to pick it up.' },
      { after: 20, text: 'If a dosa burns, tap it to clear the tawa and cook a fresh one.' },
    ],
  },
  {
    id: 'serve',
    speaker: TUTORIAL_HOST,
    say: 'Ab customer ko do anna!',
    text: 'Now tap the customer to serve the dosa from your hand.',
    te: 'కస్టమర్‌కు వడ్డించండి.',
    flags: FROZEN,
    spotlight: (s, ctx) => (ctx.cust('A') ? { kind: 'customer', id: ctx.cust('A').id } : null),
    done: (s, e, ctx) => !!ctx.cust('A') && (ctx.cust('A').got.includes('dosa') || ctx.cust('A').st !== 'waiting'),
    recover: (s, ctx) => lostFirstDosa(s, ctx),
    hint: [{ after: 8, text: 'Tap the glowing customer. Your dosa goes to them.' }],
  },
  {
    id: 'collect',
    speaker: TUTORIAL_HOST,
    say: 'Paisa nikalo, jaldi! Late hua toh bhaag jayega!',
    text: 'He eats, then holds money out. Tap him to COLLECT it fast. If you are late, a customer walks away WITHOUT paying!',
    te: 'డబ్బు తీసుకోండి, త్వరగా! ఆలస్యమైతే చెల్లించకుండా వెళ్ళిపోతారు.',
    spotlight: (s, ctx) => (ctx.cust('A') ? { kind: 'customer', id: ctx.cust('A').id } : null),
    // the pay window is real the first time (that is the lesson); after a miss it is frozen so the lesson cannot be failed twice
    flags: (ctx) => ({ patience: false, pay: ctx.attempts.collect === 0 }),
    done: (s, e, ctx) => ctx.outcome('A') === 'paid',
    failed: (s, ctx) => (ctx.outcome('A') === 'unpaid' || ctx.outcome('A') === 'angry' ? { to: 'customer', attempt: 'collect' } : null),
    hint: [
      { after: 14, text: 'Tap the customer holding the money note.' },
      { after: 30, text: 'Wait for the money note to appear, then tap the customer.' },
    ],
  },
  {
    id: 'burn',
    speaker: TUTORIAL_HOST,
    say: 'Arre, wo masala dosa dekho!',
    text: (s, ctx) => {
      const sl = slotAt(s, ctx.demo);
      if (sl && sl.st === 'burnt') return 'Burnt! Smoke means the dish is ruined. Tap it to clear the tawa. Pick dishes up in time.';
      if (sl && sl.st === 'ready') return 'That masala dosa is ready but nobody picked it up. Wait a little and watch what happens.';
      return 'That masala dosa is still cooking. Dishes you forget on the tawa burn. Watch it.';
    },
    te: 'మాడిపోయింది! కాలిన దోశను తీసేయండి.',
    flags: FROZEN,
    when: (s, ctx) => {
      const sl = slotAt(s, ctx.demo);
      return !!sl && sl.st !== 'empty';
    },
    spotlight: (s, ctx) => (ctx.demo ? { kind: 'slot', id: ctx.demo.station, slot: ctx.demo.slot } : null),
    done: (s, e, ctx) => {
      const sl = slotAt(s, ctx.demo);
      return !sl || sl.st === 'empty';
    },
    hint: [
      { after: 6, text: 'Waiting for the dosa to burn. It takes a few more seconds.' },
      { after: 20, text: 'Tap the smoking dish to clear it (or the ready one to pick it up).' },
    ],
  },
  {
    id: 'chai',
    speaker: TUTORIAL_HOST,
    say: 'Agla customer: chai aur dosa!',
    text: 'Next one wants a dosa AND an irani chai (ఇరానీ చాయ్). Start both: the chai counter pours the chai, the tawa makes the dosa.',
    te: 'ఇరానీ చాయ్ మరియు దోశ రెండూ మొదలుపెట్టండి.',
    spawns: ['B'],
    flags: FROZEN,
    spotlight: (s, ctx) => {
      const b = ctx.cust('B');
      const needChai = !b || needsOf(b).includes('irani_chai');
      if (needChai && !haveDish(s, ctx.me, 'irani_chai')) return { kind: 'station', id: 'chai1' };
      return { kind: 'station', id: 'tawa1' };
    },
    onEnter: (s, ctx) => {
      const actions = [];
      // anything left in the hands (a picked-up demo dish) would block the lesson on carrying two dishes
      if (ctx.me && ctx.visits === 1) for (let i = ctx.me.hands.length - 1; i >= 0; i--) actions.push({ type: 'discard', hand: i });
      if (!live(ctx.cust('B'))) actions.push(spawnAction({ kind: 'office', name: 'Padma', order: B_ORDER }));
      return actions;
    },
    done: (s, e, ctx) => {
      const b = ctx.cust('B');
      if (!b) return false;
      return needsOf(b).every((d) => haveDish(s, ctx.me, d)) || b.st !== 'waiting';
    },
    hint: [
      { after: 12, text: 'Tap the chai counter and pour Irani Chai, then tap the tawa and cook a Plain Dosa.' },
      { after: 34, text: 'You need both a chai and a dosa cooking. One more to start?' },
    ],
  },
  {
    id: 'carry',
    speaker: TUTORIAL_HOST,
    say: 'Dono haath bhar lo anna!',
    text: 'You have two hands, so you can carry two dishes at once. Pick up the chai and the dosa as they get ready, then serve the customer.',
    te: 'రెండు చేతులతో రెండు వంటకాలు మోయవచ్చు.',
    flags: FROZEN,
    spotlight: (s, ctx) => {
      const b = ctx.cust('B');
      if (b && ctx.me && needsOf(b).every((d) => heldCount(ctx.me, d) > 0)) return { kind: 'customer', id: b.id };
      return { kind: 'hands' };
    },
    done: (s, e, ctx) => !!ctx.cust('B') && ctx.cust('B').st !== 'waiting',
    recover: (s, ctx) => {
      const b = ctx.cust('B');
      if (!live(b) || b.st !== 'waiting') return null;
      return needsOf(b).every((d) => haveDish(s, ctx.me, d)) ? null : 'chai';
    },
    hint: [
      { after: 14, text: 'Tap each ready dish to pick it up, then tap the customer for each dish.' },
      { after: 40, text: 'Serve with a full pair of hands: chai in one, dosa in the other.' },
    ],
  },
  {
    id: 'collect2',
    speaker: TUTORIAL_HOST,
    say: 'Shabash! Ab paisa uthao.',
    text: 'Collect the money again. Collect one after another without a miss and your combo bonus grows.',
    te: 'మళ్ళీ డబ్బు తీసుకోండి. కాంబో బోనస్!',
    flags: FROZEN,
    spotlight: (s, ctx) => (ctx.cust('B') ? { kind: 'customer', id: ctx.cust('B').id } : null),
    done: (s, e, ctx) => ctx.outcome('B') === 'paid',
    hint: [{ after: 14, text: 'Tap the customer holding the money note.' }],
  },
  {
    id: 'walkcost',
    speaker: TUTORIAL_HOST,
    say: 'Ek baat yaad rakhna: chalna bhi time leta hai!',
    text: 'Walking takes time. In a rush a long walk can cost you a customer, so keep the stations you use most close together. With friends, split the work: one cooks, one serves and collects.',
    te: 'నడవడానికి కూడా సమయం పడుతుంది. పని పంచుకోండి.',
    spotlight: null,
    flags: FROZEN,
    ack: true,
    done: (s, e, ctx) => ctx.acked,
    hint: [{ after: 16, text: 'Press "Got it" when you are ready for the rush.' }],
  },
  {
    id: 'rush',
    speaker: TUTORIAL_HOST,
    say: 'Rush aa gaya! Do customer ek saath!',
    text: 'Rush time: two customers at once. Cook, serve and collect, and keep an eye on the patience rings. The clock is real now, but you have time.',
    te: 'రష్ టైమ్! ఇద్దరు కస్టమర్లు.',
    spawns: ['R1', 'R2'],
    // the first rush is live; after a rush nobody paid for, the clocks freeze so it can be finished
    flags: (ctx) => (ctx.attempts.rush === 0 ? LIVE : FROZEN),
    spotlight: null,
    onEnter: () => [
      spawnAction({ kind: 'student', name: 'Swathi', order: ['masala_dosa'] }),
      spawnAction({ kind: 'uncle', name: 'Venkat uncle', order: ['irani_chai', 'dosa'] }),
    ],
    done: (s, e, ctx) => {
      const o1 = ctx.outcome('R1');
      const o2 = ctx.outcome('R2');
      return !!o1 && !!o2 && (o1 === 'paid' || o2 === 'paid');
    },
    failed: (s, ctx) => {
      const o1 = ctx.outcome('R1');
      const o2 = ctx.outcome('R2');
      return o1 && o2 && o1 !== 'paid' && o2 !== 'paid' ? { to: 'rush', attempt: 'rush' } : null;
    },
    hint: [
      { after: 20, text: 'Cook what the order bubbles ask for, serve each customer, then collect the money.' },
      { after: 60, text: 'Tap a station to cook, tap ready dishes to pick them up, tap a customer to serve or collect.' },
    ],
  },
  {
    id: 'outro',
    speaker: TUTORIAL_HOST,
    say: 'Shabash anna! Ab tum pakke tiffin wale ho!',
    text: 'You are ready! Now invite your friends and run the centre together.',
    te: 'మీరు సిద్ధం! స్నేహితులతో కలిసి నడపండి.',
    spotlight: null,
    flags: LIVE,
    ack: true,
    complete: true, // reaching this step IS finishing the tutorial
    done: (s, e, ctx) => ctx.acked,
    hint: [],
  },
];

const STEP_INDEX = Object.freeze(Object.fromEntries(TUTORIAL_STEPS.map((s, i) => [s.id, i])));
export const TUTORIAL_STEP_IDS = Object.freeze(TUTORIAL_STEPS.map((s) => s.id));

/** The first dosa is gone (burnt or thrown away) and the customer still waits: back to cooking it. */
function lostFirstDosa(s, ctx) {
  const a = ctx.cust('A');
  if (!live(a) || a.st !== 'waiting' || a.got.includes('dosa')) return null;
  return haveDish(s, ctx.me, 'dosa') ? null : 'cook';
}

// ---------------------------------------------------------------------------------------------------------------------
// the driver

const MAX_CHAIN = 24; // steps that may complete inside one advance (the state can already satisfy several)

const resolve = (v, ...args) => (typeof v === 'function' ? v(...args) : v);

/**
 * `createTutorialDriver()` -> the tutorial's brain. Fully deterministic: same states and events in, same actions out.
 *
 *   driver.steps      TUTORIAL_STEPS
 *   driver.index      current step index        driver.step   current step data
 *   driver.text/say/te/hint/spotlight/flags/notice   the current step, resolved against the last state seen
 *   driver.done       true once the tutorial is COMPLETED (the outro was reached)
 *   driver.finished   true once the player pressed "Got it" on the outro
 *   driver.skipped    true after skip()
 *   driver.advance(state, events) -> { actions, completed }   `completed` is true exactly once
 *   driver.ack()      the player pressed "Got it" (only counts on a step with `ack: true`)
 *   driver.skip()
 */
export function createTutorialDriver({ steps = TUTORIAL_STEPS } = {}) {
  const idx = (id) => steps.findIndex((s) => s.id === id);
  const mem = {
    index: 0,
    entered: false,
    enterTick: 0,
    lastTick: 0,
    acked: false,
    visits: {}, // step id -> times entered
    attempts: { collect: 0, rush: 0 },
    seen: new Set(), // customer ids already accounted for
    tags: {}, // 'A' -> customer id
    pending: [], // tags waiting for their customer to appear
    outcomes: {}, // customer id -> 'paid' | 'angry' | 'unpaid'
    demo: null,
    flags: null, // the last flags sent to the engine
    notice: null,
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

  function observe(state, events) {
    mem.lastState = state;
    mem.lastTick = state.tick;
    for (const c of state.customers) {
      if (!mem.seen.has(c.id)) {
        mem.seen.add(c.id);
        if (mem.pending.length) mem.tags[mem.pending.shift()] = c.id;
      }
      if (c.outcome && !mem.outcomes[c.id]) mem.outcomes[c.id] = c.outcome;
    }
    for (const e of events || []) {
      if (e.type === 'collect') mem.outcomes[e.customer] = 'paid';
      else if (e.type === 'customer-angry') mem.outcomes[e.customer] = mem.outcomes[e.customer] || 'angry';
      else if (e.type === 'customer-unpaid') mem.outcomes[e.customer] = mem.outcomes[e.customer] || 'unpaid';
    }
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
      cust: (tag) => byId(mem.tags[tag]),
      outcome: (tag) => {
        const id = mem.tags[tag];
        if (id == null) return null;
        const c = byId(id);
        return mem.outcomes[id] || (c && c.outcome) || null;
      },
    };
  }

  /** Enter step `i`: returns the actions its entry needs (flags first, then onEnter). */
  function enter(i, state, meHint) {
    mem.index = i;
    const step = steps[i];
    mem.visits[step.id] = (mem.visits[step.id] || 0) + 1;
    mem.enterTick = state.tick;
    mem.acked = false;
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
      on = on.actions || [];
    }
    const spawned = on.filter((a) => a.type === 'spawn').length;
    if (spawned && step.spawns) {
      // retag: a retry brings new customers, so the old tags must not point at the ones who left
      mem.pending = step.spawns.slice(0, spawned);
      for (const tag of mem.pending) delete mem.tags[tag];
    }
    for (const a of on) actions.push(a);
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
    get progress() { return { index: mem.index, total: steps.length }; },
    get say() { return steps[mem.index].say || ''; },
    get te() { return steps[mem.index].te || ''; },
    get text() {
      const step = steps[mem.index];
      if (typeof step.text !== 'function') return step.text || '';
      return mem.lastState ? step.text(mem.lastState, makeCtx(mem.lastState)) : '';
    },
    get ackable() { return !!steps[mem.index].ack; },
    get hint() {
      const step = steps[mem.index];
      if (!step.hint || !step.hint.length || !mem.lastState || mem.completed) return null;
      const t = mem.lastState.tick - mem.enterTick;
      let h = null;
      for (const x of step.hint) if (t >= x.after) h = x.text;
      return h;
    },
    get spotlight() {
      const step = steps[mem.index];
      if (!mem.lastState || mem.skipped) return null;
      return resolve(step.spotlight, mem.lastState, makeCtx(mem.lastState)) || null;
    },
    /** The player pressed "Got it". Ignored unless the current step waits for it. */
    ack() {
      if (mem.skipped || !steps[mem.index].ack) return false;
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
      if (!mem.entered) {
        mem.entered = true;
        out.actions.push(...enter(0, state, opts.meId));
        return out;
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

        if (!step.done(state, events, ctx)) break;
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
      return out;
    },
  };
  return driver;
}

/** Station ids the tutorial uses, for tests and the HUD. */
export const TUTORIAL_STATIONS = Object.freeze(Object.keys(STATIONS).filter((id) => levelDef(TUTORIAL_LEVEL).stations.includes(id)));
export const TUTORIAL_DISHES = Object.freeze(levelDef(TUTORIAL_LEVEL).menu.filter((d) => DISHES[d]));
