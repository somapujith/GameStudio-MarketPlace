// Frame-time profiler for the game loop: how long each phase (simulate, world, camera, render, snapshot) and each gameplay system takes,
// and a ring of the slow frames with the phase / system that caused them. It never allocates in a normal frame (typed arrays and numbers),
// so it can stay on in production: `__autowala.perf.report()` in the console, and the perf harness (scripts/perf/aw-hitch.mjs) reads it.
//
//   const perf = createFramePerf();
//   perf.begin();
//   ... simulate ...      perf.lap(PHASE.sim);
//   ... world.update ...  perf.lap(PHASE.world);
//   perf.sys(index, ms)                       // inside the systems loop (index from perf.nameSystem)
//   perf.end({ programs, textures, geometries });   // counters of the renderer, to tell a shader compile from an upload
//   perf.begin(dtMs) takes the frame INTERVAL too, and perf.markPlay() starts the clock of the hitch counters: frames over 33 / 50 / 100 ms
//   between rAF callbacks once `graceMs` of play have passed (the game's target is zero over 50 ms after the first 3 s).
export const PHASES = ['sim', 'world', 'camera', 'render', 'snap'];
export const PHASE = Object.fromEntries(PHASES.map((n, i) => [n, i]));

const MAX_SYSTEMS = 40;
const EMA = 0.05;

/** @param {{ now?: () => number, slowMs?: number, ring?: number }} opts */
export function createFramePerf({ now = () => performance.now(), slowMs = 33, ring = 48, graceMs = 3000 } = {}) {
  const phaseAvg = new Float64Array(PHASES.length);
  const phaseMax = new Float64Array(PHASES.length);
  const cur = new Float64Array(PHASES.length); // this frame's phase times
  const sysAvg = new Float64Array(MAX_SYSTEMS);
  const sysMax = new Float64Array(MAX_SYSTEMS);
  const sysCur = new Float64Array(MAX_SYSTEMS);
  const names = [];
  const slow = [];
  let frameAvg = 0;
  let frameMax = 0;
  let frames = 0;
  let slowCount = 0;
  let t0 = 0;
  let tl = 0;
  let lastPrograms = -1;
  let lastTextures = -1;
  let lastGeometries = -1;
  let lastTotal = 0;
  let started = false;
  let playAt = -1; // when play started (markPlay); frames before playAt + graceMs are not counted as hitches
  let dtNow = 0;
  const hitch = { frames: 0, over33: 0, over50: 0, over100: 0, worst: 0, ms50: 0 };

  const nameSystem = (name) => {
    const i = names.indexOf(name);
    if (i >= 0) return i;
    if (names.length >= MAX_SYSTEMS) return MAX_SYSTEMS - 1;
    names.push(name);
    return names.length - 1;
  };

  const begin = (dtMs = 0) => {
    t0 = tl = now();
    dtNow = dtMs;
    cur.fill(0);
    sysCur.fill(0);
  };

  /** Close the phase that started at the previous lap (or at begin) and start the next one. */
  const lap = (phase) => {
    const t = now();
    cur[phase] += t - tl;
    tl = t;
  };

  const sys = (index, ms) => {
    sysCur[index] += ms;
  };

  const end = (counters) => {
    const total = now() - t0;
    lastTotal = total;
    frames++;
    if (!started) {
      // the first frames are shader compiles and uploads, not steady state: keep them out of the averages (they stay in `slow`)
      started = frames > 3;
    }
    for (let i = 0; i < PHASES.length; i++) {
      if (started) {
        phaseAvg[i] += (cur[i] - phaseAvg[i]) * EMA;
        if (cur[i] > phaseMax[i]) phaseMax[i] = cur[i];
      }
    }
    for (let i = 0; i < names.length; i++) {
      if (started) {
        sysAvg[i] += (sysCur[i] - sysAvg[i]) * EMA;
        if (sysCur[i] > sysMax[i]) sysMax[i] = sysCur[i];
      }
    }
    if (started) {
      frameAvg += (total - frameAvg) * EMA;
      if (total > frameMax) frameMax = total;
    }
    if (playAt >= 0 && dtNow > 0 && t0 - playAt >= graceMs) {
      hitch.frames++;
      if (dtNow > 33) hitch.over33++;
      if (dtNow > 50) {
        hitch.over50++;
        hitch.ms50 += dtNow;
      }
      if (dtNow > 100) hitch.over100++;
      if (dtNow > hitch.worst) hitch.worst = dtNow;
    }
    if (total > slowMs) {
      slowCount++;
      let topSys = -1;
      for (let i = 0; i < names.length; i++) if (topSys < 0 || sysCur[i] > sysCur[topSys]) topSys = i;
      const dPrograms = counters && lastPrograms >= 0 ? counters.programs - lastPrograms : 0;
      const dTextures = counters && lastTextures >= 0 ? counters.textures - lastTextures : 0;
      const dGeometries = counters && lastGeometries >= 0 ? counters.geometries - lastGeometries : 0;
      const entry = {
        at: Math.round(t0),
        ms: Math.round(total),
        phases: Object.fromEntries(PHASES.map((n, i) => [n, Math.round(cur[i])])),
        sys: topSys >= 0 && sysCur[topSys] > 1 ? `${names[topSys]} ${Math.round(sysCur[topSys])}` : null,
        programs: dPrograms,
        textures: dTextures,
        geometries: dGeometries,
      };
      if (slow.length >= ring) slow.shift();
      slow.push(entry);
    }
    if (counters) {
      lastPrograms = counters.programs;
      lastTextures = counters.textures;
      lastGeometries = counters.geometries;
    }
    return total;
  };

  const round = (x) => Math.round(x * 1000) / 1000;
  const report = () => ({
    frames,
    slowCount,
    frame: { avg: round(frameAvg), max: round(frameMax) },
    phases: Object.fromEntries(PHASES.map((n, i) => [n, { avg: round(phaseAvg[i]), max: round(phaseMax[i]) }])),
    hitches: { ...hitch, worst: Math.round(hitch.worst), ms50: Math.round(hitch.ms50), playing: playAt >= 0 },
    systems: Object.fromEntries(names.map((n, i) => [n, { avg: round(sysAvg[i]), max: round(sysMax[i]) }])),
    slow: slow.slice(),
  });

  const reset = () => {
    phaseAvg.fill(0);
    phaseMax.fill(0);
    sysAvg.fill(0);
    sysMax.fill(0);
    frameAvg = 0;
    frameMax = 0;
    frames = 0;
    slowCount = 0;
    started = false;
    slow.length = 0;
    hitch.frames = hitch.over33 = hitch.over50 = hitch.over100 = hitch.worst = hitch.ms50 = 0;
  };

  /** Play starts now: the hitch counters begin after `graceMs`. (Calling it again restarts the clock and the counters.) */
  const markPlay = (at = now()) => {
    playAt = at;
    hitch.frames = hitch.over33 = hitch.over50 = hitch.over100 = hitch.worst = hitch.ms50 = 0;
  };

  return {
    begin, lap, sys, end, nameSystem, report, reset, markPlay,
    get slowCount() { return slowCount; },
    /** The total time of the last finished frame (ms): the game's background work waits while this is high. */
    get last() { return lastTotal; },
  };
}
