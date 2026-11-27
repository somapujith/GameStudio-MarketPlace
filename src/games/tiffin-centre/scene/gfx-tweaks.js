// Two renderer-level tweaks that cut GPU / driver work without changing a pixel:
//
//  * `skipDarkLights()` patches three's lighting loop so a point light that contributes nothing at a fragment (switched off, or the fragment is beyond its
//    range) costs a distance test instead of a full PBR evaluation. The stall carries up to 11 point lights (bulbs, tube, station flames, candles, lamps)
//    and most are off or out of range for any given fragment. three evaluates every one of them for every fragment of every material.
//  * `programSort(renderer)` orders the OPAQUE draws by shader program first (then by material), so the GL program changes once per program instead of
//    once per material change. A program change re-sends the whole lighting uniform set and the camera matrices (about 60 GL calls); on a driver where
//    each GL call is expensive that is the biggest per-draw cost.
//
// Both are pure functions of their inputs and unit-tested; the patch is idempotent and reversible.
import { ShaderChunk } from 'three';

const POINT_CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const POINT_OPEN = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
const POINT_FETCH = 'pointLight = pointLights[ i ];';

/**
 * The lighting chunk with the point-light loop made cheap for lights that do nothing (pure: returns a new string; the input unchanged when it does not match):
 *  - a light whose colour uniform is zero (switched off) is skipped before its distance attenuation is even computed (a uniform branch: free),
 *  - a light that reaches this fragment with zero colour (beyond its range) skips the PBR evaluation.
 */
export function guardPointLights(src) {
  const fetch = src.indexOf(POINT_FETCH);
  const open = src.indexOf(POINT_OPEN, Math.max(0, fetch));
  if (fetch < 0 || open < 0) return src;
  const call = src.indexOf(POINT_CALL, open);
  if (call < 0) return src;
  // only the first RE_Direct after the point-light info belongs to the point loop (the spot and directional loops come later and keep theirs)
  const nextLoop = src.indexOf('#pragma unroll_loop_end', open);
  if (nextLoop >= 0 && call > nextLoop) return src;
  if (src.slice(fetch, call).includes('dot( pointLight.color')) return src; // already guarded
  return (
    `${src.slice(0, fetch)}${POINT_FETCH}
		if ( dot( pointLight.color, vec3( 1.0 ) ) > 0.0 ) {` +
    `${src.slice(fetch + POINT_FETCH.length, call)}if ( directLight.visible ) { ${POINT_CALL} }
		}${src.slice(call + POINT_CALL.length)}`
  );
}

let original = null;
let users = 0;

/** Install the guarded lighting chunk (reference counted: every createRenderer calls it, every dispose releases it). Returns a release function. */
export function skipDarkLights() {
  if (users === 0) {
    const src = ShaderChunk.lights_fragment_begin;
    const next = guardPointLights(src);
    if (next !== src) {
      original = src;
      ShaderChunk.lights_fragment_begin = next;
    }
  }
  users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users = Math.max(0, users - 1);
    if (users === 0 && original) {
      ShaderChunk.lights_fragment_begin = original;
      original = null;
    }
  };
}

/** True while the guarded chunk is in place (tests, debug). */
export const lightSkipActive = () => original !== null;

/**
 * A comparator for `renderer.setOpaqueSort`: groupOrder, renderOrder (the sky, the weather, the highlight keep their place), then PROGRAM, then material, variant,
 * front to back, id. `programIdOf(material)` returns a stable id of the material's compiled program (or -1 before its first compile); it is cached per frame by
 * the caller through `programSort`.
 */
export function makeProgramComparator(programIdOf) {
  return function programSortStable(a, b) {
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
    if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
    const pa = programIdOf(a.material);
    const pb = programIdOf(b.material);
    if (pa !== pb) return pa - pb;
    if (a.material.id !== b.material.id) return a.material.id - b.material.id;
    if (a.materialVariant !== b.materialVariant) return a.materialVariant - b.materialVariant;
    if (a.z !== b.z) return a.z - b.z;
    return a.id - b.id;
  };
}

/**
 * Installs the program-first opaque sort on a WebGLRenderer. The program id is looked up once per material per frame (`tick()` is called once per frame by the
 * renderer wrapper). Returns { tick, dispose }.
 */
export function programSort(renderer) {
  let frame = 1;
  const cache = new WeakMap(); // material -> { frame, id }
  const programIdOf = (m) => {
    let e = cache.get(m);
    if (!e) {
      e = { frame: 0, id: -1 };
      cache.set(m, e);
    }
    if (e.frame !== frame) {
      e.frame = frame;
      const p = renderer.properties.get(m);
      e.id = p && p.currentProgram ? p.currentProgram.id : -1;
    }
    return e.id;
  };
  renderer.setOpaqueSort(makeProgramComparator(programIdOf));
  return {
    tick() {
      frame++;
    },
    dispose() {
      renderer.setOpaqueSort(null);
    },
  };
}
