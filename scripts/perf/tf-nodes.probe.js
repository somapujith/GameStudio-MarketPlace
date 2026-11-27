// Body of an async function for scripts/perf/tf-probe.mjs: how many scene nodes are re-multiplied every frame (matrixAutoUpdate) per top-level group, and what the
// renderer's own scene.updateMatrixWorld() costs per call (what a frame pays before it draws anything).
const sc = gfx.scene;
const groups = [];
for (const k of sc.children) {
  let nodes = 0;
  let auto = 0;
  let meshes = 0;
  let autoMeshes = 0;
  k.traverse((o) => {
    nodes++;
    if (o.matrixAutoUpdate) auto++;
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      meshes++;
      if (o.matrixAutoUpdate) autoMeshes++;
    }
  });
  groups.push({ name: k.name || k.type, nodes, auto, meshes, autoMeshes });
}
groups.sort((a, b) => b.auto - a.auto);
const N = 300;
const t0 = performance.now();
for (let i = 0; i < N; i++) sc.updateMatrixWorld();
const ms = (performance.now() - t0) / N;
let total = 0;
let auto = 0;
sc.traverse((o) => {
  total++;
  if (o.matrixAutoUpdate) auto++;
});
return { tier: gfx.quality, nodes: total, autoNodes: auto, updateMatrixWorldMs: +ms.toFixed(3), groups: groups.slice(0, 10) };
