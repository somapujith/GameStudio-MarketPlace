// Tiffin Centre dialogue: the director. It watches the engine state and the events of each action and decides WHO says
// WHICH line WHEN, so customers talk like people at a stall without drowning the player.
//
//   const d = createDialogueDirector({ lang: 'auto', seed: 'abc', subtitles: 'both' });
//   const spoken = d.update(state, events);   // call after every applyAction (events = that action's events) and after every tick
//   spoken -> [{ id, customer, lineId, lang, text, rom, en, mood, sit, ttlMs, at, final? }]
//
// Rules (all enforced here and asserted in director.test.js):
//  - deterministic: every choice is a hash of (seed, customer id, line pool, tick), never Math.random or a clock;
//    the same seed and the same game give the same speech, however often update() is called.
//  - each customer gets ONE language for the shift ('auto': te 45 / hi 25 / dk 30 with biases by kind and by form of address;
//    'mixed' keeps that as the home language but switches voice per utterance), and never repeats a line.
//  - a customer speaks at most once every MIN_GAP ticks; at most MAX_ACTIVE utterances are on screen at once
//    (an utterance is active for ceil(ttlMs / TICK_MS) ticks); a priority queue decides who gets the slot:
//    anger and payment > serving > ordering and hurrying > patient waiting, eating talk > chatter.
//  - update() never throws and tolerates any input (it just returns []).
//
// The operations layer (docs/TIFFIN_CENTRE_PLAN.md section 3b) adds, all deterministic and rate limited:
//  - WORLD lines, said by whoever is at the stall (chosen by hash from the customers who are free to speak, owed for a few ticks
//    when nobody is): event-start / event-end of rain, power, cricket, festival and the inspector, the inspector's verdict,
//    stock-out, gas-out and the cylinder swap, and a little ambient talk while rain, a power cut, a cricket night, a festival
//    or an empty cylinder lasts. Each ambient situation has its own cooldown (AMBIENT) and never repeats a line within 3 uses.
//  - REQUEST lines from the customer flags (parcel, extra, spice, big, delivery, regular + rid, loyal), spoken right after the order.
//  - COMPLAINT lines on serve (broken dish, sour batter) and thanks for very fast service.
//  - sold-out: the customer reacts when told a dish is finished (takes another, skips it, or leaves politely).
//  - a regular keeps one language across visits (hash of the seed and `rid`) and never repeats a line across visits;
//    the delivery boy speaks Hindi or Dakhni (10 / 45 / 45).
import { TICK_MS, daypartOf, DISHES, FERMENT } from '../catalog.js';
import { LINES_TE } from './lines.te.js';
import { LINES_HI } from './lines.hi.js';
import { LINES_DK } from './lines.dk.js';
import { dishName } from './dishNames.js';
import { LANGS } from './lineKit.js';

export const MIN_GAP = 3; // ticks between two lines of the same customer
export const MAX_ACTIVE = 2; // utterances on screen at once
export const LANG_MODES = ['auto', 'te', 'hi', 'dk', 'mixed'];
export const SUBTITLE_MODES = ['native', 'roman', 'english', 'both'];

const BASE_WEIGHTS = { te: 45, hi: 25, dk: 30 };
const DELIVERY_WEIGHTS = { te: 10, hi: 45, dk: 45 }; // the delivery boy is mostly a Hindi / Dakhni speaker
const KIND_WEIGHTS = {
  techie: { te: 35, hi: 55, dk: 10 },
  office: { te: 40, hi: 45, dk: 15 },
  autowala: { te: 15, hi: 15, dk: 70 },
  uncle: { te: 50, hi: 5, dk: 45 },
  student: { te: 40, hi: 30, dk: 30 },
  family: { te: 50, hi: 20, dk: 30 },
};

// Lower number = more urgent.
const PRIO = {
  'angry-leave': 0, 'unpaid-leave': 0, 'waiting-angry': 0, 'pay-ready': 0, 'pay-hurry': 0, 'pay-change-keep': 0, 'pay-haggle': 0, apology: 0,
  'elder-blessing': 0, 'regular-loyal': 0,
  'serve-thanks': 1, 'serve-praise': 1, 'serve-complain': 1,
  'sold-out-polite': 1, 'broken-dish-complaint': 1, 'sour-batter-complaint': 1, 'thanks-fast-service': 1,
  'inspector-arrival': 1, 'inspector-pass': 1, 'inspector-fail': 1,
  greet: 2, 'regular-greet': 2, order: 2, 'order-multi': 2, 'waiting-hurry': 2,
  'regular-named': 2, 'big-office-order': 2, 'delivery-boy-hurry': 2, 'parcel-request': 2, 'extra-request-chutney': 2, 'extra-request-sambar': 2,
  'spice-request-less': 2, 'spice-request-more': 2, 'rain-start': 2, 'power-cut': 2,
  'waiting-polite': 3, 'eating-compliment': 3, 'eating-chat': 3, 'turned-away': 3, 'combo-praise': 3,
  'rain-ongoing': 3, 'rain-end': 3, 'power-back': 3, 'cricket-night': 3, 'festival-greeting': 3, 'stock-out-apology': 3, 'gas-out-chatter': 3,
};

/** Ambient talk while something lasts: [situation, event id, chance per tick, cooldown in ticks between two lines of that situation]. */
const AMBIENT = [
  ['rain-ongoing', 'rain', 0.28, 7],
  ['power-cut', 'power', 0.22, 9],
  ['cricket-night', 'cricket', 0.34, 6],
  ['festival-greeting', 'festival', 0.2, 8],
];
const GAS_CHATTER = { p: 0.25, cd: 8 };
const STOCK_OUT_CD = 20; // ticks between two stock-out consolations
const THANKS_FAST_CD = 10; // ticks between two 'thanks for the quick service' lines
/** Situations that are checked again when the line is about to be spoken (two were queued before either was said). */
const BUILD_CD = { 'thanks-fast-service': THANKS_FAST_CD, 'stock-out-apology': STOCK_OUT_CD };
/** Situations that avoid repeating any of their last RECENT_N lines, whoever says them (a crowd would otherwise echo itself). */
const RECENT_SITS = new Set(['rain-start', 'rain-ongoing', 'rain-end', 'power-cut', 'power-back', 'cricket-night', 'festival-greeting', 'inspector-arrival', 'inspector-pass',
  'inspector-fail', 'stock-out-apology', 'gas-out-chatter', 'sold-out-polite', 'delivery-boy-hurry']);
const RECENT_N = 3;
/** Tagged pools that never fall back to lines of another tag. */
const STRICT_TAG_SITS = new Set(['sold-out-polite', 'regular-named']);
/** Greeting sits that may fall back to a plain greeting when their own pool is used up. */
const GREET_FALLBACK = ['regular-greet', 'greet'];
const prioOf = (sit) => (Object.prototype.hasOwnProperty.call(PRIO, sit) ? PRIO[sit] : 4);

// ---------------------------------------------------------------------------------------------------------------------
// the line index

const BY = { te: {}, hi: {}, dk: {} };
for (const lines of [LINES_TE, LINES_HI, LINES_DK]) {
  for (const l of lines) (BY[l.lang][l.sit] || (BY[l.lang][l.sit] = [])).push(l);
}

/** All lines of a language and situation (read-only). */
export const linesFor = (lang, sit) => (BY[lang] && BY[lang][sit]) || [];

// ---------------------------------------------------------------------------------------------------------------------
// pure helpers

function hash32(...parts) {
  const s = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
const unit = (...parts) => hash32(...parts) / 4294967296;

/** items: [[value, weight], ...]; r in [0,1). */
function pickWeighted(items, r) {
  let total = 0;
  for (const it of items) total += it[1];
  if (!(total > 0)) return items.length ? items[0][0] : null;
  let x = r * total;
  for (const it of items) {
    x -= it[1];
    if (x < 0) return it[0];
  }
  return items[items.length - 1][0];
}

/** Language weights of a customer: by kind, nudged by the way people address them (garu/anna/akka lean Telugu; bhai/miyan/aapa lean Dakhni). */
function weightsFor(kind, name) {
  const w = { ...(KIND_WEIGHTS[kind] || BASE_WEIGHTS) };
  const n = typeof name === 'string' ? name.toLowerCase() : '';
  if (/\b(garu|anna|akka)\b/.test(n)) w.te *= 1.6;
  if (/\b(bhai|miyan|aapa|bi)\b/.test(n)) w.dk *= 1.8;
  return w;
}
const pickLang = (w, r) => pickWeighted(LANGS.map((l) => [l, w[l]]), r);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function needsOf(c) {
  const out = Array.isArray(c.order) ? c.order.slice() : [];
  for (const d of Array.isArray(c.got) ? c.got : []) {
    const i = out.indexOf(d);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}

const bandOf = (frac) => (frac <= 0.15 ? 3 : frac <= 0.35 ? 2 : frac <= 0.6 ? 1 : 0);
const WAIT_SIT = ['', 'waiting-polite', 'waiting-hurry', 'waiting-angry'];
const WAIT_EXPIRE = [0, 4, 3, 3];

/** Idle talk by kind (situation, weight). */
function chatterTable(kind, regular, festival) {
  const t = [['eating-chat', 5]];
  if (kind === 'office' || kind === 'techie') t.push(['phone-call', 4]);
  if (kind === 'student') t.push(['student-broke', 4]);
  if (kind === 'family') t.push(['kid-demand', 4]);
  if (kind === 'autowala') t.push(['autowala-chat', 4]);
  if (kind === 'uncle') t.push(['elder-blessing', 3]);
  if (regular) t.push(['regular-greet', 2]);
  if (festival) t.push(['festival', 4]);
  return t;
}

// ---------------------------------------------------------------------------------------------------------------------
// text helpers (also exported)

/** Fill {dish} {dish2} {n}. `names` = { dish, dish2, n }; a dish is a dishNames entry { text, rom, en } (or a plain string), n a number. */
export function fillTemplate(line, names = {}) {
  const src = line && typeof line === 'object' ? line : {};
  const nm = names && typeof names === 'object' ? names : {};
  const val = (x, field) => (x === undefined || x === null ? '' : typeof x === 'object' ? String(x[field] ?? '') : String(x));
  const sub = (s, field) => {
    const tpl = String(s ?? '');
    let out = tpl
      .replace(/\{(dish2|dish|n)\}/g, (_, k) => val(nm[k], field))
      .replace(/ {2,}/g, ' ')
      .trim();
    if (field === 'en') out = out.replace(/\b([Aa]) (?=[aeiouAEIOU])/g, '$1n '); // "a idly" -> "an idly"
    // a sentence that starts with the dish name keeps its capital ("Idli bhi, ..."), for Roman and English text
    if (field !== 'text' && tpl.startsWith('{')) out = out.charAt(0).toUpperCase() + out.slice(1);
    return out;
  };
  return { text: sub(src.text, 'text'), rom: sub(src.rom, 'rom'), en: sub(src.en, 'en') };
}

/** What to print for an utterance: 'native' (script), 'roman', 'english', 'both' (script, newline, English meaning). */
export function formatSubtitle(utterance, mode = 'native') {
  const u = utterance && typeof utterance === 'object' ? utterance : null;
  if (!u) return '';
  const text = String(u.text ?? '');
  const rom = String(u.rom ?? '');
  const en = String(u.en ?? '');
  switch (mode) {
    case 'roman': return rom || text;
    case 'english': return en || text;
    case 'both': return en && en !== text ? `${text}\n${en}` : text;
    default: return text;
  }
}

/** Reading time of a line: about a second plus 85 ms per character, at most 5.5 s. */
export const ttlFor = (text) => Math.min(5500, Math.round(1100 + 85 * String(text || '').length));

// ---------------------------------------------------------------------------------------------------------------------

export function createDialogueDirector({ lang = 'auto', seed = 1, subtitles = 'native' } = {}) {
  const mode = LANG_MODES.includes(lang) ? lang : 'auto';
  const S = String(seed === undefined || seed === null ? 1 : seed);
  let subMode = SUBTITLE_MODES.includes(subtitles) ? subtitles : 'native';

  let mem; // customer id -> memory
  let queue; // pending items
  let activeEnds; // tick at which each shown utterance stops being "active"
  let uSeq; // utterance counter
  let iSeq; // queue insertion counter
  let lastTick;
  let lastSeed;
  let lastDaypart;
  let dpOwed;
  let dpSince;
  let owed; // world lines still to be said: [{ sit, from, until, count, gap, next, tries, id }]
  let sitLast; // situation -> tick of its last utterance (world situations only)
  let recent; // situation -> last RECENT_N line ids (RECENT_SITS only)
  let regUsed; // rid -> the lines a regular has already said, across visits
  let cur; // the state being processed
  let oSeq;

  function reset() {
    mem = new Map();
    queue = [];
    activeEnds = [];
    uSeq = 0;
    iSeq = 0;
    lastTick = -1;
    lastSeed = undefined;
    lastDaypart = null;
    dpOwed = null;
    dpSince = 0;
    owed = [];
    sitLast = {};
    recent = {};
    regUsed = new Map();
    cur = null;
    oSeq = 0;
  }
  reset();

  const langFor = (id, kind, name) => (mode === 'auto' || mode === 'mixed' ? pickLang(weightsFor(kind, name), unit(S, 'lang', id)) : mode);
  const isReal = (c) => c.regular === true && isNum(c.rid);
  /** A regular keeps their language across visits (hash of the seed and `rid`); the delivery boy is Hindi / Dakhni; everybody else: hash of the id. */
  const homeLang = (c) => {
    if (mode !== 'auto' && mode !== 'mixed') return mode;
    const w = c.delivery ? DELIVERY_WEIGHTS : weightsFor(c.kind, c.name);
    return pickLang(w, unit(S, 'lang', isReal(c) ? `rid${c.rid}` : c.id));
  };

  function memOf(c, tick) {
    let m = mem.get(c.id);
    if (!m || (isNum(c.arrivedAt) && m.arrivedAt !== c.arrivedAt)) {
      const real = isReal(c);
      let used = new Set();
      if (real) {
        if (!regUsed.has(c.rid)) regUsed.set(c.rid, used);
        used = regUsed.get(c.rid);
      }
      // where the game has real regulars (state.regs) the random "looks like a regular" chatter is off
      const hasRegs = !!cur && Array.isArray(cur.regs) && cur.regs.length > 0;
      m = {
        id: c.id, kind: c.kind, name: c.name, arrivedAt: isNum(c.arrivedAt) ? c.arrivedAt : null,
        lang: homeLang(c), weights: c.delivery ? DELIVERY_WEIGHTS : weightsFor(c.kind, c.name), used, last: -99, band: 0, frac: 1, arrived: false, ordered: false,
        regular: real || (!hasRegs && unit(S, 'regular', c.id) < 0.22), real, delivery: !!c.delivery, gotExtra: false, reqDone: false, seen: tick,
      };
      mem.set(c.id, m);
    }
    m.seen = tick;
    return m;
  }

  function ghostMem(id, tick) {
    let m = mem.get(id);
    if (!m) {
      m = {
        id, kind: null, name: '', arrivedAt: null, lang: langFor(id, null, ''), weights: weightsFor(null, ''), used: new Set(), last: -99, band: 0, frac: 1,
        arrived: true, ordered: true, regular: false, real: false, delivery: false, gotExtra: false, reqDone: true, seen: tick,
      };
      mem.set(id, m);
    }
    return m;
  }

  function add(item) {
    item.seq = iSeq++;
    if (item.key) queue = queue.filter((q) => !(q.cid === item.cid && q.key === item.key));
    queue.push(item);
  }
  const dropFor = (cid) => { queue = queue.filter((q) => q.cid !== cid); };
  const pendingFor = (cid) => queue.some((q) => q.cid === cid);

  // ---- triggers --------------------------------------------------------------------------------------------------

  const eventOn = (id) => !!cur && Array.isArray(cur.events) && cur.events.some((e) => e && e.id === id);
  const reqKind = (x) => (typeof x === 'string' && x.includes('sambar') ? 'sambar' : typeof x === 'string' && x.includes('chutney') ? 'chutney' : null);

  function onArrive(c, m, tick, level) {
    if (m.arrived) return;
    m.arrived = true;
    const dishes = Array.isArray(c.order) ? c.order : [];
    const distinct = dishes.filter((d, i) => dishes.indexOf(d) === i);
    const big = c.big === true;
    const delivery = c.delivery === true;
    const festival = level === 12;
    // the opening line: the special customers announce themselves, everybody else may greet (and the weather and the match colour the greeting)
    let greetSit = null;
    let greetCtx = {};
    let greetFall = null;
    if (delivery) {
      greetSit = 'delivery-boy-hurry'; greetCtx = { dish: distinct[0], n: dishes.length };
    } else if (big) {
      greetSit = 'big-office-order'; greetCtx = { dish: distinct[0], dish2: distinct[1], n: dishes.length };
    } else if (m.real && unit(S, 'greet', c.id) < 0.92) {
      greetSit = 'regular-named'; greetCtx = { dish: distinct[0], tag: (c.loyal | 0) >= 2 ? 'high' : 'low' }; greetFall = GREET_FALLBACK;
    } else if (!m.real && unit(S, 'greet', c.id) < 0.78) {
      const r = unit(S, 'weather', c.id);
      if (m.regular) greetSit = 'regular-greet';
      else if (eventOn('rain') && r < 0.4) { greetSit = 'rain-ongoing'; greetFall = ['greet']; }
      else if (eventOn('cricket') && r < 0.35) { greetSit = 'cricket-night'; greetFall = ['greet']; }
      else if (eventOn('power') && r < 0.35) { greetSit = 'power-cut'; greetFall = ['greet']; }
      else if (eventOn('festival') && r < 0.35) { greetSit = 'festival-greeting'; greetFall = ['greet']; }
      else greetSit = festival && unit(S, 'fest', c.id) < 0.3 ? 'festival' : 'greet';
    }
    if (greetSit) {
      add({ cid: c.id, key: 'greet', sit: greetSit, prio: prioOf(greetSit), born: tick, expire: tick + 3, need: 'waiting', ctx: greetCtx, fall: greetFall });
    }
    const ctx = { dish: distinct[0] };
    let sit = 'order';
    if (distinct.length >= 2) { sit = 'order-multi'; ctx.dish2 = distinct[1]; } else if (dishes.length > 1) { ctx.n = dishes.length; ctx.requireN = true; }
    add({ cid: c.id, key: 'order', sit, prio: prioOf(sit), born: tick, expire: tick + 9, need: 'waiting', ctx, after: greetSit ? 'greet' : null });
    queueRequests(c, m, tick, distinct);
  }

  /** Special requests of a customer (parcel, extra chutney / sambar, spice), said one after another right after the order. Once per customer. */
  function queueRequests(c, m, tick, distinct) {
    if (m.reqDone) return;
    m.reqDone = true;
    const ctx = { dish: distinct[0] };
    const list = [];
    if (c.parcel && !c.big && !c.delivery) list.push(['parcel-request', ctx]);
    const ex = reqKind(c.extra);
    if (ex) list.push([`extra-request-${ex}`, {}]);
    if (c.spice === 'less' || c.spice === 'more') list.push([`spice-request-${c.spice}`, ctx]);
    let prev = 'order';
    list.forEach(([sit, cx], i) => {
      const key = `req${i + 1}`;
      add({ cid: c.id, key, sit, prio: prioOf(sit), born: tick, expire: tick + 14, need: 'waiting', ctx: cx, after: prev });
      prev = key;
    });
  }

  /** Is the batter of a dish sour right now (below FERMENT.sour on the shelf)? */
  function sourFor(dish) {
    const fresh = cur && cur.fresh && typeof cur.fresh === 'object' ? cur.fresh : null;
    const d = typeof dish === 'string' && Object.prototype.hasOwnProperty.call(DISHES, dish) ? DISHES[dish] : null;
    if (!fresh || !d || !d.uses) return false;
    return Object.keys(d.uses).some((it) => isNum(fresh[it]) && fresh[it] < FERMENT.sour);
  }

  function onServe(c, m, e, tick) {
    const q = Array.isArray(c.qs) && c.qs.length ? c.qs[c.qs.length - 1] : 'good';
    const late = m.frac <= 0.35;
    const quick = m.fracSeen && m.frac >= 0.8 && !late;
    const r = unit(S, 'serve', c.id, tick, e.dish);
    let sit;
    let tag;
    if ((e.q === 'broken' || q === 'broken') && r < 0.9) sit = 'broken-dish-complaint';
    else if (q !== 'perfect' && sourFor(e.dish) && unit(S, 'sour', c.id, tick) < 0.7) sit = 'sour-batter-complaint';
    else if (q === 'ok' && r < 0.75) { sit = 'serve-complain'; tag = 'quality'; } else if (late && r < 0.6) { sit = 'serve-complain'; tag = 'late'; } else if (quick && q !== 'ok' && q !== 'broken' && tick - (sitLast['thanks-fast-service'] ?? -99) >= THANKS_FAST_CD && unit(S, 'fast', c.id, tick) < 0.3) sit = 'thanks-fast-service';
    else if (r < (q === 'perfect' ? 0.5 : 0.3)) sit = 'serve-praise';
    else sit = 'serve-thanks';
    add({ cid: c.id, key: 'serve', sit, prio: prioOf(sit), born: tick, expire: tick + 4, need: null, ctx: { dish: e.dish, tag } });
  }

  function onEating(c, m, tick) {
    const sit = m.gotExtra || unit(S, 'eat', c.id) < 0.55 ? 'eating-compliment' : 'eating-chat';
    const got = Array.isArray(c.got) ? c.got : [];
    add({ cid: c.id, key: 'eat', sit, prio: prioOf(sit), born: tick, expire: tick + 5, need: 'eating', ctx: { dish: got[got.length - 1] } });
  }

  function onPayReady(c, m, tick) {
    const r = unit(S, 'pay', c.id);
    let sit = 'pay-ready';
    if (r < 0.12) sit = 'pay-haggle'; else if (r < 0.24) sit = 'apology';
    add({ cid: c.id, key: 'pay', sit, prio: prioOf(sit), born: tick, expire: tick + 7, need: 'paying', ctx: { n: isNum(c.total) ? c.total : undefined } });
  }

  function onPayWarning(c, m, tick) {
    add({ cid: c.id, key: 'pay', sit: 'pay-hurry', prio: 0, born: tick, expire: tick + 3, need: 'paying', ctx: {} });
  }

  function final(cid, sit, tick, ctx = {}) {
    dropFor(cid);
    add({ cid, key: 'final', sit, prio: prioOf(sit), born: tick, expire: tick + 5, need: null, final: true, ctx });
  }

  // ---- sold-out and the events of the day ---------------------------------------------------------------------------

  /** A dish ran out: the customer takes another (swap), skips it (drop) or goes home politely (left). */
  function onSoldOut(e, c, tick) {
    if (!isNum(e.customer) || typeof e.dish !== 'string') return;
    if (e.left === true) {
      if (c) { memOf(c, tick); final(c.id, 'sold-out-polite', tick, { dish: e.dish, tag: 'leave' }); } else {
        // never seated: a ghost walks away (like a turned-away visitor)
        ghostMem(e.customer, tick);
        add({ cid: e.customer, key: 'final', sit: 'sold-out-polite', prio: prioOf('sold-out-polite'), born: tick, expire: tick + 4, need: null, ghost: true, ctx: { dish: e.dish, tag: 'leave' } });
      }
      return;
    }
    if (!c) return;
    memOf(c, tick);
    const swap = typeof e.swap === 'string' && e.swap !== e.dish ? e.swap : null;
    add({
      cid: c.id, key: `sold-${e.dish}`, sit: 'sold-out-polite', prio: prioOf('sold-out-polite'), born: tick, expire: tick + 14, need: 'waiting', after: 'order',
      ctx: swap ? { dish: e.dish, dish2: swap, tag: 'swap' } : { dish: e.dish, tag: 'drop' },
    });
  }

  /** Something is owed to the stall: `count` lines of `sit`, said by whoever is free, within `ttl` ticks (after `delay`). */
  function owe(sit, tick, { count = 1, ttl = 6, delay = 0, gap = 2 } = {}) {
    owed.push({ id: ++oSeq, sit, from: tick + delay, until: tick + delay + ttl, count, gap, next: tick + delay, tries: 0 });
  }

  function onEventStart(e, tick) {
    switch (e.id) {
      case 'rain': owe('rain-start', tick, { count: 2, ttl: 14 }); break;
      case 'power': owe('power-cut', tick, { count: 2, ttl: 14 }); break;
      case 'cricket': owe('cricket-night', tick, { count: 2, ttl: 14 }); break;
      case 'festival': owe('festival-greeting', tick, { count: 2, ttl: 14 }); break;
      case 'inspector': owe('inspector-arrival', tick, { count: 2, ttl: 12 }); owe('inspector-arrival', tick, { count: 1, ttl: 6, delay: 7 }); break;
      default: break;
    }
  }

  function onEventEnd(e, tick) {
    if (e.id === 'rain') owe('rain-end', tick, { count: 1, ttl: 12 });
    else if (e.id === 'power') owe('power-back', tick, { count: 2, ttl: 12 });
  }

  /** Who is free to say a world line right now? Waiting customers must have ordered; nobody with something already queued. */
  function speakerFor(sit, customers, tick, taken) {
    let best = null;
    let bestH = Infinity;
    for (const c of customers) {
      const m = mem.get(c.id);
      if (!m || !m.arrived || taken.has(c.id) || pendingFor(c.id) || tick - m.last < MIN_GAP + 1) continue;
      if (c.st === 'waiting' ? !m.ordered : c.st !== 'eating' && c.st !== 'paying') continue;
      const h = hash32(S, 'who', sit, c.id, tick);
      if (h < bestH) { best = c; bestH = h; }
    }
    return best;
  }

  /** Hand each owed world line to a free speaker (one item per owed entry in the queue at a time). */
  function serveOwed(tick, customers) {
    queue = queue.filter((q) => q.expire >= tick);
    owed = owed.filter((o) => o.count > 0 && o.until >= tick && o.tries < 8);
    const taken = new Set();
    for (const o of owed) {
      if (o.from > tick || o.next > tick || queue.some((q) => q.owed === o)) continue;
      const c = speakerFor(o.sit, customers, tick, taken);
      if (!c) continue;
      taken.add(c.id);
      add({ cid: c.id, key: `w${o.id}`, sit: o.sit, prio: prioOf(o.sit), born: tick, expire: tick + 6, need: c.st, ctx: { dish: needsOf(c)[0] }, owed: o });
    }
  }

  /** Ambient talk while rain, a power cut, a cricket night, a festival or a dead cylinder lasts. */
  function ambient(tick) {
    const quiet = (sit, cd) => tick - (sitLast[sit] ?? -99) >= cd && !owed.some((o) => o.sit === sit) && !queue.some((q) => q.sit === sit);
    for (const [sit, ev, p, cd] of AMBIENT) {
      if (eventOn(ev) && quiet(sit, cd) && unit(S, 'amb', sit, tick) < p) owe(sit, tick, { count: 1, ttl: 6 });
    }
    const g = cur && cur.gas && typeof cur.gas === 'object' ? cur.gas : null;
    if (g && (g.u === 0 || (isNum(g.sw) && g.sw > 0)) && quiet('gas-out-chatter', GAS_CHATTER.cd) && unit(S, 'amb', 'gas', tick) < GAS_CHATTER.p) {
      owe('gas-out-chatter', tick, { count: 1, ttl: 6 });
    }
  }

  // ---- the update -------------------------------------------------------------------------------------------------

  function step(state, events) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.customers)) return [];
    const tick = isNum(state.tick) ? Math.trunc(state.tick) : 0;
    if (tick < lastTick || (lastSeed !== undefined && state.seed !== lastSeed)) reset();
    lastSeed = state.seed;
    cur = state;
    const tickChanged = tick !== lastTick;
    lastTick = tick;
    const level = state.level;

    const customers = state.customers.filter((c) => c && typeof c === 'object' && isNum(c.id));
    const byId = new Map();
    for (const c of customers) byId.set(c.id, c);
    for (const c of customers) {
      const m = memOf(c, tick);
      if (!m.arrived && c.st === 'waiting' && (!isNum(c.arrivedAt) || tick - c.arrivedAt <= 1)) onArrive(c, m, tick, level);
    }

    // events
    for (const e of Array.isArray(events) ? events : []) {
      if (!e || typeof e !== 'object') continue;
      const c = byId.get(e.customer);
      switch (e.type) {
        case 'customer-arrive': if (c) onArrive(c, memOf(c, tick), tick, level); break;
        case 'serve': if (c) onServe(c, memOf(c, tick), e, tick); break;
        case 'eating': if (c) onEating(c, memOf(c, tick), tick); break;
        case 'pay-ready': if (c) onPayReady(c, memOf(c, tick), tick); break;
        case 'pay-warning': if (c) onPayWarning(c, memOf(c, tick), tick); break;
        case 'collect': {
          if (!c) break;
          const m = memOf(c, tick);
          const r = unit(S, 'fare', c.id);
          if (m.real && (c.loyal | 0) >= 2 && (e.tip | 0) > 0 && unit(S, 'loyalty', c.id) < 0.65) final(c.id, 'regular-loyal', tick);
          else if (m.kind === 'uncle' && r < 0.4) final(c.id, 'elder-blessing', tick);
          else if ((e.tip | 0) > 0 && r < 0.7) final(c.id, 'pay-change-keep', tick);
          else dropFor(c.id);
          break;
        }
        case 'customer-angry': if (c) { memOf(c, tick); final(c.id, 'angry-leave', tick); } break;
        case 'customer-unpaid': if (c) { memOf(c, tick); final(c.id, 'unpaid-leave', tick); } break;
        case 'customer-turned-away':
          if (isNum(e.customer)) {
            ghostMem(e.customer, tick);
            add({ cid: e.customer, key: 'final', sit: 'turned-away', prio: prioOf('turned-away'), born: tick, expire: tick + 3, need: null, ctx: {} });
          }
          break;
        case 'extra': if (c) memOf(c, tick).gotExtra = true; break;
        case 'parcel-order': if (c) { const m = memOf(c, tick); if (m.arrived) queueRequests({ ...c, big: c.big || e.big === true, delivery: c.delivery || e.delivery === true }, m, tick, []); } break;
        case 'sold-out': onSoldOut(e, c, tick); break;
        case 'event-start': onEventStart(e, tick); break;
        case 'event-end': onEventEnd(e, tick); break;
        case 'inspector': owe(e.pass === true ? 'inspector-pass' : 'inspector-fail', tick, { count: 2, ttl: 12 }); break;
        case 'stock-out': if (tick - (sitLast['stock-out-apology'] ?? -99) >= STOCK_OUT_CD && !owed.some((o) => o.sit === 'stock-out-apology')) owe('stock-out-apology', tick, { count: 1, ttl: 10 }); break;
        case 'gas-out': owe('gas-out-chatter', tick, { count: 2, ttl: 12 }); break;
        case 'gas-swap': if (e.phase === 'start') owe('gas-out-chatter', tick, { count: 1, ttl: 10 }); break;
        case 'combo': {
          if (!isNum(e.combo) || e.combo < 3 || e.combo % 3 !== 0) break;
          const live = customers.filter((x) => x.st !== 'left');
          if (!live.length) break;
          const who = live[hash32(S, 'combo', tick, e.combo) % live.length];
          add({ cid: who.id, key: 'combo', sit: 'combo-praise', prio: prioOf('combo-praise'), born: tick, expire: tick + 3, need: null, ctx: {} });
          break;
        }
        default: break;
      }
    }

    // state transitions: patience bands of the customers still waiting for food
    const noPatience = !!(state.cfg && state.cfg.noPatience);
    for (const c of customers) {
      const m = mem.get(c.id);
      if (!m) continue;
      const frac = isNum(c.patienceMax) && c.patienceMax > 0 && isNum(c.patience) ? Math.max(0, Math.min(1, c.patience / c.patienceMax)) : 1;
      if (c.st === 'waiting' && !noPatience) {
        const band = bandOf(frac);
        if (band > m.band && m.arrived) {
          const need = needsOf(c);
          // the delivery boy hurries in his own words ('order late ayithe rating pothundi') until he is properly angry
          const sit = m.delivery && band <= 2 ? 'delivery-boy-hurry' : WAIT_SIT[band];
          add({
            cid: c.id, key: 'wait', sit, prio: prioOf(sit), born: tick, expire: tick + WAIT_EXPIRE[band],
            need: 'waiting', band, ctx: { dish: need[0], n: Array.isArray(c.order) ? c.order.length : undefined },
          });
        }
        m.band = band;
      } else m.band = 0;
      m.frac = frac;
      if (c.st === 'waiting') m.fracSeen = true;
    }

    // events of the day: ambient talk, and the world lines owed to whoever is free to say them
    const tutorial = !!(state.cfg && state.cfg.tutorial);
    if (tickChanged && !tutorial) ambient(tick);
    if (!tutorial) serveOwed(tick, customers);

    // daypart flavour and idle chatter, once per tick
    if (tickChanged && !tutorial) {
      const cfgHour = state.cfg && Array.isArray(state.cfg.hour) ? state.cfg.hour : null;
      if (cfgHour && isNum(cfgHour[0]) && isNum(cfgHour[1]) && isNum(state.shiftTicks) && state.shiftTicks > 0) {
        const hour = cfgHour[0] + (cfgHour[1] - cfgHour[0]) * Math.max(0, Math.min(1, tick / state.shiftTicks));
        const dp = daypartOf(hour);
        if (dp !== lastDaypart) { lastDaypart = dp; dpOwed = dp; dpSince = tick; }
      }
      const festival = level === 12;
      const eligible = [];
      for (const c of customers) {
        const m = mem.get(c.id);
        if (!m || !m.arrived || !m.ordered || (c.st !== 'waiting' && c.st !== 'eating')) continue;
        if (tick - m.last < MIN_GAP + 2 || pendingFor(c.id)) continue;
        eligible.push(c);
        if (c.st === 'waiting' && m.band === 0 && unit(S, 'idle', c.id, tick) < 0.1) {
          const sit = pickWeighted(chatterTable(c.kind, m.regular, festival), unit(S, 'idlesit', c.id, tick));
          add({ cid: c.id, key: 'chat', sit, prio: prioOf(sit), born: tick, expire: tick + 3, need: 'waiting', ctx: { dish: needsOf(c)[0] } });
        }
      }
      if (dpOwed) {
        if (tick - dpSince > 25) dpOwed = null;
        else if (eligible.length && !queue.some((q) => q.key === 'chat' && q.sit === dpOwed)) {
          const c = eligible[hash32(S, 'dp', dpOwed, tick) % eligible.length];
          add({ cid: c.id, key: 'chat', sit: dpOwed, prio: prioOf(dpOwed), born: tick, expire: tick + 3, need: c.st, ctx: {} });
          dpOwed = null;
        }
      }
    }

    return select(tick, byId);
  }

  // ---- choosing and building lines ----------------------------------------------------------------------------------

  function pickLine(lang2, sit, m, ctx, salt) {
    const pool = linesFor(lang2, sit);
    if (!pool.length) return null;
    let ok = pool.filter((l) => {
      if (m.used.has(l.id)) return false;
      if (l.kinds && !l.kinds.includes(m.kind)) return false;
      if (l.dish && !ctx.dish) return false;
      if (l.dish2 && (!ctx.dish2 || ctx.dish2 === ctx.dish)) return false;
      if (l.n && ctx.n === undefined) return false;
      if (l.n && sit === 'order' && !ctx.requireN) return false;
      if (!l.n && sit === 'order' && ctx.requireN) return false;
      return true;
    });
    if (ctx.tag) {
      const tagged = ok.filter((l) => l.tag === ctx.tag);
      if (tagged.length) ok = tagged;
      else if (ctx.tag === 'quality') ok = ok.filter((l) => !l.tag);
      else if (STRICT_TAG_SITS.has(sit)) ok = [];
    } else if (sit === 'serve-complain') ok = ok.filter((l) => !l.tag);
    if (RECENT_SITS.has(sit) && recent[sit]) {
      const fresh = ok.filter((l) => !recent[sit].includes(l.id));
      if (fresh.length) ok = fresh;
    }
    if (!ok.length) return null;
    return pickWeighted(ok.map((l) => [l, l.kinds ? 3 : 1]), unit(S, 'line', m.id, sit, salt));
  }

  function build(item, m, tick) {
    const cd = BUILD_CD[item.sit];
    if (cd && tick - (sitLast[item.sit] ?? -99) < cd) {
      // thanks for speed falls back to a plain thank-you; a second consolation is simply dropped
      if (item.sit === 'thanks-fast-service') item = { ...item, sit: 'serve-thanks' };
      else { if (item.owed) item.owed.count = 0; return null; }
    }
    let lang2 = m.lang;
    if (mode === 'mixed') lang2 = pickLang(m.weights || weightsFor(m.kind, m.name), unit(S, 'mixlang', m.id, tick, item.sit));
    const ctx = item.ctx || {};
    let line = pickLine(lang2, item.sit, m, ctx, tick);
    // a tagged complaint with nothing left, or a chatter pool that ran dry, may fall back to plain eating-chat
    if (!line && item.key === 'chat' && item.sit !== 'eating-chat') line = pickLine(lang2, 'eating-chat', m, ctx, tick);
    // an opening line (a regular, the weather) whose pool is used up falls back to an ordinary greeting
    if (!line && item.fall) {
      for (const f of item.fall) {
        if (f === item.sit) continue;
        line = pickLine(lang2, f, m, { dish: ctx.dish }, tick);
        if (line) break;
      }
    }
    if (!line) { if (item.owed) item.owed.tries += 1; return null; }
    const filled = fillTemplate(line, {
      dish: ctx.dish ? dishName(line.lang, ctx.dish) : undefined,
      dish2: ctx.dish2 ? dishName(line.lang, ctx.dish2) : undefined,
      n: ctx.n,
    });
    uSeq += 1;
    const u = {
      id: `u${uSeq}-${m.id}-${tick}`, customer: m.id, lineId: line.id, lang: line.lang, text: filled.text, rom: filled.rom, en: filled.en,
      mood: line.mood, sit: line.sit, ttlMs: ttlFor(filled.text), at: tick,
    };
    if (item.final) u.final = true;
    m.used.add(line.id);
    if (RECENT_SITS.has(line.sit)) recent[line.sit] = [...(recent[line.sit] || []), line.id].slice(-RECENT_N);
    if (item.owed) { item.owed.count -= 1; item.owed.next = tick + item.owed.gap; }
    if (item.owed || AMBIENT.some((a) => a[0] === line.sit) || BUILD_CD[line.sit]) sitLast[line.sit] = tick;
    return u;
  }

  function select(tick, byId) {
    queue = queue.filter((q) => q.expire >= tick);
    activeEnds = activeEnds.filter((end) => end > tick);
    const out = [];
    if (!queue.length) return out;
    // a world line that has waited two ticks for a free slot moves up to the serving band (a busy stall must not swallow the inspector's arrival)
    const eff = (q) => (q.owed && tick - q.born >= 2 ? Math.max(0, Math.min(q.prio, 2) - 1) : q.prio);
    const order = queue.slice().sort((a, b) => eff(a) - eff(b) || a.born - b.born || a.seq - b.seq);
    const done = new Set();
    for (const item of order) {
      if (activeEnds.length >= MAX_ACTIVE) break;
      const c = byId.get(item.cid);
      const m = mem.get(item.cid);
      if (!m) { done.add(item); continue; }
      // stale: the customer is gone or in another phase
      if (!item.final && !item.ghost && item.sit !== 'turned-away') {
        if (!c) { done.add(item); continue; }
        if (item.need && c.st !== item.need) { done.add(item); continue; }
        if (item.band && m.band < item.band) { done.add(item); continue; }
      }
      if (item.after && queue.some((q) => q.cid === item.cid && q.key === item.after && !done.has(q))) continue;
      if (tick - m.last < MIN_GAP) continue;
      const u = build(item, m, tick);
      done.add(item);
      if (!u) continue;
      m.last = tick;
      if (item.sit === 'order' || item.sit === 'order-multi') m.ordered = true;
      activeEnds.push(tick + Math.max(1, Math.ceil(u.ttlMs / TICK_MS)));
      out.push(u);
    }
    if (done.size) queue = queue.filter((q) => !done.has(q));
    if (mem.size > 80) for (const [id, m] of mem) if (tick - m.seen > 40) mem.delete(id);
    return out;
  }

  return {
    update(state, events) {
      try {
        return step(state, events);
      } catch {
        return [];
      }
    },
    /** The home language of a customer ('te' | 'hi' | 'dk'). Known after the customer was first seen by update(); before that it is computed from the id alone. */
    languageOf(customerId) {
      const m = mem.get(customerId);
      return m ? m.lang : langFor(customerId, null, '');
    },
    reset,
    /** Convenience for the HUD: the subtitle mode this director was created with (changeable) and a formatter that uses it. */
    get subtitles() { return subMode; },
    setSubtitles(next) { if (SUBTITLE_MODES.includes(next)) subMode = next; return subMode; },
    format(utterance) { return formatSubtitle(utterance, subMode); },
  };
}

