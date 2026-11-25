// Tiffin Centre HUD: the OPERATIONS layer as pure view-models (docs/TIFFIN_CENTRE_PLAN.md section 3b): ingredient stock groups, the LPG gauge,
// pan tending, the prep counter, the market, the sold-out board, the events banner and the chit badges. No React, no DOM: tested in opsLogic.test.js.
// Every function is defensive (optional chaining, safe fallbacks) and returns null / [] while the layer is off: level 0 (the tutorial) has none of it.
import { DISHES, FERMENT, HEAT, INGREDIENTS, MARKET_MARKUP, MARKET_MAX, PREP_STATION, STATIONS, STATION_KINDS, STOCK_CAP } from '@shared/tiffin-centre/catalog.js';
import { flawName, gasInfo, shortOf, stockInfo, tendInfo } from '@shared/tiffin-centre/ops.js';
import { eventsNow, isDown } from '@shared/tiffin-centre/events.js';
import { standX } from '@shared/tiffin-centre/movement.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const safe = (fn, d) => {
  try {
    const v = fn();
    return v === undefined ? d : v;
  } catch {
    return d;
  }
};

export { PREP_STATION, MARKET_MAX };

// ---- which parts of the layer are on --------------------------------------------------------------------------------------------------
/** Stock + the prep counter exist (levels 1..12). */
export const opsOn = (s) => !!s && !s.cfg?.tutorial && !!s.cfg?.stock && !!s.stock;
export const gasOnLevel = (s) => !!s && !s.cfg?.tutorial && !!s.cfg?.gas && !!s.gas;
export const heatOnLevel = (s) => !!s && !s.cfg?.tutorial && !!s.cfg?.heat;
export const marketOn = (s) => opsOn(s) && !!s.cfg?.market;

/** Is there anything of the operations layer to show? (false in the tutorial and in a hand-built state with none of it) */
export const hasOps = (s) => opsOn(s) || gasOnLevel(s) || heatOnLevel(s) || (Array.isArray(s?.events) && s.events.length > 0 && !s?.cfg?.tutorial);

// ---- stock groups ---------------------------------------------------------------------------------------------------------------------
export const STOCK_BAR_FULL = 20; // portions that fill a bar

/** The ingredient groups of the status strip (the order of the chalk board). An item no group lists gets a group of its own. */
export const STOCK_GROUPS = [
  { id: 'batter', label: 'Batter', te: 'పిండి', items: ['batter_dosa', 'batter_idly', 'batter_pesarattu', 'vada_batter', 'besan_batter'] },
  { id: 'chutney', label: 'Chutney', te: 'చట్నీ', items: ['coconut_chutney'] },
  { id: 'sambar', label: 'Sambar', te: 'సాంబార్', items: ['sambar'] },
  { id: 'masala', label: 'Masala', te: 'మసాలా', items: ['potato_masala', 'podi_ghee'] },
  { id: 'dough', label: 'Dough', te: 'పూరీ పిండి', items: ['poori_dough'] },
  { id: 'chillies', label: 'Chillies', te: 'మిర్చి', items: ['mirchi'] },
  { id: 'oil', label: 'Oil', te: 'నూనె', items: ['oil'] },
  { id: 'drinks', label: 'Tea / coffee', te: 'టీ కాఫీ', items: ['tea_decoction_milk', 'coffee_decoction'] },
  { id: 'biscuits', label: 'Biscuits', te: 'బిస్కెట్లు', items: ['biscuits'] },
];

/** One-word names for a bar or a prep slot face. */
export const SHORT = {
  batter_dosa: 'Dosa', batter_idly: 'Idly', batter_pesarattu: 'Pesarattu', vada_batter: 'Vada', besan_batter: 'Besan', potato_masala: 'Aloo', coconut_chutney: 'Chutney',
  sambar: 'Sambar', podi_ghee: 'Podi', poori_dough: 'Dough', mirchi: 'Mirchi', tea_decoction_milk: 'Chai', coffee_decoction: 'Coffee', biscuits: 'Biscuit', oil: 'Oil',
};
export const shortName = (item) => SHORT[item] || INGREDIENTS[item]?.name || String(item || '?');

const TONE_RANK = { ok: 0, low: 1, sour: 2, out: 3 };

/** "3", "2.5", "0.25": portions as the shelf counts them (quarters). */
export function fmtPortions(n) {
  return String(Math.round(num(n) * 100) / 100);
}

/** Batter freshness band: 'fresh' | 'turning' (about to sour) | 'sour' (dishes drop to OK). null for items that do not ferment. */
export function freshBand(fresh) {
  if (fresh === null || fresh === undefined || !Number.isFinite(Number(fresh))) return null;
  const f = Number(fresh);
  return f < FERMENT.sour ? 'sour' : f < FERMENT.sour + 20 ? 'turning' : 'fresh';
}

/** Every ingredient of the shelf as a row: stockInfo + a tone ('out' | 'sour' | 'low' | 'ok'), the bar fill and short names. [] when the layer is off. */
export function stockRows(state) {
  if (!opsOn(state)) return [];
  return safe(() => stockInfo(state), []).map((it) => {
    const tone = it.out ? 'out' : it.sour ? 'sour' : it.low ? 'low' : 'ok';
    return {
      ...it,
      short: shortName(it.item),
      tone,
      frac: clamp(num(it.n) / STOCK_BAR_FULL, 0, 1),
      text: fmtPortions(it.n),
      band: freshBand(it.fresh),
    };
  });
}

function makeGroup(def, rows) {
  const worst = rows.reduce((a, b) => (TONE_RANK[b.tone] > TONE_RANK[a.tone] || (TONE_RANK[b.tone] === TONE_RANK[a.tone] && b.n < a.n) ? b : a));
  // freshness of the row the bar shows; a sour batter anywhere in the group always shows ("Sour!"), even when another one is out
  const sourRow = rows.find((r) => r.sour && r.fresh !== null && r.fresh !== undefined);
  const worstFresh = sourRow ? sourRow.fresh : worst.fresh !== null && worst.fresh !== undefined ? worst.fresh : null;
  const pending = rows.reduce((n, r) => n + num(r.pending), 0);
  const detail = rows
    .map((r) => `${r.name} ${r.text}${r.fresh !== null && r.fresh !== undefined ? `, ${Math.round(r.fresh)} percent fresh` : ''}${r.sour ? ', sour' : ''}${r.out ? ', out' : r.low ? ', low' : ''}${r.pending ? `, ${r.pending} being made` : ''}`)
    .join('; ');
  return {
    id: def.id,
    label: def.label,
    te: def.te,
    rows,
    worst,
    item: worst.item, // the ingredient a tap pre-selects in the prep sheet
    n: worst.n,
    text: worst.text,
    frac: worst.frac,
    tone: worst.tone,
    fresh: worstFresh,
    band: freshBand(worstFresh),
    count: rows.length,
    pending,
    short: rows.length > 1 ? `${def.label}: ${worst.short}` : def.label,
    ariaLabel: `${def.label}: ${detail}`,
  };
}

/** The stock bars of the status strip, grouped (batter, chutney, sambar, masala, dough, oil, tea / coffee, biscuits). [] when the layer is off. */
export function stockGroups(state) {
  const rows = stockRows(state);
  if (!rows.length) return [];
  const byItem = new Map(rows.map((r) => [r.item, r]));
  const used = new Set();
  const out = [];
  for (const def of STOCK_GROUPS) {
    const rs = def.items.map((i) => byItem.get(i)).filter(Boolean);
    rs.forEach((r) => used.add(r.item));
    if (rs.length) out.push(makeGroup(def, rs));
  }
  for (const r of rows) if (!used.has(r.item)) out.push(makeGroup({ id: r.item, label: r.name, te: r.te || '' }, [r]));
  return out;
}

// ---- LPG gas ---------------------------------------------------------------------------------------------------------------------------
/**
 * { frac, pct, tone: 'ok'|'low'|'out'|'swap', swapping, swapLeft, swapFrac (0..1 of the 6-tick swap), cost, canSwap, reason (why Swap is off or null), label, aria } or null.
 */
export function gasView(state) {
  if (!gasOnLevel(state)) return null;
  const g = safe(() => gasInfo(state), null);
  if (!g) return null;
  const swapFrac = g.swapping ? clamp(1 - g.swapLeft / Math.max(1, g.swapTicks), 0, 1) : 0;
  const tone = g.swapping ? 'swap' : g.out ? 'out' : g.low ? 'low' : 'ok';
  const pct = Math.round(g.frac * 100);
  const reason = g.swapping ? 'Already changing the cylinder' : !g.canSwap ? 'The cylinder is still heavy' : null;
  const label = g.swapping ? `Changing ${g.swapLeft}s` : g.out ? 'No gas' : g.low ? `Low ${pct}%` : `${pct}%`;
  return {
    frac: g.frac,
    pct,
    units: g.units,
    tone,
    swapping: g.swapping,
    swapLeft: g.swapLeft,
    swapTicks: g.swapTicks,
    swapFrac,
    swapDone: g.swapping ? Math.max(0, g.swapTicks - g.swapLeft) : 0,
    cost: g.swapCost,
    canSwap: g.canSwap,
    reason,
    label,
    aria: `LPG cylinder: ${g.swapping ? `being changed, ${g.swapLeft} seconds left` : g.out ? 'empty, burners are cold' : `${pct} percent${g.low ? ', running low' : ''}`}. ${g.canSwap ? `Swap it for ₹${g.swapCost}` : reason}`,
  };
}

// ---- tending ---------------------------------------------------------------------------------------------------------------------------
/**
 * The gauge of one pan / steamer for the Tend button, or null (nothing to tend: tutorial, level 1, a chai counter):
 * { id, kind: 'heat'|'water', band, need, pulse (need > 0.6), canTend, verb, text, tone: 'ok'|'warn'|'crit', gauge:{at, lo, hi}, gunk, stuck, torn, reason, aria }.
 */
export function tendView(state, id) {
  if (!heatOnLevel(state)) return null;
  const t = safe(() => tendInfo(state, id), null);
  if (!t) return null;
  const st = state.stations?.[id] || {};
  const gunk = clamp(num(st.gunk), 0, 100);
  const water = t.kind === 'water';
  const verb = water ? 'Top up' : STATIONS[id]?.kind === 'kadai' ? 'Skim' : 'Wipe';
  let text;
  let tone = 'ok';
  if (water) {
    if (num(t.value) <= 0) { text = 'Dry!'; tone = 'crit'; } else if (t.band === 'dry') { text = 'Low water'; tone = 'warn'; } else text = `Water ${Math.round(num(t.value))}%`;
  } else if (t.torn) { text = 'Needs wiping now'; tone = 'crit'; } else if (t.stuck) { text = 'Needs wiping'; tone = 'warn'; } else if (t.band === 'cold') { text = 'Cold pan'; tone = 'warn'; } else if (t.band === 'hot') { text = 'Too hot'; tone = 'warn'; } else if (t.canTend) text = 'Getting gunky';
  else text = 'Clean';
  const reason = t.canTend ? null : 'Already clean';
  const name = STATION_KINDS[STATIONS[id]?.kind]?.name || 'Pan';
  return {
    id,
    kind: t.kind,
    band: t.band,
    need: t.need,
    pulse: t.need > 0.6,
    canTend: t.canTend,
    verb,
    text,
    tone,
    gauge: water ? { at: clamp(num(t.value) / 100, 0, 1), lo: HEAT.waterDry / 100, hi: 1 } : { at: clamp(num(t.value) / 100, 0, 1), lo: HEAT.cold / 100, hi: HEAT.hot / 100 },
    gunk: gunk / 100,
    stuck: t.stuck,
    torn: t.torn,
    reason,
    aria: `${name}: ${text}. ${t.canTend ? `Press to ${verb.toLowerCase()} (T)` : 'Already clean'}`,
  };
}

/** The station the T key tends: the nearest pan that needs it to the cook's x, else the nearest pan (the engine then says "Already clean"). null: nothing to tend. */
export function tendHotkeyTarget(state, x = 0) {
  if (!heatOnLevel(state)) return null;
  const ids = (state.cfg?.stations || []).filter((id) => tendView(state, id));
  if (!ids.length) return null;
  const by = (list) => list.slice().sort((a, b) => Math.abs(standX(a) - x) - Math.abs(standX(b) - x))[0];
  const needy = ids.filter((id) => tendView(state, id)?.canTend);
  return by(needy.length ? needy : ids);
}

/** What a tap on a cooking slot may add when the pan needs tending: a hint tail (or ''). */
export function tendHint(state, id) {
  const t = tendView(state, id);
  return t && t.pulse ? ` The pan needs tending: press T.` : '';
}

// ---- the prep counter ------------------------------------------------------------------------------------------------------------------
const needsOfItem = (item) => INGREDIENTS[item]?.prep?.needs || null;

/** Why a prep job on this item would not run right now: { reason, hard } (hard = refused; soft = it starts but waits) or null. */
export function prepBlock(state, item) {
  if (!opsOn(state)) return { reason: 'Nothing to prepare today', hard: true };
  const def = INGREDIENTS[item];
  const st = state.stations?.[PREP_STATION];
  if (!def || !st || !Object.hasOwn(state.stock, item)) return { reason: 'Not needed today', hard: true };
  if (!st.slots.some((sl) => sl.st === 'empty')) return { reason: 'Slot busy', hard: true };
  let pending = 0;
  for (const sl of st.slots) if (sl.st !== 'empty' && sl.item === item) pending += def.prep.yield;
  if (num(state.stock[item]) + pending + def.prep.yield > STOCK_CAP) return { reason: 'Shelf full', hard: true };
  const needs = needsOfItem(item);
  if (needs === 'power' && safe(() => isDown(state, 'grinder'), false)) return { reason: 'Power cut', hard: false };
  if (needs === 'gas' && state.cfg?.gas && !(state.gas && state.gas.u > 0 && state.gas.sw === 0)) return { reason: state.gas?.sw > 0 ? 'Changing cylinder' : 'No gas', hard: false };
  return null;
}

/** Why a running job is paused (null = running). */
export function slotPaused(state, sl) {
  if (!sl || sl.st !== 'cooking') return null;
  const needs = needsOfItem(sl.item);
  if (needs === 'power' && safe(() => isDown(state, 'grinder'), false)) return 'Power cut';
  if (needs === 'gas' && state.cfg?.gas && !(state.gas && state.gas.u > 0 && state.gas.sw === 0)) return state.gas?.sw > 0 ? 'Changing cylinder' : 'No gas';
  return null;
}

/**
 * The prep sheet: { slots:[{ idx, st, item, name, te, short, yield, progress, secs, paused, ready }], free (index of the first empty job slot or -1),
 * items:[{ ...stockRow, how, ticks, yield, cost (a batch), needs, block, blockText, disabled }], market, power, gas } or null when the layer is off.
 */
export function prepView(state) {
  if (!opsOn(state)) return null;
  const st = state.stations?.[PREP_STATION];
  if (!st) return null;
  const tick = num(state.tick);
  const slots = (st.slots || []).map((sl, idx) => {
    const def = sl.item ? INGREDIENTS[sl.item] : null;
    const span = Math.max(1, num(sl.readyAt) - num(sl.t0));
    return {
      idx,
      st: sl.st,
      item: sl.item || null,
      name: def?.name || '',
      te: def?.te || '',
      short: sl.item ? shortName(sl.item) : '',
      yield: def?.prep?.yield || 0,
      progress: sl.st === 'cooking' ? clamp((tick - num(sl.t0)) / span, 0, 1) : sl.st === 'ready' ? 1 : 0,
      secs: sl.st === 'cooking' ? Math.max(0, num(sl.readyAt) - tick) : 0,
      paused: slotPaused(state, sl),
      ready: sl.st === 'ready',
    };
  });
  const items = stockRows(state).map((r) => {
    const def = INGREDIENTS[r.item];
    const block = prepBlock(state, r.item);
    return {
      ...r,
      how: def.prep.how,
      ticks: def.prep.ticks,
      yield: def.prep.yield,
      cost: def.prep.yield * def.cost,
      needs: def.prep.needs,
      block,
      blockText: block ? block.reason : '',
      disabled: !!block?.hard,
    };
  });
  return {
    slots,
    free: slots.findIndex((s) => s.st === 'empty'),
    ready: slots.filter((s) => s.ready).length,
    items,
    market: marketOn(state),
    power: !safe(() => isDown(state, 'grinder'), false),
    gas: !state.cfg?.gas || !!(state.gas && state.gas.u > 0 && state.gas.sw === 0),
  };
}

// ---- the market runner -----------------------------------------------------------------------------------------------------------------
export const BUY_SIZES = [1, 5, 10];

/** Rupees a `buy` of n portions costs (40% dearer than making it). */
export const buyPrice = (item, n) => (INGREDIENTS[item] ? Math.ceil(n * INGREDIENTS[item].cost * MARKET_MARKUP) : 0);

/** Why `buy {item, n}` would be refused (null = fine). */
export function buyBlock(state, item, n) {
  if (!marketOn(state)) return 'Nobody to send to the market';
  if (!INGREDIENTS[item] || !Object.hasOwn(state.stock, item)) return 'Not needed today';
  if (!Number.isInteger(n) || n < 1 || n > MARKET_MAX) return `Buy 1 to ${MARKET_MAX}`;
  let pending = 0;
  for (const sl of state.stations?.[PREP_STATION]?.slots || []) if (sl.st !== 'empty' && sl.item === item) pending += INGREDIENTS[item].prep.yield;
  if (num(state.stock[item]) + pending + n > STOCK_CAP) return 'Shelf full';
  return null;
}

// ---- the sold-out board ------------------------------------------------------------------------------------------------------------------
/** The dishes taken off the board (nobody will order them). */
export const boardOff = (state) => new Set(Array.isArray(state?.off) ? state.off : []);

/** The first ingredient a dish is short of: { item, name } or null (null too when the layer is off). */
export function dishShort(state, dish) {
  if (!opsOn(state) || !DISHES[dish]) return null;
  const item = safe(() => shortOf(state, dish), null);
  return item ? { item, name: INGREDIENTS[item]?.name || item } : null;
}

/** The board panel: every dish on the menu with its switch, price, and what it is short of. `suggest` = on the board but cannot be made. */
export function boardView(state) {
  if (!state || state.cfg?.tutorial) return null;
  const off = boardOff(state);
  const rows = (state.cfg?.menu || []).filter((d) => DISHES[d]).map((d) => {
    const short = dishShort(state, d);
    return { dish: d, name: DISHES[d].name, te: DISHES[d].te, price: DISHES[d].price, on: !off.has(d), short, suggest: !off.has(d) && !!short };
  });
  return { rows, offCount: rows.filter((r) => !r.on).length, suggestCount: rows.filter((r) => r.suggest).length };
}

/** The board map the chalk-board chips read: dish -> { on, short, suggest }. Empty when the layer is off. */
export function boardMap(state) {
  const v = opsOn(state) ? boardView(state) : null;
  return new Map((v?.rows || []).map((r) => [r.dish, r]));
}

// ---- events banner ------------------------------------------------------------------------------------------------------------------------
const EVENT_LOOK = {
  rain: { icon: 'rain', tone: 'info', note: 'Fewer people. Chai, bajji and vada sell.' },
  cricket: { icon: 'flame', tone: 'info', note: 'The crowd comes in bursts. Students and autowalas.' },
  power: { icon: 'bolt', tone: 'warn', note: 'No steamer, no grinder. Gas burners carry on.' },
  festival: { icon: 'star', tone: 'good', note: 'More people, bigger tips.' },
  inspector: { icon: 'clip', tone: 'warn', note: 'Clear burnt dishes and wipe the tawas.' },
  delivery: { icon: 'truck', tone: 'good', note: 'Five parcels in a hurry. Big tip.' },
};

/** The running events for the banner: [{ id, name, te, left, secs, icon, tone, note, headline, waiting }]. */
export function eventBanner(state) {
  if (!state || state.cfg?.tutorial) return [];
  const waiting = new Set((Array.isArray(state.events) ? state.events : []).filter((e) => e && e.w).map((e) => e.id));
  return safe(() => eventsNow(state), []).map((e) => {
    const look = EVENT_LOOK[e.id] || { icon: 'info', tone: 'info', note: '' };
    const inspector = e.id === 'inspector';
    const wait = waiting.has(e.id);
    return {
      id: e.id,
      name: e.name,
      te: e.te,
      left: e.left,
      secs: e.left,
      icon: look.icon,
      tone: look.tone,
      note: look.note,
      waiting: wait,
      headline: inspector ? `Inspector in ${e.left}s` : wait ? `${e.name}: waiting for a free spot` : `${e.name} ${e.left}s`,
    };
  });
}

// ---- chits ---------------------------------------------------------------------------------------------------------------------------------
const EXTRA_WORD = { coconut_chutney: 'chutney', sambar: 'sambar' };

/**
 * The little badges on a chit: parcel bag, extra chutney / sambar, spice less / more, REGULAR (star + loyalty), BIG OFFICE ORDER and DELIVERY BOY with a timer.
 * [{ id, icon, label, title, tone, secs?, pips? }]. Only the customers that have the field; [] otherwise.
 */
export function chitBadges(c, state, frac = 0) {
  if (!c || typeof c !== 'object') return [];
  const out = [];
  const secs = c.st === 'waiting' && !state?.cfg?.noPatience ? Math.max(0, Math.ceil(num(c.patience) - clamp(frac, 0, 1) - 1e-6)) : null;
  if (c.delivery) out.push({ id: 'delivery', icon: 'truck', label: 'DELIVERY BOY', title: 'Tiffin delivery boy: parcels in a hurry', tone: 'good', secs });
  if (c.big) out.push({ id: 'big', icon: 'building', label: 'BIG OFFICE ORDER', title: 'Office parcel order: long deadline, big tip', tone: 'good', secs });
  if (c.parcel) out.push({ id: 'parcel', icon: 'bag', label: 'Parcel', title: 'Takeaway: packed in a bag (₹5 a dish)', tone: 'info' });
  if (c.extra) out.push({ id: 'extra', icon: 'plus', label: `Extra ${EXTRA_WORD[c.extra] || INGREDIENTS[c.extra]?.name?.toLowerCase() || 'side'}`, title: `Wants extra ${EXTRA_WORD[c.extra] || 'side'} with it`, tone: 'info' });
  if (c.spice === 'less' || c.spice === 'more') out.push({ id: 'spice', icon: 'chilli', label: c.spice === 'less' ? 'Spice less' : 'Spice more', title: c.spice === 'less' ? 'Please go easy on the spice' : 'Make it spicy', tone: 'info' });
  if (c.regular) {
    const loyal = clamp(Math.trunc(num(c.loyal)), 0, 3);
    out.push({ id: 'regular', icon: 'star', label: 'REGULAR', title: `Regular customer: loyalty ${loyal} of 3. Serve them well and they tip more`, tone: 'good', pips: loyal });
  }
  return out;
}

/** The flaw of a slot ('stuck' | 'torn' | 'sour' | null) from the engine's bit mask. */
export const slotFlaw = (sl) => (sl && sl.fl ? flawName(sl.fl) : null);

export const FLAW_TEXT = {
  stuck: { label: 'Stuck', warn: 'stuck to the pan: it will come out only OK', tone: 'warn' },
  torn: { label: 'Torn', warn: 'torn: it will sell at half price', tone: 'crit' },
  sour: { label: 'Sour', warn: 'made with sour batter: it will come out only OK', tone: 'warn' },
};


