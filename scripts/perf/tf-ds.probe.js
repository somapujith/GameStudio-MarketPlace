// Body of an async function for scripts/perf/tf-probe.mjs: the transparent double-sided materials that three.js draws TWICE (back faces, then front faces: two draw
// calls and two program variants each unless `forceSinglePass`), by object, and what a frame costs in calls when they are all forced single-pass.
const R = gfx.renderer;
const sc = gfx.scene;
const rows = [];
const mats = new Set();
sc.traverse((o) => {
  if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!m || !m.transparent || m.side !== 2) return;
  let vis = true;
  for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
  rows.push(`${o.parent && o.parent.name || ''}/${o.name || o.type} ${m.type} blend=${m.blending} fsp=${m.forceSinglePass} visible=${vis} v=${o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0}${m.userData && m.userData.shared ? ' shared' : ''}`);
  if (!m.forceSinglePass) mats.add(m);
});
const frame = () => {
  R.info.reset();
  gfx.render(0.016);
  return R.info.render.calls;
};
await h.frames(3);
const before = frame();
for (const m of mats) m.forceSinglePass = true;
await h.frames(3);
const after = frame();
return { materialsDoublePass: mats.size, callsBefore: before, callsAfterForcingAll: after, rows: rows.slice(0, 60) };
