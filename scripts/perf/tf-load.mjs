// Tiffin Centre LOAD profile: what the main thread does between "Start tutorial" and a playable, stutter-free scene.
//
//   node scripts/perf/tf-load.mjs --base http://127.0.0.1:5770 --port 9810 [--label name] [--tier medium] [--seconds 20] [--profile] [--json out.json]
//        [--w 1536 --h 864 --dpr 1.25] [--soft] [--no-lock]
//
// Reports, relative to the click on "Start tutorial": the stage marks (`tc:*` performance marks written by scene/index.js and the loader), the first
// rendered frame, the moment window.__tiffin is ready (what bench.mjs calls loadMs), every long task (start, duration), the frame-time distribution
// after the first 3 s, renderer.info counters and, with --profile, a V8 CPU profile of the whole load (self time by function, inclusive time of the
// tiffin modules). Use a build made with `vite build --minify false` for readable function names in the profile.
import fs from 'node:fs';
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = args.base || 'http://127.0.0.1:5770';
const W = +(args.w || 1536);
const H = +(args.h || 864);
const DPR = +(args.dpr || 1.25);
const SEC = +(args.seconds || 20);
const tier = args.tier && args.tier !== true ? String(args.tier) : '';
const label = args.label && args.label !== true ? String(args.label) : `tf-load-${tier || 'auto'}`;
const port = +(args.port || 9810);

const INIT = `(() => {
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch {}
  window.__frames = [];
  let last = 0;
  const f = (n) => { if (last) window.__frames.push([n, n - last]); last = n; requestAnimationFrame(f); };
  requestAnimationFrame(f);
})();`;

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(W, H, DPR, false);
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
    await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
    await c.waitFor("[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 90000);
    if (tier) {
      await c.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === '${tier.toLowerCase()}')?.click(); true`);
      await c.sleep(300);
    }
    await c.sleep(1500); // the home screen settles; its own idle prefetch is not part of "start"
    if (args.profile) {
      await c.send('Profiler.enable');
      await c.send('Profiler.setSamplingInterval', { interval: 700 });
      await c.send('Profiler.start');
    }
    const t0 = await c.ev('performance.now()');
    await c.ev("[...document.querySelectorAll('button')].filter((b) => /Start tutorial/.test(b.textContent)).pop().click(); true");
    const wall0 = Date.now();
    let readyAt = null;
    while (Date.now() - wall0 < SEC * 1000) {
      await c.sleep(100);
      if (readyAt === null) {
        try {
          if (await c.ev('!!(window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug)')) readyAt = await c.ev('performance.now()');
        } catch { /* busy */ }
      }
    }
    let profile = null;
    if (args.profile) profile = (await c.send('Profiler.stop')).profile;
    const data = await c.ev(`(() => {
      const t0 = ${t0};
      const R = window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug && window.__tiffin.scene.debug.gfx.renderer;
      const info = R && R.info;
      const marks = performance.getEntriesByType('mark').filter((m) => m.startTime >= t0 - 50).map((m) => [m.name, Math.round(m.startTime - t0)]);
      const frames = window.__frames.filter((f) => f[0] >= t0);
      const late = frames.filter((f) => f[0] - t0 > 3000).map((f) => f[1]);
      const s = late.slice().sort((a, b) => a - b);
      const q = (p) => (s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1) : null);
      const lt = window.__lt.filter((l) => l[0] >= t0).map((l) => [Math.round(l[0] - t0), Math.round(l[1])]);
      const firstDraw = frames.length ? Math.round(frames[0][0] - t0) : null;
      return {
        marks, longTasks: lt, longTaskCount: lt.length, longTaskMs: lt.reduce((a, b) => a + b[1], 0),
        longTasksAfter3s: lt.filter((l) => l[0] > 3000).length, longTaskMsAfter3s: lt.filter((l) => l[0] > 3000).reduce((a, b) => a + b[1], 0),
        worstLongTask: Math.max(0, ...lt.map((l) => l[1])),
        frames: frames.length, framesAfter3s: late.length, over50After3s: late.filter((d) => d > 50).length, over50MsAfter3s: Math.round(late.filter((d) => d > 50).reduce((a, b) => a + b, 0)),
        p50: q(0.5), p95: q(0.95), p99: q(0.99), maxFrame: s.length ? Math.round(s[s.length - 1]) : null,
        calls: info && info.render.calls, tris: info && info.render.triangles, geometries: info && info.memory.geometries, textures: info && info.memory.textures,
        programs: info && info.programs ? info.programs.length : null,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        firstRaf: firstDraw,
      };
    })()`);
    const row = { label, viewport: `${W}x${H}@${DPR}`, tierAsked: tier || 'auto', readyMs: readyAt === null ? null : Math.round(readyAt - t0), ...data, errors: c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource|Program Info Log|X4000|X3595/.test(l)).slice(0, 6) };
    return { row, profile };
  } finally {
    c.close();
  }
}

/** Self time per function and inclusive time per function (recursion counted once), from a V8 .cpuprofile. */
function summarise(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const ch of n.children || []) parent.set(ch, n.id);
  const dt = profile.timeDeltas || [];
  const self = new Map();
  const incl = new Map();
  const name = (n) => {
    const cf = n.callFrame;
    return `${cf.functionName || '(anon)'}  ${cf.url.replace(/^.*\/(assets|src)\//, '$1/')}:${cf.lineNumber + 1}`;
  };
  let total = 0;
  profile.samples.forEach((sid, i) => {
    const d = dt[i] || 0;
    total += d;
    const n = nodes.get(sid);
    const k = name(n);
    self.set(k, (self.get(k) || 0) + d);
    const seen = new Set();
    for (let id = sid; id; id = parent.get(id)) {
      const kk = name(nodes.get(id));
      if (seen.has(kk)) continue;
      seen.add(kk);
      incl.set(kk, (incl.get(kk) || 0) + d);
    }
  });
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([fn, v]) => ({ fn, ms: +(v / 1000).toFixed(1), pct: +((v / total) * 100).toFixed(1) }));
  return { totalMs: +(total / 1000).toFixed(0), self: top(self, 30), inclusive: top(new Map([...incl].filter(([k]) => /assets\/|src\//.test(k) && !/\(anon\)/.test(k))), 60) };
}

const { row, profile } = args['no-lock'] ? await run() : await withBenchLock(run);
const out = { ...row };
if (profile) {
  out.profile = summarise(profile);
  if (args.json) fs.writeFileSync(String(args.json).replace(/\.json$/, '.cpuprofile'), JSON.stringify(profile));
}
if (args.json) fs.writeFileSync(String(args.json), JSON.stringify(out, null, 1));
const { profile: p, ...short } = out;
console.log(JSON.stringify(short));
if (p) {
  console.log(`CPU profile ${p.totalMs} ms; self time:\n` + p.self.map((x) => `  ${String(x.ms).padStart(8)} ms ${String(x.pct).padStart(5)}%  ${x.fn}`).join('\n'));
  console.log('inclusive (tiffin code):\n' + p.inclusive.map((x) => `  ${String(x.ms).padStart(8)} ms ${String(x.pct).padStart(5)}%  ${x.fn}`).join('\n'));
}
process.exit(0);
