// Realistic food / cookware models: the single import surface for index.js (re-export what you need).
//   export * from './food-index.js'   or the named lines below.
// Everything shared (geometry, materials, textures, dish packs) sits in util.js's caches, so disposeModelCache() frees it;
// disposeFood() additionally clears this module family's own registries (call it right after disposeModelCache()).
export { buildDish, QUALITIES } from './dishes.js';
export { buildStationProp, COUNTER_TOP, STATION_WIDTH } from './stations.js';
export { buildTool, TOOL_IDS } from './tools.js';
export { setQuality, getQuality, onQualityChange, QUALITY_TIERS } from './pbr.js';
export { clock as foodClock } from './shaders/patch.js';
import { clearQualityRegistry } from './pbr.js';
import { disposeWisp } from './shaders/wisp.js';

export function disposeFood() {
  clearQualityRegistry();
  disposeWisp();
}
