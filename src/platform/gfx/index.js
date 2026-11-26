// src/platform/gfx: the shared rendering engine layer. See docs/GFX_ENGINE.md.
export { TIER_ORDER, classifyGpu, classifyRenderer, cleanRenderer, describeGpu, gpuKey, minTier, probeGpu, readEnv, readGlCaps, readGpuStrings, tierCapFor, withRefresh } from './gpu.js';
export { MEMORY_PREFIX, MEMORY_VERSION, createTierMemory, viewportClass } from './tierMemory.js';
export {
  DEFAULT_TIER_MODELS, REFERENCE_MODEL, chooseInitialTier, createCalibration, createThreeLoad, estimateFrameMs, fitSlope, recommendTier, shouldCalibrate,
} from './calibrate.js';
export {
  CHANGE_NONE, CHANGE_SCALE, CHANGE_TIER, DEFAULT_LADDER, STANDARD_REFRESH, createGovernor, detectRefreshHz, fpsCapFromHints, snapRefresh,
} from './governor.js';
export { collectWarmupWork, formatCensus, materialCensus, maskBits, programCensus, warmRender, warmShaders } from './warmup.js';
export {
  bakeGeometry, boundsOf, createInstances, disposeTree, freezeStatic, groupByTile, instancesFromMeshes, materialSignature, mergeByMaterial, mergeGeometries, mergeMeshes,
  thaw, tileInstances, tileMeshes,
} from './batch.js';
export { createFrameRing, createLoop } from './loop.js';
export { createGpuTimer } from './gpuTimer.js';
export { DYNRES_GLSL, DYNRES_VERT, createBlit, createDynPass, createDynamicRes, dynResUniforms, dynUv, rewriteSamples } from './dynamicRes.js';
export { createAdaptiveQuality, readBattery, readDeviceHints, runStandaloneCalibration, watchDeviceHints } from './adaptive.js';
