// Tiffin Centre: where the draw calls, geometries, materials and shader programs come from, per group of the scene.
//
//   node scripts/perf/tf-groups.mjs --base http://127.0.0.1:5770 --port 9813 [--tier medium] [--settle 20] [--json out.json] [--no-lock]
//
// Starts the tutorial like a player, lets everything settle (`--settle` seconds: batching, shader warm-up), then for every top-level group of the scene
// (stall shell, stations, street, actors, fx, ...) renders the scene with ONLY that group visible and reads renderer.info (calls include the shadow pass
// on tiers that have one). Also lists the shader programs by material type and how many programs a given material signature produced.
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
const port = +(args.port || 9813);
const tier = args.tier && args.tier !== true ? String(args.tier) : '';
const settle = +(args.settle || 20);

const INSPECT = `(() => {
  const d = window.__tiffin.scene.debug; const g = d.gfx; const R = g.renderer; const scene = g.scene;
  const cam = g.camera;
  const kids = scene.children.slice();
  const nameOf = (o, i) => o.name || (o.isLight ? o.type : o.isMesh ? 'mesh:' + (o.material && o.material.type) : o.type) + '#' + i;
  const count = (root) => {
    let meshes = 0, visibleMeshes = 0, tris = 0; const mats = new Set(); const geos = new Set(); let instanced = 0, skinned = 0, nodes = 0, statics = 0;
    root.traverse((o) => {
      nodes++;
      if (!o.matrixAutoUpdate === true) statics++;
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      meshes++;
      let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
      if (vis) visibleMeshes++;
      if (o.isInstancedMesh) instanced++;
      if (o.isSkinnedMesh) skinned++;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) if (m) mats.add(m);
      if (o.geometry) { geos.add(o.geometry); const ix = o.geometry.index; tris += (ix ? ix.count : (o.geometry.attributes.position ? o.geometry.attributes.position.count : 0)) / 3 * (o.isInstancedMesh ? o.count : 1); }
    });
    return { meshes, visibleMeshes, materials: mats.size, geometries: geos.size, triangles: Math.round(tris), instanced, skinned, nodes, frozen: statics };
  };
  const saved = kids.map((k) => k.visible);
  const post = g.post; const wasPost = g.cfg.post;
  const renderOnce = () => { R.info.reset(); R.render(scene, cam); return { calls: R.info.render.calls, tris: R.info.render.triangles }; };
  const out = [];
  // everything
  kids.forEach((k, i) => { k.visible = saved[i]; });
  const all = renderOnce();
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k === cam || k.isLight && !k.castShadow) continue;
    kids.forEach((o, j) => { o.visible = j === i || o === cam || (o.isLight); });
    k.visible = saved[i];
    const r = renderOnce();
    const c = count(k);
    out.push({ name: nameOf(k, i), type: k.type, ...r, ...c, children: k.children.length });
  }
  kids.forEach((k, i) => { k.visible = saved[i]; });
  // sub-groups of the biggest roots
  const sub = {};
  for (const k of kids) {
    if (!k.name || !['stall', 'street', 'actors'].includes(k.name) && k.children.length < 6) continue;
    const rows = [];
    const subs = k.children.slice();
    const sv = subs.map((s) => s.visible);
    for (let i = 0; i < subs.length; i++) {
      kids.forEach((o) => { if (o !== k && o !== cam && !o.isLight) o.visible = false; });
      subs.forEach((s, j) => { s.visible = j === i && sv[j]; });
      const r = renderOnce();
      const c = count(subs[i]);
      if (r.calls > 0 || c.meshes > 0) rows.push({ name: subs[i].name || subs[i].type + '#' + i, ...r, ...c });
    }
    subs.forEach((s, j) => { s.visible = sv[j]; });
    kids.forEach((o, j) => { o.visible = saved[j]; });
    sub[k.name || k.type] = rows.sort((a, b) => b.calls - a.calls).slice(0, 40);
  }
  kids.forEach((k, i) => { k.visible = saved[i]; });
  const progs = {};
  for (const p of R.info.programs) { const n = p.name || '?'; progs[n] = (progs[n] || 0) + 1; }
  return { quality: g.quality, scale: g.scale, all, groups: out.sort((a, b) => b.calls - a.calls), sub, programs: R.info.programs.length, programsByName: progs, memory: { geometries: R.info.memory.geometries, textures: R.info.memory.textures } };
})()`;

async function run() {
  const c = await launch({ port, w: 1536, h: 864, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(1536, 864, 1.25, false);
    await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
    await c.waitFor("[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 90000);
    if (tier) {
      await c.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === '${tier.toLowerCase()}')?.click(); true`);
      await c.sleep(300);
    }
    await c.ev("[...document.querySelectorAll('button')].filter((b) => /Start tutorial/.test(b.textContent)).pop().click(); true");
    await c.waitFor('!!(window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug)', 180000);
    await c.sleep(settle * 1000);
    return await c.ev(INSPECT);
  } finally {
    c.close();
  }
}

const res = args['no-lock'] ? await run() : await withBenchLock(run);
if (args.json) fs.writeFileSync(String(args.json), JSON.stringify(res, null, 1));
console.log(`tier ${res.quality} scale ${res.scale}: whole scene ${res.all.calls} calls, ${res.all.tris} tris; ${res.programs} programs; ${res.memory.geometries} geometries, ${res.memory.textures} textures`);
const row = (r) => `  ${String(r.calls).padStart(4)} calls ${String(r.visibleMeshes).padStart(4)}/${String(r.meshes).padStart(4)} meshes ${String(r.materials).padStart(3)} mats ${String(r.geometries).padStart(4)} geos ${String(r.triangles).padStart(7)} tris  ${r.name}`;
console.log('top-level groups:\n' + res.groups.map(row).join('\n'));
for (const [k, rows] of Object.entries(res.sub)) console.log(`inside ${k}:\n` + rows.map(row).join('\n'));
console.log('programs by material type: ' + JSON.stringify(res.programsByName));
process.exit(0);
