// Tiny disposal helper: every geometry / material / texture a module creates is `track`ed and released in one call.
export function createTracker() {
  const items = [];
  return {
    track(o) {
      if (o) items.push(o);
      return o;
    },
    dispose() {
      for (const o of items) {
        try {
          o.dispose?.();
        } catch {
          /* already gone */
        }
      }
      items.length = 0;
    },
  };
}

/** Dispose geometries, materials and textures hanging off an Object3D tree (for objects built by someone else). */
export function disposeTree(root) {
  root?.traverse?.((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) m[k].dispose();
      m.dispose?.();
    }
  });
}
