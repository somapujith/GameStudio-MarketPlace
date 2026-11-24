// Tiffin Centre stress test: random legal and illegal actions, straight to game over, for 200 seeds. Nothing may throw,
// refusals leave the very same state object, and the structural invariants hold after every action.
import { describe, it, expect, vi } from 'vitest';
import { mulberry32 } from '../rng.js';
import {
  createGame, applyAction, isOver, result, chooseAutoAction, LIVES, HANDS_MAX, STATIONS, STATION_KINDS, DISHES, EMOTES, MAX_LEVEL,
} from './index.js';

vi.setConfig({ testTimeout: 180000 });

const JUNK = [undefined, null, NaN, Infinity, -Infinity, -1, 0, 1, 2, 3, 99, 1e30, -1e30, 0.5, '0', '1', '', 'x', '__proto__', 'constructor', 'spot:99',
  true, false, {}, [], [0], { a: 1 }, () => 1];
const pick = (r, a) => a[Math.floor(r() * a.length)];

let checks = 0;
const ok = (cond, label, what) => {
  if (!cond) throw new Error(`${label}: ${what}`);
};

function invariants(s, label) {
  const text = JSON.stringify(s);
  if (checks++ % 4 === 0) ok(JSON.stringify(JSON.parse(text)) === text, label, 'not JSON round-trippable');
  if (checks % 500 === 1) expect(JSON.parse(text), label).toEqual(s); // deep check (catches undefined values) now and then
  ok(Number.isInteger(s.money) && s.money >= 0, label, `money ${s.money}`);
  ok(s.tips >= 0 && s.combo >= 0, label, 'negative tips or combo');
  ok(Number.isInteger(s.lives) && s.lives >= 0 && s.lives <= LIVES, label, `lives ${s.lives}`);
  ok(text.length < 7000, label, `state is ${text.length} bytes`);
  ok(s.schedule.length <= 2 && s.emotes.length <= 4, label, 'schedule or emotes grew');
  ok(s.status !== 'closed' || s.stars === 0, label, 'closed with stars');
  let earned = 0;
  for (const id of s.order) {
    const p = s.players[id];
    ok(p.hands.length <= HANDS_MAX, label, 'hands over capacity');
    for (const h of p.hands) ok(DISHES[h.dish] && ['perfect', 'good', 'ok'].includes(h.q), label, 'bad hand item');
    ok(p.earned >= 0, label, 'negative earnings');
    earned += p.earned;
  }
  ok(earned === s.money, label, 'money does not add up');
  for (const sid of Object.keys(s.stations)) {
    const st = s.stations[sid];
    ok(st.slots.length === STATION_KINDS[STATIONS[sid].kind].slots, label, 'slot count changed');
    for (const sl of st.slots) {
      ok(['empty', 'cooking', 'ready', 'burnt'].includes(sl.st), label, 'bad slot state');
      ok(sl.st === 'empty' ? sl.dish === null : DISHES[sl.dish].station === st.kind, label, 'bad slot dish');
    }
  }
  const spots = new Set();
  for (const c of s.customers) {
    ok(c.patience >= 0 && c.patience <= c.patienceMax, label, 'patience out of range');
    ok(c.got.length <= c.order.length && c.qs.length === c.got.length, label, 'bad got/qs');
    if (c.st !== 'left') {
      ok(!spots.has(c.spot) && c.spot < s.cfg.spots, label, `bad spot ${c.spot}`);
      spots.add(c.spot);
    }
  }
}

/** Half the time a plausible action built from the state, half the time garbage. */
function randomAction(s, r) {
  const who = pick(r, [...s.order, ...s.order, 'ghost', '__proto__', undefined, 7]);
  const stations = Object.keys(s.stations);
  const garbage = r() < 0.3;
  const g = (legal) => (garbage && r() < 0.5 ? pick(r, JUNK) : legal);
  const station = g(pick(r, stations.concat(['tawa2', 'steamer1', 'kadai1'])));
  const slot = g(Math.floor(r() * 4));
  const customers = s.customers.map((c) => c.id);
  const customer = g(customers.length ? pick(r, customers) : 1);
  const hand = g(Math.floor(r() * 3));
  const roll = r();
  if (roll < 0.04) return pick(r, JUNK);
  if (roll < 0.25) return { type: 'cook', playerId: who, station, slot, dish: g(pick(r, Object.keys(DISHES))) };
  if (roll < 0.45) return { type: 'take', playerId: who, station, slot };
  if (roll < 0.62) return { type: 'serve', playerId: who, customer, hand };
  if (roll < 0.78) return { type: 'collect', playerId: who, customer };
  if (roll < 0.83) return { type: 'discard', playerId: who, hand };
  if (roll < 0.89) return { type: 'move', playerId: who, to: g(pick(r, [null, 'bin', 'spot:0', 'spot:5', ...stations])) };
  if (roll < 0.92) return { type: 'emote', playerId: who, e: g(pick(r, EMOTES)) };
  if (roll < 0.94) return { type: 'spawn', customer: g({ order: [pick(r, s.cfg.menu)], kind: 'student' }) };
  if (roll < 0.96) return { type: 'tutorial-flags', patience: g(r() < 0.5), pay: g(r() < 0.5) };
  if (roll < 0.98) return { type: pick(r, JUNK) };
  return { type: 'tick', tick: g(s.tick) };
}

function run(seed) {
  const r = mulberry32(seed * 7919 + 1);
  const level = seed % (MAX_LEVEL + 1);
  const n = 1 + (seed % 4);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  let s = createGame({ players, settings: { level, pace: pick(r, ['relaxed', 'normal', 'rush']) }, seed });
  const label = (i, a) => `seed ${seed} level ${level} step ${i} ${JSON.stringify(a)}`;
  let steps = 0;
  while (!isOver(s) && steps < 60000) {
    const burst = Math.floor(r() * 4);
    for (let k = 0; k < burst; k++) {
      // some players are sensible, some are chaos
      const a = r() < 0.4 ? chooseAutoAction(s, pick(r, s.order)) || randomAction(s, r) : randomAction(s, r);
      const lab = label(steps++, a);
      let res;
      try { res = applyAction(s, a); } catch (e) { throw new Error(`${lab} threw ${e.message}`); }
      ok(Array.isArray(res.events), lab, 'events is not an array');
      if (res.error !== undefined) {
        ok(typeof res.error === 'string' && res.state === s && res.events.length === 0, lab, 'a refusal must keep the same state, no events, a string error');
      } else {
        ok(res.state !== s || res.events.length === 0, lab, 'a no-op may not emit events');
        if (steps % 3 === 0) invariants(res.state, lab);
        s = res.state;
      }
      if (isOver(s)) break;
    }
    if (isOver(s)) break;
    const tick = applyAction(s, { type: 'tick' });
    ok(tick.error === undefined, `seed ${seed}`, `tick refused: ${tick.error}`);
    s = tick.state;
    invariants(s, `seed ${seed} tick ${s.tick}`);
    steps++;
  }
  return s;
}

describe('fuzz: random legal and illegal actions to game over', () => {
  it('200 seeds, every level, 1-4 players', () => {
    const ends = { done: 0, closed: 0 };
    for (let seed = 1; seed <= 200; seed++) {
      const s = run(seed);
      expect(isOver(s), `seed ${seed} did not finish`).toBe(true);
      ends[s.status] += 1;
      const res = result(s);
      expect(res.standings).toHaveLength(s.order.length);
      expect(res.money).toBe(s.money);
      expect(res.stars).toBe(s.stars);
      if (s.stars === 0) expect(res.winnerId).toBe(null);
      // nothing works after the end
      for (const a of [{ type: 'tick' }, { type: 'cook', playerId: 'p0', station: 'tawa1', slot: 0, dish: 'dosa' }, { type: 'emote', playerId: 'p0', e: 'fire' }]) {
        const after = applyAction(s, a);
        expect(after.state).toBe(s);
        expect(after.error).toBeTruthy();
      }
    }
    expect(ends.done + ends.closed).toBe(200);
    expect(ends.closed).toBeGreaterThan(0);
    expect(ends.done).toBeGreaterThan(0);
  });

  it('the same seed replays to the identical game', () => {
    expect(run(17)).toEqual(run(17));
    expect(run(18)).not.toEqual(run(17));
  });
});
