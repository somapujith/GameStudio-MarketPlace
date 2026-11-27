// OWNER: weather agent. Weather (rain, storms, wet roads, slippery tyres, a wet rider) and the city events (events.js).
//
// ctx.weather = {
//   state: 'clear' | 'cloudy' | 'rain' | 'storm',   raining: bool,   intensity / rain: 0..1 (how hard it rains),   sev: 0..1 (the one number we move),
//   gripMul: total tyre grip (1 dry .. ~0.68 in a storm, standing water counts),   visibility: 1 clear .. ~0.5 storm,
//   puddles: 0..1 standing water (lingers after the rain),   wet: 0..1 how soaked the rider is (the open auto has no windscreen),
//   event: { id, name, te, until } | null  (the first running city event),   day kind: 'dry' | 'cloudy' | 'showers' | 'monsoon',
//   force(name | null, instant?)  debug: hold 'clear' | 'cloudy' | 'rain' | 'storm' until forced back with null,   strike()  debug: a flash now,
// }
// It drives ctx.state.weather (sky, fog, wet-road shader), ctx.state.gripMul (compensated for the engine's own wet-road factor in Game.js) and
// ctx.state.speedMul (only inside a baraat's crowd). Bus events: `weather:change { state, prev, intensity, day }`, `weather:rain-start`,
// `weather:rain-end`, `weather:thunder { delay, strength }`, `weather:splash { x, z, speed }`, plus event:start / event:end (events.js).
// Snapshot key `weather: { state, rain, wet, puddles, event: { id, name, te } | null }`.
import { clamp, damp } from '../game/rng.js';
import { createRain, RAIN_STREAKS } from '../world/rain.js';
import { createRainGround } from '../world/rain-ground.js';
import { installOvercast } from '../world/rain-sky.js';
import { installEvents } from './events.js';
import {
  SEV, approach, dayKind, flashEnvelope, gripCompensation, gripFor, nextFlashDelay, puddleStep, rainFor, roadWetFor, scheduledWeather,
  sevForSky, skyFor, stateFor, thunderDelay, visibilityFor, wetStep,
} from './weather-logic.js';

export function installWeather(ctx) {
  const { scene, camera, world, state, clock, v } = ctx;
  const seed = world.city?.seed ?? 1;

  const W = {
    state: 'clear', raining: false, intensity: 0, rain: 0, sev: 0, cloud: 0, gripMul: 1, visibility: 1, puddles: 0, wet: 0,
    event: null, kind: dayKind(clock.day, seed), forced: null,
    /** Debug: hold a state ('clear' | 'cloudy' | 'rain' | 'storm') or a severity 0..1; null gives the schedule back. `instant` skips the transition. */
    force(s, instant = false) {
      forced = s == null ? null : typeof s === 'number' ? clamp(s, 0, 1) : (SEV[s] ?? 0);
      W.forced = s ?? null;
      if (instant && forced != null) sev = forced;
    },
    /** Debug numbers: how many puddle decals and splash particles are live. */
    stats: () => ({ puddles: ground.shown, splash: ground.sparks }),
    /** Debug: a lightning flash now (the thunder event follows). */
    strike() {
      flashT0 = clock.time;
      ctx.emit('weather:thunder', { delay: thunderDelay(Math.random()), strength: 1 });
    },
  };
  ctx.weather = W;

  let sev = 0;
  let forced = null;
  let lastWritten = 0;
  let forcedUntil = 0;
  let lastQ = '';
  let nextFlash = Infinity;
  let flashT0 = -9;
  let flash = 0;
  let lastKind = clock.day;
  // The weather's own top-speed factor. It must NOT be read back from state.speedMul: career.js hooks that property so a read returns
  // (weather's value x damage's value), and easing "the previous read" would multiply the damage factor in again on every frame.
  let speedBase = 1;

  const rain = createRain(scene);
  const ground = createRainGround(scene, world.city);
  const undoSky = installOvercast(world.sky, scene, () => ({ weather: state.weather, flash }));
  const events = installEvents(ctx, W);
  const hor = world.sky.palette.hor;
  const wheelPos = { x: 0, z: 0, heading: 0, speed: 0 };

  const announceRain = (name, prev) => {
    if (state.menu) return;
    if (name === 'storm') ctx.toast('Storm! The roads are slick and you can barely see', { tone: 'bad', ms: 3600 });
    else if (name === 'rain' && prev !== 'storm') ctx.toast('It is raining: the roads are slick, easy on the throttle', { tone: 'info', ms: 3200 });
  };

  const sys = {
    update(dt) {
      const time = clock.time;
      // someone wrote state.weather directly (debug.weather(w)): hold that sky for three game hours
      if (Math.abs(state.weather - lastWritten) > 0.004) {
        forced = sevForSky(clamp(state.weather, 0, 1));
        W.forced = state.weather;
        forcedUntil = time + 3 * 60;
        sev = forced;
      } else if (forcedUntil && time > forcedUntil && typeof W.forced === 'number') {
        forced = null;
        W.forced = null;
        forcedUntil = 0;
      }
      if (clock.day !== lastKind) {
        lastKind = clock.day;
        W.kind = dayKind(clock.day, seed);
      }
      const target = forced ?? scheduledWeather(clock.day, clock.hour, seed).target;
      sev = approach(sev, target, dt);

      const prev = W.state;
      const name = stateFor(sev, prev);
      const r = rainFor(sev);
      const sky = skyFor(sev);
      const puddles = puddleStep(W.puddles, r, dt);
      W.sev = sev;
      W.cloud = sky;
      W.rain = W.intensity = r;
      const wasRaining = W.raining;
      W.raining = wasRaining ? r > 0.04 : r > 0.1; // a little hysteresis
      if (W.raining !== wasRaining) ctx.emit(W.raining ? 'weather:rain-start' : 'weather:rain-end', { intensity: r });
      W.puddles = puddles;
      W.visibility = visibilityFor(sev);
      state.weather = lastWritten = roadWetFor(sky, puddles);

      // tyres: the total grip we want, expressed as the extra factor on top of what Game.js already applies for a wet road
      W.gripMul = gripFor(r, puddles);
      state.gripMul = gripCompensation(W.gripMul, world.shared.uWet.value);

      W.wet = wetStep(W.wet, r, Math.abs(v.speed), dt);

      if (name !== prev) {
        W.state = name;
        ctx.emit('weather:change', { state: name, prev, intensity: r, day: clock.day });
        if (name === 'rain' || name === 'storm') announceRain(name, prev);
      }

      // lightning: only in a storm
      if (r >= 0.75) {
        if (nextFlash === Infinity) nextFlash = time + nextFlashDelay(r, Math.random());
        if (time >= nextFlash) {
          flashT0 = time;
          nextFlash = time + nextFlashDelay(r, Math.random());
          ctx.emit('weather:thunder', { delay: thunderDelay(Math.random()), strength: 0.5 + 0.5 * Math.random() });
        }
      } else nextFlash = Infinity;
      flash = flashEnvelope(time - flashT0);
      rain.setFlash(flash);

      // visuals
      const q = ctx.gfx?.quality || 'medium';
      if (q !== lastQ) {
        lastQ = q;
        rain.setCount(RAIN_STREAKS[q] ?? RAIN_STREAKS.medium);
        ground.setQuality(q);
      }
      const night = world.sky.state.night;
      rain.update(time, camera, r, night);
      wheelPos.x = v.x;
      wheelPos.z = v.z;
      wheelPos.heading = v.heading;
      wheelPos.speed = Math.abs(v.speed);
      ground.update(dt, puddles, r, wheelPos, night, hor, (e) => ctx.emit('weather:splash', e));

      // events run after the weather (a baraat will not start in a storm)
      events.sys.update(dt);
      const drag = events.out.drag;
      speedBase = damp(speedBase, (1 - 0.04 * r) * (1 - 0.55 * drag), 6, dt);
      state.speedMul = speedBase;
      if (drag > 0.05 && !state.menu) {
        // nobody drives through a baraat at speed: the crowd bleeds the auto's speed off (time constant ~0.45 s at full drag)
        const k = Math.exp(-2.2 * drag * dt);
        v.vx *= k;
        v.vz *= k;
      }
      const ev = events.active[0];
      W.event = ev ? { id: ev.id, name: ev.name, te: ev.te, until: ev.until } : null;
    },
    dispose() {
      events.sys.dispose();
      undoSky();
      rain.dispose();
      ground.dispose();
      state.weather = 0;
      state.gripMul = 1;
      state.speedMul = 1;
      if (ctx.weather === W) delete ctx.weather;
    },
  };
  ctx.addSystem(sys);
  ctx.addSnapshot(() => ({
    weather: {
      state: W.state, rain: +W.rain.toFixed(2), wet: +W.wet.toFixed(2), puddles: +W.puddles.toFixed(2),
      event: W.event ? { id: W.event.id, name: W.event.name, te: W.event.te } : null,
    },
  }));
}
