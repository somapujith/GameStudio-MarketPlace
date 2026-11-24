// Tiffin Centre HUD: every decision the overlay makes lives here as a pure function (no React, no DOM, no engine import) so it is
// unit-tested in hudLogic.test.js. Inputs are the engine STATE shape of docs/TIFFIN_CENTRE_PLAN.md section 3 (read-only here).
import { standX, validTarget, walkSeconds, workTarget } from '@shared/tiffin-centre/movement.js';
import { starTargets as engineStars } from '@shared/tiffin-centre/scoring.js';
import { DISHES, STATION_KINDS, STATIONS, CUSTOMER_KINDS, DAYPARTS, daypartOf, PACE, LEVELS, coopScale, LIVES, HANDS_MAX, PAY_WINDOW, TICK_MS, EAT_TICKS } from '@shared/tiffin-centre/catalog.js';

export { LIVES, HANDS_MAX, PAY_WINDOW, TICK_MS, EAT_TICKS };

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

// ---- clock, daypart, shift progress --------------------------------------------------------------------------------------------
/** Game hour of a state (same formula as the engine's hourOf: lerp(level.hour[0], level.hour[1], tick / shiftTicks)). */
export function hourFromState(state, frac = 0) {
  const [a, b] = state?.cfg?.hour || [7, 8];
  const total = Math.max(1, num(state?.shiftTicks, 1));
  const p = clamp((num(state?.tick) + clamp(frac, 0, 1)) / total, 0, 1);
  return a + (b - a) * p;
}

/** 12-hour clock parts of a decimal hour: 0 -> 12:00 AM, 13.5 -> 1:30 PM, 24 wraps. */
export function formatClock(hour) {
  let h = num(hour) % 24;
  if (h < 0) h += 24;
  const total = Math.min(24 * 60 - 1, Math.floor(h * 60 + 1e-6));
  const hh = Math.floor(total / 60);
  const mm = String(total % 60).padStart(2, '0');
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const ampm = hh < 12 ? 'AM' : 'PM';
  return { time: `${h12}:${mm}`, ampm, label: `${h12}:${mm} ${ampm}` };
}

export const DAYPART_ICON = { morning: 'sunrise', noon: 'sun', evening: 'chai', night: 'moon' };
export function daypartView(hour) {
  const id = daypartOf(hour);
  const d = DAYPARTS[id];
  return { id, label: d.label, te: d.te, icon: DAYPART_ICON[id] };
}

/** 0..1 of the shift that has elapsed. */
export function shiftFrac(state, frac = 0) {
  const total = Math.max(1, num(state?.shiftTicks, 1));
  return clamp((num(state?.tick) + clamp(frac, 0, 1)) / total, 0, 1);
}

/** "2:05" left in the shift (rounded up to whole seconds, 1 tick = 1 s). */
export function formatLeft(state) {
  const s = Math.max(0, num(state?.shiftTicks) - num(state?.tick));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Money needed for 1/2/3 stars in this state (catalog stars * pace * co-op), or null for a level with no targets (tutorial). */
export function starTargets(state) {
  if (!state || LEVELS[state.level] === undefined) return null;
  const t = engineStars(state.level, state.pace, Math.max(1, (state.order || []).length));
  return t.some((n) => n > 0) ? t : null;
}

/** The star bar: fill 0..1 of the 3-star target, tick positions (0..1) of each threshold, and stars already earned. */
export function starBar(money, targets) {
  if (!targets) return null;
  const top = Math.max(1, targets[2]);
  return {
    fill: clamp(num(money) / top, 0, 1),
    ticks: targets.map((t) => clamp(t / top, 0, 1)),
    earned: targets.filter((t) => num(money) >= t && t > 0).length,
    targets,
  };
}

// ---- time interpolation -------------------------------------------------------------------------------------------------------
/** Fraction (0..1) of the current tick that has elapsed. Frozen at `last` while the game is not 'playing' (pause, disconnect). */
export function tickFrac(now, tickAt, status, last = 0) {
  if (status !== 'playing') return last;
  if (!Number.isFinite(tickAt)) return 0;
  return clamp((now - tickAt) / TICK_MS, 0, 1);
}

/** Exponential ease of a counter toward its target (the money count-up). Snaps when within half a rupee. */
export function easeCount(cur, target, dt) {
  const d = target - cur;
  if (Math.abs(d) < 0.5) return target;
  return cur + d * Math.min(1, Math.max(0, dt) * 7);
}

// ---- urgency (the patience coin ring) -----------------------------------------------------------------------------------------
export function urgency(frac) {
  const f = clamp(num(frac, 1), 0, 1);
  if (f < 0.25) return { tone: 'crit', shake: true, label: 'Very impatient' };
  if (f < 0.55) return { tone: 'warn', shake: false, label: 'Getting impatient' };
  return { tone: 'ok', shake: false, label: 'Happy to wait' };
}

/** Patience fraction, interpolated inside the tick. Only a waiting customer drains (and not in a no-patience tutorial step). */
export function patienceFracAt(c, state, frac = 0) {
  const max = Math.max(1, num(c?.patienceMax, 1));
  const drains = c?.st === 'waiting' && !state?.cfg?.noPatience;
  return clamp((num(c?.patience) - (drains ? clamp(frac, 0, 1) : 0)) / max, 0, 1);
}
export function patienceLeftSecs(c, state, frac = 0) {
  const drains = c?.st === 'waiting' && !state?.cfg?.noPatience;
  return Math.max(0, Math.ceil(num(c?.patience) - (drains ? clamp(frac, 0, 1) : 0) - 1e-6));
}
/** Pay-window fraction (1 = full window), interpolated; frozen when the tutorial turned the expiry off. */
export function payFracAt(c, state, frac = 0) {
  const drains = c?.st === 'paying' && !state?.cfg?.noPayExpiry;
  return clamp((num(c?.payLeft) - (drains ? clamp(frac, 0, 1) : 0)) / PAY_WINDOW, 0, 1);
}
export function payLeftSecs(c, state, frac = 0) {
  const drains = c?.st === 'paying' && !state?.cfg?.noPayExpiry;
  return Math.max(0, Math.ceil(num(c?.payLeft) - (drains ? clamp(frac, 0, 1) : 0) - 1e-6));
}

/**
 * What a chit's coin ring shows this frame: waiting -> patience (green/amber/red, shakes under 25%), eating -> a slow fill,
 * paying -> the pay window (red from 3 s left). { mode, p (0..1 ring), tone 'ok'|'warn'|'crit'|'eat', shake, secs }.
 */
export function ticketFrame(c, state, frac = 0) {
  if (c?.st === 'paying') {
    const secs = payLeftSecs(c, state, frac);
    const tone = secs <= 3 ? 'crit' : secs <= 5 ? 'warn' : 'ok';
    return { mode: 'pay', p: payFracAt(c, state, frac), tone, shake: tone === 'crit', secs };
  }
  if (c?.st === 'eating') {
    const left = Math.max(0, num(c.eatLeft) - clamp(frac, 0, 1));
    return { mode: 'eat', p: clamp(1 - left / Math.max(1, EAT_TICKS), 0, 1), tone: 'eat', shake: false, secs: Math.ceil(left - 1e-6) };
  }
  const p = patienceFracAt(c, state, frac);
  const u = urgency(p);
  return { mode: 'wait', p, tone: u.tone, shake: u.shake, secs: patienceLeftSecs(c, state, frac) };
}

// ---- customers and tickets ----------------------------------------------------------------------------------------------------
const onStall = (c) => c && (c.st === 'waiting' || c.st === 'eating' || c.st === 'paying');

/** Customers still at the stall, in spot order (left to right, the order of the chit rail). */
export function activeCustomers(state) {
  return (state?.customers || []).filter(onStall).sort((a, b) => num(a.spot) - num(b.spot) || num(a.id) - num(b.id));
}

/** Dishes a customer still needs (order minus got, as a multiset). */
export function needsOf(c) {
  const left = [...(c?.order || [])];
  for (const d of c?.got || []) {
    const i = left.indexOf(d);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

export function dishInfo(id) {
  const d = DISHES[id];
  return d ? { id, name: d.name, te: d.te, price: d.price, station: d.station, cook: d.cook, burn: d.burn } : { id, name: String(id || '?'), te: '', price: 0, station: null, cook: 0, burn: 0 };
}

export function customerKindLabel(kind) {
  return CUSTOMER_KINDS[kind]?.label || 'Customer';
}

/** View model of one chit: chips in order with a served flag, and whether it is `mine to serve` with the held dishes. */
export function ticketModel(c, state, hands = []) {
  const got = [...(c?.got || [])];
  const held = hands.map((h) => h?.dish);
  const chips = (c?.order || []).map((dish) => {
    const i = got.indexOf(dish);
    const served = i >= 0;
    if (served) got.splice(i, 1);
    return { dish, ...dishInfo(dish), served, inHand: !served && held.includes(dish) };
  });
  return {
    id: c.id,
    name: c.name || 'Customer',
    kind: c.kind,
    kindLabel: customerKindLabel(c.kind),
    spot: c.spot,
    st: c.st,
    chips,
    needs: chips.filter((x) => !x.served).map((x) => x.dish),
    total: num(c.total),
    initial: String(c.name || '?').trim().charAt(0).toUpperCase() || '?',
  };
}

/** Which held dish serves this customer: the selected one if they need it, else the first held one they need, else -1. */
export function serveHandFor(c, hands, selected) {
  const needs = needsOf(c);
  const ok = (i) => hands[i] && needs.includes(hands[i].dish);
  if (ok(selected)) return selected;
  for (let i = 0; i < hands.length; i += 1) if (ok(i)) return i;
  return -1;
}

/** The hand that is selected: the chosen one if it still holds a dish, else the first filled hand, else -1. */
export function effectiveHand(hands, selected) {
  if (hands?.[selected]) return selected;
  const i = (hands || []).findIndex(Boolean);
  return i;
}

export const QUALITY = {
  perfect: { label: 'Perfect', stars: 3 },
  good: { label: 'Good', stars: 2 },
  ok: { label: 'OK', stars: 1 },
};
export const qualityView = (q) => QUALITY[q] || QUALITY.ok;

/** The paying customer who will leave first (for the C shortcut). */
export function urgentPaying(state) {
  return (state?.customers || []).filter((c) => c.st === 'paying').sort((a, b) => num(a.payLeft) - num(b.payLeft))[0] || null;
}

// ---- stations ----------------------------------------------------------------------------------------------------------------
/** Dishes a station can cook that are on the level menu, in menu order. */
export function stationDishes(state, stationId) {
  const kind = STATIONS[stationId]?.kind;
  const menu = state?.cfg?.menu || [];
  return menu.filter((d) => DISHES[d]?.station === kind).map((d, i) => ({ ...dishInfo(d), key: i + 1 }));
}

/** The stations this shift has, in layout order, each with its slots as view models. */
export function stationList(state) {
  const ids = state?.cfg?.stations || [];
  return ids
    .filter((id) => STATIONS[id])
    .map((id) => {
      const kind = STATION_KINDS[STATIONS[id].kind];
      const slots = (state.stations?.[id]?.slots || []).map((s, idx) => ({ idx, st: s.st, dish: s.dish || null, by: s.by ?? null }));
      return {
        id,
        kind: kind.id,
        name: kind.name,
        te: kind.te,
        slots,
        free: slots.filter((s) => s.st === 'empty').length,
        ready: slots.filter((s) => s.st === 'ready').length,
      };
    });
}

/** Cooking / ready-and-burning progress of one slot, interpolated inside the tick. */
export function slotProgress(state, stationId, idx, frac = 0) {
  const s = state?.stations?.[stationId]?.slots?.[idx];
  if (!s) return { st: 'empty', progress: 0, burn: 0, secs: 0 };
  const now = num(state.tick) + clamp(frac, 0, 1);
  if (s.st === 'cooking') {
    const span = Math.max(1, num(s.readyAt) - num(s.t0));
    return { st: s.st, progress: clamp((now - num(s.t0)) / span, 0, 1), burn: 0, secs: Math.max(0, Math.ceil(num(s.readyAt) - now - 1e-6)) };
  }
  if (s.st === 'ready') {
    const span = Math.max(1, num(s.burnAt) - num(s.readyAt));
    const burn = clamp((now - num(s.readyAt)) / span, 0, 1);
    return { st: s.st, progress: 1, burn, secs: Math.max(0, Math.ceil(num(s.burnAt) - now - 1e-6)) };
  }
  return { st: s.st, progress: s.st === 'burnt' ? 1 : 0, burn: s.st === 'burnt' ? 1 : 0, secs: 0 };
}

export const SLOT_WORD = { empty: 'empty', cooking: 'cooking', ready: 'ready', burnt: 'burnt' };

// ---- availability (the dish stock strip) ------------------------------------------------------------------------------------------
/**
 * For every dish on the level menu: how many are ready on stations (burnt ones do NOT count), cooking (with the soonest ETA in
 * ticks), held in hands (all players, and mine), wanted by WAITING customers (order minus got), the shortfall that nothing covers,
 * and how many empty slots its station kind has. Also `urgent` (a customer under 25% patience needs it and nothing is ready, cooking
 * or held) and `blocked` (no empty slot and none ready: it cannot be started or picked up).
 */
export function availability(state, meId) {
  const menu = state?.cfg?.menu || [];
  const stationIds = state?.cfg?.stations || Object.keys(state?.stations || {});
  const tick = num(state?.tick);
  const rows = new Map(menu.map((id) => [id, { dish: id, ready: 0, cooking: 0, eta: null, held: 0, heldByMe: 0, demand: 0, shortfall: 0, free: 0, urgent: false, blocked: false }]));
  for (const sid of stationIds) {
    const kind = STATIONS[sid]?.kind;
    for (const s of state?.stations?.[sid]?.slots || []) {
      if (s.st === 'ready' && rows.has(s.dish)) rows.get(s.dish).ready += 1;
      else if (s.st === 'cooking' && rows.has(s.dish)) {
        const r = rows.get(s.dish);
        r.cooking += 1;
        const eta = Math.max(0, num(s.readyAt) - tick);
        r.eta = r.eta === null ? eta : Math.min(r.eta, eta);
      } else if (s.st === 'empty') {
        for (const r of rows.values()) if (DISHES[r.dish]?.station === kind) r.free += 1;
      }
    }
  }
  for (const p of Object.values(state?.players || {})) {
    for (const h of p?.hands || []) {
      const r = h && rows.get(h.dish);
      if (!r) continue;
      r.held += 1;
      if (p.id === meId) r.heldByMe += 1;
    }
  }
  const patient = state?.cfg?.noPatience;
  const hurry = new Set();
  for (const c of state?.customers || []) {
    if (c.st !== 'waiting') continue;
    const urgent = !patient && num(c.patience) / Math.max(1, num(c.patienceMax, 1)) < 0.25;
    for (const d of needsOf(c)) {
      const r = rows.get(d);
      if (!r) continue;
      r.demand += 1;
      if (urgent) hurry.add(d);
    }
  }
  for (const r of rows.values()) {
    r.shortfall = Math.max(0, r.demand - r.ready - r.cooking - r.held);
    r.urgent = hurry.has(r.dish) && r.ready === 0 && r.cooking === 0 && r.held === 0;
    r.blocked = r.free === 0 && r.ready === 0;
  }
  return menu.map((id) => rows.get(id));
}

/** Visual state of an availability chip. */
export function chipTone(row) {
  if (row.urgent) return 'urgent';
  if (row.blocked) return 'blocked';
  if (row.shortfall > 0) return 'short';
  return 'ok';
}

/** 'Masala Dosa: 2 ready, 1 cooking, 3 wanted' (zero parts are dropped, 'none ready' when nothing at all is on hand). */
export function availabilityLabel(row) {
  const name = DISHES[row.dish]?.name || row.dish;
  const bits = [];
  if (row.ready) bits.push(`${row.ready} ready`);
  if (row.cooking) bits.push(`${row.cooking} cooking`);
  if (row.held) bits.push(`${row.held} in hand`);
  if (!bits.length) bits.push('none ready');
  bits.push(`${row.demand} wanted`);
  if (row.blocked) bits.push('no free slot');
  return `${name}: ${bits.join(', ')}`;
}

/** Where tapping a dish chip takes you: a ready slot to take from, else a free slot to cook in, else null. */
export function bestTarget(state, dishId) {
  const kind = DISHES[dishId]?.station;
  if (!kind) return null;
  const ids = (state?.cfg?.stations || []).filter((id) => STATIONS[id]?.kind === kind);
  for (const id of ids) {
    const i = (state.stations?.[id]?.slots || []).findIndex((s) => s.st === 'ready' && s.dish === dishId);
    if (i >= 0) return { mode: 'take', station: id, slot: i };
  }
  for (const id of ids) {
    const i = (state.stations?.[id]?.slots || []).findIndex((s) => s.st === 'empty');
    if (i >= 0) return { mode: 'cook', station: id, slot: i, dish: dishId };
  }
  return null;
}

/** Stock alerts: dishes whose ready count just dropped to 0 (with nothing held or cooking) while customers still want them. */
export function runOutAlerts(prev, next) {
  if (!prev || !next) return [];
  const before = new Map(prev.map((r) => [r.dish, r]));
  return next
    .filter((r) => {
      const b = before.get(r.dish);
      return b && b.ready > 0 && r.ready === 0 && r.demand > 0;
    })
    .map((r) => ({
      dish: r.dish,
      text: `${DISHES[r.dish]?.name || r.dish}: none ready, ${r.demand} wanted${r.cooking ? `, ${r.cooking} cooking` : ''}`,
    }));
}

// ---- what a tap or key does ---------------------------------------------------------------------------------------------------
/** Pick target of a slot, in the shape the scene's setHighlight/project/pick all understand (both `id` and `station` are given). */
export const slotTarget = (station, slot) => ({ kind: 'slot', id: station, station, slot });
export const stationTarget = (station) => ({ kind: 'station', id: station, station });
export const customerTarget = (id) => ({ kind: 'customer', id });
export const BIN_TARGET = { kind: 'bin' };

export function targetKey(t) {
  if (!t) return '';
  if (t.kind === 'slot') return `slot:${t.station ?? t.id}:${t.slot}`;
  if (t.kind === 'station') return `station:${t.station ?? t.id}`;
  if (t.kind === 'customer') return `customer:${t.id}`;
  return t.kind;
}

/**
 * What acting on a world target does. Returns one of
 *   { type:'sheet', station, slot }                 open the action sheet on an empty slot
 *   { type:'dispatch', action }                     an engine action, to be run through the action runner (walk, then work)
 *   { type:'hint', text }                           a client-side message (nothing is sent)
 *   null                                            nothing to do
 */
export function decideAction(state, target, { meId, selectedHand = 0 } = {}) {
  if (!state || !target) return null;
  const hands = state.players?.[meId]?.hands || [];
  if (target.kind === 'slot') return decideSlot(state, target.station ?? target.id, target.slot, hands);
  if (target.kind === 'station') {
    const id = target.station ?? target.id;
    const slots = state.stations?.[id]?.slots || [];
    const ready = slots.findIndex((s) => s.st === 'ready');
    if (ready >= 0 && hands.length < HANDS_MAX) return decideSlot(state, id, ready, hands);
    const burnt = slots.findIndex((s) => s.st === 'burnt');
    const empty = slots.findIndex((s) => s.st === 'empty');
    // Clear smoking pans before cooking more: with the keyboard (Space at the station) this is the only way to reach a burnt slot.
    if (burnt >= 0) return decideSlot(state, id, burnt, hands);
    if (empty >= 0) return decideSlot(state, id, empty, hands);
    if (ready >= 0) return decideSlot(state, id, ready, hands);
    return { type: 'hint', text: 'No free slot' };
  }
  if (target.kind === 'customer') {
    const c = (state.customers || []).find((x) => x.id === target.id);
    if (!c) return null;
    if (c.st === 'paying') return { type: 'dispatch', action: { type: 'collect', customer: c.id } };
    if (c.st === 'eating') return { type: 'hint', text: 'Still eating' };
    if (c.st !== 'waiting') return null;
    if (!hands.length) return { type: 'hint', text: needsOf(c).length ? 'Pick up a dish first' : 'All served' };
    const hand = serveHandFor(c, hands, selectedHand);
    if (hand < 0) return { type: 'hint', text: 'They do not need that' };
    return { type: 'dispatch', action: { type: 'serve', customer: c.id, hand } };
  }
  if (target.kind === 'bin') {
    const hand = effectiveHand(hands, selectedHand);
    if (hand < 0) return { type: 'hint', text: 'Nothing to throw away' };
    return { type: 'dispatch', action: { type: 'discard', hand } };
  }
  return null;
}

function decideSlot(state, station, slot, hands) {
  const s = state.stations?.[station]?.slots?.[slot];
  if (!s) return null;
  if (s.st === 'empty') {
    return stationDishes(state, station).length ? { type: 'sheet', station, slot } : { type: 'hint', text: 'Nothing on the menu here' };
  }
  if (s.st === 'cooking') return { type: 'hint', text: 'Still cooking' };
  if (s.st === 'ready') {
    if (hands.length >= HANDS_MAX) return { type: 'hint', text: 'Hands full' };
    return { type: 'dispatch', action: { type: 'take', station, slot }};
  }
  if (s.st === 'burnt') return { type: 'dispatch', action: { type: 'take', station, slot }};
  return null;
}

/** The cook action for a dish chosen in the sheet. */
export const cookAction = (station, slot, dish) => ({ type: 'cook', station, slot, dish });

/** Number keys 1-9 -> the dish at that menu position of the open sheet (or null). */
export function dishForKey(rows, key) {
  const n = /^[1-9]$/.test(String(key)) ? Number(key) : 0;
  return n ? rows[n - 1] || null : null;
}

// ---- tutorial spotlight -> which DOM controls pulse ----------------------------------------------------------------------------
/**
 * The set of DOM keys a tutorial spotlight maps to. Keys used by the components via data-spot:
 *   `station:<id>` (dock group), `slot:<id>:<n>` (dock button), `ticket:<customerId>`, `collect:<customerId>`, `hands`, `bin`.
 * A 'customer' spotlight without an id means the first customer at the stall; a paying customer also pulses their COLLECT button.
 */
export function spotKeys(spotlight, state) {
  const keys = new Set();
  if (!spotlight || !spotlight.kind) return keys;
  const id = spotlight.id ?? spotlight.station;
  if (spotlight.kind === 'station' && id) keys.add(`station:${id}`);
  if (spotlight.kind === 'slot' && id) {
    keys.add(`station:${id}`);
    if (Number.isFinite(spotlight.slot)) keys.add(`slot:${id}:${spotlight.slot}`);
  }
  if (spotlight.kind === 'customer') {
    const c = id !== undefined && id !== null ? (state?.customers || []).find((x) => x.id === id) : activeCustomers(state)[0];
    if (c) {
      keys.add(`ticket:${c.id}`);
      if (c.st === 'paying') keys.add(`collect:${c.id}`);
    }
  }
  if (spotlight.kind === 'hands') keys.add('hands');
  if (spotlight.kind === 'bin') keys.add('bin');
  return keys;
}

// ---- events -> notices ---------------------------------------------------------------------------------------------------------
export const EMOTES = [
  { e: 'thumbs', label: 'Thumbs up', icon: 'thumb' },
  { e: 'fire', label: 'On fire', icon: 'flame' },
  { e: 'help', label: 'Need help', icon: 'help' },
  { e: 'thanks', label: 'Thanks', icon: 'heart' },
];
export const emoteInfo = (e) => EMOTES.find((x) => x.e === e) || null;

const nameOf = (state, id) => (state?.customers || []).find((c) => c.id === id)?.name || 'A customer';
const dishName = (id) => DISHES[id]?.name || 'dish';
const playerName = (state, id, meId) => (id === meId ? 'You' : state?.players?.[id]?.name || 'A teammate');

/**
 * One engine event -> { text, tone:'good'|'bad'|'warn'|'info', icon, toast, pay?, collect? } or null.
 * `toast` false means the notice is only announced to screen readers (ready dishes etc.).
 */
export function eventNotice(ev, state, meId, formatMoney = (n) => `₹${n}`) {
  if (!ev || !ev.type) return null;
  switch (ev.type) {
    case 'pay-ready':
      return { text: `Pay now! ${nameOf(state, ev.customer)} is holding money out`, tone: 'good', icon: 'rupee', toast: true };
    case 'pay-warning':
      return { text: `Collect now! ${nameOf(state, ev.customer)} is about to leave`, tone: 'warn', icon: 'alarm', toast: true, pulse: true };
    case 'collect': {
      const who = ev.by === meId ? '' : `${playerName(state, ev.by, meId)} collected `;
      const tip = ev.tip > 0 ? ` (tip ${formatMoney(ev.tip)})` : '';
      return {
        text: `${who || 'Collected '}${formatMoney(ev.amount)}${tip}`,
        tone: 'good',
        icon: 'rupee',
        toast: false,
        collect: { amount: num(ev.amount), by: ev.by },
      };
    }
    case 'combo':
      return ev.combo >= 2 ? { text: `Combo x${ev.combo}`, tone: 'good', icon: 'flame', toast: true } : null;
    case 'customer-angry':
      return { text: `${nameOf(state, ev.customer)} got fed up and left (-1 heart)`, tone: 'bad', icon: 'heartCrack', toast: true };
    case 'customer-unpaid':
      return { text: `${nameOf(state, ev.customer)} walked out without paying (-1 heart)`, tone: 'bad', icon: 'heartCrack', toast: true };
    case 'customer-turned-away':
      return { text: 'A customer left: no free spot', tone: 'info', icon: 'users', toast: true };
    case 'life-lost':
      return { text: `Heart lost: ${ev.lives} left`, tone: 'bad', icon: 'heartCrack', toast: false };
    case 'burnt':
      return { text: `${dishName(ev.dish)} burnt!`, tone: 'bad', icon: 'smoke', toast: true };
    case 'ready':
      return { text: `${dishName(ev.dish)} is ready`, tone: 'info', icon: 'check', toast: false };
    case 'customer-arrive':
      return { text: `${nameOf(state, ev.customer)} arrived`, tone: 'info', icon: 'users', toast: false };
    case 'emote': {
      const info = emoteInfo(ev.e);
      return info ? { text: `${playerName(state, ev.by, meId)}: ${info.label}`, tone: 'info', icon: info.icon, toast: false, emote: { by: ev.by, e: ev.e } } : null;
    }
    case 'shift-end':
      return { text: ev.status === 'closed' ? 'The centre had to close' : 'Shift over', tone: ev.status === 'closed' ? 'bad' : 'good', icon: 'star', toast: false };
    default:
      return null;
  }
}

/** Customers whose patience crossed below 25% between two states ("Customer waiting too long!"). */
export function patienceWarnings(prev, next) {
  if (!prev || !next || next.cfg?.noPatience) return [];
  const before = new Map((prev.customers || []).map((c) => [c.id, c]));
  return (next.customers || [])
    .filter((c) => {
      const b = before.get(c.id);
      return b && c.st === 'waiting' && b.st === 'waiting' && b.patience / Math.max(1, b.patienceMax) >= 0.25 && c.patience / Math.max(1, c.patienceMax) < 0.25;
    })
    .map((c) => ({ text: `Customer waiting too long! ${c.name}`, tone: 'warn', icon: 'alarm', toast: true, customer: c.id }));
}

/** Teammate changes between two states: joined / left (a player who vanished, or the session marks `online:false`). */
export function playerChanges(prevPlayers, nextPlayers, meId) {
  const out = [];
  const prev = new Map((prevPlayers || []).map((p) => [p.id, p]));
  const next = new Map((nextPlayers || []).map((p) => [p.id, p]));
  for (const [id, p] of prev) {
    if (id === meId) continue;
    const n = next.get(id);
    if (!n || (p.online !== false && n.online === false)) out.push({ type: 'left', id, name: p.name });
  }
  for (const [id, n] of next) {
    if (id === meId) continue;
    const p = prev.get(id);
    if (p && p.online === false && n.online !== false) out.push({ type: 'back', id, name: n.name });
  }
  return out;
}

/** Teammate chip data: everyone but me, with a short summary of what they hold. */
export function teammates(state, players, meId) {
  return (players || [])
    .filter((p) => p.id !== meId)
    .map((p, i) => {
      const live = state?.players?.[p.id];
      const hands = (live?.hands || []).map((h) => dishInfo(h.dish).name);
      return {
        id: p.id,
        name: p.name || live?.name || 'Player',
        avatar: p.avatar ?? live?.avatar ?? null,
        online: p.online !== false,
        hands: live?.hands || [],
        holding: hands.length ? hands.join(' + ') : 'Empty hands',
        at: live?.at ?? null,
        hue: (i * 83 + 28) % 360,
      };
    });
}

/** Reads like "2 hearts left" for the aria label of the hearts row. */
export function heartsLabel(lives) {
  const n = Math.max(0, Math.round(num(lives)));
  return `${n} ${n === 1 ? 'heart' : 'hearts'} left`;
}

// ---- walking along the counter line (keyboard) and the pending-action chip ------------------------------------------------------
/** Every place a person can stand this shift, left to right: stations, the spot behind each customer place, the bin. */
export function walkStops(state) {
  const stops = [];
  for (const id of state?.cfg?.stations || []) if (STATIONS[id]) stops.push({ to: id, x: standX(id), kind: 'station' });
  for (let i = 0; i < num(state?.cfg?.spots); i += 1) stops.push({ to: `spot:${i}`, x: standX(`spot:${i}`), kind: 'spot', spot: i });
  stops.push({ to: 'bin', x: standX('bin'), kind: 'bin' });
  return stops.sort((a, b) => a.x - b.x || (a.kind === 'station' ? -1 : 1));
}

/** The next stop beyond `x` in direction `dir` (-1 | 1), or null at the end of the line. */
export function nextStop(state, x, dir) {
  const stops = walkStops(state);
  const eps = 0.05;
  const list = dir < 0 ? stops.filter((s) => s.x < x - eps).reverse() : stops.filter((s) => s.x > x + eps);
  return list[0] || null;
}

/** The interactive thing a person standing at `x` is facing: their station, the customer at that spot, or the bin. */
export function nearestTarget(state, x, reach = 0.6) {
  let best = null;
  for (const s of walkStops(state)) {
    const d = Math.abs(s.x - x);
    if (d <= reach && (!best || d < best.d)) best = { s, d };
  }
  if (!best) return null;
  const { s } = best;
  if (s.kind === 'station') return stationTarget(s.to);
  if (s.kind === 'bin') return BIN_TARGET;
  const c = activeCustomers(state).find((x2) => x2.spot === s.spot);
  return c ? customerTarget(c.id) : null;
}

/** A queued action is re-checked when the walk ends (hands, slots and customers may have changed meanwhile). null = drop it. */
export function refineAction(action, state, meId, selectedHand = 0) {
  if (!action || !state) return null;
  const me = state.players?.[meId];
  const hands = me?.hands || [];
  if (action.type === 'serve') {
    const c = (state.customers || []).find((x) => x.id === action.customer);
    if (!c || c.st !== 'waiting') return null;
    const want = hands[action.hand] && needsOf(c).includes(hands[action.hand].dish) ? action.hand : serveHandFor(c, hands, selectedHand);
    return want < 0 ? null : { ...action, hand: want };
  }
  if (action.type === 'collect') {
    const c = (state.customers || []).find((x) => x.id === action.customer);
    return c && c.st === 'paying' ? action : null;
  }
  if (action.type === 'cook') {
    const slots = state.stations?.[action.station]?.slots || [];
    if (slots[action.slot]?.st === 'empty') return action;
    const i = slots.findIndex((s) => s.st === 'empty');
    return i < 0 ? null : { ...action, slot: i };
  }
  if (action.type === 'discard') {
    const i = hands[action.hand] ? action.hand : effectiveHand(hands, selectedHand);
    return i < 0 ? null : { ...action, hand: i };
  }
  return action;
}

/** What to call the place a queued action is walking to ("Dosa tawa", "Ravi anna", "the bin"). */
export function placeName(to, state) {
  if (to === 'bin') return 'the bin';
  if (typeof to === 'string' && to.startsWith('spot:')) {
    const spot = Number(to.slice(5));
    return (state?.customers || []).find((c) => c.spot === spot && onStall(c))?.name || 'the counter';
  }
  const kind = STATIONS[to] && STATION_KINDS[STATIONS[to].kind];
  return kind ? kind.name : 'the stall';
}

/** The 'Walking to ...' chip text of a pending action. */
export function pendingLabel(action, to, state) {
  const where = placeName(to, state);
  if (action?.type === 'serve') return `Walking to serve ${where}`;
  if (action?.type === 'collect') return `Walking to collect from ${where}`;
  return `Walking to ${where}`;
}

/** DOM keys (see spotKeys) of the controls a pending action points at, for the dotted path hint. */
export function pendingKeys(action, to) {
  const keys = new Set();
  if (!action) return keys;
  if (action.type === 'cook' || action.type === 'take') {
    keys.add(`station:${action.station}`);
    keys.add(`slot:${action.station}:${action.slot}`);
  }
  if (action.type === 'serve' || action.type === 'collect') {
    keys.add(`ticket:${action.customer}`);
    keys.add(`collect:${action.customer}`);
  }
  if (action.type === 'discard') keys.add('bin');
  if (to && !keys.size) keys.add(to);
  return keys;
}

export { standX, validTarget, walkSeconds, workTarget };
