// Body of an async function for scripts/perf/tf-probe.mjs: WHO draws in the main pass. Every mesh gets an onBeforeRender counter, one real frame is drawn
// (gfx.render), and the drawn objects are listed, aggregated by owner path + material kind. Run with --level 1 to have customers in the picture.
//   node scripts/perf/tf-probe.mjs --base http://127.0.0.1:5852 --port 9990 --tier medium --level 1 --warm 25 --js scripts/perf/tf-who.probe.js
const R = gfx.renderer;
const sc = gfx.scene;
const want = (args && args.customers) || 0;
const t0 = performance.now();
const countCust = () => {
  let n = 0;
  sc.traverse((o) => {
    if (/^customer-/.test(o.name || '')) {
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      n++;
    }
  });
  return n;
};
while (countCust() < want && performance.now() - t0 < 90000) await h.sleep(500);
await h.frames(5);
const rows = [];
const hooked = [];
sc.traverse((o) => {
  if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
  const prev = o.onBeforeRender;
  o.__n = 0;
  o.onBeforeRender = function (...a) {
    this.__n++;
    return prev.apply(this, a);
  };
  hooked.push([o, prev]);
});
// shadow pass off for this frame: the main pass only
const sm = R.shadowMap;
const wasAuto = sm.autoUpdate;
sm.autoUpdate = false;
sm.needsUpdate = false;
R.info.reset();
gfx.render(0.016);
const calls = R.info.render.calls;
sm.autoUpdate = wasAuto;
sm.needsUpdate = true;
const pathOf = (o) => {
  const names = [];
  for (let p = o; p && p !== sc; p = p.parent) names.unshift((p.name || p.type).replace(/#\d+/g, ''));
  return names;
};
const agg = new Map();
const detail = [];
let total = 0;
for (const [o, prev] of hooked) {
  if (o.__n > 0) {
    total += o.__n;
    const names = pathOf(o);
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const g0 = o.geometry;
    detail.push(
      `${names.slice(0, 3).join('/')} | ${o.name || ''} | ${m ? m.type.replace('Material', '') : '?'}${m && m.name ? ':' + m.name : ''} c=${m && m.color ? m.color.getHexString() : ''} r=${m && m.roughness !== undefined ? +m.roughness.toFixed(2) : ''} m=${m && m.metalness !== undefined ? +m.metalness.toFixed(2) : ''}${m && m.map ? ' MAP=' + (m.map.name || m.map.uuid.slice(0, 4)) + (m.map.isCanvasTexture ? 'C' : '') + (m.normalMap ? '/' + m.normalMap.uuid.slice(0, 4) : '') : ''}${m && m.normalMap ? ' NM' : ''}${m && m.roughnessMap ? ' RM' : ''}${m && m.transparent ? ' TR' : ''}${m && m.side === 2 ? ' DS' : m && m.side === 1 ? ' BS' : ''}${m && m.emissiveIntensity > 0 && m.emissive && m.emissive.getHex() ? ' EM' : ''}${o.castShadow ? ' cs' : ''}${o.receiveShadow ? ' rs' : ''}${o.isInstancedMesh ? ' INST' + o.count : ''}${m && m.vertexColors ? ' vc' : ''} ${g0 && g0.attributes.position ? g0.attributes.position.count : 0}v ${g0 ? Math.round((g0.index ? g0.index.count : g0.attributes.position.count) / 3) : 0}t${m && m.onBeforeCompile && String(m.onBeforeCompile).length > 60 ? ' OBC' : ''}`,
    );
    const label = `${names.slice(0, 2).join('/')} | ${o.isInstancedMesh ? 'inst ' : ''}${m ? (m.name || m.type) : '?'}${m && m.userData && m.userData.uber ? '(uber)' : ''}${o.castShadow ? ' cs' : ''}`;
    const e = agg.get(label) || { n: 0, tris: 0 };
    e.n += o.__n;
    const g = o.geometry;
    e.tris += g ? Math.round((g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0) / 3) : 0;
    agg.set(label, e);
  }
  o.onBeforeRender = prev;
  delete o.__n;
}
const list = [...agg.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${v.n}x ${k} (${v.tris} tris)`);
return { tier: gfx.quality, scale: gfx.scale, calls, hookCount: total, customers: countCust(), groups: list.length, list, detail: detail.sort() };
