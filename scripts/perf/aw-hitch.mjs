// Autowala stutter hunter: drives the real game on the real GPU through scripted scenarios and reports, per scenario, every main-thread
// stall with its cause (long-animation-frame script attribution), frames over 50 ms, optional CPU profile (self AND inclusive time) and
// allocation sampling (per-frame garbage = GC pauses). Build the game first (see README.md); a `--minify false` build gives readable names.
//
//   node scripts/perf/aw-hitch.mjs --base http://127.0.0.1:5730 --port 9770 --tier medium --scenarios boot,drive,menus,weather,fares,rage
//        [--seconds 20] [--profile] [--heap] [--label x] [--w 1536 --h 864 --dpr 1.25] [--json out.json] [--no-lock] [--grace 3]
//
// Scenarios (each runs after the previous one, in the same session, like a real play session):
//   boot     load the page and start the game, measures page load -> game ready -> first seconds of play (no driving)
//   drive    an autopilot drives a random walk of the road graph at full throttle (new map tiles keep appearing)
//   menus    opens and closes pause / workshop / map / quests / radio
//   weather  rain on, then night, then clear dawn while driving
//   fares    teleports next to a waiting customer, picks them up, drives to the destination and drops them
//   rage     rams traffic so the chase / road-rage systems run
//   soak     drives for `--seconds` and compares the JS heap and renderer memory before / after (leak check)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = args.base || 'http://127.0.0.1:5730';
const W = +(args.w || 1536);
const H = +(args.h || 864);
const DPR = +(args.dpr || 1.25);
const SEC = +(args.seconds || 20);
const GRACE = +(args.grace ?? 3);
const tier = args.tier && args.tier !== true ? String(args.tier) : '';
const label = args.label && args.label !== true ? String(args.label) : `hitch-${tier || 'auto'}`;
const port = +(args.port || 9770);
const scenarios = String(args.scenarios || 'boot,drive,menus,weather,fares,rage').split(',').filter(Boolean);
const out = process.env.PERF_OUT || path.join(os.tmpdir(), 'jalebi-perf.jsonl');

/** Injected before any page script: recorders for frames, long tasks, long animation frames (with the script that caused them). */
const INIT = `(() => {
  const R = (window.__rec = { longs: [], loafs: [], marks: [], frames: [], errs: [] });
  const watch = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch (e) { R.errs.push(String(e)); } };
  watch('longtask', (e) => R.longs.push([e.startTime, e.duration]));
  watch('long-animation-frame', (e) => R.loafs.push({
    s: e.startTime, d: e.duration, b: e.blockingDuration, rs: e.renderStart, ss: e.styleAndLayoutStart,
    scripts: e.scripts.map((x) => ({ inv: x.invoker, type: x.invokerType, fn: x.sourceFunctionName, url: (x.sourceURL || '').split('/').pop(), pos: x.sourceCharPosition, d: x.duration, fsl: x.forcedStyleAndLayoutDuration, ex: x.executionStart, pause: x.pauseDuration })),
  }));
  window.__mark = (n) => R.marks.push([performance.now(), n]);
  // React: how many commits and how many components rendered (PerformedWork) per commit. A minimal DevTools hook is enough for React to report to.
  R.react = { commits: 0, rendered: 0, maxRendered: 0 };
  const countRendered = (f) => { let n = 0; const stack = [f]; while (stack.length) { const x = stack.pop(); if (!x) continue; if ((x.flags & 1) && typeof x.type === 'function') n++; if (x.sibling) stack.push(x.sibling); if (x.child) stack.push(x.child); } return n; };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject(r) { this.renderers.set(this.renderers.size + 1, r); return this.renderers.size; },
    onCommitFiberRoot(id, root) { try { const n = countRendered(root.current); R.react.commits++; R.react.rendered += n; if (n > R.react.maxRendered) R.react.maxRendered = n; } catch (e) { /* never break the page */ } },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
  let last = performance.now();
  const tick = (n) => { R.frames.push([n, n - last]); last = n; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  let g = null;
  Object.defineProperty(window, '__autowala', { configurable: true, get: () => g, set: (v) => { g = v; if (v) window.__mark('game-start'); } });
  // every shader program the renderer builds, with the moment and its cache key (what differs from its siblings says why it was needed)
  R.programs = [];
  const seenPrograms = new Set();
  const watchPrograms = () => {
    requestAnimationFrame(watchPrograms);
    const G = window.__autowala; const ps = G && G.gfx && G.gfx.renderer.info.programs;
    if (!ps || ps.length === seenPrograms.size) return;
    for (const p of ps) if (!seenPrograms.has(p.id)) { seenPrograms.add(p.id); R.programs.push({ t: performance.now(), id: p.id, name: p.name, key: String(p.cacheKey) }); }
  };
  requestAnimationFrame(watchPrograms);
  // an autopilot: follows a random walk of the road graph, re-places itself when stuck
  const P = (window.__pilot = { on: false, cur: -1, next: -1, prev: -1, seed: 12345, lastX: 0, lastZ: 0, lastT: 0, tele: 0, speedCap: 1 });
  const rnd = () => ((P.seed = (P.seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const choose = (city, nid, prev) => {
    const n = city.nodes[nid]; const outs = n.out.map((id) => city.edges[id]);
    const opts = outs.filter((e) => (e.a === nid ? e.b : e.a) !== prev);
    const e = (opts.length ? opts : outs)[Math.floor(rnd() * (opts.length || outs.length))];
    return e.a === nid ? e.b : e.a;
  };
  P.place = (nid) => {
    const G = window.__autowala; const city = G.world.city; const n = city.nodes[nid];
    P.cur = nid; P.prev = -1; P.next = choose(city, nid, -1);
    const t = city.nodes[P.next];
    G.debug.teleport(n.x, n.z, Math.atan2(t.x - n.x, t.z - n.z));
  };
  const loop = (now) => {
    requestAnimationFrame(loop);
    const G = window.__autowala; if (!P.on || !G) return;
    const city = G.world.city; const v = G.ctx.v;
    if (P.cur < 0) { let b = 1e12, bi = 0; city.nodes.forEach((n, i) => { const d = (n.x - v.x) ** 2 + (n.z - v.z) ** 2; if (d < b) { b = d; bi = i; } }); P.place(bi); }
    let tn = city.nodes[P.next];
    let dx = tn.x - v.x; let dz = tn.z - v.z; let dist = Math.hypot(dx, dz);
    if (dist < 16) { const nx = choose(city, P.next, P.cur); P.prev = P.cur; P.cur = P.next; P.next = nx; tn = city.nodes[nx]; dx = tn.x - v.x; dz = tn.z - v.z; dist = Math.hypot(dx, dz); }
    const err = wrap(Math.atan2(dx, dz) - v.heading);
    const steer = Math.max(-1, Math.min(1, -err * 2.2));
    const sharp = Math.abs(err) > 1.0;
    G.debug.drive({ steer, throttle: sharp && v.speed > 10 ? 0 : P.speedCap, brake: sharp && v.speed > 12 ? 0.6 : 0 });
    if (now - P.lastT > 1500) {
      if (Math.hypot(v.x - P.lastX, v.z - P.lastZ) < 2 && !G.ctx.state.menu) { P.tele++; P.place(P.cur); }
      P.lastX = v.x; P.lastZ = v.z; P.lastT = now;
    }
  };
  requestAnimationFrame(loop);
})();`;

const q = (s, p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))]?.toFixed(2);

/** Cut the recorded data to [t0, t1) and summarise it. `grace` seconds at the start are excluded from the hitch count. */
function summarise(rec, t0, t1, grace = 0) {
  const frames = rec.frames.filter(([n]) => n >= t0 && n < t1).map(([n, d]) => ({ n, d }));
  const counted = frames.filter((f) => f.n >= t0 + grace * 1000);
  const ds = counted.map((f) => f.d).sort((a, b) => a - b);
  const mean = ds.reduce((a, b) => a + b, 0) / Math.max(1, ds.length);
  const longs = rec.longs.filter(([s]) => s >= t0 && s < t1);
  const loafs = rec.loafs.filter((l) => l.s >= t0 && l.s < t1).sort((a, b) => b.d - a.d);
  const lateLongs = longs.filter(([s]) => s >= t0 + grace * 1000);
  // a program's kind: the shader id in its cache key ('physical', 'basic', 'sprite', 'points'...) and, for lit ones, the light counts (numbers after
  // the precision / colour space tokens differ between light sets)
  const kindOf = (p) => (p.key.split(',').find((tok) => /^[a-z]{3,}$/.test(tok) && !/^(highp|mediump|lowp|true|false|srgb|linear)/.test(tok)) || '?');
  const firstOf = new Map();
  for (const p of rec.programs || []) if (!firstOf.has(kindOf(p))) firstOf.set(kindOf(p), p);
  const programs = (rec.programs || []).filter((p) => p.t >= t0 && p.t < t1).map((p) => {
    const base = firstOf.get(kindOf(p));
    const a = p.key.split(',');
    const b = base ? base.key.split(',') : [];
    const diff = base === p ? 'first of its kind' : a.map((v, i) => (v !== b[i] ? `#${i} ${String(b[i]).slice(0, 14)}->${String(v).slice(0, 14)}` : null)).filter(Boolean).slice(0, 4).join('; ');
    return `${((p.t - t0) / 1000).toFixed(1)}s ${kindOf(p)}: ${diff}`;
  });
  return {
    programsCreated: programs.length, programList: programs,
    sec: +((t1 - t0) / 1000).toFixed(1), frames: counted.length, fps: +(1000 / (mean || 1)).toFixed(1), meanMs: +mean.toFixed(2),
    p95: q(ds, 0.95), p99: q(ds, 0.99), maxMs: +(ds[ds.length - 1] || 0).toFixed(1),
    hitches50: counted.filter((f) => f.d > 50).length, hitches100: counted.filter((f) => f.d > 100).length,
    hitchMs: Math.round(counted.filter((f) => f.d > 50).reduce((a, f) => a + f.d, 0)),
    longTasks: lateLongs.length, longTaskMs: Math.round(lateLongs.reduce((a, [, d]) => a + d, 0)), worstLong: Math.round(Math.max(0, ...lateLongs.map(([, d]) => d))),
    longTasksAll: longs.length, longTaskMsAll: Math.round(longs.reduce((a, [, d]) => a + d, 0)),
    loafs: loafs.slice(0, 6).map((l) => ({
      at: +((l.s - t0) / 1000).toFixed(2), ms: Math.round(l.d), block: Math.round(l.b), render: Math.round(l.ss ? l.s + l.d - l.ss : 0),
      scripts: l.scripts.sort((a, b) => b.d - a.d).slice(0, 3).map((x) => `${x.type}:${x.fn || x.inv || '?'}@${x.url}:${x.pos} ${Math.round(x.d)}ms${x.fsl ? ` (forced layout ${Math.round(x.fsl)})` : ''}`),
    })),
  };
}

/** Self + inclusive time by function from a V8 profile. */
function profileTables(profile, top = 28) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const key = (n) => `${n.callFrame.functionName || '(anon)'}  ${(n.callFrame.url || '').replace(/^.*\/(assets|src)\//, '$1/')}:${n.callFrame.lineNumber + 1}`;
  const self = new Map();
  const incl = new Map();
  const dt = profile.timeDeltas || [];
  let total = 0;
  profile.samples.forEach((sid, i) => {
    const d = dt[i] || 0;
    total += d;
    let n = nodes.get(sid);
    self.set(key(n), (self.get(key(n)) || 0) + d);
    const seen = new Set();
    while (n) {
      const k = key(n);
      if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + d); }
      n = nodes.get(parent.get(n.id));
    }
  });
  const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => ({ fn: k, ms: +(v / 1000).toFixed(1), pct: +((v / total) * 100).toFixed(1) }));
  // self time by where the code lives: the game chunk, three.js, React, the browser (native GL calls have no url), idle
  const byFile = new Map();
  profile.samples.forEach((sid, i) => {
    const cf = nodes.get(sid).callFrame;
    const f = cf.functionName === '(idle)' ? 'idle' : cf.functionName === '(program)' ? '(program: browser / driver)' : cf.functionName === '(garbage collector)' ? 'GC' : !cf.url ? 'native (GL calls etc)' : /three/.test(cf.url) ? 'three.js' : /react/.test(cf.url) ? 'react' : /Autowala/.test(cf.url) ? 'game code' : 'other js';
    byFile.set(f, (byFile.get(f) || 0) + (dt[i] || 0));
  });
  const files = Object.fromEntries([...byFile.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${(v / 1000).toFixed(0)} ms ${((v / total) * 100).toFixed(1)}%`]));
  return { totalMs: Math.round(total / 1000), self: fmt(self), incl: fmt(incl), files };
}

/** Allocation sampling profile -> bytes per allocating function. */
function heapTable(profile, seconds, top = 25) {
  const by = new Map();
  const walk = (n) => {
    const k = `${n.callFrame.functionName || '(anon)'}  ${(n.callFrame.url || '').replace(/^.*\/(assets|src)\//, '$1/')}:${n.callFrame.lineNumber + 1}`;
    const self = (n.selfSize || 0);
    if (self) by.set(k, (by.get(k) || 0) + self);
    (n.children || []).forEach(walk);
  };
  walk(profile.head);
  const total = [...by.values()].reduce((a, b) => a + b, 0) || 1;
  return { totalMB: +(total / 1048576).toFixed(1), perSecKB: Math.round(total / 1024 / seconds), top: [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => ({ fn: k, kbPerSec: Math.round(v / 1024 / seconds), pct: +((v / total) * 100).toFixed(1) })) };
}

async function launchRetrying() {
  // under load (other agents' builds and test runs) Chrome sometimes needs longer than the launcher waits: try again
  for (let attempt = 1; ; attempt++) {
    try {
      return await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
    } catch (err) {
      if (attempt >= 3) throw err;
      console.error(`Chrome did not start (attempt ${attempt}), retrying`);
    }
  }
}

async function run() {
  const c = await launchRetrying();
  const report = { label, tier: tier || 'auto', viewport: `${W}x${H}@${DPR}`, base, scenarios: {} };
  try {
    await c.viewport(W, H, DPR, false);
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
    if (tier) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); if (String(k).startsWith('jalebi.autowala.v')) { try { const d = JSON.parse(v || '{}'); d.settings = { ...(d.settings || {}), quality: '${tier}' }; return JSON.stringify(d); } catch { return v; } } return v; }; })();` });
    await c.send('Profiler.enable');
    await c.send('HeapProfiler.enable');
    const now = () => c.ev('performance.now()');
    const mark = (n) => c.ev(`window.__mark(${JSON.stringify(n)}); performance.now()`);
    const pull = () => c.ev('JSON.stringify(window.__rec)').then(JSON.parse);
    const phase = async (name, fn, { grace = 0, profile = false, heap = false } = {}) => {
      const t0 = await mark(`${name}:start`);
      const react0 = await c.ev('({ ...window.__rec.react })');
      let prof = null;
      let heapProf = null;
      if (heap) await c.send('HeapProfiler.startSampling', { samplingInterval: 4096 });
      if (profile) { await c.send('Profiler.setSamplingInterval', { interval: 250 }); await c.send('Profiler.start'); }
      const extra = await fn();
      if (profile) prof = (await c.send('Profiler.stop')).profile;
      if (heap) heapProf = (await c.send('HeapProfiler.stopSampling')).profile;
      const t1 = await mark(`${name}:end`);
      await c.sleep(300); // let observers flush
      const rec = await pull();
      const s = summarise(rec, t0, t1, grace);
      const dc = rec.react.commits - react0.commits;
      s.react = { commits: dc, componentsPerCommit: dc ? +((rec.react.rendered - react0.rendered) / dc).toFixed(1) : 0, commitsPerSec: +(dc / ((t1 - t0) / 1000)).toFixed(1) };
      if (prof) s.profile = profileTables(prof);
      if (heapProf) s.alloc = heapTable(heapProf, (t1 - t0) / 1000);
      if (extra) s.extra = extra;
      report.scenarios[name] = s;
      return s;
    };
    const play = (s) => c.sleep(s * 1000);
    const sysTimes = () => c.ev('(() => { const p = window.__autowala && window.__autowala.perf; return p ? p.report() : null; })()');
    const resetSys = () => c.ev('(() => { const p = window.__autowala && window.__autowala.perf; if (p) p.reset(); return true; })()');

    // ---- boot: page load -> game start -> first seconds of play
    if (args.bootprofile) {
      // a profile that survives the navigation to the game: start it on a same-origin page, so the renderer process is kept
      await c.send('Page.navigate', { url: `${base}/robots.txt` });
      await c.sleep(800);
      await c.send('Profiler.setSamplingInterval', { interval: 250 });
      await c.send('Profiler.start');
    }
    await c.send('Page.navigate', { url: `${base}/play/autowala` });
    await c.waitFor("!!document.querySelector('.aw-go')", 180000);
    const tReady = await mark('start-screen');
    if (args.bootprofile) report.bootProfile = profileTables((await c.send('Profiler.stop')).profile, 34);
    await c.waitFor('!!window.__autowala', 60000);
    report.boot = await c.ev('window.__autowalaBoot ? { ms: window.__autowalaBoot.ms, quality: window.__autowalaBoot.quality } : null');
    report.bootSteps = await c.ev('(() => { const g = window.__autowala; return g && g.boot ? { world: g.boot.world, systems: g.boot.systems, compile: g.boot.compile, programs: g.boot.programs, warm: g.boot.warm } : null; })()');
    const rec0 = await pull();
    const gs = rec0.marks.find((m) => m[1] === 'game-start');
    const bootRange = summarise(rec0, 0, gs ? gs[0] : tReady, 0);
    report.bootPhase = { ...bootRange, loadToStartScreenMs: Math.round(tReady) };
    const tClick = await mark('click');
    if (gs) report.startScreen = summarise(await pull(), gs[0], tClick, 0);
    await c.ev("window.__autowala.debug.drive(null); document.querySelector('.aw-go').click(); true");
    await c.ev('window.__gfx = window.__autowala.gfx.renderer; true');
    if (scenarios.includes('boot')) {
      await resetSys();
      await phase('boot-play', () => play(8), { grace: 0, profile: !!args.profile });
      report.scenarios['boot-play'].sys = await sysTimes();
    } else {
      await play(4);
    }
    const memInfo = () => c.ev('(() => { const i = window.__autowala.gfx.renderer.info; return { geo: i.memory.geometries, tex: i.memory.textures, programs: i.programs ? i.programs.length : 0, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null }; })()');
    report.tierNow = await c.ev('({ tier: window.__autowala.gfx.quality, pr: window.__autowala.gfx.renderer.getPixelRatio() })');

    const opts = { grace: GRACE, profile: !!args.profile, heap: !!args.heap };
    for (const name of scenarios) {
      if (name === 'boot') continue;
      await resetSys();
      if (name === 'drive') {
        await c.ev('window.__autowala.debug.hour(11); window.__autowala.debug.weather(0); window.__pilot.on = true; true');
        await phase('drive', () => play(SEC), opts);
      } else if (name === 'menus') {
        await phase('menus', async () => {
          await c.ev('window.__pilot.on = false; window.__autowala.debug.drive(null); true');
          const open = (n) => c.ev(`window.__autowala.ctx.openMenu(${JSON.stringify(n)}); true`);
          const close = () => c.ev('window.__autowala.ctx.closeMenu(); true');
          const key = (k) => c.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)} })); window.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(k)} })); true`);
          const times = {};
          for (const n of ['pause', 'workshop', 'quests', 'map']) {
            const t = await c.ev('performance.now()');
            if (n === 'map') await key('m'); else await open(n);
            await c.sleep(1800);
            if (n === 'map') await key('m'); else await close();
            await c.sleep(800);
            times[n] = Math.round((await c.ev('performance.now()')) - t);
          }
          await key('r'); await c.sleep(600); await key('r'); await c.sleep(600);
          return times;
        }, { ...opts, grace: 0 });
        await c.ev('window.__autowala.ctx.closeMenu(); true');
      } else if (name === 'weather') {
        await phase('weather', async () => {
          await c.ev('window.__pilot.on = true; window.__autowala.debug.weather(1); true');
          await play(SEC / 3);
          await c.ev('window.__autowala.debug.weather(0.6); window.__autowala.debug.hour(22.5); true');
          await play(SEC / 3);
          await c.ev('window.__autowala.debug.weather(0); window.__autowala.debug.hour(5.6); true');
          await play(SEC / 3);
        }, opts);
      } else if (name === 'fares') {
        await phase('fares', () => c.ev(FARES_SCRIPT(SEC)), { ...opts, grace: 0 });
      } else if (name === 'rage') {
        await phase('rage', () => c.ev(RAGE_SCRIPT(SEC)), { ...opts, grace: 0 });
      } else if (name === 'eval') {
        // experiments: `--eval file.js` is an async function body run in the page; its return value is printed (see docs/perf/aw-cpu.md)
        await phase('eval', async () => c.ev(`(async () => { ${fs.readFileSync(String(args.eval), 'utf8')} })()`), { ...opts, grace: 0, profile: false, heap: false });
      } else if (name === 'shots') {
        // the same fixed camera, hour and weather on every build: JPEGs to compare before / after (named <shots>/<label>-<view>.jpg)
        const dir = String(args.shots || path.join(os.tmpdir(), 'aw-cpu-shots'));
        const views = [
          { id: 'dusk', hour: 17.6, weather: 0 },
          { id: 'noon', hour: 12, weather: 0 },
          { id: 'night', hour: 21.5, weather: 0 },
          { id: 'rain-night', hour: 21.5, weather: 0.9 },
        ];
        await phase('shots', async () => {
          await c.ev('window.__pilot.on = false; window.__autowala.debug.drive(null); true');
          const info = await c.ev(`(() => { const G = window.__autowala; const g = G.world.city.poiById.garage.front; const e = G.world.city.edges[g.edge]; G.debug.teleport(g.x, g.z, Math.atan2(e.dx, e.dz)); return { x: g.x, z: g.z, h: Math.atan2(e.dx, e.dz) }; })()`);
          const files = [];
          for (const v of views) {
            await c.ev(`(() => { const G = window.__autowala; const i = ${JSON.stringify(info)}; G.debug.hour(${v.hour}); G.debug.weather(${v.weather}); G.debug.cam({ x: i.x - Math.sin(i.h) * 9 + Math.cos(i.h) * 2.5, y: 4.2, z: i.z - Math.cos(i.h) * 9 - Math.sin(i.h) * 2.5, yaw: i.h, pitch: -0.12, fov: 62 }); })()`);
            await c.sleep(v.weather ? 7000 : 4500); // the sky, the lamp lights and the rain settle
            const file = path.join(dir, `${label}-${v.id}.jpg`);
            // a JPEG of the page at 70 % size (the proofs in docs/perf/ stay under 150 KB)
            const r = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 68, clip: { x: 0, y: 0, width: W, height: H, scale: 0.7 } });
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
            files.push(file);
          }
          await c.ev('window.__autowala.debug.cam(null); window.__autowala.debug.weather(0); true');
          return files;
        }, { ...opts, grace: 0, profile: false, heap: false });
      } else if (name === 'cycles') {
        // enter / leave the game N times in the same tab (client-side navigation): the heap and the renderer's memory must come back each time
        const n = +(args.cycles || 5);
        const rows = [];
        const go = (path) => c.ev(`history.pushState({}, '', ${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent('popstate')); true`);
        const snapshot = async (label) => {
          await c.send('HeapProfiler.collectGarbage');
          const heap = await c.ev('performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null');
          const g = await c.ev('window.__autowala ? { geo: window.__autowala.gfx.renderer.info.memory.geometries, tex: window.__autowala.gfx.renderer.info.memory.textures, programs: window.__autowala.gfx.renderer.info.programs.length } : null');
          const nodes = await c.ev('document.getElementsByTagName("*").length');
          const ctxs = await c.ev('document.querySelectorAll("canvas").length');
          rows.push({ label, heapMB: heap, ...(g || {}), domNodes: nodes, canvases: ctxs });
        };
        await phase('cycles', async () => {
          await c.ev('window.__pilot.on = false; true');
          await snapshot('start (in game)');
          for (let i = 1; i <= n; i++) {
            await go('/');
            await c.sleep(1500);
            await snapshot(`left #${i}`);
            await go('/play/autowala');
            await c.waitFor("!!document.querySelector('.aw-go')", 120000);
            await c.ev("document.querySelector('.aw-go').click(); true");
            await c.waitFor('!!window.__autowala', 30000);
            await c.ev('window.__gfx = window.__autowala.gfx.renderer; window.__pilot.on = true; true');
            await c.sleep(6000);
            await snapshot(`in game #${i} (6 s of driving)`);
          }
          return rows;
        }, { grace: 0 });
      } else if (name === 'soak') {
        await c.ev('window.__pilot.on = true; window.__autowala.debug.hour(11); window.__autowala.debug.weather(0); true');
        await c.send('HeapProfiler.collectGarbage');
        const before = await memInfo();
        const s = await phase('soak', () => play(SEC), { ...opts });
        await c.send('HeapProfiler.collectGarbage');
        s.memBefore = before;
        s.memAfter = await memInfo();
      }
      if (report.scenarios[name]) report.scenarios[name].sys = await sysTimes();
      report.scenarios[name] && (report.scenarios[name].mem = await memInfo());
    }
    if (args.shot) await c.shot(String(args.shot));
    report.errors = c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource/.test(l)).slice(0, 10);
    report.pilotTeleports = await c.ev('window.__pilot.tele');
  } finally {
    c.close();
  }
  return report;
}

/** In-page script: finds a waiting customer, teleports beside them, presses E, drives to the destination with the autopilot's steering. Resolves when done / timed out. */
const FARES_SCRIPT = (seconds) => `(async () => {
  const G = window.__autowala; const ctx = G.ctx; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = (k) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); };
  const log = [];
  window.__pilot.on = false; G.debug.drive(null);
  const t0 = performance.now();
  for (let trip = 0; trip < 2 && performance.now() - t0 < ${seconds} * 1000; trip++) {
    // wait for someone to be waiting
    let w = null; for (let i = 0; i < 50 && !w; i++) { w = ctx.fares.waiting && ctx.fares.waiting[0]; if (!w) { G.debug.step(2); await sleep(100); } }
    if (!w) { log.push('no customer'); break; }
    G.debug.teleport(w.x + 3, w.z + 3, 0); await sleep(400);
    for (let i = 0; i < 12 && !ctx.fares.trip; i++) { press('e'); await sleep(350); const ch = document.querySelector('[class*="choice"] button, .aw-fc button'); if (ch && !ctx.fares.trip) ch.click(); }
    log.push('trip:' + (ctx.fares.trip ? ctx.fares.trip.status : 'none'));
    if (!ctx.fares.trip) continue;
    // teleport near the destination, then drive in and drop off
    const d = ctx.fares.trip.dest; G.debug.teleport(d.front.x + 2, d.front.z + 2, 0); await sleep(500);
    for (let i = 0; i < 14 && ctx.fares.trip; i++) { press('e'); await sleep(450); }
    log.push('dropped:' + !ctx.fares.trip);
    await sleep(1500);
  }
  return log;
})()`;

/** In-page script: aims the auto at the nearest traffic vehicles so the crash / rage systems run. */
const RAGE_SCRIPT = (seconds) => `(async () => {
  const G = window.__autowala; const ctx = G.ctx; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__pilot.on = false; const t0 = performance.now(); let hits = 0; let maxRage = 0;
  const off = G.on((e) => { if (e.type === 'traffic:hit') hits++; });
  let id = 0; const stop = () => performance.now() - t0 > ${seconds} * 1000;
  const aim = () => {
    const v = ctx.v; const list = ctx.traffic && ctx.traffic.vehicles || []; let best = null, bd = 1e12;
    for (const t of list) { const d = (t.x - v.x) ** 2 + (t.z - v.z) ** 2; if (d < bd && d > 25) { bd = d; best = t; } }
    if (!best) return;
    let e = Math.atan2(best.x - v.x, best.z - v.z) - v.heading; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
    G.debug.drive({ steer: Math.max(-1, Math.min(1, -e * 2.5)), throttle: 1, boost: true });
  };
  const loop = () => { if (stop()) return; id = requestAnimationFrame(loop); aim(); if (ctx.rage) maxRage = Math.max(maxRage, ctx.rage.chasers || 0); };
  loop();
  while (!stop()) { await sleep(500); if (ctx.traffic && ctx.traffic.vehicles && ctx.traffic.vehicles.length < 3) {} }
  cancelAnimationFrame(id); off(); G.debug.drive(null);
  return { hits, maxChasers: maxRage };
})()`;

const row = args['no-lock'] ? await run() : await withBenchLock(run);
fs.appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), kind: 'aw-hitch', ...row }) + '\n');
if (args.json) fs.writeFileSync(String(args.json), JSON.stringify(row, null, 1));
const f = (o) => Object.entries(o).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
console.log(`== ${row.label}  tier=${row.tier} (now ${JSON.stringify(row.tierNow)})  ${row.viewport}`);
console.log(`boot: ${JSON.stringify(row.boot)} steps=${JSON.stringify(row.bootSteps)}`);
console.log(`bootPhase: ${f({ ...row.bootPhase, loafs: undefined, programList: undefined })}`);
if (row.startScreen) { const { loafs, programList, ...rest } = row.startScreen; console.log(`startScreen (game running, start menu up, before the click): ${f(rest)}`); for (const l of loafs.slice(0, 3)) console.log(`   LoAF @${l.at}s ${l.ms}ms: ${l.scripts.join(' | ')}`); }
for (const l of row.bootPhase.loafs) console.log(`   LoAF @${l.at}s ${l.ms}ms: ${l.scripts.join(' | ')}`);
if (row.bootProfile) {
  const b = row.bootProfile;
  console.log(`   boot profile ${b.totalMs} ms; by place: ${JSON.stringify(b.files)}`);
  console.log('   SELF:'); for (const p of b.self.slice(0, 20)) console.log(`      ${String(p.ms).padStart(7)} ms ${String(p.pct).padStart(5)}%  ${p.fn}`);
  console.log('   INCLUSIVE:'); for (const p of b.incl) console.log(`      ${String(p.ms).padStart(7)} ms ${String(p.pct).padStart(5)}%  ${p.fn}`);
}
for (const [name, s] of Object.entries(row.scenarios)) {
  const { loafs, profile, alloc, sys, extra, mem, memBefore, memAfter, programList, react, ...rest } = s;
  console.log(`-- ${name}: ${f(rest)}`);
  if (react) console.log(`   react: ${react.commits} commits (${react.commitsPerSec}/s), ${react.componentsPerCommit} components rendered per commit`);
  if (programList && programList.length) { console.log(`   programs created in this phase (${programList.length}):`); for (const p of programList.slice(0, 40)) console.log(`      ${p}`); }
  if (mem) console.log(`   mem ${JSON.stringify(mem)}${memBefore ? ` before=${JSON.stringify(memBefore)} after=${JSON.stringify(memAfter)}` : ''}`);
  if (name === 'cycles' && Array.isArray(extra)) for (const r of extra) console.log(`   ${JSON.stringify(r)}`);
  else if (extra) console.log(`   extra ${JSON.stringify(extra, null, name === 'eval' ? 1 : 0)}`);
  if (sys) {
    console.log(`   frame cost ms avg/max ${sys.frame.avg}/${sys.frame.max} | phases: ${Object.entries(sys.phases).map(([k, v]) => `${k} ${v.avg}/${v.max}`).join('  ')}`);
    console.log(`   systems (avg/max ms): ${Object.entries(sys.systems).sort((a, b) => b[1].max - a[1].max).map(([k, v]) => `${k} ${v.avg}/${v.max}`).join('  ')}`);
    const slowShow = [...sys.slow.filter((f) => f.programs > 0 || f.textures > 0 || f.geometries > 0), ...sys.slow.filter((f) => !(f.programs > 0 || f.textures > 0 || f.geometries > 0)).sort((a, b) => b.ms - a.ms).slice(0, 8)];
    console.log(`   slow frames (> 33 ms): ${sys.slowCount} total; with new programs/textures/geometries first, then the worst others`);
    for (const f of slowShow) console.log(`   slow frame ${f.ms} ms: ${Object.entries(f.phases).filter(([, v]) => v > 1).map(([k, v]) => `${k}=${v}`).join(' ')}${f.sys ? ` top-system ${f.sys}` : ''}${f.programs ? ` +${f.programs} programs` : ''}${f.textures ? ` +${f.textures} textures` : ''}${f.geometries ? ` +${f.geometries} geometries` : ''}`);
  }
  for (const l of loafs) console.log(`   LoAF @${l.at}s ${l.ms}ms (block ${l.block}, render ${l.render}): ${l.scripts.join(' | ')}`);
  if (alloc) { console.log(`   alloc: ${alloc.totalMB} MB total, ${alloc.perSecKB} KB/s`); for (const a of alloc.top.slice(0, 14)) console.log(`      ${String(a.kbPerSec).padStart(6)} KB/s ${String(a.pct).padStart(5)}%  ${a.fn}`); }
  if (profile) {
    console.log(`   profile ${profile.totalMs} ms; by place: ${JSON.stringify(profile.files)}`);
    console.log('   SELF:');
    for (const p of profile.self.slice(0, 16)) console.log(`      ${String(p.ms).padStart(7)} ms ${String(p.pct).padStart(5)}%  ${p.fn}`);
    console.log('   INCLUSIVE:');
    for (const p of profile.incl.slice(0, 26)) console.log(`      ${String(p.ms).padStart(7)} ms ${String(p.pct).padStart(5)}%  ${p.fn}`);
  }
}
if (row.errors.length) console.log('errors:', row.errors);
console.log('pilot teleports (stuck re-placements):', row.pilotTeleports);
process.exit(0);
