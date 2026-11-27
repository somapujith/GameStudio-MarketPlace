// The player's auto in a handful of draw calls: an "uber" MeshStandardMaterial whose per-part look comes from per-vertex SLOTS.
// Every opaque static part (chrome, the vertex-coloured matte trim, seat, roof, curtains, window panes, lamps, emblem, number plates,
// banner, rear-window sticker) is ONE mesh, the wheels are one mesh per spin group, and the always-visible transparent decals (engine
// cover art, mud-flap art, roof badge) one more. Each vertex carries `aSlot`; the vertex shader reads that slot's colour, emissive,
// roughness, metalness, environment strength, shadow receiving, "unlit" (lamp) and visibility from small uniform arrays.
//
// The per-part materials customize.js and Game.js write (paint is NOT one of them: it keeps its own MeshPhysicalMaterial) stay exactly
// what they were: the handles in auto.userData (chrome, roofM, seatM, curtainM, rimM, spokeM, hlM, tailLampM, tailRefM, brakeM...) are
// still recoloured by reference, they are just no longer drawn by a mesh of their own. `syncUber` copies them into the uniform arrays
// right before the merged meshes draw (onBeforeRender: no per-frame allocation, a few hundred float writes).
// Textures come from the decal atlas (sim/auto-atlas.js): untextured parts sample its white cell.
// OWNER: customisation agent.
import { Float32BufferAttribute, MeshDepthMaterial, MeshStandardMaterial, ShaderChunk } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATLAS_UV, remapUvs } from './auto-atlas.js';

/**
 * The slots, in uniform-array order. recv: receives shadows; cast: drawn in the shadow pass (only the roof among the merged parts, as before:
 * the tub and the driver are separate casters); unlit: a lamp (its material's colour is the final colour, like the MeshBasicMaterial it
 * was); cell: the atlas cell its uvs address (null = the white cell).
 */
export const UBER_SLOTS = [
  { name: 'chrome' },
  { name: 'matte' },
  { name: 'seat' },
  { name: 'roof', recv: true, cast: true },
  { name: 'curtains' },
  { name: 'paneSides' },
  { name: 'tailLens', unlit: true },
  { name: 'tailRef', unlit: true },
  { name: 'brake', unlit: true },
  { name: 'hlLamp', unlit: true },
  { name: 'emblem' },
  { name: 'plates', cell: 'plate' },
  { name: 'banner', cell: 'banner' },
  { name: 'paneCenter', cell: 'rearWindow' },
  { name: 'tyre' },
  { name: 'rim' },
  { name: 'spokes' },
  { name: 'whites' },
  { name: 'face', cell: 'cover' },
  { name: 'flapDecal', cell: 'flap' },
  { name: 'badge', cell: 'badge' },
];
export const SLOT = Object.fromEntries(UBER_SLOTS.map((s, i) => [s.name, i]));
export const SLOT_COUNT = UBER_SLOTS.length;

/** Which slots each merged mesh holds (the wheel set is built twice: '' = the front wheel, 'R' = the rear pair). */
export const UBER_GROUPS = {
  body: ['chrome', 'matte', 'seat', 'roof', 'curtains', 'paneSides', 'tailLens', 'tailRef', 'brake', 'hlLamp', 'emblem', 'plates', 'banner', 'paneCenter'],
  wheel: ['tyre', 'rim', 'spokes', 'whites'],
  decal: ['face', 'flapDecal', 'badge'],
};

// ------------------------------------------------------------------------------------------------------------ geometry

/**
 * Merge per-slot geometries (`geos[name + suffix]`, non-indexed, position / normal / uv, optional colour) into one geometry carrying
 * `aSlot`, a colour on every vertex (white where the slot had none) and uvs moved into the slot's atlas cell. Missing slots are skipped.
 */
export function mergeSlots(geos, names, suffix = '') {
  const list = [];
  for (const name of names) {
    const src = geos[name + suffix];
    if (!src) continue;
    const g = src.clone();
    const n = g.attributes.position.count;
    const slot = new Float32Array(n).fill(SLOT[name]);
    g.setAttribute('aSlot', new Float32BufferAttribute(slot, 1));
    if (!g.attributes.color) g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    const cell = UBER_SLOTS[SLOT[name]].cell;
    remapUvs(g.attributes.uv.array, cell ? ATLAS_UV[cell] : null, ATLAS_UV.white);
    list.push(g);
  }
  const out = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!out) throw new Error(`auto-uber: could not merge ${names.join(',')} (mismatched attributes)`);
  return out;
}

// ------------------------------------------------------------------------------------------------------------ uniforms

/** The uniform arrays (shared by every material of one auto): a = colour rgb + visible, b = emissive rgb + env strength, c = roughness, metalness, receive, unlit. */
export function createUberState() {
  const n = SLOT_COUNT * 4;
  const st = { a: new Float32Array(n), b: new Float32Array(n), c: new Float32Array(n), bindings: [] };
  st.uniforms = { uberA: { value: st.a }, uberB: { value: st.b }, uberC: { value: st.c } };
  return st;
}

/**
 * Write slot `i` from material `m` (a MeshStandardMaterial, or a MeshBasicMaterial lamp) into the arrays. Pure and allocation-free.
 * An unlit slot puts the material's colour in the emissive channel (it is the final colour); a lit one copies colour, emissive x intensity,
 * roughness, metalness and envMapIntensity (customize.js scales that per material, so the env strength stays per part).
 */
export function packSlot(st, i, m, visible) {
  const o = i * 4;
  const f = UBER_SLOTS[i];
  const { a, b, c } = st;
  a[o + 3] = visible ? 1 : 0;
  c[o + 2] = f.recv ? 1 : 0;
  if (f.unlit) {
    a[o] = a[o + 1] = a[o + 2] = 0;
    b[o] = m.color.r;
    b[o + 1] = m.color.g;
    b[o + 2] = m.color.b;
    b[o + 3] = 0;
    c[o] = 1;
    c[o + 1] = 0;
    c[o + 3] = 1;
    return;
  }
  a[o] = m.color.r;
  a[o + 1] = m.color.g;
  a[o + 2] = m.color.b;
  const e = m.emissive;
  const k = m.emissiveIntensity ?? 1;
  b[o] = e ? e.r * k : 0;
  b[o + 1] = e ? e.g * k : 0;
  b[o + 2] = e ? e.b * k : 0;
  b[o + 3] = m.envMapIntensity ?? 1;
  c[o] = m.roughness ?? 1;
  c[o + 1] = m.metalness ?? 0;
  c[o + 3] = 0;
}

/**
 * Bind slot `name` to the material that holds its look. `vis` (optional): an object whose `.visible` shows / hides the slot (`invert`:
 * hidden while that object is visible, e.g. the textured stand-in mesh of a patterned seat).
 */
export function bindSlot(st, name, material, vis = null, invert = false) {
  st.bindings.push({ i: SLOT[name], m: material, vis, invert });
}

/** Copy every bound material into the uniform arrays (per frame; allocation-free). */
export function syncUber(st) {
  const list = st.bindings;
  for (let k = 0; k < list.length; k++) {
    const bd = list[k];
    const v = bd.vis ? bd.vis.visible !== bd.invert : true;
    packSlot(st, bd.i, bd.m, v);
  }
}

// ------------------------------------------------------------------------------------------------------------ shaders

const N = SLOT_COUNT;
const VERT_PARS = `
attribute float aSlot;
uniform vec4 uberA[ ${N} ];
uniform vec4 uberB[ ${N} ];
uniform vec4 uberC[ ${N} ];
varying vec4 vUberB;
varying vec4 vUberC;`;
// (the slot's colour multiplies the vertex colour; a hidden slot is moved outside the clip volume, so its triangles are culled)
const VERT_SLOT = `
int uberI = int( aSlot + 0.5 );
vColor.rgb *= uberA[ uberI ].rgb;
vUberB = uberB[ uberI ];
vUberC = uberC[ uberI ];`;
const VERT_HIDE = `
if ( uberA[ uberI ].a < 0.5 ) gl_Position = vec4( 0.0, 0.0, - 2.0, 1.0 );`;

/** Patch a MeshStandardMaterial shader (onBeforeCompile) into the slot reader. Exported for the shader-text test. */
export function patchUberShader(shader, st) {
  Object.assign(shader.uniforms, st.uniforms);
  const must = (src, find, repl) => {
    if (!src.includes(find)) throw new Error(`auto-uber: shader chunk "${find}" not found`);
    return src.replace(find, repl);
  };
  let v = shader.vertexShader;
  v = must(v, '#include <common>', `#include <common>${VERT_PARS}`);
  v = must(v, '#include <color_vertex>', `#include <color_vertex>${VERT_SLOT}`);
  v = must(v, '#include <project_vertex>', `#include <project_vertex>${VERT_HIDE}`);
  shader.vertexShader = v;
  let f = shader.fragmentShader;
  f = must(f, '#include <common>', '#include <common>\nvarying vec4 vUberB;\nvarying vec4 vUberC;');
  // per-slot environment strength (customize.js writes envMapIntensity per material)
  f = must(f, '#include <envmap_physical_pars_fragment>', ShaderChunk.envmap_physical_pars_fragment.replaceAll('envMapIntensity', 'vUberB.a'));
  // per-slot shadow receiving (the object-wide `receiveShadow` uniform is declared in lights_pars_begin and read in lights_fragment_begin)
  f = must(f, '#include <lights_pars_begin>', '#include <lights_pars_begin>\n#define receiveShadow ( vUberC.z > 0.5 )');
  f = must(f, '#include <map_fragment>', 'vec4 uberTexel = vec4( 1.0 );\n#ifdef USE_MAP\nuberTexel = texture2D( map, vMapUv );\n#endif\ndiffuseColor *= uberTexel;');
  f = must(f, '#include <roughnessmap_fragment>', 'float roughnessFactor = vUberC.x;');
  f = must(f, '#include <metalnessmap_fragment>', 'float metalnessFactor = vUberC.y;');
  // emissive x the texel (the glowing number plate used its texture as the emissive map; untextured slots sample white)
  f = must(f, '#include <emissivemap_fragment>', 'totalEmissiveRadiance = vUberB.rgb * uberTexel.rgb;');
  f = must(f, '#include <opaque_fragment>', 'if ( vUberC.w > 0.5 ) outgoingLight = vUberB.rgb;\n#include <opaque_fragment>');
  shader.fragmentShader = f;
}

/** The uber material (opaque by default; `opts` are MeshStandardMaterial parameters, e.g. the transparent decal variant). */
export function createUberMaterial(st, opts = {}) {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true, ...opts });
  m.onBeforeCompile = (shader) => patchUberShader(shader, st);
  m.customProgramCacheKey = () => 'aw-uber-1';
  m.name = opts.transparent ? 'aw-uber-decal' : 'aw-uber';
  return m;
}

/** The merged body mesh's shadow-pass material: only the slots flagged `cast` (the roof) reach the shadow map, exactly as before. */
export function createUberDepthMaterial() {
  const cast = new Float32Array(SLOT_COUNT);
  UBER_SLOTS.forEach((s, i) => {
    cast[i] = s.cast ? 1 : 0;
  });
  const m = new MeshDepthMaterial();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uberCast = { value: cast };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aSlot;\nuniform float uberCast[ ${N} ];`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nif ( uberCast[ int( aSlot + 0.5 ) ] < 0.5 ) gl_Position = vec4( 0.0, 0.0, - 2.0, 1.0 );');
  };
  m.customProgramCacheKey = () => 'aw-uber-depth-1';
  m.name = 'aw-uber-depth';
  return m;
}
