// Which board tiles raise a flag for the city event of the round, and what the flag says. Pure; no React.
//
//   eventFlagFor(event, tile) -> { raised, tone, shape, label, emoji, note, line, key } | null
//
//   event   `view.event` ({ id, title, kind, group?, groups?, mult?, amount?, round })
//   tone    'boom'     a rent multiplier above 1 (green flag)
//           'slump'    a multiplier below 1, or money leaving every player (red, drooping flag)
//           'festival' bonuses and celebrations (saffron / gold)
//   shape   'pennant'  a flagpole with a pennant (a collection's districts)
//           'bunting'  a string of festive pennants along the top of a corner tile (a whole-city event)
//   label   what the pennant prints: '×1.5', '+₹20k'; '' on the bunting of a corner that has nothing to add
//   note    plain words for the tile's aria-label ("city event: <note>")
//   line    the same as one sentence for the hover card ("<title>: <what it does>")
//   key     `${id}:${round}`, changes when a new event (or the next round's) arrives: the flag raises again then
//
// Collection events (rush hour, monsoon, biryani boom, wedding season) flag the districts of their collection(s).
// Whole-city events (the festival bonus, or any cash event without a collection) raise bunting on the four corner tiles
// (START, Traffic Jam, Chai Adda, Municipal); START also prints the amount. A whole-city payment (money leaving everyone)
// is a drooping banner on START alone. At most 6 district flags (two collections of three) or 4 corner flags ever show,
// which is what keeps the "flutter" loop of the flags to a handful of elements.
import { GROUPS } from '@shared/board.js';
import { compactINR, formatINR } from '@shared/format.js';
import { cityEventById } from '@shared/events.js';
import { DEFAULT_MAP, activeMapId } from '@shared/maps.js';

/** Same emoji as EventBanner's news strip (a test keeps the two in step). */
export const FLAG_EMOJI = {
  rush_hour: '🚦',
  biryani_boom: '🍛',
  wedding_season: '💍',
  festival: '🪔',
  monsoon: '🌧️',
};
const DEFAULT_EMOJI = '🎉';
// The Andhra map re-words the same events (Sankranti Boom, Tourism Season, Mirchi Market Swing): its own little pictures.
const ANDHRA_EMOJI = { biryani_boom: '🪁', wedding_season: '🏝️', monsoon: '🌶️' };
/** The emoji of a city event on the active map (EventBanner and the flags share it). */
export const eventEmoji = (id) => (activeMapId() !== DEFAULT_MAP && ANDHRA_EMOJI[id]) || FLAG_EMOJI[id] || DEFAULT_EMOJI;

/** The four corner tiles of the ring (the auction tile is an edge tile). */
export const FLAG_CORNERS = Object.freeze(['start', 'traffic', 'chai', 'municipal']);

const NAMES = {
  rush_hour: 'rush hour',
  biryani_boom: 'biryani boom',
  wedding_season: 'wedding season',
  festival: 'festive bonus',
  monsoon: 'monsoon',
};

const mult = (m) => `×${Number(Number(m).toFixed(2))}`;
const signed = (n) => (n > 0 ? `+${compactINR(n)}` : `-${compactINR(Math.abs(n))}`);

// One frozen descriptor per distinct content, so a memoised Tile re-renders only when its own flag really changes.
const INTERNED = new Map();
function intern(d) {
  const k = `${d.key}|${d.tone}|${d.shape}|${d.label}|${d.emoji}|${d.note}|${d.line}`;
  let hit = INTERNED.get(k);
  if (!hit) {
    if (INTERNED.size > 300) INTERNED.clear();
    hit = Object.freeze({ raised: true, ...d });
    INTERNED.set(k, hit);
  }
  return hit;
}

/** Collections an event concerns: the drawn / sent ones, else the event's own fixed ones (biryani boom, wedding season). */
export function eventGroups(event) {
  if (!event) return [];
  const ids = [];
  if (event.group) ids.push(event.group);
  if (Array.isArray(event.groups)) ids.push(...event.groups);
  if (!ids.length) {
    const def = cityEventById(event.id);
    if (def && Array.isArray(def.groups)) ids.push(...def.groups);
  }
  return [...new Set(ids)].filter((g) => GROUPS[g]);
}

/** Stable key of the event instance: a different id or round means a new flag. */
export const eventFlagKey = (event) => (event && event.id ? `${event.id}:${event.round ?? ''}` : null);

export function eventFlagFor(event, tile) {
  if (!event || !event.id || !tile) return null;
  const def = cityEventById(event.id);
  const key = eventFlagKey(event);
  const emoji = eventEmoji(event.id);
  // the default map names an event by its short id word ("biryani boom"); another map by its own title ("sankranti boom")
  const name = activeMapId() === DEFAULT_MAP
    ? NAMES[event.id] || String(event.title || event.id).toLowerCase()
    : String(event.title || NAMES[event.id] || event.id).toLowerCase();
  const title = event.title || def?.title || name;
  const rawMult = event.mult ?? def?.mult;
  const m = rawMult != null ? Number(rawMult) : null;
  const amount = event.amount != null ? Number(event.amount) : null;
  const groups = eventGroups(event);

  // ---- a collection: its districts raise a pennant
  if (groups.length) {
    if (tile.type !== 'property' || !tile.group || !groups.includes(tile.group)) return null;
    if (m != null && Number.isFinite(m) && m !== 1) {
      const up = m > 1;
      const who = event.upgradedOnly ?? def?.upgradedOnly ? 'upgraded businesses' : 'rents';
      const label = mult(m);
      return intern({
        key, tone: up ? 'boom' : 'slump', shape: 'pennant', label, emoji,
        note: `${name}, ${who} ${label} this round`,
        line: `${title}: ${who} ${label} this round`,
      });
    }
    // a cash event with a venue bonus (wedding season): the venues are flagged, everybody pays
    const bonus = Number(def?.bonus) > 0 ? Number(def.bonus) : 0;
    const label = bonus ? signed(bonus) : '';
    const pays = amount != null && amount < 0 ? `every player pays ${formatINR(Math.abs(amount))}; ` : '';
    return intern({
      key, tone: 'festival', shape: 'pennant', label, emoji,
      note: `${name}, ${pays}upgraded venues earn ${formatINR(bonus)}`,
      line: `${title}: ${pays}upgraded venues earn ${formatINR(bonus)}`,
    });
  }

  // a rent event that lost its collection has nothing to point at
  if (event.kind === 'rent' && m != null) return null;

  // ---- the whole city
  if (amount != null && amount < 0) {
    if (tile.type !== 'start') return null;
    const label = signed(amount);
    return intern({
      key, tone: 'slump', shape: 'pennant', label, emoji,
      note: `${name}, every player pays ${formatINR(Math.abs(amount))}`,
      line: `${title}: every player pays ${formatINR(Math.abs(amount))}`,
    });
  }
  if (!FLAG_CORNERS.includes(tile.type)) return null;
  const gift = amount != null && amount > 0 ? amount : 0;
  return intern({
    key, tone: 'festival', shape: 'bunting', label: tile.type === 'start' && gift ? signed(gift) : '', emoji,
    note: gift ? `${name}, every player receives ${formatINR(gift)}` : name,
    line: gift ? `${title}: every player receives ${formatINR(gift)}` : title,
  });
}

// ---- the raise / lower story of one tile's flag (EventFlag.jsx keeps this state per tile) --------------------------
//   state { key, flag, mode: 'none' | 'up' | 'raise' | 'lower', n }
//   first paint with an event already running  -> 'up' (standing, nothing plays: reconnects and snapshots stay quiet)
//   a different event id / round arrives       -> 'raise' (n + 1 replays the animation)
//   the event goes away                        -> 'lower' (the last flag is kept until the lowering has played)

export const flagStart = (flag) => ({ key: flag ? flag.key : null, flag: flag || null, mode: flag ? 'up' : 'none', n: 0 });

export function flagStep(st, flag) {
  const key = flag ? flag.key : null;
  if (st.key !== key) {
    if (flag) return { key, flag, mode: 'raise', n: st.n + 1 };
    return { key: null, flag: st.flag, mode: st.flag ? 'lower' : 'none', n: st.n + 1 };
  }
  if (flag && st.flag !== flag) return { ...st, flag }; // same event and round, only the words changed: no replay
  return st;
}
