// What does the Autowala HUD cost the main thread while the player drives? (ui-touch)
//
//   node scripts/perf/aw-hud.mjs --base http://127.0.0.1:5871 --port 9944 --tier low --cmd ab [--rounds 4] [--seconds 6] [--w 1536 --h 864 --dpr 1.25] [--touch 844x390@2]
//   node scripts/perf/aw-hud.mjs ... --cmd profile    # V8 CPU profile with the HUD on, heaviest self-time functions
//
// The game is started like bench.mjs does and the tier is held (the shared governor is switched off) so only the HUD changes between windows. The car
// keeps changing speed (throttle alternates), so the HUD gets its ~10 Hz of changing snapshots, like a player's. Variants are applied round-robin in ONE page
// session (the machine drifts 20-40 % over a minute): `hud` (the page as it is) and `nohud` (everything over the canvas is display:none, the lower bound).
// Per window: frame times (rAF deltas: mean, p50, p95, p99, max, frames > 33 / 50 ms) and the long-animation-frame entries (count, summed duration, the slowest).
import fs from 'node:fs';
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = String(args.base || 'http://127.0.0.1:5871');
const port = +(args.port || 9944);
const cmd = String(args.cmd || 'ab');
const tier = args.tier && args.tier !== true ? String(args.tier) : 'low';
const ROUNDS = +(args.rounds || 4);
const SEC = +(args.seconds || 6);
const SETTLE = +(args.settle || 1.5);
let W = +(args.w || 1536);
let H = +(args.h || 864);
let DPR = +(args.dpr || 1.25);
let touch = false;
if (args.touch && args.touch !== true) {
  const m = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(String(args.touch));
  if (m) {
    W = +m[1];
    H = +m[2];
    DPR = +(m[3] || 2);
    touch = true;
  }
}

const START = async (c) => {
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); if (String(k).startsWith('jalebi.autowala.v')) { try { const d = JSON.parse(v || '{}'); d.settings = { ...(d.settings || {}), quality: '${tier}' }; return JSON.stringify(d); } catch { return v; } } return v; }; })();` });
  await c.goto(`${base}/play/autowala |  `);
  await c.waitFor("!!document.querySelector('.aw-go')", 240000);
  await c.ev("document.querySelector('.aw-go').click()");
  await c.waitFor('!!window.__autowala', 120000);
  await c.ev('window.__autowala.gfx.autoTier = false; true'); // hold the tier: the HUD is the only thing that changes between windows
  // a player's speed keeps changing: alternate the throttle, and put the auto back on the same long straight at the start of each window
  await c.ev(`(() => {
    const g = window.__autowala; const p = g.world.city.poiById.charminar; const f = p.front || p;
    window.__home = () => { g.debug.teleport(f.x, f.z, 0); g.debug.hour(12); };
    window.__home(); g.debug.weather(0);
    let k = 0; clearInterval(window.__throttleT);
    window.__throttleT = setInterval(() => { k++; g.debug.drive({ throttle: k % 6 < 3 ? 1 : 0.15, steer: 0 }); }, 700);
    return true;
  })() |  `);
};

const setCss = (css) => `(() => { let st = document.getElementById('aw-nohud'); if (!st) { st = document.createElement('style'); st.id = 'aw-nohud'; document.head.appendChild(st); } st.textContent = ${JSON.stringify(css)}; return true; })()`;
const hideCss = (sel) => setCss(sel + ' { display: none !important; }');
const HIDE = hideCss('.aw > *:not(.aw-canvas)');
const SHOW = "(() => { document.getElementById('aw-nohud')?.remove(); return true; })()";

/** Frame times + long animation frames over `seconds`; the car starts from the same spot. */
const MEASURE = (seconds) => `(async () => {
  window.__home();
  await new Promise((r) => setTimeout(r, 400));
  const dts = []; const loaf = []; const longs = [];
  let po1 = null; let po2 = null;
  try { po1 = new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push({ d: e.duration, block: e.blockingDuration, rs: e.renderStart ? e.renderStart - e.startTime : 0, sl: e.styleAndLayoutStart ? e.styleAndLayoutStart - e.startTime : 0, sc: (e.scripts || []).map((s) => ({ f: s.sourceFunctionName || s.invoker || '', d: s.duration, forced: s.forcedStyleAndLayoutDuration, u: String(s.sourceURL || '').split('/').pop() })) }); }); po1.observe({ type: 'long-animation-frame', buffered: false }); } catch {}
  try { po2 = new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration); }); po2.observe({ type: 'longtask', buffered: false }); } catch {}
  let last = performance.now(); const end = last + ${seconds} * 1000;
  await new Promise((res) => { const f = (t) => { dts.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  await new Promise((r) => setTimeout(r, 60));
  po1 && po1.disconnect(); po2 && po2.disconnect();
  dts.shift();
  const s = dts.slice().sort((a, b) => a - b); const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
  const top = loaf.slice().sort((a, b) => b.d - a.d).slice(0, 3);
  return { frames: dts.length, mean, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1], over33: dts.filter((d) => d > 33.4).length, over50: dts.filter((d) => d > 50).length,
    loafN: loaf.length, loafMs: loaf.reduce((a, b) => a + b.d, 0), loafBlockMs: loaf.reduce((a, b) => a + b.block, 0), longN: longs.length, longMs: longs.reduce((a, b) => a + b, 0), top, kmh: window.__autowala.vehicle.state.kmh };
})()`;

const med = (a) => {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/** How many HUD snapshots React was offered so far: the store counter, else the number of DOM mutation batches in the HUD (older builds have no store). */
const SNAPS = `(() => {
  if (window.__autowalaStore) return window.__autowalaStore.version();
  if (!window.__snapMO) { window.__snapN = 0; window.__snapMO = new MutationObserver(() => { window.__snapN++; }); window.__snapMO.observe(document.querySelector('.aw'), { subtree: true, childList: true, characterData: true, attributes: true }); }
  return window.__snapN;
})()`;
const METRIC_KEYS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
const metricsNow = async (c) => {
  const m = Object.fromEntries((await c.send('Performance.getMetrics')).metrics.filter((x) => METRIC_KEYS.includes(x.name)).map((x) => [x.name, x.value]));
  // CPU seconds so far of every Chrome process by type: the GPU process (raster + compositing + the game's GL) and the renderer (main + compositor + raster threads)
  try {
    for (const p of (await c.send('SystemInfo.getProcessInfo')).processInfo) m['cpu_' + p.type] = (m['cpu_' + p.type] || 0) + p.cpuTime;
  } catch {
    /* an older Chrome without the SystemInfo domain */
  }
  return m;
};

async function ab(c) {
  await c.send('Performance.enable');
  await c.sleep(+(args.warm || 6) * 1000);
  const variants = String(args.variants || 'hud|nohud').split('|');
  // a variant is hud (the page as it is), nohud (everything over the canvas hidden), name=<css selector> (only that hidden) or name~<css rules> (extra CSS applied)
  const apply = (v) => c.ev(v === 'nohud' ? HIDE : v.includes('~') ? setCss(v.slice(v.indexOf('~') + 1)) : v.includes('=') ? hideCss(v.slice(v.indexOf('=') + 1)) : SHOW);
  for (const v of variants) {
    await apply(v);
    await c.sleep(1500);
  }
  const rows = new Map(variants.map((v) => [v, []]));
  for (let r = 0; r < ROUNDS; r++) {
    for (const v of variants) {
      await apply(v);
      await c.sleep(SETTLE * 1000);
      const t0 = Date.now();
      const m0 = await metricsNow(c);
      const n0 = await c.ev(SNAPS);
      const w = await c.ev(MEASURE(SEC));
      const n1 = await c.ev(SNAPS);
      const m1 = await metricsNow(c);
      const dt = (Date.now() - t0) / 1000;
      const per = (k) => ((m1[k] - m0[k]) / dt) * 1000; // ms of main-thread time per second
      w.task = per('TaskDuration');
      w.script = per('ScriptDuration');
      w.layout = per('LayoutDuration');
      w.style = per('RecalcStyleDuration');
      w.layouts = (m1.LayoutCount - m0.LayoutCount) / dt;
      w.styles = (m1.RecalcStyleCount - m0.RecalcStyleCount) / dt;
      w.snaps = (n1 - n0) / dt;
      w.gpuCpu = ((m1.cpu_gpu - m0.cpu_gpu) / dt) * 1000; // ms of CPU per second in the GPU process
      w.rendererCpu = ((m1.cpu_renderer - m0.cpu_renderer) / dt) * 1000; // ... in the renderer, all threads
      rows.get(v).push(w);
    }
  }
  await apply('hud');
  return variants.map((v) => {
    const m = rows.get(v);
    const k = (key) => +med(m.map((x) => x[key])).toFixed(2);
    const sum = (key) => m.reduce((a, x) => a + x[key], 0);
    const slow = m.flatMap((x) => x.top).sort((a, b) => b.d - a.d)[0];
    return { variant: v, rounds: m.length, fps: +(1000 / k('mean')).toFixed(1), mean: k('mean'), p50: k('p50'), p95: k('p95'), p99: k('p99'), maxMs: k('max'), over33: sum('over33'), over50: sum('over50'), frames: sum('frames'),
      loafPerS: +(sum('loafN') / (m.length * SEC)).toFixed(2), loafMsPerS: +(sum('loafMs') / (m.length * SEC)).toFixed(1), longTasks: sum('longN'), per: m.map((x) => +x.p95.toFixed(1)),
      taskMsPerS: k('task'), scriptMsPerS: k('script'), layoutMsPerS: k('layout'), styleMsPerS: k('style'), layoutsPerS: k('layouts'), stylesPerS: k('styles'), snapsPerS: k('snaps'), gpuCpuMsPerS: k('gpuCpu'), rendererCpuMsPerS: k('rendererCpu'),
      slowest: slow ? { d: Math.round(slow.d), block: Math.round(slow.block), rs: Math.round(slow.rs), sl: Math.round(slow.sl), scripts: slow.sc.slice(0, 4) } : null };
  });
}

/** A V8 CPU profile of the next `ms`, as self time per script file (ms per second) plus the heaviest functions of the files matching `focus`. */
async function profileWindow(c, ms, focus = /vendor-react|AutowalaGame|react-dom/) {
  await c.send('Profiler.enable');
  await c.send('Profiler.setSamplingInterval', { interval: 200 });
  await c.send('Profiler.start');
  await c.sleep(ms);
  const { profile } = await c.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas || [];
  const files = new Map();
  const fns = new Map();
  let total = 0;
  let idle = 0;
  profile.samples.forEach((sid, i) => {
    const cf = byId.get(sid).callFrame;
    const d = dt[i] || 0;
    total += d;
    if (cf.functionName === '(idle)') idle += d;
    const file = cf.url ? cf.url.replace(/^.*\/assets\//, '') : cf.functionName || '(native)';
    files.set(file, (files.get(file) || 0) + d);
    if (focus.test(cf.url || '')) {
      const k = `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`;
      fns.set(k, (fns.get(k) || 0) + d);
    }
  });
  const perS = (v) => +(v / 1000 / (ms / 1000)).toFixed(1);
  return {
    busyMsPerS: perS(total - idle),
    files: Object.fromEntries([...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, perS(v)])),
    focus: [...fns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => ({ fn: k, msPerS: perS(v) })),
  };
}

async function profile(c) {
  await c.sleep(+(args.warm || 6) * 1000);
  const out = {};
  for (const v of ['hud', 'nohud', 'hud#2', 'nohud#2']) {
    await c.ev(v.startsWith('nohud') ? HIDE : SHOW);
    await c.sleep(1200);
    await c.ev('window.__home(); true');
    out[v] = await profileWindow(c, SEC * 1000);
  }
  await c.ev(SHOW);
  return out;
}

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(W, H, DPR, touch);
    await START(c);
    const info = { cmd, tier, viewport: `${W}x${H}@${DPR}${touch ? ' touch' : ''}`, gpu: await c.ev("(() => { const gl = window.__autowala.gfx.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })()"), layout: await c.ev("document.querySelector('.aw').dataset.awLayout || 'desktop'") };
    const result = cmd === 'profile' ? await profile(c) : await ab(c);
    return { ...info, result, errors: c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource/.test(l)).slice(0, 6) };
  } finally {
    c.close();
  }
}

const res = args['no-lock'] ? await run() : await withBenchLock(run, { maxWaitMs: 60 * 60 * 1000 });
if (cmd === 'ab') {
  console.log(JSON.stringify({ ...res, result: undefined }));
  console.log('variant   fps    mean    p50    p95    p99    max  >33ms >50ms  LoAF/s  LoAF ms/s  longtasks  per-round p95');
  for (const r of res.result) console.log(`${r.variant.padEnd(8)} ${String(r.fps).padStart(5)} ${String(r.mean).padStart(7)} ${String(r.p50).padStart(6)} ${String(r.p95).padStart(6)} ${String(r.p99).padStart(6)} ${String(r.maxMs).padStart(6)} ${String(r.over33).padStart(5)} ${String(r.over50).padStart(5)} ${String(r.loafPerS).padStart(7)} ${String(r.loafMsPerS).padStart(10)} ${String(r.longTasks).padStart(9)}  ${r.per.join(' ')}`);
  console.log('variant   main-thread ms per second: task  script  layout  style   | layouts/s styles/s  snapshots/s | CPU ms/s: gpu-process  renderer(all threads)');
  for (const r of res.result) console.log(`${r.variant.padEnd(8)} ${String(r.taskMsPerS).padStart(30)} ${String(r.scriptMsPerS).padStart(7)} ${String(r.layoutMsPerS).padStart(7)} ${String(r.styleMsPerS).padStart(6)}   | ${String(r.layoutsPerS).padStart(8)} ${String(r.stylesPerS).padStart(8)} ${String(r.snapsPerS).padStart(11)} | ${String(r.gpuCpuMsPerS).padStart(21)} ${String(r.rendererCpuMsPerS).padStart(14)}`);
  for (const r of res.result) if (r.slowest) console.log(`slowest LoAF (${r.variant}): ${JSON.stringify(r.slowest)}`);
} else console.log(JSON.stringify(res, null, 1));
if (args.out && args.out !== true) fs.writeFileSync(String(args.out), JSON.stringify(res, null, 1));
process.exit(0);
