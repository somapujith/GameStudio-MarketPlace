// Body of an async function for scripts/perf/tf-probe.mjs (scene, gfx, args, h in scope):
//   node scripts/perf/tf-probe.mjs --base http://127.0.0.1:5852 --port 9990 --tier medium --level 1 --warm 25 --js scripts/perf/tf-draws.probe.js
// Draw calls of ONE frame split by group (main pass only: the shadow map is frozen for the measurement), the customers one by one, programs and what they
// are made of. Waits (up to args.wait s) until at least args.customers customers are standing in the scene.
const R = gfx.renderer;
const sc = gfx.scene;
const cam = gfx.camera;
const want = (args && args.customers) || 3;
const t0 = performance.now();
const customersNow = () => {
  const out = [];
  sc.traverse((o) => {
    if (/^customer-/.test(o.name || '')) out.push(o);
  });
  return out;
};
const visibleChain = (o) => {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};
while (customersNow().filter(visibleChain).length < want && performance.now() - t0 < (((args && args.wait) || 90) * 1000)) await h.sleep(500);
await h.frames(10);
const programs = R.info.programs.length; // before this script renders to the canvas (a different output colour space: more programs)
const meshesOf = (root) => {
  let main = 0;
  let shadow = 0;
  let tris = 0;
  const mats = new Set();
  root.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    if (!visibleChain(o)) return;
    main++;
    if (o.castShadow) shadow++;
    mats.add(o.material);
    const g = o.geometry;
    if (g && g.index) tris += g.index.count / 3;
  });
  return { main, shadow, tris: Math.round(tris), mats: mats.size };
};
const render = () => {
  R.info.reset();
  R.render(sc, cam);
  return R.info.render.calls;
};
const sm = R.shadowMap;
const wasAuto = sm.autoUpdate;
sm.autoUpdate = false;
sm.needsUpdate = false;
const mainOnly = render();
sm.autoUpdate = wasAuto;
sm.needsUpdate = true;
const withShadow = render();
const customers = customersNow().map((g) => {
  const m = meshesOf(g);
  return { name: g.name, visible: visibleChain(g), ...m };
}).filter((c) => c.visible);
// per top-level group
const kids = sc.children.slice();
const saved = kids.map((k) => k.visible);
const groups = [];
sm.autoUpdate = false;
for (let i = 0; i < kids.length; i++) {
  const k = kids[i];
  if (k === cam || k.isLight) continue;
  kids.forEach((o, j) => {
    o.visible = j === i || o === cam || o.isLight;
  });
  k.visible = saved[i];
  sm.needsUpdate = false;
  const c = render();
  groups.push({ name: k.name || k.type, calls: c });
}
kids.forEach((k, i) => {
  k.visible = saved[i];
});
sm.autoUpdate = wasAuto;
sm.needsUpdate = true;
groups.sort((a, b) => b.calls - a.calls);
return { tier: gfx.quality, scale: gfx.scale, mainOnly, withShadow, programs, customers, groups: groups.slice(0, 14), tris: R.info.render.triangles };
