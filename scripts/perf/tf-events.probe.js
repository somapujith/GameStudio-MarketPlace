// Body of an async function for scripts/perf/tf-probe.mjs: forces each world event on (by wrapping scene.setState so the session's own ticks carry the fake
// event) and records, per event, the frames over 33 / 50 ms, the shader programs and geometries created, and the long tasks. The point: an event that shows up for
// the first time mid-shift (rain, a power cut, the cricket TV, the festival lights, the inspector) must not compile or build anything.
//   node scripts/perf/tf-probe.mjs --base http://127.0.0.1:5852 --port 9990 --tier medium --level 1 --warm 6 --js scripts/perf/tf-events.probe.js
const R = gfx.renderer;
gfx.holdAdaptation(1e6);
gfx.setScale(0.7);
const orig = scene.setState.bind(scene);
let forced = [];
scene.setState = (st, at) => orig(st && forced.length ? { ...st, events: [...(Array.isArray(st.events) ? st.events : []), ...forced.map((id) => ({ id, until: 1e9 }))] } : st, at);
const lt = [];
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) lt.push([Math.round(e.startTime), Math.round(e.duration)]);
  }).observe({ entryTypes: ['longtask'] });
} catch {
  /* no long task API */
}
const run = async (label, ids, sec) => {
  forced = ids;
  const p0 = R.info.programs.length;
  const g0 = R.info.memory.geometries;
  const x0 = R.info.memory.textures;
  const dts = [];
  let last = performance.now();
  const end = last + sec * 1000;
  const lt0 = lt.length;
  await new Promise((res) => {
    const f = (n) => {
      dts.push(n - last);
      last = n;
      if (n < end) requestAnimationFrame(f);
      else res();
    };
    requestAnimationFrame(f);
  });
  dts.shift();
  const worst = dts.reduce((a, b) => Math.max(a, b), 0);
  return {
    label,
    frames: dts.length,
    over33: dts.filter((d) => d > 33).length,
    over50: dts.filter((d) => d > 50).length,
    worst: Math.round(worst),
    newPrograms: R.info.programs.length - p0,
    newGeometries: R.info.memory.geometries - g0,
    newTextures: R.info.memory.textures - x0,
    longTasks: lt.slice(lt0).map((x) => x[1]),
  };
};
const out = [];
out.push(await run('quiet', [], 4));
for (const id of ['rain', 'power', 'cricket', 'festival', 'inspector', 'rain+power+festival']) out.push(await run(id, id.split('+'), 6));
out.push(await run('back to quiet', [], 4));
scene.setState = orig;
return { tier: gfx.quality, scale: gfx.scale, programsEnd: R.info.programs.length, rows: out };
