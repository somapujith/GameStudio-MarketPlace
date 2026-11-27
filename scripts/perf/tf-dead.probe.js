// Body of an async function for scripts/perf/tf-probe.mjs: which compiled programs does NO live material use any more (wasted link time at load), and what
// differs between each of them and the live program closest to it (cache key tokens), plus which material of the scene would own it.
const R = gfx.renderer;
const sc = gfx.scene;
const props = R.properties;
const progs = R.info.programs.slice();
const live = new Set();
const owner = new Map();
sc.traverse((o) => {
  const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
  for (const m of ms) {
    const pr = props.get(m);
    if (pr && pr.currentProgram) {
      live.add(pr.currentProgram.id);
      if (!owner.has(pr.currentProgram.id)) owner.set(pr.currentProgram.id, (o.name || o.type) + ':' + m.type);
    }
  }
});
const tok = (p) => String(p.cacheKey).split(',');
const dead = progs.filter((p) => !live.has(p.id) && !/PMREM|bloom|final|fxaa/.test(p.name || ''));
const rows = dead.map((d) => {
  const a = tok(d);
  let best = null;
  for (const l of progs) {
    if (!live.has(l.id)) continue;
    const b = tok(l);
    if (b.length !== a.length) continue;
    let n = 0;
    const diffs = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) {
      n++;
      diffs.push(`${i}:${String(a[i]).slice(0, 24)}->${String(b[i]).slice(0, 24)}`);
    }
    if (!best || n < best.n) best = { n, id: l.id, diffs };
  }
  return { id: d.id, name: d.name || '', used: d.usedTimes, keyTail: String(d.cacheKey).slice(-60), nearestLive: best ? { id: best.id, n: best.n, owner: owner.get(best.id), diffs: best.diffs.slice(0, 6) } : null };
});
return { programs: progs.length, live: live.size, dead: rows.length, rows };
