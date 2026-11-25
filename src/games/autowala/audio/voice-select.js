// OWNER: voice agent. Pure line-selection logic (no Web Audio, no DOM): which persona speaks for a customer kind, which line
// of the catalogue is picked (cooldowns, no repeat of the last 3, weights) and the priority scheduler that decides whether a
// line plays now, waits or is dropped. Unit-tested in voice-select.test.js.
import { LINES, PERSONAS, KINDS } from './voiceLines.js';

const FEMALE_HINT = /\b(amma|ammamma|akka|aapa|apa|bai|begum|bibi|devi|aunty|madam|mam|ma'am|lakshmi|salma|fatima|sita|priya)\b/i;
const MALE_HINT = /\b(anna|bhai|bhaiya|rao|thatha|tata|tatha|ayya|sir|uncle|saab|sahab|miyan|mian|babu)\b/i;
/** 'f' | 'm' | null from the words of a name ("Lakshmi Amma" -> 'f', "Ramaiah Thatha" -> 'm'). */
export function genderHint(name) {
  const s = String(name || '');
  if (FEMALE_HINT.test(s)) return 'f';
  if (MALE_HINT.test(s)) return 'm';
  return null;
}

/** customer kind (+ name hint) -> persona id. `rng` () => [0,1) for the random mixes. */
export function personaForKind(kind, name, rng = Math.random) {
  const g = genderHint(name);
  switch (kind) {
    case 'elder':
      return g === 'f' ? 'elder_woman' : g === 'm' ? 'elder_man' : rng() < 0.5 ? 'elder_woman' : 'elder_man';
    case 'women':
      return /\b(aunty|amma|madam|mam|begum)\b/i.test(String(name || '')) ? 'woman_mid' : rng() < 0.55 ? 'woman_young' : 'woman_mid';
    case 'rusher':
      return 'man_rusher';
    case 'tourist':
      return 'tourist';
    case 'student':
      return 'student';
    default: // 'regular' and anything unknown
      return g === 'f' ? 'woman_mid' : g === 'm' ? 'man_rusher' : rng() < 0.5 ? 'woman_mid' : 'man_rusher';
  }
}

/** Higher number = more important. Used by the scheduler. */
export const PRIORITY = {
  chatter: 1,
  hail: 2, rush: 2, missed: 2, complaint_speed: 2, complaint_bumpy: 2, rage_shout: 2, traffic_hit: 2,
  boarding: 3, thanks: 3, tip: 3, rage_start: 3, rage_caught: 3,
  complaint_crash: 4,
  hero: 3,
};
export const priorityOf = (line) => (line.persona === 'mega_hero' ? PRIORITY.hero : PRIORITY[line.category] ?? 1);

/** ms of silence a persona must keep after one of its lines (per category; crash and hero lines are exempt from the long one). */
export const COOLDOWNS = {
  personaMs: 4000, // the same persona speaks at most every 4 s ...
  personaCrashMs: 1200, // ... a crash reaction can come sooner
  passengerGlobalMs: 1200, // any two passenger lines
  heroGlobalMs: 9000, // any two hero lines
  historySize: 3, // never repeat one of the last 3 lines
};

/**
 * The picker. `pick(query, now)` returns a catalogue line or null (blocked by a cooldown / nothing matches).
 * query: { category, persona?, kind?, dest?, force? }  (`force` ignores the cooldowns, never the no-repeat rule)
 * `commit(line, now)` records that the line was spoken (history + cooldown stamps). Split so a line that ends up dropped by the
 * scheduler does not burn a cooldown.
 */
export function createPicker({ lines = LINES, rng = Math.random, cooldowns = COOLDOWNS } = {}) {
  const history = []; // most recent last
  const lastByPersona = new Map();
  let lastPassenger = -Infinity;
  let lastHero = -Infinity;

  const weighted = (arr) => {
    const total = arr.reduce((s, l) => s + (l.weight ?? 1), 0);
    let r = rng() * total;
    for (const l of arr) {
      r -= l.weight ?? 1;
      if (r < 0) return l;
    }
    return arr[arr.length - 1];
  };

  const blocked = (query, persona, now) => {
    if (query.force) return false;
    const hero = persona === 'mega_hero';
    if (hero) return now - lastHero < cooldowns.heroGlobalMs;
    if (now - lastPassenger < cooldowns.passengerGlobalMs && query.category !== 'complaint_crash') return true;
    const gap = query.category === 'complaint_crash' ? cooldowns.personaCrashMs : cooldowns.personaMs;
    return now - (lastByPersona.get(persona) ?? -Infinity) < gap;
  };

  function candidates(query) {
    let pool = lines.filter((l) => l.category === query.category);
    if (query.persona) pool = pool.filter((l) => l.persona === query.persona);
    if (query.kind) pool = pool.filter((l) => !l.kind || l.kind === query.kind);
    if (query.category === 'hail') {
      // a line that names a place is only used at that place; where the persona has one it is preferred (70%)
      const here = query.place ? pool.filter((l) => l.place === query.place) : [];
      const plain = pool.filter((l) => !l.place);
      pool = here.length && (rng() < 0.7 || !plain.length) ? here : plain.length ? plain : pool.filter((l) => !l.place);
    }
    if (query.category === 'boarding') {
      const dest = query.dest ? pool.filter((l) => l.dest === query.dest) : [];
      // a destination line is preferred 75% of the time when the persona has one; otherwise the generic ones
      const generic = pool.filter((l) => !l.dest);
      pool = dest.length && (rng() < 0.75 || !generic.length) ? dest : generic.length ? generic : pool;
    }
    return pool;
  }

  return {
    pick(query, now) {
      const pool = candidates(query);
      if (!pool.length) return null;
      const persona = query.persona || pool[0].persona;
      if (blocked(query, persona, now)) return null;
      const recent = new Set(history);
      const fresh = pool.filter((l) => !recent.has(l.id));
      if (fresh.length) return weighted(fresh);
      // every candidate was spoken within the last 3 lines: take the least recently used one
      return [...pool].sort((a, b) => history.indexOf(a.id) - history.indexOf(b.id))[0];
    },
    commit(line, now) {
      history.push(line.id);
      while (history.length > cooldowns.historySize) history.shift();
      lastByPersona.set(line.persona, now);
      if (line.persona === 'mega_hero') lastHero = now;
      else lastPassenger = now;
    },
    history: () => [...history],
    reset() {
      history.length = 0;
      lastByPersona.clear();
      lastPassenger = lastHero = -Infinity;
    },
  };
}

/**
 * The scheduler: one voice at a time. A hero line never overlaps another hero line or a passenger line (it waits its turn, up
 * to its ttl) and is never cut off; a crash reaction (priority 4) interrupts a low-priority passenger line (chatter, hail ...);
 * everything else waits in a small priority queue and is dropped when it has waited longer than its `ttl`.
 *
 * item: { line, priority, ms, ttl?, ...anything the caller needs back }
 * submit(item, now) -> { action: 'play' | 'queued' | 'dropped', item, interrupted? }
 * tick(now)  -> item | null   (call every frame: starts the next queued item once the current one has ended)
 * finish(now) -> marks the current line ended (the audio's `ended` event); tick() then moves on.
 */
export function createScheduler({ maxQueue = 4, gapMs = 250 } = {}) {
  let current = null; // { item, endsAt }
  let queue = [];
  const start = (item, now) => {
    current = { item, endsAt: now + Math.max(300, item.ms || 1500) + gapMs };
    return item;
  };
  const hero = (item) => item.line.persona === 'mega_hero';
  const active = (now) => current && now < current.endsAt;

  return {
    submit(item, now) {
      if (!active(now)) {
        current = null;
        return { action: 'play', item: start(item, now) };
      }
      const cur = current.item;
      // only a crash reaction may cut in, and only over low-priority passenger talk (chatter, hails, complaints ...)
      if (item.line.category === 'complaint_crash' && !hero(cur) && cur.priority <= 2) {
        const interrupted = cur;
        return { action: 'play', item: start(item, now), interrupted };
      }
      item.queuedAt = now;
      queue.push(item);
      queue.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
      let dropped = null;
      while (queue.length > maxQueue) dropped = queue.pop();
      if (dropped === item) return { action: 'dropped', item };
      return { action: 'queued', item };
    },
    tick(now) {
      if (active(now)) return null;
      current = null;
      while (queue.length) {
        const next = queue.shift();
        if (now - next.queuedAt <= (next.ttl ?? 4000)) return start(next, now);
      }
      return null;
    },
    finish(now) {
      if (current) current.endsAt = Math.min(current.endsAt, now + gapMs);
    },
    playing: (now) => (active(now) ? current.item : null),
    queued: () => queue.length,
    clear() {
      current = null;
      queue = [];
    },
  };
}

/** The persona/kind sanity check used by tests and the runtime: every kind maps to a persona that has hail lines. */
export const HAIL_PERSONAS = Object.fromEntries(
  KINDS.map((k) => [k, [...new Set(LINES.filter((l) => l.category === 'hail' && l.kind === k && !l.place).map((l) => l.persona))]]),
);
export const personaName = (id) => PERSONAS[id]?.name || id;
