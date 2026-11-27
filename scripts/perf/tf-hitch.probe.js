// Body of an async function for scripts/perf/tf-probe.mjs (scene, gfx, args, h in scope):
//   node scripts/perf/tf-probe.mjs --base http://127.0.0.1:5852 --port 9990 --tier medium --level 1 --warm 4 --js scripts/perf/tf-hitch.probe.js
// Plays `args.seconds` (default 75) of a practice shift and records every frame: its length, how many shader programs / geometries / textures exist and how many
// customer models are in the scene. Frames over 33 ms are listed with what changed in that frame (a new program, a new geometry, a new customer: the cause), and
// the programs that appeared after the first 3 s are named. Also long tasks (PerformanceObserver) and the draw calls of the last frame.
const R = gfx.renderer;
const sc = gfx.scene;
const secs = (args && args.seconds) || 60;
// a fixed render scale and no governor, so two builds are compared at the same load (the governor's own steps are not what this measures)
gfx.holdAdaptation(1e6);
gfx.setScale(0.7);
const lt = [];
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) lt.push([Math.round(e.startTime), Math.round(e.duration)]);
  }).observe({ entryTypes: ['longtask'] });
} catch {
  /* no long task API */
}
const custCount = () => {
  let n = 0;
  sc.traverse((o) => {
    if (/^customer-/.test(o.name || '')) n++;
  });
  return n;
};
const rows = [];
let last = performance.now();
const t0 = last;
const known = new Set(R.info.programs.map((p) => p.id));
const lateProgs = [];
let prevProgs = R.info.programs.length;
let prevGeo = R.info.memory.geometries;
let prevTex = R.info.memory.textures;
let prevCust = custCount();
let calls = 0;
await new Promise((res) => {
  const f = (n) => {
    const dt = n - last;
    last = n;
    const progs = R.info.programs.length;
    const geo = R.info.memory.geometries;
    const tex = R.info.memory.textures;
    calls = R.info.render.calls;
    // customers are counted every 10th frame only (a scene traverse)
    const cust = rows.length % 10 === 0 ? custCount() : prevCust;
    if (dt > 33 || progs !== prevProgs || cust !== prevCust) {
      rows.push({ t: Math.round(n - t0), dt: Math.round(dt), dProgs: progs - prevProgs, dGeo: geo - prevGeo, dTex: tex - prevTex, dCust: cust - prevCust, progs });
    } else rows.push(null);
    if (progs !== prevProgs) {
      for (const p of R.info.programs) if (!known.has(p.id)) {
        known.add(p.id);
        lateProgs.push({ t: Math.round(n - t0), name: p.name, key: String(p.cacheKey).slice(-70) });
      }
    }
    prevProgs = progs;
    prevGeo = geo;
    prevTex = tex;
    prevCust = cust;
    if (n - t0 < secs * 1000) requestAnimationFrame(f);
    else res();
  };
  requestAnimationFrame(f);
});
const events = rows.filter(Boolean);
const dts = [];
let frames = 0;
for (const r of rows) frames++;
void dts;
const slow = events.filter((r) => r.dt > 33);
const over50 = events.filter((r) => r.dt > 50 && r.t > 3000);
return {
  tier: gfx.quality,
  scale: gfx.scale,
  frames,
  over33: slow.length,
  over50After3s: over50.length,
  worst: Math.max(0, ...events.map((r) => r.dt)),
  hitches: slow.filter((r) => r.t <= 3000).slice(0, 12),
  hitchesAfter3s: slow.filter((r) => r.t > 3000).slice(0, 60).map((r) => [r.t, r.dt, r.dProgs, r.dGeo, r.dTex, r.dCust]),
  over33After3s: slow.filter((r) => r.t > 3000).length,
  customerEvents: events.filter((r) => r.dCust !== 0).map((r) => [r.t, r.dCust, r.dt]),
  lateProgramCount: lateProgs.length,
  lateProgs: lateProgs.slice(0, 25),
  longTasks: lt.slice(0, 40),
  programsEnd: R.info.programs.length,
  calls,
};
