// Customer speech in the HUD, pure. The dialogue DIRECTOR (shared/tiffin-centre/dialogue/index.js, written by another hand) turns engine
// state + events into Utterances: { id, customer, lineId, lang:'te'|'hi'|'dk', text, rom, en, mood, sit, ttlMs, at }.
// This file turns Utterances into what the screen shows: speech bubbles over heads (max 3), one subtitle strip, an aria-live gloss, and
// the call that makes the mouth move and the voice speak. No React and no DOM here, so all of it is tested in Node.
import { patienceFracAt, tokenOf } from './hudLogic.js';

// The director module may not exist yet (or ever, in a stripped build): glob it eagerly so a missing file is simply `{}`.
const DIRECTOR_MODULES = import.meta.glob('../../../../../shared/tiffin-centre/dialogue/index.js', { eager: true });
const DIRECTOR_MOD = Object.values(DIRECTOR_MODULES)[0] || null;

/** createDialogueDirector from the shared dialogue module, or null when it has not landed. */
export const loadDirectorFactory = () => (typeof DIRECTOR_MOD?.createDialogueDirector === 'function' ? DIRECTOR_MOD.createDialogueDirector : null);

export const TTL_MIN = 1800;
export const TTL_MAX = 9000;
export const TTL_DEFAULT = 4200;
export const LEAVE_MS = 380; // the fade-out at the end of a bubble
export const MAX_BUBBLES = 3;
export const MAX_ACTIVE = 8;

// ---- subtitles ----------------------------------------------------------------------------------------------------------------------
/**
 * The lines to show for an utterance in a subtitle mode: [{ kind: 'native' | 'roman' | 'english', text }].
 *   both    native script, then the English gloss (small)     native  the script only
 *   roman   Latin letters only                                 english the gloss only
 * A missing field falls back to the next best one, so a line is never blank.
 */
export function subtitleLines(u, mode = 'both') {
  if (!u) return [];
  const native = String(u.text || u.rom || u.en || '');
  const roman = String(u.rom || u.text || u.en || '');
  const english = String(u.en || u.rom || u.text || '');
  switch (mode) {
    case 'native': return [{ kind: 'native', text: native }];
    case 'roman': return [{ kind: 'roman', text: roman }];
    case 'english': return [{ kind: 'english', text: english }];
    default: {
      const out = [{ kind: 'native', text: native }];
      if (english && english !== native) out.push({ kind: 'english', text: english });
      return out;
    }
  }
}

/** The text a screen reader hears for an utterance: always the English gloss, led by the token ("Token 7: where is my dosa?"). */
export function spokenGloss(u, state) {
  const c = (state?.customers || []).find((x) => x.id === u.customer);
  const who = c ? `Token ${tokenOf(c)}` : 'A customer';
  return `${who}: ${u.en || u.rom || u.text || ''}`.trim();
}

const MOODS = {
  angry: 'angry', furious: 'angry', annoyed: 'angry', rude: 'angry', storm: 'angry', outraged: 'angry', sad: 'angry',
  happy: 'happy', delighted: 'happy', laughing: 'happy', grateful: 'happy', thankful: 'happy', pleased: 'happy', warm: 'happy', joking: 'happy', sheepish: 'happy',
  impatient: 'impatient', hurry: 'impatient', hurried: 'impatient', bored: 'impatient', urgent: 'impatient', worried: 'impatient', nagging: 'impatient',
};
/** angry (red) | happy (warm) | impatient (amber) | calm (cream). */
export const moodTone = (mood) => MOODS[String(mood || '').toLowerCase()] || 'calm';
const MOOD_RANK = { angry: 3, impatient: 2, happy: 1, calm: 0 };

// ---- which bubbles / which subtitle ----------------------------------------------------------------------------------------------
/** The ids of the speech bubbles to draw: in-view customers first, then angrier, then newer; at most `max`. */
export function pickBubbles(active, { inView = null, max = MAX_BUBBLES } = {}) {
  const live = active.filter((a) => !a.gone);
  const seen = (a) => (inView ? inView.has(a.u.customer) : true);
  return live
    .slice()
    .sort((a, b) => Number(seen(b)) - Number(seen(a)) || MOOD_RANK[moodTone(b.u.mood)] - MOOD_RANK[moodTone(a.u.mood)] || b.born - a.born)
    .filter(seen)
    .slice(0, max)
    .map((a) => a.u.id);
}

/**
 * The line the subtitle strip shows: the newest line from a customer who is in view; else the line of the most urgent customer
 * (lowest patience, a paying customer counts as most urgent); else the newest line. null when nobody is talking.
 */
export function pickSubtitle(active, state, inView = null, frac = 0) {
  const live = active.filter((a) => !a.gone);
  if (!live.length) return null;
  const view = inView ? live.filter((a) => inView.has(a.u.customer)) : live;
  if (view.length) return view.slice().sort((a, b) => b.born - a.born)[0];
  const urgency = (a) => {
    const c = (state?.customers || []).find((x) => x.id === a.u.customer);
    if (!c) return 2;
    if (c.st === 'paying') return -1;
    return patienceFracAt(c, state, frac);
  };
  return live.slice().sort((a, b) => urgency(a) - urgency(b) || b.born - a.born)[0];
}

// ---- the runner ---------------------------------------------------------------------------------------------------------------------
const ttlOf = (u) => Math.min(TTL_MAX, Math.max(TTL_MIN, Number.isFinite(Number(u?.ttlMs)) ? Number(u.ttlMs) : TTL_DEFAULT));

/**
 * Feeds session notifications through a director and keeps the list of live utterances.
 *   ingest(state, events, now) -> the NEW utterances (already spoken / animated when enabled)
 *   active(now)               -> [{ u, born, until, leaving, gone }] (what to draw right now)
 *   nextDeadline(now)         -> the time the list next changes (a fade starts or a line ends), or null
 *   reset()                   -> restart, nothing is shown (a restarted shift)
 * Options: director ({ update, reset }), speak(u), speaking(customerId, ms), canSpeak() -> bool, now().
 */
export function createDialogueRunner({ director, speak, speaking, canSpeak = () => true } = {}) {
  let list = [];
  let lastTick = -1;
  const seenIds = new Set();
  const runner = {
    ingest(state, events, now) {
      if (!director || !state) return [];
      if (Number.isFinite(state.tick) && state.tick < lastTick) runner.reset();
      lastTick = Number.isFinite(state.tick) ? state.tick : lastTick;
      let fresh = [];
      try {
        fresh = director.update(state, events || []) || [];
      } catch {
        fresh = [];
      }
      const out = [];
      for (const u of fresh) {
        if (!u || u.id === undefined || seenIds.has(u.id)) continue;
        seenIds.add(u.id);
        if (seenIds.size > 400) seenIds.delete(seenIds.values().next().value);
        const ttl = ttlOf(u);
        // one bubble per customer: a new line replaces their old one
        list = list.filter((a) => a.u.customer !== u.customer);
        list.push({ u, born: now, until: now + ttl, ttl });
        out.push(u);
        try {
          if (canSpeak()) speak?.(u);
        } catch {
          /* a broken voice must never break the game */
        }
        try {
          speaking?.(u.customer, ttl);
        } catch {
          /* the scene may not animate mouths yet */
        }
      }
      if (list.length > MAX_ACTIVE) list = list.slice(-MAX_ACTIVE);
      return out;
    },
    active(now) {
      list = list.filter((a) => now < a.until);
      return list.map((a) => ({ ...a, leaving: now >= a.until - LEAVE_MS, gone: false }));
    },
    nextDeadline(now) {
      let t = null;
      for (const a of list) {
        for (const d of [a.until - LEAVE_MS, a.until]) if (d > now && (t === null || d < t)) t = d;
      }
      return t;
    },
    reset() {
      list = [];
      seenIds.clear();
      lastTick = -1;
      try {
        director?.reset?.();
      } catch {
        /* ignore */
      }
    },
  };
  return runner;
}
