// Free every GPU resource under an Object3D (geometries, materials, their textures). Safe to call twice.
export function disposeTree(root) {
  const seen = new Set();
  const freeMaterial = (m) => {
    if (!m || seen.has(m)) return;
    seen.add(m);
    for (const v of Object.values(m)) if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); }
    m.dispose?.();
  };
  root.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    if (o.material) Array.isArray(o.material) ? o.material.forEach(freeMaterial) : freeMaterial(o.material);
    if (o.isInstancedMesh) o.dispose?.();
    if (o.shadow?.map) o.shadow.map.dispose();
  });
}
