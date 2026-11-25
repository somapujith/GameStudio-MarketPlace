// Tiffin Centre: a competent greedy bot, for tests and balance (the server does NOT use it for AFK players).
// One call = one action, which is the realistic pace of a human player (one tap per tick).
// Priority: collect money (closest to walking away first) > serve > throw away a useless dish > take ready dishes
// (burning soonest first) > fetch finished prep from the back counter > change an empty gas cylinder > tidy for the inspector >
// tend a pan that is about to hurt the food > cook only what the waiting customers still need (prepping the ingredient when the stock is
// short) > tend and restock in quiet moments > mark a dish off the board when it cannot be made > clear burnt slots.
import { DISHES, HANDS_MAX, INGREDIENTS, MARKET_MAX, PREP_STATION, STOCK_CAP } from './catalog.js';
import { needsOf } from './engine.js';
import { WORK_MS, standX, walkSeconds, workTarget } from './movement.js';
import { cookBlocker, expectedDemand, gasInfo, minUse, shortOf, tendInfo } from './ops.js';
import { levelDef } from './catalog.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Walk the waiting customers (most urgent first) and hand out `supply` (dish -> count) to their needs; returns what stays unmet. */
function unmet(waiting, supply) {
  const left = { ...supply };
  const out = [];
  for (const c of waiting) {
    for (const d of needsOf(c)) {
      if (left[d] > 0) left[d] -= 1;
      else out.push({ c, dish: d });
    }
  }
  return out;
}

const rateCache = new Map();
/** Portions of an ingredient the shift is expected to use per tick (so the bot restocks before the shelf is empty, not at some fixed number). */
function useRate(s, item) {
  const key = `${s.level}|${s.order.length}|${s.pace}`;
  let need = rateCache.get(key);
  if (!need) {
    need = expectedDemand(levelDef(s.level), s.cfg.menu, s.order.length, s.pace);
    if (rateCache.size > 64) rateCache.clear();
    rateCache.set(key, need);
  }
  return (need[item] || 0) / s.shiftTicks;
}

/** A prep job for `item` is worth starting: the counter has a free slot, nobody is already making it, and the shelf has room. */
function prepFor(s, playerId, item) {
  const prep = s.stations[PREP_STATION];
  if (!prep || !hasOwn(INGREDIENTS, item) || !hasOwn(s.stock, item)) return null;
  const def = INGREDIENTS[item];
  let pending = 0;
  for (const j of prep.slots) if (j.st !== 'empty' && j.item === item) pending += def.prep.yield;
  if (pending > 0) return null;
  if (s.stock[item] + def.prep.yield > STOCK_CAP) return null;
  const slot = prep.slots.findIndex((j) => j.st === 'empty');
  return slot >= 0 ? { type: 'prep', playerId, station: PREP_STATION, slot, item } : null;
}

/** Start a prep job for the ingredient closest to running out: it is due when the stock covers fewer than (prep ticks + margin) ticks of use. */
function restock(s, playerId, margin, remaining) {
  const cands = [];
  for (const item of Object.keys(s.stock)) {
    const def = INGREDIENTS[item];
    if (remaining < def.prep.ticks + 12) continue;
    const n = s.stock[item];
    const mark = Math.max(1, Math.ceil(1.3 * useRate(s, item) * (def.prep.ticks + margin)));
    const sour = typeof s.fresh[item] === 'number' && s.fresh[item] < 40 && n <= 12 && remaining > 60 && useRate(s, item) * remaining >= 4;
    if (n > mark && !sour) continue;
    if (n + 3 >= useRate(s, item) * (remaining - 4) && !sour) continue; // the shelf lasts to closing time (or the shortfall is too small for a batch)
    cands.push({ item, score: (sour ? 1 : 0) + (mark - n) / mark });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const { item } of cands) {
    const job = prepFor(s, playerId, item);
    if (job) return job;
  }
  return null;
}

export function chooseAutoAction(s, playerId) {
  if (!s || s.status !== 'playing' || typeof playerId !== 'string' || !hasOwn(s.players, playerId)) return null;
  const me = s.players[playerId];
  const live = s.customers.filter((c) => c.st !== 'left');
  const waiting = live.filter((c) => c.st === 'waiting').sort((a, b) => a.patience - b.patience || a.id - b.id);
  const cfg = s.cfg;

  // 1. money first: whoever is about to walk away
  const paying = live.filter((c) => c.st === 'paying').sort((a, b) => a.payLeft - b.payLeft || a.id - b.id);
  if (paying.length) return { type: 'collect', playerId, customer: paying[0].id };

  // 2. serve a held dish to the most urgent customer who still needs it
  for (const c of waiting) {
    const need = needsOf(c);
    const hand = me.hands.findIndex((h) => need.includes(h.dish));
    if (hand >= 0) return { type: 'serve', playerId, customer: c.id, hand };
  }

  // 3. a dish nobody needs any more is only in the way
  for (let i = 0; i < me.hands.length; i++) {
    if (!waiting.some((c) => needsOf(c).includes(me.hands[i].dish))) return { type: 'discard', playerId, hand: i };
  }

  // 4. take ready dishes that somebody is waiting for (and nobody is already carrying), the ones about to burn first
  if (me.hands.length < HANDS_MAX) {
    const carried = {};
    for (const id of s.order) for (const h of s.players[id].hands) carried[h.dish] = (carried[h.dish] || 0) + 1;
    const wanted = new Set(unmet(waiting, carried).map((u) => u.dish));
    let best = null;
    for (const sid of cfg.stations) {
      if (s.stations[sid].kind === 'prep') continue;
      s.stations[sid].slots.forEach((sl, slot) => {
        if (sl.st !== 'ready' || !wanted.has(sl.dish)) return;
        const left = sl.burnAt - s.tick;
        if (!best || left < best.left) best = { sid, slot, left };
      });
    }
    if (best) return { type: 'take', playerId, station: best.sid, slot: best.slot };
  }

  // --- the operations layer (every branch is off at level 0) ---
  const remaining = s.shiftTicks - s.tick;
  if (cfg.stock) {
    // 4b. finished prep waits at the back counter
    const prep = s.stations[PREP_STATION];
    const ready = prep.slots.findIndex((j) => j.st === 'ready');
    if (ready >= 0) return { type: 'collectPrep', playerId, station: PREP_STATION, slot: ready };
    // 4b'. an ingredient somebody is waiting for has run out: one tap at the back counter beats any single dish
    if (remaining > 14) {
      for (const c of waiting) {
        for (const d of needsOf(c)) {
          const item = shortOf(s, d);
          if (!item) continue;
          const job = prepFor(s, playerId, item);
          if (job) return job;
        }
      }
    }
  }
  if (cfg.gas) {
    // 4c. the cylinder is nearly empty (or empty): change it before the burners go cold
    const g = gasInfo(s);
    if (g && !g.swapping && g.canSwap && g.frac <= 0.18 && remaining > 25) return { type: 'swapGas', playerId };
  }
  if (cfg.heat && s.events.some((e) => e.id === 'inspector')) {
    // 4d. the inspector is at the gate: clear burnt food and wipe every pan that looks tired
    for (const sid of cfg.stations) {
      const slot = s.stations[sid].slots.findIndex((sl) => sl.st === 'burnt');
      if (slot >= 0) return { type: 'take', playerId, station: sid, slot };
    }
    for (const sid of cfg.stations) {
      const t = tendInfo(s, sid);
      if (t && t.canTend && s.stations[sid].kind === 'tawa' && s.tick - s.stations[sid].tendAt > 18) return { type: 'tend', playerId, station: sid };
    }
  }

  if (cfg.stock && remaining > 30) {
    const job = restock(s, playerId, 2, remaining);
    if (job) return job;
  }

  // 5. cook what is still missing (hands + everything cooking or ready count as supply)
  const supply = {};
  const add = (d) => { supply[d] = (supply[d] || 0) + 1; };
  for (const id of s.order) for (const h of s.players[id].hands) add(h.dish);
  for (const sid of cfg.stations) {
    if (s.stations[sid].kind === 'prep') continue;
    for (const sl of s.stations[sid].slots) if (sl.st === 'cooking' || sl.st === 'ready') add(sl.dish);
  }
  const missing = unmet(waiting, supply);
  let shortItem = null;
  for (const { dish } of missing) {
    const kind = DISHES[dish].station;
    for (const sid of cfg.stations) {
      const st = s.stations[sid];
      if (st.kind !== kind) continue;
      const slot = st.slots.findIndex((sl) => sl.st === 'empty');
      if (slot < 0) continue;
      if (cfg.heat) {
        // a pan that is about to tear or stick the food gets wiped first
        const t = tendInfo(s, sid);
        if (t && t.need >= 0.75 && t.canTend) return { type: 'tend', playerId, station: sid };
      }
      const blocked = cookBlocker(s, st, dish);
      if (!blocked) return { type: 'cook', playerId, station: sid, slot, dish };
      if (!shortItem && cfg.stock) shortItem = shortOf(s, dish);
    }
  }
  if (shortItem) {
    // the stock ran short for somebody who is waiting: prep it (or send a runner to the market when the counter is busy)
    const job = prepFor(s, playerId, shortItem);
    if (job) return job;
    if (cfg.market && s.stock[shortItem] < minUse(shortItem, cfg.menu)) {
      const prep = s.stations[PREP_STATION];
      let pending = 0;
      for (const j of prep.slots) if (j.st !== 'empty' && j.item === shortItem) pending += INGREDIENTS[shortItem].prep.yield;
      const n = Math.min(4, MARKET_MAX);
      if (pending === 0 && s.stock[shortItem] + n <= STOCK_CAP && !prep.slots.some((j) => j.st === 'empty')) return { type: 'buy', playerId, item: shortItem, n };
    }
  }

  // 6. quiet moment: tend pans that are drifting
  if (cfg.heat) {
    let worst = null;
    for (const sid of cfg.stations) {
      const t = tendInfo(s, sid);
      if (t && t.canTend && t.need >= 0.45 && (!worst || t.need > worst.need)) worst = { sid, need: t.need };
    }
    if (worst) return { type: 'tend', playerId, station: worst.sid };
  }
  if (cfg.stock && remaining > 30) {
    const job = restock(s, playerId, 12, remaining);
    if (job) return job;
  }
  if (cfg.gas) {
    const g = gasInfo(s);
    if (g && !g.swapping && g.canSwap && g.frac <= 0.3 && remaining > 40 && !waiting.length) return { type: 'swapGas', playerId };
  }

  // 7. the board: an item that is out with nothing coming comes off, and goes back on when it is back
  if (cfg.stock && !cfg.market) {
    const prep = s.stations[PREP_STATION];
    for (const d of cfg.menu) {
      const missingItem = shortOf(s, d);
      const off = s.off.includes(d);
      if (missingItem && !off) {
        const coming = prep.slots.some((j) => j.st !== 'empty' && j.item === missingItem);
        if (!coming && !prep.slots.some((j) => j.st === 'empty') && remaining > 20) return { type: 'board', playerId, dish: d, on: false };
      } else if (!missingItem && off) return { type: 'board', playerId, dish: d, on: true };
    }
  } else if (cfg.stock) {
    for (const d of cfg.menu) if (s.off.includes(d) && !shortOf(s, d)) return { type: 'board', playerId, dish: d, on: true };
  }

  // 8. clear burnt slots (they block the station)
  for (const sid of cfg.stations) {
    if (s.stations[sid].kind === 'prep') continue;
    const slot = s.stations[sid].slots.findIndex((sl) => sl.st === 'burnt');
    if (slot >= 0) return { type: 'take', playerId, station: sid, slot };
  }
  return null;
}

/**
 * What an action costs a walking player: the place they must stand at, and how many whole ticks they are busy
 * (walk there + the work animation, rounded up, at least 1). Used by the balance simulation to keep bots human-paced.
 */
export function actionCost(s, playerId, action) {
  const to = workTarget(action, s);
  const at = s && s.players && hasOwn(s.players, playerId) ? s.players[playerId].at : null;
  if (!to) return { to: null, ticks: 1 };
  const secs = walkSeconds(standX(at), standX(to)) + WORK_MS / 1000;
  return { to, ticks: Math.max(1, Math.ceil(secs - 1e-9)) };
}

