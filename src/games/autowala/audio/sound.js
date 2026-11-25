// OWNER: sound agent. The whole procedural soundscape of Autowala: engine, tyres, crashes, city ambience, the radio and the volume
// buses. 100% Web Audio synthesis (no files, no network). Called once by Game.js: installSound(ctx).
//
// Graph (all sources are built on the first user gesture; before that, and when Web Audio is missing, everything is a silent no-op):
//   engine (4 osc) + tyres + ambience (1 osc) + one-shots ........ -> bus.fx    \
//   radio (4 sources, only while it is on) ......................... -> bus.music  > master -> compressor
//   voices (audio/voices.js, via getBuses().voice) ................. -> bus.voice  /
//   ONE shared looping noise source feeds every filtered-noise branch (skid, rumble, hum, rain, rattle, rustle).
//
// Public handles: ctx.sound (also window.__autowala.sound) = { radio, stats(), buses(), ... }; snapshot key `radio`;
// events listened to: crash, land, audio:volume, voice:line | voice:start | voice:end, menu; events emitted: radio:station.
import { getBuses, setBusLevels, dropBuses } from './sound-bus.js';
import { normalizeAudio } from '../ui/menus/menuNav.js';
import { createNoiseBuffer, createNoiseSource, safeStop, safeDisconnect } from './engine-kit.js';
import { createEngineVoice } from './engine-voice.js';
import { createTyres } from './engine-tyres.js';
import { createOneShots } from './engine-oneshots.js';
import { createAmbience } from './ambience-voice.js';
import { createRadio } from './radio-voice.js';
import {
  STATIONS, ambienceMix, clamp, clamp01, crashParams, engineMix, engineRpm, landParams, liftOff, radioDuck, skidAmount, skidHz,
  surfaceMix, trackTitle,
} from './sound-math.js';

const RADIO_KEY = 'jalebi.autowala.radio.v1';
const SLOW = 0.12; // s between the slower scans (traffic, pillars, pavement)

export function installSound(ctx) {
  const state = ctx.state;
  const v = ctx.v;
  let disposed = false;
  let gestured = false;
  let failed = false;
  let b = null; // the buses
  let engine = null;
  let tyres = null;
  let amb = null;
  let shots = null;
  let radioV = null;
  let noiseSrc = null;
  const off = [];

  // ---- reusable scratch (nothing below allocates per frame) -------------------------------------------------------------------
  const eMix = { rpm: 0, hz: 0, gain: 0, lp: 0, sub: 0, rattle: 0, whineGain: 0, whineHz: 0 };
  const eIn = { kmh: 0, throttle: 0, boosting: false, airborne: false, hold: false, fuel: 1 };
  const sIn = { drifting: false, side: 0, speed: 0, braking: false, airborne: false, onPave: false };
  const surf = { pave: 0, road: 0 };
  const aIn = { hour: 12, traffic: 0, pillars: 0, rain: 0, menu: false };
  const aMix = { road: 0, birds: 0, crickets: 0, metro: 0, rain: 0, bed: 0 };
  const cp = { gain: 0, lp: 0, thumpHz: 0, dur: 0, metal: 0 };
  const lp = { gain: 0, hz: 0, dur: 0 };
  const pillarBuf = [];
  let acc = 0;
  let onPave = false;
  let prevTh = 0;
  let prevFwd = 0;
  let lastPopAt = -9;
  let lastHitAt = -9;
  let skidNow = 0;
  let cost = 0; // EMA of update() in ms
  let voiceUntil = 0; // performance.now() seconds
  let duck = 1;
  const nowS = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000);

  // ---- settings -> buses ------------------------------------------------------------------------------------------------------
  try {
    setBusLevels(normalizeAudio(ctx.profile?.data?.settings?.audio));
  } catch {
    /* defaults */
  }

  // ---- the radio (state lives here so the widget works even before the first gesture) -----------------------------------------
  const radio = { on: false, station: 0 };
  try {
    const s = Number(localStorage.getItem(RADIO_KEY));
    if (Number.isInteger(s) && s >= 0 && s < STATIONS.length) radio.station = s;
  } catch {
    /* private mode */
  }
  const saveStation = () => {
    try {
      localStorage.setItem(RADIO_KEY, String(radio.station));
    } catch {
      /* private mode */
    }
  };
  const audioNow = () => (b ? b.ac.currentTime : 0);

  function announce() {
    const st = STATIONS[radio.station];
    ctx.emit?.('radio:station', { station: radio.station, name: st.name, on: radio.on });
    if (radio.on) ctx.toast?.(`${st.name}  ·  ${st.te}`, { tone: 'gold', ms: 1900 });
    else ctx.toast?.('Radio off', { tone: 'info', ms: 1200 });
  }
  function applyRadio(retune) {
    if (!radioV) return; // built later: build() syncs it
    const t = audioNow();
    if (radio.on) {
      if (radioV.on && retune) radioV.tune(radio.station, t);
      else if (!radioV.on) radioV.start(radio.station, t);
    } else radioV.stop(t);
  }
  const radioApi = {
    get on() {
      return radio.on;
    },
    get station() {
      return radio.station;
    },
    get name() {
      return STATIONS[radio.station].name;
    },
    stations: STATIONS,
    /** off -> station 1 -> 2 -> 3 -> off (the R key). */
    cycle() {
      if (!radio.on) {
        radio.on = true;
        applyRadio(false);
      } else if (radio.station >= STATIONS.length - 1) {
        radio.on = false;
        radio.station = 0;
        applyRadio(false);
        saveStation();
        announce();
        return;
      } else {
        radio.station++;
        applyRadio(true);
      }
      saveStation();
      announce();
    },
    /** Tune a station (0..n-1) and switch on; -1 switches off. */
    set(i) {
      if (i < 0 || i >= STATIONS.length) {
        if (radio.on) {
          radio.on = false;
          applyRadio(false);
          announce();
        }
        return;
      }
      const wasOn = radio.on;
      radio.on = true;
      radio.station = i;
      applyRadio(wasOn);
      saveStation();
      announce();
    },
    next() {
      radio.on ? this.set((radio.station + 1) % STATIONS.length) : this.set(radio.station);
    },
    prev() {
      radio.on ? this.set((radio.station + STATIONS.length - 1) % STATIONS.length) : this.set(radio.station);
    },
    toggle() {
      radio.on ? this.set(-1) : this.set(radio.station);
    },
  };

  // ---- build the graph on the first gesture -----------------------------------------------------------------------------------
  const onGesture = () => {
    gestured = true;
  };
  for (const e of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(e, onGesture, { passive: true, capture: true });
    off.push(() => window.removeEventListener(e, onGesture, { capture: true }));
  }
  const canStart = () => gestured || (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true);

  function build() {
    try {
      b = getBuses();
      if (!b) {
        failed = true;
        return;
      }
      const noiseBuf = createNoiseBuffer(b.ac);
      noiseSrc = createNoiseSource(b.ac, noiseBuf);
      engine = createEngineVoice(b.ac, b.fx, noiseSrc);
      tyres = createTyres(b.ac, b.fx, noiseSrc);
      amb = createAmbience(b.ac, b.fx, noiseSrc);
      shots = createOneShots(b.ac, b.fx, noiseBuf);
      radioV = createRadio(b.ac, b.music, noiseBuf);
      if (radio.on) radioV.start(radio.station, b.ac.currentTime);
    } catch (err) {
      failed = true;
      console.warn('[autowala] sound unavailable:', err?.message || err);
      teardown();
    }
  }
  function teardown() {
    for (const x of [engine, tyres, amb, shots, radioV]) {
      try {
        x?.dispose();
      } catch {
        /* ignore */
      }
    }
    engine = tyres = amb = shots = radioV = null;
    if (noiseSrc) {
      safeStop(noiseSrc);
      safeDisconnect(noiseSrc);
      noiseSrc = null;
    }
  }

  // ---- events --------------------------------------------------------------------------------------------------------------------
  const offBus = ctx.game?.on?.((e) => {
    if (!e || disposed) return;
    switch (e.type) {
      case 'audio:volume':
        setBusLevels(e);
        break;
      case 'voice:line':
        voiceUntil = Math.max(voiceUntil, nowS() + (Number(e.ms) > 0 ? Number(e.ms) / 1000 : 3) + 0.4);
        break;
      case 'voice:start':
        voiceUntil = nowS() + 30;
        break;
      case 'voice:end':
        voiceUntil = nowS() + 0.3;
        break;
      case 'crash': {
        if (!shots || !running()) break;
        const t = nowS();
        if (t - lastHitAt < (e.guard ? 0.18 : 0.3)) break;
        lastHitAt = t;
        shots.crash(crashParams(e.strength, !!e.guard, cp));
        break;
      }
      case 'land':
        if (shots && running() && Number(e.impact) > 3) shots.land(landParams(e.impact, lp));
        break;
      default:
    }
  });
  if (offBus) off.push(offBus);

  const running = () => !!b && b.ac.state === 'running';

  // ---- per-frame ----------------------------------------------------------------------------------------------------------------
  function slowScan() {
    const tr = ctx.traffic?.vehicles;
    let count = 0;
    if (tr) for (let i = 0; i < tr.length; i++) {
      const o = tr[i];
      const dx = o.x - v.x;
      const dz = o.z - v.z;
      if (dx * dx + dz * dz < 3600) count++;
    }
    aIn.traffic = count;
    let pillars = 0;
    const col = ctx.world?.colliders;
    if (col?.near) {
      col.near(v.x, v.z, 16, pillarBuf);
      for (let i = 0; i < pillarBuf.length; i++) if (pillarBuf[i].tag === 'pillar') pillars++;
    }
    aIn.pillars = pillars;
    onPave = (ctx.world?.heightAt?.(v.x, v.z) || 0) > 0.1;
    const w = ctx.weather;
    aIn.rain = clamp01(Math.max(w?.rain || 0, w?.raining ? 1 : 0, state.weather || 0));
  }

  const system = {
    update(dt) {
      if (disposed || failed) return;
      const t0 = performance.now();
      // the R key / the pause of a menu: a menu eats the key press, the tap is dropped by the input when the menu closes
      if (ctx.input?.pressed?.('radio') && !state.menu) radioApi.cycle();
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!b) {
        if (!canStart()) return;
        build();
        if (!b) return;
      }
      if (b.ac.state !== 'running') return; // locked (Safari/iOS before a tap) or suspended (hidden tab): stay silent
      const now = b.ac.currentTime;
      const menu = state.menu;
      const sec = nowS();

      // engine -------------------------------------------------------------------------------------------------------------------
      const fd = state.forceDrive;
      let th = fd ? fd.throttle || 0 : ctx.input?.held?.('up') ? 1 : 0;
      if (!fd && th === 0 && dt > 0) {
        const a = (v.fwd - prevFwd) / dt; // a gamepad trigger has no key: infer pulling away from the speed rising
        if (a > 1.2) th = clamp(a / 7, 0, 1);
      }
      prevFwd = v.fwd;
      eIn.kmh = v.kmh;
      eIn.throttle = th;
      eIn.boosting = v.boosting;
      eIn.airborne = v.airborne;
      eIn.hold = !!menu;
      eIn.fuel = v.fuel;
      eIn.rpm = undefined;
      engineMix(eIn, eMix);
      engine.update(eMix, now);
      if (liftOff(prevTh, th, v.kmh) && !menu && sec - lastPopAt > 0.6) {
        lastPopAt = sec;
        shots.pops(2 + ((Math.random() * 3) | 0), 0.8);
      }
      prevTh = th;

      // tyres --------------------------------------------------------------------------------------------------------------------
      sIn.drifting = v.drifting;
      sIn.side = v.side;
      sIn.speed = v.speed;
      sIn.braking = v.braking;
      sIn.airborne = v.airborne;
      sIn.onPave = onPave;
      const skid = menu ? 0 : skidAmount(sIn);
      skidNow = skid;
      surfaceMix(menu ? 0 : v.kmh, onPave, v.airborne, surf);
      tyres.update(skid, skidHz(v.speed), surf.pave, surf.road, now);

      // ambience ----------------------------------------------------------------------------------------------------------------
      acc += dt;
      if (acc >= SLOW) {
        acc = 0;
        slowScan();
      }
      aIn.hour = ctx.clock?.hour ?? 12;
      aIn.menu = !!menu;
      ambienceMix(aIn, aMix);
      if (menu) {
        aMix.road *= 0.5;
        aMix.bed *= 0.6;
        aMix.metro *= 0.4;
      }
      amb.update(aMix, now, dt);

      // radio -------------------------------------------------------------------------------------------------------------------
      duck = radioDuck(sec, voiceUntil, menu);
      radioV.update(now, duck);

      const ms = performance.now() - t0;
      cost += (ms - cost) * 0.05;
    },
    dispose() {
      disposed = true;
      for (const f of off) f();
      off.length = 0;
      teardown();
      dropBuses();
      if (ctx.game && ctx.game.sound === api) delete ctx.game.sound;
      if (ctx.sound === api) delete ctx.sound;
    },
  };

  // ---- debug / HUD handles ------------------------------------------------------------------------------------------------------
  const api = {
    radio: radioApi,
    /** The buses ({ac, master, fx, voice, music}); same object voices/horns can use via getBuses(). */
    buses: () => b,
    /** Everything worth checking from the console or a test: states, mixes, gains, node counts, frame cost. */
    stats() {
      const g = (n) => (n ? Math.round(n.gain.value * 1000) / 1000 : null);
      return {
        built: !!b,
        failed,
        state: b ? b.ac.state : 'none',
        costMs: Math.round(cost * 1000) / 1000,
        sources: (engine?.nodes || 0) + (amb?.nodes || 0) + (radioV?.on ? radioV.nodes : 0) + (noiseSrc ? 1 : 0),
        oneShotsLive: shots?.live ?? 0,
        engine: { ...eMix, throttle: eIn.throttle },
        surface: { ...surf, onPave, skid: Math.round(skidNow * 100) / 100 },
        ambience: { ...aMix, traffic: aIn.traffic, pillars: aIn.pillars, rain: aIn.rain },
        duck,
        radio: { on: radio.on, station: radio.station, name: STATIONS[radio.station].name, step: radioV?.step ?? 0, nodes: radioV?.on ? radioV.nodes : 0 },
        buses: b ? { fx: g(b.fx), voice: g(b.voice), music: g(b.music), master: g(b.master) } : null,
      };
    },
    /** Force a one-shot (testing): kind 'guard' | 'crash' | 'land' | 'pops'. */
    test(kind, arg = 0.8) {
      if (!shots) return false;
      if (kind === 'guard') return shots.crash(crashParams(arg, true, cp));
      if (kind === 'crash') return shots.crash(crashParams(arg, false, cp));
      if (kind === 'land') return shots.land(landParams(arg * 14, lp));
      if (kind === 'pops') return shots.pops(3, 1);
      return false;
    },
    rpmFor: (kmh, throttle) => engineRpm(kmh, throttle),
  };
  ctx.sound = api;
  if (ctx.game) ctx.game.sound = api;

  ctx.addSnapshot?.(() => {
    const st = STATIONS[radio.station];
    return {
      radio: {
        station: radio.on ? radio.station : -1,
        name: st.name,
        te: st.te,
        on: radio.on,
        color: st.color,
        track: radio.on ? trackTitle(radio.station, radioV?.step ?? 0) : '',
        count: STATIONS.length,
      },
    };
  });
  ctx.addSystem(system);
}
