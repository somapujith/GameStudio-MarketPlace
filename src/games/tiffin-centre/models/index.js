// Tiffin Centre procedural models. Everything is built from primitives and generated canvas textures (no assets), node-safe, and every
// factory result has dispose(). Shared geometry/material/texture caches are freed with materials.dispose() / disposeModelCache().
//   food + cookware   dishes.js, stations.js, tools.js, food-index.js        buildDish, buildStationProp (+ playAction), buildTool
//   people            characters-index.js                                    buildCustomer (faces, expressions), buildAvatar, buildViewmodel
//   street            street.js                                              buildStreetProp
export { buildDish, QUALITIES } from './dishes.js';
export { buildStationProp, COUNTER_TOP, STATION_WIDTH } from './stations.js';
export {
  buildTool, TOOL_IDS, setQuality as setFoodQuality, getQuality as getFoodQuality, onQualityChange, disposeFood, foodClock,
} from './food-index.js';
export * from './characters-index.js';
export { buildStreetProp, STREET_PROP_IDS, STREET_EXTRA_IDS, STREET_ALL_IDS, streetPropTriangles } from './street.js';
export { makeCanvasTexture, makeCanvas, disposeObject, disposeModelCache, countTriangles, palette, materials, rng, hashSeed, setTextureQuality, getTextureQuality } from './util.js';
export { labelTexture, bannerTexture, nameTagTexture, pbr } from './textures.js';
