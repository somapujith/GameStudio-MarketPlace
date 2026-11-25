// OWNER: voice agent. Spoken lines: customers hailing the auto ("babu auto!"), passengers riding, and an original fictional hero
// (Mega Hero) cheering the player on at milestones. Lines are static audio files made OFFLINE by scripts/gen-voicelines.mjs and
// served from /audio/autowala/voices/ (the game never calls any voice/AI API). No file yet? The subtitle still shows, with the
// browser's own Telugu voice if it has one, else a short chime. See docs/AUTOWALA_VOICES.md.
//
// Events consumed (all payload fields are optional, everything is read defensively):
//   fare:hail {customer:{id,x,z,kind,name}}          positional hail ("Babu auto!") from the customer's side
//   fare:pickup {trip:{id,kind,name,dest:{poiId,name}}}  boarding line ("Charminar ki teesukelu babu"), starts the ride chatter
//   fare:dropoff {trip, fare, tip, rating}           thanks / tip line, then hero streak / first-fare lines
//   fare:missed {customer:{id,x,z,kind,name}}        the customer gives up (positional)
//   crash {strength}                                 a passenger reaction while a trip is active
//   land {air, impact}                               big air -> hero line (rough landing -> passenger complaint)
//   drift-end {time}                                 long drift -> hero line
//   rage:start {chasers} / rage:shout {kind} / rage:escaped / rage:caught {fine, chasers}   angry drivers + hero reactions
//   traffic:hit {kind, severity}                     the other driver shouts (chasers/payloads with {x,z} make it positional)
//   wallet {wallet, delta}                           cumulative earnings milestones (Rs 1000 / 5000)
//   workshop:buy {...}                               first workshop purchase -> hero line
//   polled: night begins, rain begins, low fuel, back at the garage
// Event emitted:
//   voice:line {id, text (Telugu), te, roman, en, persona, personaName, speaker, color, hero, ms, mode}   (the subtitle bar)
import { PERSONAS, HERO_CATEGORIES, LINES, getLine, placeKey } from './voiceLines.js';
import { createPicker, createScheduler, personaForKind, priorityOf } from './voice-select.js';
import { createVoicePlayer } from './voice-player.js';
import { spatial, MAX_HEARD_M } from './voice-math.js';
import { CAR } from '../game/config.js';

const HEARD_KEY = 'jalebi.autowala.voices.v1:';
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** {x,z} from an object, or from the first element of an array of them (chasers); null when there is none. */
export function firstPos(v) {
  const o = Array.isArray(v) ? v[0] : v;
  const x = Number(o?.x);
  const z = Number(o?.z);
  return Number.isFinite(x) && Number.isFinite(z) && o?.x != null && o?.z != null ? { x, z } : null;
}

/** poi id for a trip destination (the fares agent should give `dest.poiId`; fall back to the name). */
export function destKey(dest) {
  if (!dest) return null;
  if (dest.poiId) return String(dest.poiId);
  const n = `${dest.name || ''} ${dest.id || ''}`.toLowerCase();
  if (/charminar|char minar/.test(n)) return 'charminar';
  if (/station|railway|nampally/.test(n)) return 'station';
  if (/airport|rgia|shamshabad/.test(n)) return 'airport';
  if (/hospital|nims|osmania|clinic/.test(n)) return 'hospital';
  return null;
}

export function installVoices(ctx) {
  const picker = createPicker();
  const sched = createScheduler();
  const settings = () => ctx.profile?.data?.settings || {};
  const player = createVoicePlayer({ settings });
  const off = [];
  const timers = [];
  let disposed = false;
  let stopWarm = () => {};

  // ---- once-ever milestones, remembered per account on this device --------------------------------------------------------
  const heardKey = HEARD_KEY + (ctx.hooks?.userId || 'guest');
  let heard = {};
  try {
    heard = JSON.parse(localStorage.getItem(heardKey) || '{}') || {};
  } catch {
    heard = {};
  }
  const markHeard = (k) => {
    heard[k] = 1;
    try {
      localStorage.setItem(heardKey, JSON.stringify(heard));
    } catch {
      /* private mode: it just may repeat next session */
    }
  };

  // ---- where the listener (the camera) is ---------------------------------------------------------------------------------
  const listener = () => {
    const e = ctx.camera?.matrixWorld?.elements;
    if (e && Number.isFinite(e[12])) return { x: e[12], z: e[14], rx: e[0], rz: e[2] };
    const v = ctx.v;
    return { x: num(v?.x), z: num(v?.z), rx: -Math.cos(num(v?.heading)), rz: Math.sin(num(v?.heading)) };
  };

  // ---- speaking -------------------------------------------------------------------------------------------------------------
  /** Pick a line for `query` and speak (or queue) it. Returns true when it was accepted. */
  function say(query, { pos = null, speaker = '', ttl, line: fixed = null } = {}) {
    if (disposed) return false;
    const t = nowMs();
    if (pos && !spatial(listener(), pos).audible) return false; // too far to hear: neither heard nor subtitled
    const line = fixed || picker.pick(query, t);
    if (!line) return false;
    const hero = line.persona === 'mega_hero';
    const item = { line, priority: priorityOf(line), ms: player.expectedMs(line), ttl: ttl ?? (hero ? 12000 : 3000), pos, speaker };
    const r = sched.submit(item, t);
    if (r.action === 'dropped') return false;
    picker.commit(line, t);
    if (r.interrupted) cancelItem(r.interrupted);
    if (r.action === 'play') start(item);
    return true;
  }

  function cancelItem(item) {
    item.cancelled = true;
    item.handle?.stop();
  }

  async function start(item) {
    const { line, pos, speaker } = item;
    const handle = await player.play(line, { pos, listener: pos ? listener() : null, onEnd: () => sched.finish(nowMs()) });
    if (item.cancelled || disposed) {
      handle.stop();
      return;
    }
    item.handle = handle;
    const p = PERSONAS[line.persona];
    ctx.emit('voice:line', {
      id: line.id, text: line.te, te: line.te, roman: line.roman, en: line.en,
      persona: line.persona, personaName: p?.name || line.persona, speaker: speaker || p?.name || '', color: p?.color || '#fff',
      hero: line.persona === 'mega_hero', ms: handle.ms, mode: handle.mode,
    });
  }

  // ---- state kept between events -------------------------------------------------------------------------------------------
  const customers = new Map(); // customer id -> { persona, name, lastHail }
  let trip = null; // { persona, kind, name, dest, started, nextChat, rushSaid }
  let streak = 0;
  let lastTotal = num(ctx.profile?.data?.totalEarned);
  const cool = {}; // category -> earliest next time (ms)
  const cooled = (key, ms) => {
    const t = nowMs();
    if (t < (cool[key] || 0)) return false;
    cool[key] = t + ms;
    return true;
  };

  const customerPersona = (c) => {
    const known = c?.id != null ? customers.get(c.id) : null;
    if (known) return known;
    const rec = { persona: personaForKind(c?.kind, c?.name), name: c?.name || '', lastHail: -1e9 };
    if (c?.id != null) {
      customers.set(c.id, rec);
      if (customers.size > 80) customers.delete(customers.keys().next().value);
    }
    return rec;
  };
  const tripActive = () => !!trip && ctx.fares?.trip?.status !== 'arrived';

  const hero = (category, { once = null, cooldownMs = 0, force = false } = {}) => {
    if (once && heard[once]) return false;
    if (cooldownMs && !cooled(category, cooldownMs)) return false;
    const ok = say({ category, persona: 'mega_hero', force });
    if (ok && once) markHeard(once);
    return ok;
  };

  // ---- event handlers --------------------------------------------------------------------------------------------------------
  function hail(c, { repeat = false } = {}) {
    if (!c || !Number.isFinite(Number(c.x)) || !Number.isFinite(Number(c.z))) return;
    const rec = customerPersona(c);
    const t = nowMs();
    if (t - rec.lastHail < 18000) return;
    const ok = say({ category: 'hail', persona: rec.persona, kind: c.kind || 'regular', place: placeKey(c.place) }, { pos: { x: Number(c.x), z: Number(c.z) }, speaker: rec.name });
    if (ok) rec.lastHail = t;
    else if (!repeat) rec.lastHail = t - 12000; // out of earshot: let the proximity check try again soon
  }

  function onPickup(tr) {
    if (!tr) return;
    const rec = customerPersona({ id: tr.id, kind: tr.kind, name: tr.name });
    trip = { persona: rec.persona, kind: tr.kind, name: tr.name || rec.name, dest: destKey(tr.dest), nextChat: nowMs() + 14000 + Math.random() * 12000, rushSaid: false, speedFor: 0 };
    say({ category: 'boarding', persona: trip.persona, dest: trip.dest, force: true }, { speaker: trip.name });
  }

  function onDropoff(e) {
    const tr = trip;
    const persona = tr?.persona || personaForKind(e.trip?.kind, e.trip?.name);
    const name = tr?.name || e.trip?.name || '';
    trip = null;
    streak++;
    const rating = e.rating == null ? 5 : num(e.rating, 5);
    if (rating >= 3) {
      const tipped = num(e.tip) > 0;
      const asked = tipped ? { category: 'tip', persona, force: true } : { category: 'thanks', persona, force: true };
      if (!say(asked, { speaker: name }) && tipped) say({ category: 'thanks', persona, force: true }, { speaker: name });
    }
    const rides = num(ctx.profile?.data?.rides);
    if (!heard.first_fare && rides <= 2) hero('hero_first_fare', { once: 'first_fare', force: true });
    else if (streak % 5 === 0) hero('hero_streak', { force: true });
  }

  function onMissed(c) {
    streak = 0;
    if (!c) return;
    const rec = customerPersona(c);
    if (Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.z))) {
      say({ category: 'missed', persona: rec.persona }, { pos: { x: Number(c.x), z: Number(c.z) }, speaker: rec.name });
    }
  }

  function onWallet(e) {
    if (num(e.delta) <= 0) return;
    const total = num(ctx.profile?.data?.totalEarned, lastTotal);
    if (lastTotal < 1000 && total >= 1000 && !heard.earn_1000) hero('hero_earn_1000', { once: 'earn_1000', force: true });
    if (lastTotal < 5000 && total >= 5000 && !heard.earn_5000) hero('hero_earn_5000', { once: 'earn_5000', force: true });
    lastTotal = total;
  }

  const handleEvent = (e) => {
    if (!e || disposed) return;
    try {
      switch (e.type) {
        case 'fare:hail': return hail(e.customer);
        case 'fare:pickup': return onPickup(e.trip);
        case 'fare:dropoff': return onDropoff(e);
        case 'fare:missed': return onMissed(e.customer);
        case 'crash':
          if (tripActive() && !e.guard && num(e.strength) >= 0.3) say({ category: 'complaint_crash', persona: trip.persona }, { speaker: trip.name });
          return;
        case 'land':
          if (num(e.air) >= 1.1) hero('hero_jump', { cooldownMs: 45000 });
          else if (tripActive() && num(e.impact) > 8) say({ category: 'complaint_bumpy', persona: trip.persona }, { speaker: trip.name });
          return;
        case 'drift-end':
          if (num(e.time) >= 3) hero('hero_drift', { cooldownMs: 60000 });
          return;
        case 'rage:start': // angry drivers start chasing
          return void say({ category: 'rage_start', persona: 'driver_angry', force: true }, { pos: firstPos(e.chasers) || firstPos(e), speaker: 'Angry driver' });
        case 'rage:shout': // one of the chasers yells (a `kind` such as 'horn' may come with it; any kind gets a shout)
          return void say({ category: 'rage_shout', persona: 'driver_angry' }, { pos: firstPos(e.chaser) || firstPos(e.chasers) || firstPos(e), speaker: 'Angry driver', ttl: 1500 });
        case 'rage:escaped':
          return void hero('hero_escape', { force: true });
        case 'rage:caught':
          streak = 0;
          say({ category: 'rage_caught', persona: 'driver_angry', force: true }, { pos: firstPos(e.chasers), speaker: 'Angry driver' });
          return void hero('hero_caught', { force: true });
        case 'traffic:hit': {
          const sev = typeof e.severity === 'number' ? e.severity : /hard|big|heavy|high/i.test(String(e.severity)) ? 1 : 0.5;
          if (sev >= 0.25 && cooled('trafficHit', 5000)) say({ category: 'traffic_hit', persona: 'driver_angry' }, { pos: firstPos(e), speaker: 'Angry driver' });
          return;
        }
        case 'wallet': return onWallet(e);
        case 'workshop:buy': return void hero('hero_workshop', { once: 'workshop', force: true });
        default:
      }
    } catch (err) {
      console.error('[autowala] voices event failed', e.type, err);
    }
  };
  off.push(ctx.game.on(handleEvent));

  // ---- the per-frame part: queue, positional follow, ride chatter, polled triggers -------------------------------------------
  let poll = 0;
  let wasNight = false;
  let wasRain = false;
  let lowFuel = false;
  let awayMax = 0;
  const garage = ctx.world?.city?.poiById?.garage?.front || null;
  let sessionRides = 0;
  off.push(ctx.game.on((e) => { if (e.type === 'fare:dropoff') sessionRides++; }));

  const system = ctx.addSystem({
    update(dt) {
      if (disposed) return;
      const t = nowMs();
      const next = sched.tick(t);
      if (next) start(next);
      const cur = sched.playing(t);
      if (cur?.pos && cur.handle?.update) cur.handle.update(listener());

      const v = ctx.v;
      // riding: speeding complaints, rusher urgency, idle chatter
      if (tripActive() && v) {
        trip.speedFor = v.kmh > 68 ? trip.speedFor + dt : 0;
        if (trip.speedFor > 2.5 && cooled('speed', 25000)) {
          trip.speedFor = 0;
          say({ category: 'complaint_speed', persona: trip.persona }, { speaker: trip.name });
        }
        if (num(v.jolt) > 0.6 && cooled('bump', 14000)) say({ category: 'complaint_bumpy', persona: trip.persona }, { speaker: trip.name });
        const left = ctx.fares?.trip?.timeLeft;
        if (!trip.rushSaid && Number.isFinite(left) && left < 25 && left > 0) {
          trip.rushSaid = true;
          say({ category: 'rush', persona: trip.persona, force: true }, { speaker: trip.name });
        }
        if (t > trip.nextChat) {
          trip.nextChat = t + 22000 + Math.random() * 20000;
          const category = trip.kind === 'rusher' && Math.random() < 0.6 ? 'rush' : 'chatter';
          say({ category, persona: trip.persona }, { speaker: trip.name });
        }
      }

      poll += dt;
      if (poll < 0.6) return;
      poll = 0;

      // a waiting customer you drive close to calls out again
      const waiting = ctx.fares?.waiting;
      if (Array.isArray(waiting) && v) {
        let best = null;
        let bestD = 55;
        for (const c of waiting) {
          const d = Math.hypot(num(c.x) - num(v.x), num(c.z) - num(v.z));
          if (d < bestD && (c.patience == null || c.patience > 0.15)) {
            best = c;
            bestD = d;
          }
        }
        if (best) hail(best, { repeat: true });
      }

      // night begins / rain begins / low fuel / back at the garage
      const hour = num(ctx.clock?.hour);
      const night = hour >= 19.5 || hour < 5;
      if (night && !wasNight) hero('hero_night', { cooldownMs: 120000 });
      wasNight = night;
      const rain = num(ctx.state?.weather) > 0.45;
      if (rain && !wasRain) hero('hero_rain', { cooldownMs: 240000 });
      wasRain = rain;
      if (v) {
        const tank = ctx.vehicle?.params?.({ upgrades: ctx.state?.upgrades })?.tank || CAR.fuelTank;
        const frac = num(v.fuel) / tank;
        if (frac < 0.2 && !lowFuel && ctx.clock?.time > 20) {
          lowFuel = true;
          hero('hero_fuel', { cooldownMs: 150000 });
        } else if (frac > 0.35) lowFuel = false;
        if (garage) {
          const d = Math.hypot(num(v.x) - garage.x, num(v.z) - garage.z);
          awayMax = Math.max(awayMax, d);
          if (awayMax > 150 && d < 22 && sessionRides > 0 && cooled('garage', 240000)) {
            awayMax = 0;
            hero('hero_garage');
          }
        }
      }
    },
    dispose() {
      disposed = true;
      off.forEach((f) => f?.());
      stopWarm();
      timers.forEach(clearTimeout);
      sched.clear();
      player.dispose();
      if (ctx.voices === api) delete ctx.voices;
    },
  });

  // ---- startup: the index (a 404 just means no files are generated yet) ---------------------------------------------------------
  player.loadIndex().then(() => {
    if (disposed || !player.fileCount()) return;
    const heroIds = LINES.filter((l) => l.persona === 'mega_hero').map((l) => l.id);
    const warm = () => {
      stopWarm();
      timers.push(setTimeout(() => player.preload(heroIds), 1500));
    };
    stopWarm = () => {
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
    };
    window.addEventListener('pointerdown', warm, { passive: true });
    window.addEventListener('keydown', warm, { passive: true });
  });

  /** Dev / debug handle: __autowala.ctx.voices.say('hero_first_1'), .hail({kind:'elder',...}) */
  const api = {
    player,
    categories: HERO_CATEGORIES,
    /** Speak one catalogue line now (ignores the cooldowns); pass a customer-like {x,z} to make it positional. */
    say: (id, pos = null) => say({ category: getLine(id)?.category }, { line: getLine(id), pos }),
    hail: (c) => hail({ x: 0, z: 0, kind: 'regular', ...c }),
    stats: () => ({ files: player.fileCount(), history: picker.history(), queued: sched.queued(), heard: { ...heard }, maxHeardM: MAX_HEARD_M }),
  };
  ctx.voices = api;
  return system;
}
