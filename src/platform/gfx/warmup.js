// Shader / texture warm-up under a per-frame budget, and a "program census" for dev diagnostics.
//
// WHY: three.js compiles a material's program the first time an object using it is drawn. With 300 programs (Autowala 162, Tiffin 311 measured) that
// is a stream of 20-450 ms stalls spread over the first seconds of play. warmShaders() submits the compiles up front, a few per frame, while the
// loading screen is still up; KHR_parallel_shader_compile (when the browser has it) lets the driver link them on other threads and compileAsync
// resolves when they are READY, so the first real frame does not stall. Textures are uploaded the same way (renderer.initTexture).
//
// Measured on the dev laptop (integrated AMD Radeon, ANGLE / D3D11): a program's FIRST DRAW right after compileAsync resolved cost 25-30 ms of main
// thread (four distinct programs = four stalls); programs whose first draw came ~5 frames after readiness cost ~1 ms. So the promise resolves
// `settleFrames` (default 2) frames after the last program reports ready, and the real lever is the NUMBER of programs (use the census): at ~25 ms
// each, 300 programs are seconds of main thread however they are spread.
//
//   const job = warmShaders(renderer, scene, camera, { budgetMs: 4, onProgress: (p) => setLoadBar(p.done / p.total) });
//   await job.promise;                       // job.cancel() any time
//   if (dev) console.log(formatCensus(programCensus(renderer)));
//
// What compile() does NOT cover: shadow-depth programs and geometry upload (both happen at the first real render of each object). warmRender() draws the
// scene once into a tiny target with frustum culling off, so they too happen behind the loading screen.
//
// The census answers "why 311 programs?": it groups the compiled programs by shader and shows WHICH cache-key tokens vary (light counts, map uv
// channels, vertex colours, tone mapping ...), and flags near-duplicates (programs that differ by only 1-2 tokens) as candidates for being unified.

// ---------------------------------------------------------------------------------------------------------------------------------
// Warm-up

const FEATURE_ATTRS = ['color', 'uv', 'uv1', 'uv2', 'uv3', 'tangent', 'normal'];

/** What an object adds to its material's program key besides the material itself (the flags prepareMaterial() reads). */
function objectFeatureKey(o, m) {
  const g = o.geometry;
  let attrs = '';
  if (g?.attributes) for (const a of FEATURE_ATTRS) if (g.attributes[a]) attrs += a[0] + (a.length > 1 ? a.slice(1) : '') + ',';
  const morph = g?.morphAttributes ? Object.keys(g.morphAttributes).length : 0;
  return [
    m.uuid, o.isInstancedMesh ? 'I' + (o.instanceColor ? 'c' : '') : '', o.isSkinnedMesh ? 'S' : '', o.isBatchedMesh ? 'B' : '', morph ? 'M' + morph : '',
    o.isPoints ? 'P' : o.isLine ? 'L' : o.isSprite ? 'Sp' : '', o.receiveShadow ? 'r' : '', o.castShadow ? 'c' : '', attrs,
  ].join('|');
}

/** One representative object per distinct (material, object feature) combination under `root`, in traversal order, plus the textures to upload. */
export function collectWarmupWork(root, { include = null } = {}) {
  const seen = new Set();
  const reps = [];
  const textures = new Set();
  root.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    if (include && !include(o)) return;
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    let fresh = false;
    for (const m of mats) {
      const k = objectFeatureKey(o, m);
      if (!seen.has(k)) {
        seen.add(k);
        fresh = true;
      }
      for (const v of Object.values(m)) if (v && v.isTexture && !v.isRenderTargetTexture && v.image) textures.add(v);
      const u = m.uniforms;
      if (u) for (const k2 of Object.keys(u)) {
        const v = u[k2]?.value;
        if (v && v.isTexture && !v.isRenderTargetTexture && v.image) textures.add(v);
      }
    }
    if (fresh) reps.push(o);
  });
  return { reps, textures: [...textures] };
}

/**
 * Compiles every distinct program under `scene` and uploads its textures, at most `budgetMs` of main-thread work per frame.
 * Returns { promise, cancel(), progress, stats }. The promise resolves { compiled, textures, ms, cancelled, errors } and never rejects.
 * Options: budgetMs (4), textures (true), include(obj), onProgress({ done, total, phase }), now / nextFrame (injectable), targetScene (lights / fog context).
 */
export function warmShaders(renderer, scene, camera, opts = {}) {
  const budgetMs = opts.budgetMs ?? 4;
  const now = opts.now || (() => performance.now());
  const nextFrame = opts.nextFrame || (() => new Promise((r) => requestAnimationFrame(() => r())));
  const target = opts.targetScene || scene;
  const settleFrames = opts.settleFrames ?? 2;
  const { reps, textures } = collectWarmupWork(scene, { include: opts.include });
  const queue = [];
  const pending = [];
  const errors = [];
  let done = 0;
  let cancelled = false;
  let compiled = 0;
  let uploaded = 0;
  const total = reps.length + (opts.textures === false ? 0 : textures.length);
  const report = (phase) => opts.onProgress?.({ done, total, phase });
  for (const o of reps) {
    queue.push(() => {
      try {
        if (renderer.compileAsync) pending.push(renderer.compileAsync(o, camera, target).catch((e) => errors.push(String(e?.message || e))));
        else renderer.compile(o, camera, target);
        compiled++;
      } catch (e) {
        errors.push(String(e?.message || e));
      }
      done++;
      report('programs');
    });
  }
  if (opts.textures !== false) {
    for (const t of textures) {
      queue.push(() => {
        try {
          renderer.initTexture?.(t);
          uploaded++;
        } catch (e) {
          errors.push(String(e?.message || e));
        }
        done++;
        report('textures');
      });
    }
  }
  const t0 = now();
  const job = {
    total,
    get progress() { return total ? done / total : 1; },
    get stats() { return { total, done, compiled, textures: uploaded, errors: errors.length }; },
    cancel() { cancelled = true; },
    promise: null,
  };
  job.promise = (async () => {
    while (queue.length && !cancelled) {
      const s0 = now();
      do queue.shift()(); while (queue.length && !cancelled && now() - s0 < budgetMs);
      if (queue.length && !cancelled) await nextFrame();
    }
    if (!cancelled) await Promise.all(pending); // ready = linked: the first real frame will not stall on them
    for (let i = 0; i < settleFrames && !cancelled && pending.length; i++) await nextFrame(); // let the driver finish its post-link work (see the note above)
    return { compiled, textures: uploaded, ms: now() - t0, cancelled, errors };
  })();
  return job;
}

/**
 * One real draw of the scene into a tiny render target with frustum culling off: uploads every geometry and compiles the shadow-depth programs,
 * which compile() cannot reach. Run it behind the loading screen (one frame, tens of ms on a big scene). Restores everything it touches.
 */
export function warmRender(renderer, scene, camera, { size = 64, uploadAll = true, makeTarget } = {}) {
  const prevRT = renderer.getRenderTarget?.() ?? null;
  const culled = [];
  if (uploadAll) scene.traverse((o) => {
    if (o.frustumCulled) {
      culled.push(o);
      o.frustumCulled = false;
    }
  });
  const rt = makeTarget ? makeTarget(size) : null;
  const hadAutoClear = renderer.autoClear;
  try {
    if (rt) renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
  } finally {
    for (const o of culled) o.frustumCulled = true;
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = hadAutoClear;
    rt?.dispose?.();
  }
  return { objects: culled.length };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Program census

// the order three r187 pushes the parameter section of a program cache key (WebGLPrograms.getProgramCacheKeyParameters), used to NAME tokens when
// a key has exactly the standard shape; anything else is reported by position
const PARAM_NAMES = [
  'precision', 'outputColorSpace', 'envMapMode', 'envMapPMREM', 'envMapMaxLod', 'envMapSize', 'mapUv', 'alphaMapUv', 'lightMapUv', 'aoMapUv', 'bumpMapUv', 'normalMapUv',
  'displacementMapUv', 'emissiveMapUv', 'metalnessMapUv', 'roughnessMapUv', 'anisotropyMapUv', 'clearcoatMapUv', 'clearcoatNormalMapUv', 'clearcoatRoughnessMapUv',
  'diffuseRoughnessMapUv', 'iridescenceMapUv', 'iridescenceThicknessMapUv', 'sheenColorMapUv', 'sheenRoughnessMapUv', 'specularMapUv', 'specularColorMapUv',
  'specularIntensityMapUv', 'transmissionMapUv', 'thicknessMapUv', 'combine', 'fogExp2', 'sizeAttenuation', 'morphTargetsCount', 'numSunLights', 'numDirLights',
  'numPointLights', 'numSpotLights', 'numSpotLightMaps', 'numHemiLights', 'numRectAreaLights', 'numSunLightShadows', 'numDirLightShadows', 'numPointLightShadows',
  'numSpotLightShadows', 'numSpotLightShadowsWithMaps', 'numLightProbes', 'numLightProbeGrids', 'shadowMapType', 'toneMapping', 'numClippingPlanes',
  'numClipIntersection', 'depthPacking',
];
// a standard key is: shader id, the 53 parameters, two feature masks (features, then state), the output colour space, the custom key
const STANDARD_LABELS = ['shader', ...PARAM_NAMES, 'featureMask', 'stateMask', 'outputColorSpaceKey', 'customKey'];
const MASK_BITS = [
  'instancing', 'instancingColor', 'instancingMorph', 'matcap', 'envMap', 'normalMapObjectSpace', 'normalMapTangentSpace', 'clearcoat', 'iridescence', 'alphaTest', 'vertexColors',
  'vertexAlphas', 'vertexUv1', 'vertexUv2', 'vertexUv3', 'vertexTangents', 'anisotropy', 'alphaHash', 'batching', 'dispersion', 'batchingColor', 'gradientMap', 'packedNormalMap',
  'vertexNormals', 'retroreflection', 'diffuseRoughness',
];
const STATE_BITS = [
  'fog', 'useFog', 'flatShading', 'logarithmicDepthBuffer', 'reversedDepthBuffer', 'skinning', 'morphTargets', 'morphNormals', 'morphColors', 'premultipliedAlpha', 'shadowMapEnabled',
  'doubleSided', 'flipSided', 'useDepthPacking', 'dithering', 'transmission', 'sheen', 'opaque', 'pointsUvs', 'decodeVideoTexture', 'decodeVideoTextureEmissive', 'alphaToCoverage', 'bit22',
  'hasPositionAttribute',
];

/** The names of the feature bits set in a program-layers mask (`state` = the second mask of the key: fog, skinning, shadows, double sided ...). */
export function maskBits(mask, state = false) {
  const n = Number(mask) || 0;
  const names = state ? STATE_BITS : MASK_BITS;
  const out = [];
  for (let i = 0; i < 32; i++) if (n & (1 << i)) out.push(names[i] || `bit${i}`);
  return out;
}

const labelsFor = (tokens) => (tokens.length === STANDARD_LABELS.length ? STANDARD_LABELS : tokens.map((_, i) => `#${i}`));

/**
 * Groups compiled programs and finds near-duplicates. `source` is a WebGLRenderer (reads renderer.info.programs) or an array of
 * { name, cacheKey, usedTimes?, id? }. Options: maxDiff (2: programs differing in at most this many key tokens are near-duplicates), maxPairs (60).
 * Returns { total, byName, groups: [{ name, count, varying: [{ label, values }] }], nearDuplicates: [{ name, a, b, diff: [{ label, a, b }] }], rarelyUsed }.
 */
export function programCensus(source, { maxDiff = 2, maxPairs = 60 } = {}) {
  const list = Array.isArray(source) ? source : source?.info?.programs ? [...source.info.programs] : [];
  const progs = list.map((p, i) => ({ id: p.id ?? i, name: p.name || p.type || 'unknown', key: String(p.cacheKey ?? ''), used: p.usedTimes ?? 1 }));
  const byName = {};
  const buckets = new Map();
  for (const p of progs) {
    byName[p.name] = (byName[p.name] || 0) + 1;
    p.tokens = p.key.split(',');
    const k = `${p.name}#${p.tokens.length}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  const groups = [];
  const nearDuplicates = [];
  for (const [k, items] of buckets) {
    const name = k.slice(0, k.lastIndexOf('#'));
    const len = items[0].tokens.length;
    const labels = labelsFor(items[0].tokens);
    const varying = [];
    for (let i = 0; i < len; i++) {
      const vals = new Map();
      for (const p of items) vals.set(p.tokens[i], (vals.get(p.tokens[i]) || 0) + 1);
      if (vals.size > 1) {
        const values = [...vals.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => (labels[i] === 'featureMask' || labels[i] === 'stateMask' ? `${v} [${maskBits(v, labels[i] === 'stateMask').join('+') || 'none'}] x${n}` : `${v} x${n}`));
        varying.push({ label: labels[i], index: i, distinct: vals.size, values: values.slice(0, 8) });
      }
    }
    groups.push({ name, count: items.length, varying: varying.sort((a, b) => b.distinct - a.distinct) });
    if (items.length > 1 && nearDuplicates.length < maxPairs) {
      for (let a = 0; a < items.length && nearDuplicates.length < maxPairs; a++) {
        for (let b = a + 1; b < items.length && nearDuplicates.length < maxPairs; b++) {
          const diff = [];
          for (let i = 0; i < len && diff.length <= maxDiff; i++) if (items[a].tokens[i] !== items[b].tokens[i]) diff.push({ label: labels[i], a: items[a].tokens[i], b: items[b].tokens[i] });
          if (diff.length && diff.length <= maxDiff) nearDuplicates.push({ name, a: items[a].id, b: items[b].id, diff });
        }
      }
    }
  }
  groups.sort((x, y) => y.count - x.count);
  return { total: progs.length, byName, groups, nearDuplicates, rarelyUsed: progs.filter((p) => p.used <= 1).length };
}

const BUILTIN_DEFINES = new Set(['STANDARD', 'PHYSICAL', 'MATCAP', 'TOON', 'LAMBERT', 'PHONG', 'DISTANCE', 'USE_UV', 'DEPTH_PACKING']);

/** A static census from a scene graph (no renderer): materials grouped by type and the features that split them, plus exact-duplicate materials that could be shared. */
export function materialCensus(root) {
  const mats = new Map();
  root.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      let r = mats.get(m);
      if (!r) mats.set(m, (r = { m, users: 0, instanced: false, skinned: false, vcolors: false }));
      r.users++;
      r.instanced ||= !!o.isInstancedMesh;
      r.skinned ||= !!o.isSkinnedMesh;
      r.vcolors ||= !!o.geometry?.attributes?.color;
    }
  });
  const featureOf = (r) => {
    const m = r.m;
    const f = [];
    if (m.map) f.push('map');
    if (m.normalMap) f.push('normalMap');
    if (m.roughnessMap || m.metalnessMap) f.push('rmMap');
    if (m.emissiveMap) f.push('emissiveMap');
    if (m.aoMap) f.push('aoMap');
    if (m.alphaMap) f.push('alphaMap');
    if (m.envMap) f.push('envMap');
    if (m.alphaTest > 0) f.push('alphaTest');
    if (m.transparent) f.push('transparent');
    if (m.vertexColors || r.vcolors) f.push('vertexColors');
    if (m.flatShading) f.push('flat');
    if (m.side === 2) f.push('double');
    if (m.fog === false) f.push('nofog');
    if (r.instanced) f.push('instanced');
    if (r.skinned) f.push('skinned');
    // the built-in material types carry their own defines (STANDARD, PHYSICAL ...): only a game's extra defines split programs
    const defs = m.defines ? Object.keys(m.defines).filter((k) => !BUILTIN_DEFINES.has(k)) : [];
    if (defs.length) f.push('defines:' + defs.sort().join('+'));
    if (m.onBeforeCompile && String(m.onBeforeCompile).length > 60) f.push('patched');
    // Material.customProgramCacheKey() defaults to onBeforeCompile's source text: only an override is a real extra key
    const ck = m.customProgramCacheKey?.();
    if (typeof ck === 'string' && ck && ck !== String(m.onBeforeCompile)) f.push('key:' + ck);
    return f.sort().join(',');
  };
  const byType = {};
  const variants = new Map();
  const valueSig = new Map();
  for (const r of mats.values()) {
    const t = r.m.type || 'Material';
    byType[t] = (byType[t] || 0) + 1;
    const f = featureOf(r);
    const vk = `${t}|${f}`;
    variants.set(vk, (variants.get(vk) || 0) + 1);
    const sig = [t, f, r.m.color?.getHexString?.() ?? '', r.m.emissive?.getHexString?.() ?? '', r.m.roughness ?? '', r.m.metalness ?? '', r.m.opacity ?? '', r.m.map?.uuid ?? '', r.m.normalMap?.uuid ?? ''].join('|');
    (valueSig.get(sig) || valueSig.set(sig, []).get(sig)).push(r.m);
  }
  const programVariants = [...variants.entries()].map(([k, n]) => ({ variant: k, materials: n })).sort((a, b) => b.materials - a.materials);
  const duplicates = [...valueSig.values()].filter((a) => a.length > 1).map((a) => ({ type: a[0].type, count: a.length })).sort((a, b) => b.count - a.count);
  const split = {};
  for (const v of programVariants) {
    const type = v.variant.split('|')[0];
    (split[type] ||= []).push(v.variant.split('|')[1] || '(plain)');
  }
  return { materials: mats.size, byType, estimatedPrograms: programVariants.length, programVariants, shareableDuplicates: duplicates, shareableCount: duplicates.reduce((s, d) => s + d.count - 1, 0), split };
}

/** A readable report for the dev console. */
export function formatCensus(c) {
  const lines = [`${c.total} programs: ${Object.entries(c.byName).sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n} x${k}`).join(', ')}`];
  for (const g of c.groups.slice(0, 8)) {
    lines.push(`  ${g.name} (${g.count})`);
    for (const v of g.varying.slice(0, 6)) lines.push(`    ${v.label}: ${v.distinct} distinct  ${v.values.slice(0, 4).join(' | ')}`);
  }
  if (c.nearDuplicates.length) {
    lines.push(`near-duplicates (differ by <= 2 tokens): ${c.nearDuplicates.length}`);
    for (const d of c.nearDuplicates.slice(0, 12)) lines.push(`  ${d.name} #${d.a} / #${d.b}: ${d.diff.map((x) => `${x.label} ${x.a} vs ${x.b}`).join('; ')}`);
  }
  if (c.rarelyUsed) lines.push(`${c.rarelyUsed} programs used by a single material`);
  return lines.join('\n');
}
