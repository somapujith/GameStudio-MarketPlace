// Tiffin Centre menus: pure view-models (no React, no DOM). Everything the menu screens show is computed here so it can be unit-tested
// in Node: level map, hour labels, star thresholds, the end-of-shift numbers, briefing, coach marks and status copy.
import {
  DAYPARTS, DISHES, EVENTS, GAME_ID, GAS, LEVELS, LEVEL_OPS, MAX_LEVEL, PACE, STATIONS, STATION_KINDS, TICK_MS, coopScale, daypartOf, levelDef,
} from '@shared/tiffin-centre/catalog.js';

export const PACE_IDS = ['relaxed', 'normal', 'rush'];
export const PACE_OPTIONS = PACE_IDS.map((id) => ({ value: id, label: PACE[id].label }));
export const paceOf = (id) => (PACE[id] ? id : 'normal');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const rupees = (n) => `₹${Math.round(num(n)).toLocaleString('en-IN')}`;
export { rupees };

// ---- time and sky ----------------------------------------------------------------------------------------------------------

function clock(h) {
  const total = Math.round(num(h) * 60);
  const m = ((total % 60) + 60) % 60;
  const hh = (((Math.floor(total / 60)) % 24) + 24) % 24;
  return { t: `${hh % 12 === 0 ? 12 : hh % 12}:${String(m).padStart(2, '0')}`, suf: hh >= 12 ? 'PM' : 'AM' };
}

/** [6, 9] -> '6:00-9:00 AM'; [11, 13] -> '11:00 AM-1:00 PM'; [6, 24] -> '6:00 AM-12:00 AM'. */
export function hourRange(hours) {
  const [a, b] = Array.isArray(hours) ? hours : [0, 0];
  const A = clock(a);
  const B = clock(b);
  const long = num(b) - num(a) >= 12; // "6:00-12:00 AM" would read as six hours; spell both ends
  return `${A.t}${A.suf === B.suf && !long ? '' : ` ${A.suf}`}-${B.t} ${B.suf}`;
}

/** Ticks (1 tick = TICK_MS) as 'm:ss'. */
export function shiftLength(shiftTicks) {
  const s = Math.round((num(shiftTicks) * TICK_MS) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const FESTIVAL = { id: 'festival', label: 'Festival', te: 'పండుగ' };

/** The sky / group a level belongs to: its day-part by start hour; a level covering most of the day is the Festival. */
export function levelSky(n) {
  const l = LEVELS[n];
  if (!l) return 'morning';
  if (l.hour[1] - l.hour[0] >= 12) return FESTIVAL.id;
  return daypartOf(l.hour[0]);
}

export const SKY_META = {
  morning: { label: DAYPARTS.morning.label, te: DAYPARTS.morning.te },
  noon: { label: DAYPARTS.noon.label, te: DAYPARTS.noon.te },
  evening: { label: DAYPARTS.evening.label, te: DAYPARTS.evening.te },
  night: { label: DAYPARTS.night.label, te: DAYPARTS.night.te },
  festival: { label: FESTIVAL.label, te: FESTIVAL.te },
};
export const SKY_ORDER = ['morning', 'noon', 'evening', 'night', 'festival'];

// ---- progress and the level map --------------------------------------------------------------------------------------------

export const starsOfLevel = (progress, n) => clamp(Math.trunc(num(progress?.best?.[n]?.stars)), 0, 3);

/** Level 1 is always open; level n+1 opens after at least one star on n (progress.unlocked, when present, can only raise it). */
export function unlockedLevelOf(progress) {
  let top = 1;
  for (let n = 1; n < MAX_LEVEL; n += 1) {
    if (starsOfLevel(progress, n) >= 1) top = n + 1;
    else break;
  }
  return clamp(Math.max(top, Math.trunc(num(progress?.unlocked, 1))), 1, MAX_LEVEL);
}

// ---- what a shift brings: the operations layer per level (LEVEL_OPS in the catalogue) ------------------------------------------------------------

const opsOf = (n) => LEVEL_OPS[levelDef(n).id] || LEVEL_OPS[0];
const EVENT_SHORT = { rain: 'Rain', cricket: 'Cricket night', power: 'Power cut', festival: 'Festival rush', inspector: 'Inspector', delivery: 'Delivery boy' };
const EVENT_ICON = { rain: 'rain', cricket: 'cricket', power: 'power', festival: 'festival', inspector: 'inspector', delivery: 'delivery' };

/**
 * The expected events and features of a level, from LEVEL_OPS: [{ id, label, te?, kind: 'event' | 'gas' | 'feature', icon }].
 * Gas and the events come first (they are the surprises); then stock, pan care, the market, requests, regulars and office parcels.
 */
export function levelFeatures(n) {
  const l = levelDef(n);
  const ops = opsOf(l.id);
  const out = [];
  if (ops.gas > 0) out.push({ id: 'gas', label: 'LPG gas', kind: 'gas', icon: 'gas' });
  for (const id of ops.events || []) {
    if (EVENTS[id]) out.push({ id, label: EVENT_SHORT[id] || EVENTS[id].name, te: EVENTS[id].te, kind: 'event', icon: EVENT_ICON[id] || 'event' });
  }
  if (ops.stock > 0) out.push({ id: 'stock', label: 'Stock and prep', kind: 'feature', icon: 'stock' });
  if (ops.heat) out.push({ id: 'heat', label: 'Pan care', kind: 'feature', icon: 'heat' });
  if (ops.market) out.push({ id: 'market', label: 'Market runner', kind: 'feature', icon: 'market' });
  if (ops.requests) out.push({ id: 'requests', label: 'Special requests', kind: 'feature', icon: 'requests' });
  if (ops.regulars > 0) out.push({ id: 'regulars', label: 'Regulars', kind: 'feature', icon: 'regulars' });
  if (ops.big) out.push({ id: 'big', label: 'Office parcels', kind: 'feature', icon: 'big' });
  return out;
}

/** The chips a level card shows: gas and the events (at most `max`), or the stock note on a shift with none; `more` counts the rest. */
export function levelHighlights(n, max = 4) {
  const all = levelFeatures(n);
  const loud = all.filter((f) => f.kind !== 'feature');
  const pool = loud.length ? loud : all.slice(0, 1);
  return { chips: pool.slice(0, max), more: Math.max(0, all.length - Math.min(pool.length, max)), line: all.map((f) => f.label).join(', ') };
}

export function levelCardModel(n, { progress = null, unlockedLevel } = {}) {
  const l = levelDef(n);
  const open = Math.max(1, num(unlockedLevel, unlockedLevelOf(progress)));
  const locked = l.id > open;
  const stars = starsOfLevel(progress, l.id);
  const best = Math.max(0, Math.round(num(progress?.best?.[l.id]?.earned)));
  const sky = levelSky(l.id);
  return {
    level: l.id,
    name: l.name,
    te: l.te,
    sky,
    skyLabel: SKY_META[sky].label,
    hours: hourRange(l.hour),
    menuCount: l.menu.length,
    spots: l.spots,
    length: shiftLength(l.shiftTicks),
    stars,
    best,
    locked,
    current: !locked && stars === 0 && l.id === open,
    lockNote: locked ? `Earn a star on level ${l.id - 1} to open this shift` : '',
    features: levelFeatures(l.id),
    highlights: levelHighlights(l.id),
    label: `Level ${l.id}, ${l.name}, ${hourRange(l.hour)}, ${l.menu.length} dishes, ${locked ? 'locked' : `${stars} of 3 stars`}`,
  };
}

/** Day-part groups of the practice map: [{ id, label, te, hours, cards:[levelCardModel] }]. */
export function levelMapModel({ progress = null, unlockedLevel } = {}) {
  const open = num(unlockedLevel, unlockedLevelOf(progress));
  return SKY_ORDER.map((sky) => {
    const ids = [];
    for (let n = 1; n <= MAX_LEVEL; n += 1) if (levelSky(n) === sky) ids.push(n);
    if (!ids.length) return null;
    const from = Math.min(...ids.map((n) => LEVELS[n].hour[0]));
    const to = Math.max(...ids.map((n) => LEVELS[n].hour[1]));
    return {
      id: sky,
      label: SKY_META[sky].label,
      te: SKY_META[sky].te,
      hours: hourRange([from, to]),
      cards: ids.map((n) => levelCardModel(n, { progress, unlockedLevel: open })),
    };
  }).filter(Boolean);
}

export function totalStars(progress) {
  let s = 0;
  for (let n = 1; n <= MAX_LEVEL; n += 1) s += starsOfLevel(progress, n);
  return s;
}

// ---- end of shift ----------------------------------------------------------------------------------------------------------

/** PROFIT targets in whole rupees for this pace and table size (the engine tests `profit >= base * PACE.stars * coopScale`, profit = cash - costs). */
export function starThresholds(level, pace, players = 1) {
  const l = levelDef(level);
  const k = PACE[paceOf(pace)].stars * coopScale(players);
  return l.stars.map((v) => Math.ceil(Number((v * k).toFixed(6))));
}

const pick = (srcs, keys, d = 0) => {
  for (const s of srcs) {
    if (!s || typeof s !== 'object') continue;
    for (const k of keys) if (Number.isFinite(Number(s[k])) && s[k] !== null && s[k] !== '') return Number(s[k]);
  }
  return d;
};

const HEADLINES = { 1: 'Shift done', 2: 'Great shift!', 3: 'Perfect shift!' };

/**
 * The numbers on the results screen. `result` is the engine result: { winnerId, reason: 'cleared'|'closed'|'tutorial',
 * standings:[{id, rank, score, stats}], stars, money, level, (optional) stats|team: { tips, served, lost, unpaid, combo } }.
 * opts: { players: [{id, name}], mode: 'tutorial'|'practice'|'online' }. Tolerant of missing fields.
 */
export function resultViewModel(result, level, pace, opts = {}) {
  const r = result && typeof result === 'object' ? result : {};
  const lvl = levelDef(Number.isFinite(Number(level)) && level !== null && level !== undefined ? level : r.level);
  const standings = Array.isArray(r.standings) ? r.standings : [];
  const names = new Map((opts.players || []).map((p) => [p.id, p.name]));
  const seats = Math.max(1, standings.length || (opts.players || []).length || 1);
  const paceId = paceOf(pace);
  const thresholds = starThresholds(lvl.id, paceId, seats);

  const money = Math.max(0, Math.round(r.money !== undefined && r.money !== null ? num(r.money) : standings.reduce((a, s) => a + num(s.score), 0)));
  const tutorial = r.reason === 'tutorial' || lvl.id === 0;
  // STARS ARE PROFIT (cash in hand minus what the stall spent): money alone is shown on the galla but is not what the targets compare with
  const bookSrcs = [r, r.team, r.stats];
  const has = (k) => bookSrcs.some((s) => s && typeof s === 'object' && s[k] !== undefined && s[k] !== null && s[k] !== '');
  const cost = Math.max(0, Math.round(pick(bookSrcs, ['cost'], 0)));
  const profit = Math.round(pick(bookSrcs, ['profit'], money - cost));
  const scored = thresholds.filter((t) => profit >= t).length;
  const stars = tutorial ? 0 : clamp(Math.trunc(num(r.stars, scored)), 0, 3);
  const kind = tutorial ? 'tutorial' : r.reason === 'closed' || stars === 0 ? 'closed' : 'cleared';

  const srcs = [r.stats, r.team, r];
  const totals = standings.reduce((a, s) => ({ tips: a.tips + num(s?.stats?.tips), served: a.served + num(s?.stats?.served) }), { tips: 0, served: 0 });
  const stats = {
    tips: pick(srcs, ['tips'], totals.tips),
    served: pick(srcs, ['served'], totals.served),
    lost: pick(srcs, ['lost', 'angry']),
    unpaid: pick(srcs, ['unpaid', 'walkouts']),
    bestCombo: pick(srcs, ['bestCombo', 'maxCombo', 'combo']),
  };

  const topMoney = Math.max(1, ...standings.map((s) => num(s.score)));
  const teamMoney = Math.max(1, standings.reduce((a, s) => a + num(s.score), 0));
  const rows = standings
    .map((s, i) => ({
      id: s.id,
      name: names.get(s.id) || s.name || `Player ${i + 1}`,
      collected: Math.round(num(s.score)),
      served: Math.round(num(s.stats?.served)),
      tips: Math.round(num(s.stats?.tips)),
      share: clamp(num(s.score) / topMoney, 0, 1),
      pct: Math.round((num(s.score) / teamMoney) * 100),
      mvp: false,
    }))
    .sort((a, b) => b.collected - a.collected);
  const coop = rows.length > 1;
  const mvpId = coop && kind === 'cleared' ? (rows.some((x) => x.id === r.winnerId) ? r.winnerId : rows[0]?.id) : null;
  rows.forEach((x) => { x.mvp = x.id === mvpId && x.collected > 0; });

  const hasBar = !tutorial && thresholds[2] > 0;
  const barMax = Math.max(Math.round(thresholds[2] * 1.1), profit, 1);
  const nextIdx = hasBar ? thresholds.findIndex((t) => profit < t) : -1;
  const books = {
    show: !tutorial && (has('cost') || has('profit') || has('revenue')),
    revenue: Math.round(pick(bookSrcs, ['revenue'], money - stats.tips)),
    tips: stats.tips,
    cost,
    waste: Math.round(pick(bookSrcs, ['waste'], 0)),
    fines: Math.round(pick(bookSrcs, ['fines'], 0)),
    carry: Math.round(pick(bookSrcs, ['carry'], 0)),
    profit,
    cash: money,
  };
  const opsStats = {
    show: !tutorial && ['prepped', 'tended', 'gasSwaps', 'bought'].some(has),
    prepped: Math.round(pick(bookSrcs, ['prepped'], 0)),
    tended: Math.round(pick(bookSrcs, ['tended'], 0)),
    gasSwaps: Math.round(pick(bookSrcs, ['gasSwaps'], 0)),
    bought: Math.round(pick(bookSrcs, ['bought'], 0)),
  };
  const next = kind === 'tutorial' ? (MAX_LEVEL >= 1 ? 1 : null) : kind === 'cleared' && lvl.id < MAX_LEVEL ? lvl.id + 1 : null;

  return {
    kind,
    level: lvl.id,
    levelName: lvl.name,
    levelTe: lvl.te,
    pace: paceId,
    paceLabel: PACE[paceId].label,
    stars,
    maxStars: 3,
    headline: kind === 'tutorial' ? 'Tutorial complete!' : kind === 'closed' ? 'Closed for the day' : HEADLINES[stars] || HEADLINES[1],
    sub: kind === 'tutorial'
      ? 'Co-op with friends unlocked'
      : kind === 'closed'
        ? 'Too many customers walked away. Open the shutters and try again.'
        : `${lvl.name} cleared with ${stars} ${stars === 1 ? 'star' : 'stars'}`,
    money,
    profit,
    cost,
    books,
    ops: opsStats,
    thresholds,
    hasBar,
    bar: { max: barMax, fill: clamp(profit / barMax, 0, 1), marks: thresholds.map((t, i) => ({ star: i + 1, value: t, at: clamp(t / barMax, 0, 1), reached: profit >= t })) },
    nextStar: nextIdx >= 0 ? { star: nextIdx + 1, target: thresholds[nextIdx], need: thresholds[nextIdx] - profit } : null,
    stats,
    coop,
    rows,
    mvp: rows.find((x) => x.mvp) || null,
    nextLevel: next,
    nextLevelName: next ? LEVELS[next].name : '',
    unlockedCoop: kind === 'tutorial',
  };
}

// ---- briefing ---------------------------------------------------------------------------------------------------------------

const TIPS = {
  1: 'Take a dosa the moment it is ready. Left a few seconds too long, it burns.',
  2: 'The idly steamer holds four. Start a batch before the queue builds.',
  3: 'Carry two dishes at once: two hands, one trip to the counter.',
  4: 'Money out means act now. A customer who is not collected walks away without paying.',
  5: 'Two tawas: keep one for plain dosas and one for the fancy ones.',
  6: 'Office-goers have little patience but tip well. Serve them first.',
  7: 'Chai is quick and forgiving. Fill the gaps between fry batches with it.',
  8: 'Bajji burns fast. Never start more than you can serve.',
  9: 'Sunset crowd: keep your combo alive by collecting every payment.',
  10: 'Night shift is all tawa. Rotate your slots so nothing sits ready too long.',
  11: 'Late crowd, thin patience. Serve what is ready, then start the next batch.',
  12: 'A whole festival day. Pace yourself: the evening rush is the big one.',
};
export const tipOfLevel = (n) => TIPS[levelDef(n).id] || 'Serve fast, collect faster, and keep the stove clean.';

const stationLabel = (id, prevIds) => {
  const st = STATIONS[id];
  const kind = STATION_KINDS[st?.kind];
  if (!kind) return { id, name: id, te: '' };
  const sameBefore = prevIds.some((p) => STATIONS[p]?.kind === st.kind);
  return { id, name: sameBefore ? `Second ${kind.name.toLowerCase()}` : kind.name, te: kind.te };
};

const MECH = {
  stock: { title: 'Stock and prep', text: 'Batter, chutney and sambar run out. Make more at the prep counter behind you (P) before the shelf is empty.' },
  heat: { title: 'Pan care', text: 'Pans go cold and gunky. Wipe the tawa, skim the kadai and top up the steamer (T), or dosas stick and tear.' },
  gas: { title: 'LPG cylinder', text: `The gas runs down while you cook. Swap the cylinder before it is empty (₹${GAS.swapCost}, burners off for ${GAS.swapTicks}s).` },
  market: { title: 'Market runner', text: 'Short of something? Buy it from the market: instant, but 40% dearer than making it.' },
  requests: { title: 'Special requests', text: 'Parcels, extra chutney or sambar, less or more spice: a happy customer tips more.' },
  regulars: { title: 'Regulars', text: 'Regular customers come back. Serve them well and they tip more every visit.' },
  big: { title: 'Office parcel orders', text: 'Now and then an office orders a big batch of parcels: a long deadline and a big tip.' },
  rain: { title: 'Rain', text: 'Fewer people, but chai, bajji and vada sell.' },
  cricket: { title: 'Cricket night', text: 'Students and autowalas arrive in bursts.' },
  power: { title: 'Power cut', text: 'No steamer and no grinder for a while. The gas burners carry on.' },
  festival: { title: 'Festival rush', text: 'A bigger crowd and bigger tips.' },
  inspector: { title: 'Food-safety inspector', text: 'The GHMC inspector comes round: clear burnt dishes and wipe the tawas, or pay a fine and lose a heart.' },
  delivery: { title: 'Delivery boy', text: 'The tiffin delivery boy wants five parcels in a hurry, for a tip.' },
};
const hasFeature = (ops, id) => (id === 'stock' ? ops.stock > 0 : id === 'heat' ? !!ops.heat : id === 'gas' ? ops.gas > 0 : id === 'market' ? !!ops.market : id === 'requests' ? !!ops.requests : id === 'regulars' ? ops.regulars > 0 : id === 'big' ? !!ops.big : (ops.events || []).includes(id));
const MECH_ORDER = ['stock', 'heat', 'gas', 'market', 'requests', 'regulars', 'big', 'rain', 'cricket', 'power', 'festival', 'inspector', 'delivery'];

/** The mechanics a shift introduces for the first time (not seen in any earlier level): [{ id, title, text }]. */
export function mechanicsIntroduced(n) {
  const id = levelDef(n).id;
  if (id < 1) return [];
  const here = opsOf(id);
  return MECH_ORDER.filter((m) => hasFeature(here, m) && !Array.from({ length: id - 1 }, (_, i) => opsOf(i + 1)).some((o) => hasFeature(o, m))).map((m) => ({ id: m, ...MECH[m] }));
}

export function briefingModel(level, pace) {
  const l = levelDef(level);
  const prev = l.id > 0 ? LEVELS[l.id - 1] : null;
  const prevMenu = new Set(prev?.menu || l.menu);
  const prevStations = prev?.stations || l.stations;
  const paceId = paceOf(pace);
  const sky = levelSky(l.id);
  const menu = l.menu.map((id) => {
    const d = DISHES[id];
    return { id, name: d?.name || id, te: d?.te || '', station: d?.station || '', price: d?.price || 0, isNew: !prevMenu.has(id) };
  });
  const stations = l.stations.map((id) => ({ ...stationLabel(id, l.stations.filter((x) => x !== id && l.stations.indexOf(x) < l.stations.indexOf(id))), isNew: !prevStations.includes(id) }));
  return {
    level: l.id,
    name: l.name,
    te: l.te,
    sky,
    skyLabel: SKY_META[sky].label,
    skyTe: SKY_META[sky].te,
    hours: hourRange(l.hour),
    length: shiftLength(l.shiftTicks),
    paceId,
    paceLabel: PACE[paceId].label,
    menu,
    stations,
    newDishes: menu.filter((m) => m.isNew).length,
    newStations: stations.filter((s) => s.isNew).length,
    tip: tipOfLevel(l.id),
    mechanics: mechanicsIntroduced(l.id), // first met today
    features: levelFeatures(l.id), // everything to expect today
  };
}

// ---- coach marks -------------------------------------------------------------------------------------------------------------

export const DEFAULT_HINT_MS = 9000;

/** One chapter of the tutorial strip: string | { id, label|name|title, te? } -> { id, label, te }. */
const chapterItem = (c, i) => (typeof c === 'string' ? { id: c, label: c, te: '' } : { id: c?.id ?? String(i), label: String(c?.label ?? c?.name ?? c?.title ?? c?.id ?? ''), te: c?.te || '' });

/**
 * The chapter strip (Look, Tokens, Tawa, Idly, Kadai, Chai, Serve and collect, Game flow, Rush): every chapter with a state
 * ('done' | 'active' | 'todo'). `chapter` is the current one as an index, an id / label, or { id | index }. [] when the driver has none.
 */
export function chapterStrip(chapters, chapter) {
  const list = Array.isArray(chapters) ? chapters.map(chapterItem) : [];
  if (!list.length) return { items: [], index: -1, label: '', count: 0 };
  let cur = -1;
  if (typeof chapter === 'number' && Number.isFinite(chapter)) cur = Math.trunc(chapter);
  else if (typeof chapter === 'string') cur = list.findIndex((c) => c.id === chapter || c.label === chapter);
  else if (chapter && typeof chapter === 'object') {
    cur = Number.isFinite(chapter.index) ? Math.trunc(chapter.index) : list.findIndex((c) => c.id === chapter.id || c.label === chapter.label);
  }
  cur = cur >= list.length ? list.length - 1 : cur;
  return {
    items: list.map((c, k) => ({ ...c, state: cur < 0 ? 'todo' : k < cur ? 'done' : k === cur ? 'active' : 'todo' })),
    index: cur,
    label: cur >= 0 ? list[cur].label : '',
    count: list.length,
  };
}

const pickText = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? String(v.text || '') : '');

/** Controls line: string | string[] | { touch, keyboard } -> the right one for this device. */
export function controlsLine(controls, touch) {
  if (!controls) return '';
  if (typeof controls === 'string') return controls;
  if (Array.isArray(controls)) return controls.filter(Boolean).join('  ·  ');
  if (typeof controls === 'object') return controlsLine(touch ? controls.touch ?? controls.keyboard ?? controls.kb : controls.keyboard ?? controls.kb ?? controls.touch, touch);
  return '';
}

/**
 * Where the coach bar sits, as the numbers the HUD sheets inset themselves by (CSS variables on the game root): `bar` and `host` are
 * rects ({ top, height }). A bar in the lower half is "bottom" (its height plus 4 px is kept clear above the HUD's bottom bands), else "top"
 * (the same under the HUD's top bands). A sheet inside the HUD can then never lie under the bar, nor the bar over a sheet's tappable rows.
 */
export function coachInsets(bar, host) {
  const none = { bottomOn: 0, bottomH: 0, topOn: 0, topH: 0, subsH: 0 };
  if (!bar || !host || !(bar.height > 0)) return none;
  const h = Math.ceil(bar.height + 4);
  const atBottom = bar.top + bar.height / 2 > host.top + host.height / 2;
  return atBottom ? { ...none, bottomOn: 1, bottomH: h, subsH: h } : { ...none, topOn: 1, topH: h };
}

/** First sentence of a line, for the one-line coach bar. */
export function firstSentence(text, max = 110) {
  const t = String(text || '').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  const one = m ? m[1] : t;
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/**
 * step: { id, say?, text, textTouch?, te?, hint?: string | { text, ms }, hintTouch?, hintMs?, controls?, recipe? (a dish id), chapter? }. `index` is 0-based.
 * extra: { touch (a coarse pointer: use the textTouch / hintTouch wording), chapters, chapter, steps? (the driver's steps, for the count inside a chapter) }.
 */
export function coachViewModel(step, index = 0, total = 1, extra = {}) {
  const n = Math.max(1, Math.trunc(num(total, 1)));
  const i = clamp(Math.trunc(num(index)), 0, n - 1);
  const s = step && typeof step === 'object' ? step : {};
  const touch = !!extra.touch;
  const hintObj = s.hint && typeof s.hint === 'object' ? s.hint : null;
  const hintBase = pickText(s.hint);
  const hint = touch && s.hintTouch ? pickText(s.hintTouch) : hintBase;
  const text = touch && s.textTouch ? pickText(s.textTouch) : pickText(s.text);
  const ms = num(hintObj?.ms ?? s.hintMs, DEFAULT_HINT_MS);
  const chapter = chapterStrip(extra.chapters ?? s.chapters, extra.chapter ?? s.chapter);
  const recipe = typeof s.recipe === 'string' ? s.recipe : s.recipe?.dish || (typeof extra.recipe === 'string' ? extra.recipe : '') || '';
  let inChapter = null;
  const co = extra.chapter ?? s.chapter;
  if (co && typeof co === 'object' && Number.isFinite(co.count) && Number.isFinite(co.step)) {
    inChapter = { at: Math.min(co.count, co.step + 1), of: co.count }; // the driver's own { step, count } inside the chapter
  } else if (Array.isArray(extra.steps) && chapter.index >= 0) {
    const key = chapter.items[chapter.index].id;
    const same = extra.steps.map((x, k) => ({ k, c: x?.chapter })).filter((x) => x.c === key || x.c === chapter.items[chapter.index].label);
    const at = same.findIndex((x) => x.k === i);
    if (same.length && at >= 0) inChapter = { at: at + 1, of: same.length };
  }
  return {
    id: s.id || `step-${i}`,
    say: s.say || '',
    text,
    line: firstSentence(s.say || text),
    te: s.te || '',
    hint,
    hintMs: Math.max(1500, ms),
    controls: controlsLine(s.controls ?? extra.controls, touch),
    recipe,
    chapters: chapter,
    chapterStep: inChapter,
    position: `Step ${i + 1} of ${n}`,
    last: i === n - 1,
    ack: !!s.ack,
    dots: Array.from({ length: n }, (_, k) => (k < i ? 'done' : k === i ? 'active' : 'todo')),
    progress: n > 1 ? i / (n - 1) : 1,
  };
}

/**
 * The coach step of a session's `tutorial` object (or of a bare driver): reads each field from the object, then from its `step`, so it
 * works with the wrapper in session/localSession.js and with a driver passed straight in. A driver's per-pointer variants
 * (textFor / hintFor / controlsFor) become the text / textTouch, hint / hintTouch and controls { keyboard, touch } of the step.
 */
export function coachStepFromTutorial(t) {
  if (!t || typeof t !== 'object') return null;
  const st = t.step && typeof t.step === 'object' ? t.step : {};
  const get = (k) => (t[k] !== undefined ? t[k] : st[k]);
  const per = (fn, kb, touch) => (typeof t[fn] === 'function' ? { kb: t[fn]('keyboard'), touch: t[fn]('touch') } : { kb, touch });
  const text = per('textFor', get('text'), get('textTouch'));
  const hint = per('hintFor', get('hint'), get('hintTouch'));
  const controls = typeof t.controlsFor === 'function' ? { keyboard: t.controlsFor('keyboard'), touch: t.controlsFor('touch') } : get('controls');
  const dish = get('recipe');
  return {
    id: st.id ?? get('id'),
    say: get('say') || '',
    text: text.kb || '',
    textTouch: text.touch || '',
    te: get('te') || '',
    hint: hint.kb || '',
    hintTouch: hint.touch || '',
    controls,
    recipe: dish && typeof dish === 'object' ? dish.dish : dish,
    chapter: get('chapter'),
    chapters: get('chapters'),
    ack: !!(t.ackable ?? st.ack),
  };
}

// ---- saved shift (auto-save) -----------------------------------------------------------------------------------------------------

/** '3 min ago' style text for a timestamp (ms since the epoch); 'just now' under 45 s, 'a while ago' for a missing or future time. */
export function savedAgo(savedAt, now = Date.now()) {
  const t = Number(savedAt);
  if (!Number.isFinite(t) || t <= 0 || t > now + 60000) return 'a while ago';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

/**
 * The Resume card of the start screen. `saved` is describeSavedShift(snapshot): { title, level, pace, tick, shiftTicks, money, savedAt }
 * (null / missing = no card). A level 0 save is the tutorial: "Continue tutorial". Tolerant of missing fields.
 */
export function resumeViewModel(saved, now = Date.now()) {
  if (!saved || typeof saved !== 'object') return null;
  const level = Math.max(0, Math.trunc(num(saved.level)));
  const tutorial = level === 0 || saved.mode === 'tutorial';
  const total = Math.max(1, Math.trunc(num(saved.shiftTicks, 1)));
  const tick = clamp(Math.trunc(num(saved.tick)), 0, total);
  // a tutorial's clock is frozen: how far it got is its step (saved as step / steps), only an older save falls back to game time
  const steps = tutorial ? Math.trunc(num(saved.steps)) : 0;
  const step = steps > 0 ? clamp(Math.trunc(num(saved.step, 1)), 1, steps) : 0;
  const pct = steps > 0 ? Math.round(((step - 1) / steps) * 100) : Math.round((tick / total) * 100);
  const def = levelDef(level);
  const title = String(saved.title || def.name);
  const money = Math.max(0, Math.round(num(saved.money)));
  const ago = savedAgo(saved.savedAt, now);
  return {
    tutorial,
    level,
    title,
    te: def.te,
    paceLabel: PACE[paceOf(saved.pace)].label,
    pct,
    left: steps > 0 ? '' : shiftLength(total - tick),
    detail: steps > 0 ? `step ${step} of ${steps}` : `${shiftLength(total - tick)} left`,
    money,
    ago,
    heading: tutorial ? 'Continue tutorial' : 'Resume your shift',
    resume: tutorial ? 'Continue tutorial' : 'Resume',
    label: `${tutorial ? 'Tutorial' : `Level ${level}, ${title}`}, ${pct} percent done, saved ${ago}${tutorial ? '' : `, takings ${rupees(money)}`}`,
    confirm: tutorial ? 'Start the tutorial again from the beginning?' : 'Throw away this saved shift and start fresh?',
  };
}

// ---- status screens ----------------------------------------------------------------------------------------------------------

const STATUS = {
  loading: { tone: 'info', icon: '...', eyebrow: 'Tiffin Centre', title: 'Lighting the stove...', body: 'Heating the tawa, filling the chai pot and setting out the plates.', busy: true, retry: '', exit: 'Back' },
  error: { tone: 'bad', icon: '!', glyph: 'alert', eyebrow: 'Kitchen trouble', title: 'The stove would not light, anna', body: 'Something went wrong while opening the centre. Your progress is safe. Try again in a moment.', busy: false, retry: 'Try again', exit: 'Back to games' },
  disconnected: { tone: 'info', icon: '~', glyph: 'offline', eyebrow: 'Connection lost', title: 'Line cut, miyan! Connection lost', body: 'The table cannot be reached right now. Check your signal and reconnect, your seat is held for a short while.', busy: false, retry: 'Reconnect', exit: 'Leave table' },
  webgl: { tone: 'bad', icon: '3D', glyph: 'cube', eyebrow: 'Not supported here', title: 'This device cannot draw the 3D stall', body: 'Tiffin Centre needs WebGL, and this browser has it switched off or does not support it. Turn on hardware acceleration, update your browser, or open the game on another phone or computer.', busy: false, retry: 'Check again', exit: 'Back to games' },
};
export const STATUS_KINDS = Object.keys(STATUS);
export const statusCopy = (kind) => STATUS[kind] || STATUS.error;

export { GAME_ID };
