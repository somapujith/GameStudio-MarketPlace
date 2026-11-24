// Tiffin Centre procedural models. Everything is built from primitives and canvas textures (no assets), node-safe, and every
// factory result has dispose(). Shared geometry/material/texture caches are freed with materials.dispose() / disposeModelCache().
export { buildDish, QUALITIES } from './dishes.js';
export { buildStationProp, COUNTER_TOP, STATION_WIDTH } from './stations.js';
export { buildCustomer, MOODS } from './customers.js';
export { buildAvatar, POSES } from './avatar.js';
export { buildStreetProp, STREET_PROP_IDS } from './street.js';
export { makeCanvasTexture, makeCanvas, disposeObject, disposeModelCache, countTriangles, palette, materials, rng, hashSeed } from './util.js';
export { labelTexture, bannerTexture, nameTagTexture } from './textures.js';
