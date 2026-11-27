// Frame-time benchmark for the two 3D games, on the machine's real GPU (see README.md).
//
//   node scripts/perf/bench.mjs --game autowala|tiffin [--base http://127.0.0.1:5701] [--tier low|medium|high|lite] [--w 1536 --h 864 --dpr 1.25]
//        [--warm 6] [--seconds 8] [--profile] [--soft] [--label name] [--shot out.jpg] [--port 9720] [--no-lock]
//
// It starts the game exactly like a player does (Autowala: Start; Tiffin: Start tutorial), waits `warm` seconds so shader compiles and first
// uploads are over, then measures `seconds` of requestAnimationFrame with vsync and the frame cap off: frame time is then the real cost of a frame
// (the sum of the CPU work and any wait for the GPU). One JSON line goes to stdout and is appended to $PERF_OUT (default: <tmp>/jalebi-perf.jsonl).
// Run it on a production build (`vite build --outDir <dir>` + `vite preview --outDir <dir> --port N`): the dev server is slower and not what players get.
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
const game = args.game || 'autowala';
const base = args.base || 'http://127.0.0.1:5701';
const W = +(args.w || 1536);
const H = +(args.h || 864);
const DPR = +(args.dpr || 1.25);
const WARM = +(args.warm || 6);
const SEC = +(args.seconds || 8);
const tier = args.tier && args.tier !== true ? String(args.tier) : '';
const label = args.label && args.label !== true ? String(args.label) : `${game}-${tier || 'auto'}`;
const port = +(args.port || 9720 + Math.floor(Math.random() * 60));
const out = process.env.PERF_OUT || path.join(os.tmpdir(), 'jalebi-perf.jsonl');

/** Runs inside the page: rAF deltas, long tasks, GPU string, renderer counters. `sample()` is passed the renderer. */
const MEASURE = (seconds) => `(async () => {
  const R = window.__gfxForBench();
  const gl = R && R.getContext && R.getContext();
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const dts = []; const longs = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch {}
  let last = performance.now(); const end = last + ${seconds} * 1000;
  await new Promise((res) => { const f = (n) => { dts.push(n - last); last = n; if (n < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  dts.shift();
  const s = dts.slice().sort((a, b) => a - b);
  const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
  const mean = dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length);
  const info = R && R.info;
  return {
    gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?',
    fps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), maxMs: +s[s.length - 1].toFixed(1), frames: dts.length,
    hitches50: dts.filter((d) => d > 50).length, hitchMs: Math.round(dts.filter((d) => d > 50).reduce((a, b) => a + b, 0)),
    longTasks: longs.length, longTaskMs: Math.round(longs.reduce((a, b) => a + b, 0)),
    calls: info && info.render.calls, tris: info && info.render.triangles, geometries: info && info.memory.geometries, textures: info && info.memory.textures,
    programs: info && info.programs ? info.programs.length : null,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
})()`;

/** In the page: the tier / scale the game is on now and what the shared governor has decided so far (absent on a build without it). */
const AW_STATE = `(() => { const g = window.__autowala; const f = g.gfx; const a = g.adaptive; const st = a && a.governor.stats();
  return { tier: f.quality, scale: f.scale, renderScale: f.renderScale == null ? null : +f.renderScale.toFixed(3), pr: f.renderer.getPixelRatio(), boot: window.__autowalaBoot && window.__autowalaBoot.ms,
    gov: st ? { start: a.describe(), refreshHz: st.refreshHz, counts: st.counts, history: st.history.map((h) => h.kind + ' ' + h.from + '->' + h.to + ' @' + h.t), tierFail: st.tierFailures } : null,
    calib: a && a.calibration ? { ranMs: a.calibration.ranMs, mode: a.calibration.mode, confident: a.calibration.recommended && a.calibration.recommended.confident, units: a.calibration.units, refreshHz: a.calibration.refreshHz, rec: a.calibration.recommended && { tier: a.calibration.recommended.tier, scale: a.calibration.recommended.scale, est: a.calibration.recommended.estimates } } : null }; })()`;

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(W, H, DPR, false);
    const t0 = Date.now();
    let extra = {};
    if (game === 'autowala') {
      // the player's saved choice beats the auto-pick; patching getItem makes a fresh browser profile behave like one that chose `tier`
      if (tier) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); if (String(k).startsWith('jalebi.autowala.v')) { try { const d = JSON.parse(v || '{}'); d.settings = { ...(d.settings || {}), quality: '${tier}' }; return JSON.stringify(d); } catch { return v; } } return v; }; })();` });
      await c.goto(`${base}/play/autowala`);
      await c.waitFor("!!document.querySelector('.aw-go')", 180000);
      await c.ev("document.querySelector('.aw-go').click()");
      await c.waitFor('!!window.__autowala', 60000);
      await c.ev("window.__gfxForBench = () => window.__autowala.gfx.renderer; true");
      await c.ev('window.__autowala.debug.drive({ throttle: 1 }); true');
    } else {
      await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
      await c.waitFor("[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 90000);
      if (tier) {
        await c.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === '${tier.toLowerCase()}')?.click(); true`);
        await c.sleep(300);
      }
      await c.ev("[...document.querySelectorAll('button')].filter((b) => /Start tutorial/.test(b.textContent)).pop().click(); true");
      await c.waitFor('!!(window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug)', 180000);
      await c.ev("window.__gfxForBench = () => window.__tiffin.scene.debug.gfx.renderer; true");
    }
    const loadMs = Date.now() - t0;
    // boot-time stalls: long tasks during the warm-up are what the player feels as "the game freezes after I press start"
    await c.ev(`window.__bootLongs = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__bootLongs.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch {} true`);
    await c.sleep(WARM * 1000);
    const boot = await c.ev('({ n: window.__bootLongs.length, ms: Math.round(window.__bootLongs.reduce((a, b) => a + b, 0)), worst: Math.round(Math.max(0, ...window.__bootLongs)) })');
    if (game === 'autowala') extra = await c.ev(AW_STATE);
    else {
      extra = await c.ev('(() => { const g = window.__tiffin.scene.debug.gfx; return { tier: g.quality, scale: g.scale, pr: g.pixelRatio }; })()');
    }
    let profile;
    if (args.profile) profile = await c.cpuProfile(Math.min(6000, SEC * 1000));
    const m = await c.ev(MEASURE(SEC));
    const end = game === 'autowala' ? await c.ev(AW_STATE) : null;
    const row = { label, game, tierAsked: tier || 'auto', viewport: `${W}x${H}@${DPR}`, soft: !!args.soft, loadMs, bootLongTasks: boot, ...extra, ...m, ...(end ? { endTier: end.tier, endScale: end.scale, endRenderScale: end.renderScale, endGov: end.gov, calib: end.calib } : {}), errors: c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource/.test(l)).slice(0, 8) };
    if (args.shot) await c.shot(String(args.shot));
    return { row, profile };
  } finally {
    c.close();
  }
}

const { row, profile } = args['no-lock'] ? await run() : await withBenchLock(run);
console.log(JSON.stringify(row));
if (profile) console.log('CPU self-time, heaviest first:\n' + profile.map((p) => `  ${String(p.ms).padStart(7)} ms ${String(p.pct).padStart(5)}%  ${p.fn}`).join('\n'));
fs.appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n');
process.exit(0);
