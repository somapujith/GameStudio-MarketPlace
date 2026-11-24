// Tiffin Centre menus: pure view-models (no React, no DOM). Everything the menu screens show is computed here so it can be unit-tested
// in Node: level map, hour labels, star thresholds, the end-of-shift numbers, briefing, coach marks and status copy.
import {
  DAYPARTS, DISHES, GAME_ID, LEVELS, MAX_LEVEL, PACE, STATIONS, STATION_KINDS, TICK_MS, coopScale, daypartOf, levelDef,
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

/** Star targets in whole rupees for this pace and table size (the engine tests `money >= base * PACE.stars * coopScale`). */
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
  const scored = thresholds.filter((t) => money >= t).length;
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
  const barMax = Math.max(Math.round(thresholds[2] * 1.1), money, 1);
  const nextIdx = hasBar ? thresholds.findIndex((t) => money < t) : -1;
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
    thresholds,
    hasBar,
    bar: { max: barMax, fill: clamp(money / barMax, 0, 1), marks: thresholds.map((t, i) => ({ star: i + 1, value: t, at: clamp(t / barMax, 0, 1), reached: money >= t })) },
    nextStar: nextIdx >= 0 ? { star: nextIdx + 1, target: thresholds[nextIdx], need: thresholds[nextIdx] - money } : null,
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
  };
}

// ---- coach marks -------------------------------------------------------------------------------------------------------------

export const DEFAULT_HINT_MS = 9000;

/** step: { id, text, te?, hint?: string | { text, ms }, hintMs? }. `index` is 0-based. */
export function coachViewModel(step, index = 0, total = 1) {
  const n = Math.max(1, Math.trunc(num(total, 1)));
  const i = clamp(Math.trunc(num(index)), 0, n - 1);
  const s = step && typeof step === 'object' ? step : {};
  const hintObj = s.hint && typeof s.hint === 'object' ? s.hint : null;
  const hint = typeof s.hint === 'string' ? s.hint : hintObj?.text || '';
  const ms = num(hintObj?.ms ?? s.hintMs, DEFAULT_HINT_MS);
  return {
    id: s.id || `step-${i}`,
    text: s.text || '',
    te: s.te || '',
    hint,
    hintMs: Math.max(1500, ms),
    position: `Step ${i + 1} of ${n}`,
    last: i === n - 1,
    dots: Array.from({ length: n }, (_, k) => (k < i ? 'done' : k === i ? 'active' : 'todo')),
  };
}

// ---- status screens ----------------------------------------------------------------------------------------------------------

const STATUS = {
  loading: { tone: 'info', icon: '...', eyebrow: 'Tiffin Centre', title: 'Lighting the stove...', body: 'Heating the tawa, filling the chai pot and setting out the plates.', busy: true, retry: '', exit: 'Back' },
  error: { tone: 'bad', icon: '!', eyebrow: 'Kitchen trouble', title: 'The stove would not light, anna', body: 'Something went wrong while opening the centre. Your progress is safe. Try again in a moment.', busy: false, retry: 'Try again', exit: 'Back to games' },
  disconnected: { tone: 'info', icon: '~', eyebrow: 'Connection lost', title: 'Line cut, miyan! Connection lost', body: 'The table cannot be reached right now. Check your signal and reconnect, your seat is held for a short while.', busy: false, retry: 'Reconnect', exit: 'Leave table' },
  webgl: { tone: 'bad', icon: '3D', eyebrow: 'Not supported here', title: 'This device cannot draw the 3D stall', body: 'Tiffin Centre needs WebGL, and this browser has it switched off or does not support it. Turn on hardware acceleration, update your browser, or open the game on another phone or computer.', busy: false, retry: 'Check again', exit: 'Back to games' },
};
export const STATUS_KINDS = Object.keys(STATUS);
export const statusCopy = (kind) => STATUS[kind] || STATUS.error;

export { GAME_ID };
