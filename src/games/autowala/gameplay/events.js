// City events, scheduled by the day clock (event-logic.js eventsForDay): a baraat, match night at the stadium, kite season.
// Publishes on `ctx.events` (the array Game.js already keeps of recent bus events, so these are properties of it):
//   ctx.events.active      [{ id, name, te, x, z, r, until (hour), start (hour), heading? }]  what is on now; the baraat's x,z moves with it. Avoid it.
//                          kites have x = z = null (the whole sky)
//   ctx.events.trafficMul  number, product of the active events' traffic factors (also applied to ctx.gfx.cfg.traffic / .peds)
//   ctx.events.today       [{ id, start, end }] today's schedule (hours)
//   ctx.events.force(id|null, on = true)  debug: run an event whatever the schedule says
// Bus events: `event:start { id, name, te, x, z, until, say: { en, te } }` and `event:end { id }`.
import { DAY } from '../game/config.js';
import { makeRng } from '../game/rng.js';
import { createBaraat } from './event-baraat.js';
import { createKites } from './event-kites.js';
import { createMatch } from './event-match.js';
import { EVENT_INFO, activeAt, eventsForDay, matchPhase, pickBaraatRoute } from './event-logic.js';

const SAY = {
  baraat: (r) => ({
    en: `A baraat is coming down ${r?.name || 'the road'}: it will be jammed, go round`,
    te: 'బారాత్ వస్తోంది, ఆ రోడ్డు జామ్ అవుతుంది, వేరే దారిలో వెళ్ళు',
  }),
  match: () => ({ en: 'Match night at Uppal Stadium: heavy traffic around the stadium', te: 'ఉప్పల్ స్టేడియంలో మ్యాచ్ నైట్, చుట్టుపక్కల ట్రాఫిక్ ఎక్కువ' }),
  kites: () => ({ en: 'Kite day: the sky is full of patangs', te: 'ఈ రోజు గాలిపటాల పండుగ, ఆకాశమంతా పతంగులు' }),
};

export function installEvents(ctx, weather) {
  const city = ctx.world.city;
  const seed = city.seed ?? 1;
  const list = [];
  ctx.events.active = list;
  ctx.events.trafficMul = 1;
  ctx.events.pedMul = 1;
  ctx.events.today = [];
  const forced = new Set();
  ctx.events.force = (id, on = true) => {
    if (id == null) forced.clear();
    else if (on) forced.add(id);
    else forced.delete(id);
  };

  // ctx.gfx.cfg is read by the traffic system every frame (`cfg.traffic`, `cfg.peds`): hand out a copy scaled by the events' factors.
  // The renderer reads QUALITY directly, so nothing else changes. Restored in dispose.
  const gfx = ctx.gfx;
  const cfgDesc = gfx ? Object.getOwnPropertyDescriptor(gfx, 'cfg') : null;
  let cfgOut = null;
  let cfgBase = null;
  let cfgKey = '';
  if (cfgDesc?.get && cfgDesc.configurable) {
    Object.defineProperty(gfx, 'cfg', {
      configurable: true,
      enumerable: cfgDesc.enumerable,
      get() {
        const base = cfgDesc.get.call(gfx);
        const tm = ctx.events.trafficMul;
        const pm = ctx.events.pedMul;
        if (tm === 1 && pm === 1) return base;
        const key = `${tm.toFixed(3)}|${pm.toFixed(3)}`;
        if (base !== cfgBase || key !== cfgKey) {
          cfgBase = base;
          cfgKey = key;
          cfgOut = { ...base, traffic: Math.round(base.traffic * tm), peds: Math.round(base.peds * pm) };
        }
        return cfgOut;
      },
    });
  }

  const runtimes = {
    baraat: { make: () => createBaraat(ctx), rt: null },
    match: { make: () => createMatch(ctx, ctx.gfx?.quality === 'low' ? 26 : 44), rt: null },
    kites: { make: () => createKites(ctx), rt: null },
  };
  for (const r of Object.values(runtimes)) {
    try {
      r.rt = r.make();
    } catch (err) {
      console.error('[autowala] an event failed to build', err);
    }
  }
  const run = {}; // id -> { entry, announced, started }
  let today = [];
  let todayDay = -1;
  let acc = 1;
  let first = true;
  const finished = new Set(); // `${day}:${id}` of events that ran their course
  const out = { drag: 0 };

  const setQuality = () => {
    runtimes.kites.rt?.setQuality(ctx.gfx?.quality || 'medium');
  };
  let lastQ = '';

  function begin(id, sched) {
    const R = runtimes[id]?.rt;
    if (!R) return false;
    const info = EVENT_INFO[id];
    const hour = ctx.clock.hour;
    const entry = { id, name: info.name, te: info.te, x: null, z: null, r: 0, until: sched.end, start: sched.start };
    if (id === 'baraat') {
      if (weather.intensity > 0.75) return false; // nobody walks a baraat through a storm: it waits
      const rnd = makeRng(((seed >>> 0) ^ (ctx.clock.day * 977)) + 13);
      const route = pickBaraatRoute(city, ctx.v, rnd);
      if (!route) return false;
      const seconds = Math.max(60, (sched.end - sched.start) * DAY.secondsPerHour);
      R.begin(route, seconds, Math.max(0, (hour - sched.start) * DAY.secondsPerHour));
      entry.name = `Baraat on ${route.name}`;
      entry.x = R.info.x;
      entry.z = R.info.z;
      entry.r = 24;
      entry.route = route.name;
    } else if (id === 'match') {
      const poi = city.poiById.stadium;
      R.start();
      entry.x = poi.x;
      entry.z = poi.z;
      entry.r = 130;
    } else {
      R.start();
    }
    run[id] = { entry, announced: false };
    list.push(entry);
    return true;
  }

  function stop(id, why) {
    const r = run[id];
    if (!r) return;
    runtimes[id].rt?.end();
    const i = list.indexOf(r.entry);
    if (i >= 0) list.splice(i, 1);
    delete run[id];
    if (r.announced) ctx.emit('event:end', { id, why });
  }

  function announce(id) {
    const r = run[id];
    const e = r.entry;
    const say = SAY[id](e);
    ctx.emit('event:start', { id, name: e.name, te: e.te, x: e.x, z: e.z, until: e.until, say });
    ctx.toast(say.en, { tone: 'info', ms: 4200 });
    r.announced = true;
  }

  const sys = {
    update(dt) {
      const clock = ctx.clock;
      const hour = clock.hour;
      if (first) {
        first = false;
        for (const r of Object.values(runtimes)) r.rt?.end(); // hide everything built visible for the shader warm-up
      }
      const q = ctx.gfx?.quality || 'medium';
      if (q !== lastQ) {
        lastQ = q;
        setQuality();
      }
      acc += dt;
      if (todayDay !== clock.day) {
        todayDay = clock.day;
        today = eventsForDay(clock.day, seed);
        ctx.events.today = today;
        for (const k of [...finished]) if (!k.startsWith(`${clock.day}:`)) finished.delete(k);
      }
      if (acc > 0.25) {
        acc = 0;
        const want = new Map();
        for (const e of activeAt(today, hour)) want.set(e.id, e);
        for (const id of forced) if (!want.has(id)) want.set(id, { id, start: hour, end: hour + 2 });
        for (const id of Object.keys(run)) if (!want.has(id)) stop(id, 'over');
        for (const [id, sched] of want) {
          if (run[id] || finished.has(`${clock.day}:${id}`)) continue;
          begin(id, sched);
        }
      }
      // announce once the player can see it (not behind the start screen or a menu)
      if (!ctx.state.menu) for (const id of Object.keys(run)) if (!run[id].announced) announce(id);

      let tm = 1;
      let pm = 1;
      let drag = 0;
      for (const id of Object.keys(run)) {
        const R = runtimes[id].rt;
        const e = run[id].entry;
        if (id === 'baraat') {
          const info = R.update(dt, clock.time);
          e.x = info.x;
          e.z = info.z;
          e.heading = info.heading;
          drag = Math.max(drag, info.drag);
          tm *= 0.88; // people keep out of the way
          if (info.done) {
            finished.add(`${clock.day}:baraat`);
            stop('baraat', 'arrived');
          }
        } else if (id === 'match') {
          const ph = R.update(dt, clock.time, hour);
          tm *= ph.trafficMul;
          pm *= ph.pedMul;
        } else if (id === 'kites') {
          R.update(dt, clock.time, hour, ctx.v, ctx.camera);
        }
      }
      ctx.events.trafficMul = tm;
      ctx.events.pedMul = pm;
      out.drag = drag;
    },
    dispose() {
      for (const id of Object.keys(run)) stop(id, 'dispose');
      for (const r of Object.values(runtimes)) {
        try {
          r.rt?.dispose();
        } catch (err) {
          console.error('[autowala] an event failed to dispose', err);
        }
      }
      if (cfgDesc?.get && gfx) Object.defineProperty(gfx, 'cfg', cfgDesc);
      delete ctx.events.active;
      delete ctx.events.trafficMul;
      delete ctx.events.pedMul;
      delete ctx.events.today;
      delete ctx.events.force;
    },
  };
  return { sys, out, active: list, matchPhase };
}
