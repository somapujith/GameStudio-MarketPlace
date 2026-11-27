// Runs ONE experiment script inside a live Tiffin Centre page on the real GPU and prints its JSON result: the building block of the tf-int A/B work.
//
//   node scripts/perf/tf-probe.mjs --base http://127.0.0.1:5851 --port 9861 --js <file.js> [--tier medium] [--w 1536 --h 864 --dpr 1.25] [--warm 20] [--level 0] [--no-lock]
//        [--label x] [--args '{"k":1}']
//
// The page is started like a player starts it (Start tutorial, or `--level N` for a practice shift), `warm` seconds pass, then the file is evaluated as the
// body of an async function `(scene, gfx, args, h) => {...}` and its return value is printed as one JSON line (also appended to $PERF_OUT). `h` is a small
// helper kit: h.sleep(ms), h.frames(n) (resolves after n rAFs), h.measure(sec) (uncapped rAF frame stats), h.gpu(sec) (GPU ms of whole frames through
// EXT_disjoint_timer_query_webgl2 of the game's own loop), h.passes(sec) (per post pass GPU ms through post.setProbe), h.hour(x). It takes the machine-wide
// bench lock, like bench.mjs, so two measurements never share the GPU.
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
const base = args.base || 'http://127.0.0.1:5851';
const port = +(args.port || 9861);
const W = +(args.w || 1536);
const H = +(args.h || 864);
const DPR = +(args.dpr || 1.25);
const WARM = +(args.warm || 20);
const level = +(args.level || 0);
const tier = args.tier && args.tier !== true ? String(args.tier) : '';
const label = args.label && args.label !== true ? String(args.label) : 'probe';
const jsFile = String(args.js || '');
const userArgs = args.args && args.args !== true ? JSON.parse(String(args.args)) : {};
const out = process.env.PERF_OUT || path.join(os.tmpdir(), 'jalebi-perf.jsonl');
if (!jsFile) throw new Error('--js <file> is required');
const body = fs.readFileSync(jsFile, 'utf8');

const KIT = `(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const stats = (dts) => {
    const s = dts.slice().sort((a, b) => a - b); const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
    const mean = dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length);
    return { fps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), maxMs: +s[s.length - 1].toFixed(1), frames: dts.length, over50: dts.filter((d) => d > 50).length };
  };
  const measure = async (sec) => {
    const dts = []; let last = performance.now(); const end = last + sec * 1000;
    await new Promise((res) => { const f = (n) => { dts.push(n - last); last = n; if (n < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    dts.shift(); return stats(dts);
  };
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(2) : -1; };
  // GPU time of the whole frame: wraps gfx.render in a TIME_ELAPSED query (the game's own timer is paused meanwhile: one active query at a time)
  const gpu = async (sec) => {
    const g = window.__tiffin.scene.debug.gfx; const gl = g.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext) return { error: 'no timer query' };
    const orig = g.render; const q = []; const done = [];
    g.pauseTimer?.(true);
    g.render = (dt) => { const qq = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, qq); try { return orig(dt); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); q.push(qq); } };
    const t0 = performance.now(); const cpu = [];
    const poll = () => { while (q.length && gl.getQueryParameter(q[0], gl.QUERY_RESULT_AVAILABLE)) { const qq = q.shift(); const ns = gl.getQueryParameter(qq, gl.QUERY_RESULT); gl.deleteQuery(qq); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) done.push(ns / 1e6); } };
    while (performance.now() - t0 < sec * 1000) { await frames(1); poll(); }
    await sleep(200); poll();
    g.render = orig; g.pauseTimer?.(false);
    return { gpuMedian: median(done), gpuMean: +(done.reduce((a, b) => a + b, 0) / Math.max(1, done.length)).toFixed(2), gpuMin: +Math.min(...done).toFixed(2), n: done.length };
  };
  // GPU ms per post pass (and the scene pass), median over the window: post.setProbe(name, begin)
  const passes = async (sec) => {
    const g = window.__tiffin.scene.debug.gfx; const gl = g.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext || !g.post.setProbe) return { error: 'no timer / probe' };
    g.pauseTimer?.(true);
    const q = []; let cur = null; const by = {};
    g.post.setProbe((name, begin) => { if (begin) { cur = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, cur); } else { gl.endQuery(ext.TIME_ELAPSED_EXT); q.push({ name, q: cur }); cur = null; } });
    const t0 = performance.now();
    const poll = () => { while (q.length && gl.getQueryParameter(q[0].q, gl.QUERY_RESULT_AVAILABLE)) { const e = q.shift(); const ns = gl.getQueryParameter(e.q, gl.QUERY_RESULT); gl.deleteQuery(e.q); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) (by[e.name] ||= []).push(ns / 1e6); } };
    while (performance.now() - t0 < sec * 1000) { await frames(1); poll(); }
    await sleep(200); poll();
    g.post.setProbe(null); g.pauseTimer?.(false);
    const res = {}; let sum = 0; for (const k of Object.keys(by)) { res[k] = median(by[k]); sum += res[k] * 1; } res.sumOfMedians = +sum.toFixed(2);
    return res;
  };
  const info = () => { const g = window.__tiffin.scene.debug.gfx; const i = g.renderer.info; return { tier: g.quality, scale: g.scale, pr: g.pixelRatio, calls: i.render.calls, tris: i.render.triangles, programs: i.programs ? i.programs.length : null, geometries: i.memory.geometries, textures: i.memory.textures }; };
  return { sleep, frames, measure, median, gpu, passes, info, stats };
})()`;

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(W, H, DPR, false);
    if (level > 0) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('jalebi.tutorial.v1.tiffin-centre', '1'); } catch {}" });
    if (args.clearmem) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { for (const k of Object.keys(localStorage)) if (k.startsWith('jalebi.gfx')) localStorage.removeItem(k); } catch {}" });
    const t0 = Date.now();
    await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
    await c.waitFor(level > 0 ? "!!document.querySelector('.tc-menu-lvl__btn')" : "[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 90000);
    if (tier) {
      await c.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === '${tier.toLowerCase()}')?.click(); true`);
      await c.sleep(300);
    }
    if (level > 0) {
      await c.ev("document.querySelector('.tc-menu-lvl__btn').click(); true");
      await c.waitFor("[...document.querySelectorAll('button')].some((b) => /Open the stall/.test(b.textContent))", 30000);
      await c.ev("[...document.querySelectorAll('button')].find((b) => /Open the stall/.test(b.textContent)).click(); true");
    } else await c.ev("[...document.querySelectorAll('button')].filter((b) => /Start tutorial/.test(b.textContent)).pop().click(); true");
    await c.waitFor('!!(window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug)', 240000);
    const loadMs = Date.now() - t0;
    await c.sleep(WARM * 1000);
    const expr = `(async () => { const h = ${KIT}; const scene = window.__tiffin.scene; const gfx = scene.debug.gfx; const args = ${JSON.stringify(userArgs)}; ${args.hud ? '' : "document.querySelectorAll('.tc > *:not(canvas)').forEach((e) => { e.style.visibility = 'hidden'; });"} return await (async () => { ${body}\n })(); })()`;
    const result = await c.ev(expr);
    if (args.shot) await c.shot(String(args.shot));
    return { label, viewport: `${W}x${H}@${DPR}`, tierAsked: tier || 'auto', loadMs, result, errors: c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource/.test(l)).slice(0, 8) };
  } finally {
    c.close();
  }
}

const row = args['no-lock'] ? await run() : await withBenchLock(run, { maxWaitMs: 90 * 60 * 1000 });
console.log(JSON.stringify(row));
fs.appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n');
process.exit(0);
