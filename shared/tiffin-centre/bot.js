// Tiffin Centre: a competent greedy bot, for tests and balance (the server does NOT use it for AFK players).
// One call = one action, which is the realistic pace of a human player (one tap per tick).
// Priority: collect money (closest to walking away first) > serve > throw away a useless dish > take ready dishes
// (burning soonest first) > cook only what the waiting customers still need > clear burnt slots.
import { DISHES, HANDS_MAX } from './catalog.js';
import { needsOf } from './engine.js';
import { WORK_MS, standX, walkSeconds, workTarget } from './movement.js';

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

export function chooseAutoAction(s, playerId) {
  if (!s || s.status !== 'playing' || typeof playerId !== 'string' || !hasOwn(s.players, playerId)) return null;
  const me = s.players[playerId];
  const live = s.customers.filter((c) => c.st !== 'left');
  const waiting = live.filter((c) => c.st === 'waiting').sort((a, b) => a.patience - b.patience || a.id - b.id);

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
    for (const sid of s.cfg.stations) {
      s.stations[sid].slots.forEach((sl, slot) => {
        if (sl.st !== 'ready' || !wanted.has(sl.dish)) return;
        const left = sl.burnAt - s.tick;
        if (!best || left < best.left) best = { sid, slot, left };
      });
    }
    if (best) return { type: 'take', playerId, station: best.sid, slot: best.slot };
  }

  // 5. cook what is still missing (hands + everything cooking or ready count as supply)
  const supply = {};
  const add = (d) => { supply[d] = (supply[d] || 0) + 1; };
  for (const id of s.order) for (const h of s.players[id].hands) add(h.dish);
  for (const sid of s.cfg.stations) for (const sl of s.stations[sid].slots) if (sl.st === 'cooking' || sl.st === 'ready') add(sl.dish);
  for (const { dish } of unmet(waiting, supply)) {
    const kind = DISHES[dish].station;
    for (const sid of s.cfg.stations) {
      const st = s.stations[sid];
      if (st.kind !== kind) continue;
      const slot = st.slots.findIndex((sl) => sl.st === 'empty');
      if (slot >= 0) return { type: 'cook', playerId, station: sid, slot, dish };
    }
  }

  // 6. clear burnt slots (they block the station)
  for (const sid of s.cfg.stations) {
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
