// Shared PBR materials of the street props (one MeshStandardMaterial per real-world material, cached, userData.shared).
// All of them use vertex colours as a TINT multiplied onto the albedo map, so one "paint" material makes the yellow body, the
// black hood and the red cylinder. `tile` = world metres covered by one texture repeat (used for the baked box-projection UVs),
// `proj` = default UV mode ('box' = world-space box projection, 'keep' = the primitive's own UVs, scaled by o.uvs).
import { DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Vector2 } from 'three';
import { pbr } from './textures-pbr.js';
import { sharedMat } from './util.js';

export const MAT = {
  steel: { set: () => pbr.brushedSteel(), tile: 0.7, rough: 1, metal: 1, ns: 0.7, side: DoubleSide },
  steelDark: { set: () => pbr.brushedSteel({ tone: '#868e94', dirt: 1 }), tile: 0.7, rough: 1, metal: 1, ns: 0.8, side: DoubleSide },
  paint: { set: () => pbr.paint(), tile: 0.9, rough: 1, metal: 1, ns: 0.8, side: DoubleSide },
  paintWorn: { set: () => pbr.paint({ wear: 0.85 }), tile: 0.9, rough: 1, metal: 1, ns: 1, side: DoubleSide },
  tin: { set: () => pbr.tin(), tile: 1.1, rough: 1, metal: 1, ns: 1, side: DoubleSide },
  wood: { set: () => pbr.wood(), tile: 0.9, rough: 1, metal: 0, ns: 0.9 },
  woodDark: { set: () => pbr.wood({ tone: '#5a3a24' }), tile: 0.9, rough: 1, metal: 0, ns: 0.9 },
  woodPaint: { set: () => pbr.wood({ tone: '#8a5a33', painted: 0.55 }), tile: 0.9, rough: 1, metal: 0, ns: 1 },
  brick: { set: () => pbr.brick(), tile: 0.96, rough: 1, metal: 0, ns: 1.2 },
  concrete: { set: () => pbr.concrete(), tile: 1.6, rough: 1, metal: 0, ns: 1.1 },
  asphalt: { set: () => pbr.asphalt(), tile: 2.2, rough: 1, metal: 0, ns: 1.3 },
  tarp: { set: () => pbr.tarp(), tile: 0.5, rough: 1, metal: 0, ns: 0.7, side: DoubleSide },
  cloth: { set: () => pbr.cloth(), tile: 0.22, rough: 1, metal: 0, ns: 0.4, side: DoubleSide },
  canvas: { set: () => pbr.cloth({ threads: 32, jit: 0.4 }), tile: 0.3, rough: 1, metal: 0, ns: 0.45, side: DoubleSide },
  jute: { set: () => pbr.jute(), tile: 0.36, rough: 1, metal: 0, ns: 1, side: DoubleSide },
  plastic: { set: () => pbr.plastic(), tile: 0.5, rough: 1, metal: 0, ns: 0.45 },
  rubber: { set: () => pbr.rubber(), tile: 0.4, rough: 1, metal: 0, ns: 0.8 },
  tyre: { set: () => pbr.tyre(), tile: 1, rough: 1, metal: 0, ns: 1, proj: 'keep' },
  vinyl: { set: () => pbr.vinyl(), tile: 0.16, rough: 1, metal: 0, ns: 0.45 },
  rope: { set: () => pbr.rope(), tile: 1, rough: 1, metal: 0, ns: 1, proj: 'keep' },
  bamboo: { set: () => pbr.bamboo(), tile: 1, rough: 1, metal: 0, ns: 0.8, proj: 'keep' },
  hide: { set: () => pbr.hide(), tile: 2.2, rough: 1, metal: 0, ns: 0.8 },
  // plain (no maps): chrome, brass, enamel pieces
  chrome: { plain: { rough: 0.1, metal: 1 }, tile: 1 },
  stainless: { plain: { rough: 0.3, metal: 1 }, tile: 1 },
  brass: { plain: { rough: 0.32, metal: 1 }, tile: 1 },
  enamel: { plain: { rough: 0.3, metal: 0 }, tile: 1, side: DoubleSide },
  matte: { plain: { rough: 0.9, metal: 0 }, tile: 1 },
  glass: { plain: { rough: 0.04, metal: 0, glass: true }, tile: 1, side: DoubleSide },
};

/** Shared material by name (see MAT). */
export function streetMat(name) {
  const def = MAT[name];
  if (!def) throw new Error(`unknown street material ${name}`);
  return sharedMat(`street:${name}`, () => {
    if (def.plain?.glass) {
      return new MeshPhysicalMaterial({ color: '#d8f0f0', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide, vertexColors: true, ior: 1.5, specularIntensity: 1, envMapIntensity: 1.4 });
    }
    if (def.plain) return new MeshStandardMaterial({ vertexColors: true, roughness: def.plain.rough, metalness: def.plain.metal, ...(def.side ? { side: def.side } : {}) });
    const s = def.set();
    return new MeshStandardMaterial({
      vertexColors: true,
      map: s.map,
      normalMap: s.normalMap,
      normalScale: new Vector2(def.ns ?? 1, def.ns ?? 1),
      roughnessMap: s.roughnessMap,
      metalnessMap: def.metal ? s.roughnessMap : null,
      roughness: def.rough,
      metalness: def.metal,
      ...(def.side ? { side: def.side } : {}),
      envMapIntensity: 1,
    });
  });
}

/** Cow hide with its own coat / patch colours (shared per colour pair). */
export function hideMat(coat = '#ece6d6', patch = '#8a5a34', amount = 0.5) {
  return sharedMat(`street:hide:${coat}:${patch}:${amount}`, () => {
    const s = pbr.hide({ coat, patch, amount });
    return new MeshStandardMaterial({ vertexColors: true, map: s.map, normalMap: s.normalMap, normalScale: new Vector2(0.8, 0.8), roughnessMap: s.roughnessMap, roughness: 1, metalness: 0 });
  });
}

/** Unlit emissive (bulbs, tubes, lamps): vertex-coloured, ignores tone mapping so bloom picks it up. */
export const glowMat = () => sharedMat('street:glow', () => new MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
