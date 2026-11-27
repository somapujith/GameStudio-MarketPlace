// Autowala GPU probe: richer than bench.mjs, used by the aw-gpu stream. Same launch / lock / tier handling.
//
//   node scripts/perf/aw-probe.mjs --base http://127.0.0.1:5720 --port 9760 --tier medium --cmd programs|cost|tour|shots|boot [--dpr 1.25] [--out file.json]
//
//   programs  every shader program with the materials / objects that use it and the decoded cache-key differences
//   cost      per-frame draw calls / triangles split into shadow pass / scene pass / post, over `--seconds`, plus gfx.cost when present
//   tour      teleports to every landmark at several hours and in rain for `--leg` seconds each: counts frames > 50 ms, new programs, new textures
//   shots     fixed cameras (day / dusk / night / rain) -> JPEGs in --dir (default $TMP/aw-shots) named <label>-<name>.jpg
//   boot      Start -> playable timing, long tasks, programs at the end
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = args.base || 'http://127.0.0.1:5720';
const W = +(args.w || 1536);
const H = +(args.h || 864);
const DPR = +(args.dpr || 1.25);
const WARM = +(args.warm || 5);
const SEC = +(args.seconds || 6);
const LEG = +(args.leg || 6);
const tier = args.tier && args.tier !== true ? String(args.tier) : '';
const cmd = String(args.cmd || 'programs');
const label = args.label && args.label !== true ? String(args.label) : `${tier || 'auto'}`;
const port = +(args.port || 9760 + Math.floor(Math.random() * 9));
const dir = args.dir && args.dir !== true ? String(args.dir) : path.join(os.tmpdir(), 'aw-shots');

const DECODE_NAMES = ['precision', 'outputColorSpace', 'envMapMode', 'envMapPMREM', 'envMapMaxLod', 'envMapSize', 'mapUv', 'alphaMapUv', 'lightMapUv', 'aoMapUv', 'bumpMapUv', 'normalMapUv', 'displacementMapUv', 'emissiveMapUv', 'metalnessMapUv', 'roughnessMapUv', 'anisotropyMapUv', 'clearcoatMapUv', 'clearcoatNormalMapUv', 'clearcoatRoughnessMapUv', 'diffuseRoughnessMapUv', 'iridescenceMapUv', 'iridescenceThicknessMapUv', 'sheenColorMapUv', 'sheenRoughnessMapUv', 'specularMapUv', 'specularColorMapUv', 'specularIntensityMapUv', 'transmissionMapUv', 'thicknessMapUv', 'combine', 'fogExp2', 'sizeAttenuation', 'morphTargetsCount', 'numSunLights', 'numDirLights', 'numPointLights', 'numSpotLights', 'numSpotLightMaps', 'numHemiLights', 'numRectAreaLights', 'numSunLightShadows', 'numDirLightShadows', 'numPointLightShadows', 'numSpotLightShadows', 'numSpotLightShadowsWithMaps', 'numLightProbes', 'numLightProbeGrids', 'shadowMapType', 'toneMapping', 'numClippingPlanes', 'numClipIntersection', 'depthPacking'];

const START = async (c) => {
  if (args.tune && args.tune !== true) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `globalThis.__awTune = ${args.tune};` }); // e.g. --tune '{"medium":{"chunk":1024}}' (builds with the tier() hook)
  if (tier) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); if (String(k).startsWith('jalebi.autowala.v')) { try { const d = JSON.parse(v || '{}'); d.settings = { ...(d.settings || {}), quality: '${tier}' }; return JSON.stringify(d); } catch { return v; } } return v; }; })();` });
  await c.goto(`${base}/play/autowala`);
  await c.waitFor("!!document.querySelector('.aw-go')", 180000);
  const t0 = Date.now();
  await c.ev("document.querySelector('.aw-go').click()");
  await c.waitFor('!!window.__autowala', 60000);
  const startMs = Date.now() - t0;
  await c.ev("window.__gfxForBench = () => window.__autowala.gfx.renderer; true");
  if (!args['keep-sampler']) await c.ev('window.__autowala.gfx.autoTier = false; true'); // the shared governor is ignored: hold the tier (and the scale) asked for
  // the game's own frame timer query must not nest with this script's per-pass queries (cmd gpu / suite)
  if (cmd === 'gpu' || cmd === 'suite') await c.ev('(() => { const a = window.__autowala.adaptive; if (a) a.timer.enabled = false; return true; })()');
  if (args.scale !== undefined) await c.ev('window.__autowala.gfx.setScale(' + (+args.scale) + '); true'); // experiment: render resolution
  if (args.lights !== undefined) await c.ev('window.__autowala.world.props.setLightCount(' + (+args.lights) + '); true'); // experiment: point lights in every lit shader
  await c.ev('window.__autowala.debug.drive({ throttle: 1 }); true');
  // --nohud: the page's HTML over the canvas is hidden (is a stall the GL frame or the compositor mixing the HUD with it?)
  if (args.nohud) await c.ev("(() => { const st = document.createElement('style'); st.textContent = '.aw > *:not(.aw-canvas) { display: none !important; }'; document.head.appendChild(st); return true; })()");
  return startMs;
};

/** In-page: wrap renderer.render and the shadow pass so every frame's draw calls / triangles are split by pass. */
const INSTRUMENT = `(() => {
  const g = window.__autowala.gfx; const R = g.renderer;
  if (window.__awProbe) return true;
  const P = window.__awProbe = { frames: 0, shCalls: 0, shTris: 0, calls: 0, tris: 0, passes: 0, dts: [] };
  const sm = R.shadowMap; const sr = sm.render.bind(sm);
  sm.render = (...a) => { const c0 = R.info.render.calls, t0 = R.info.render.triangles; sr(...a); P.shCalls += R.info.render.calls - c0; P.shTris += R.info.render.triangles - t0; };
  const r0 = R.render.bind(R);
  let lastF = -1;
  R.render = (s, c) => { r0(s, c); P.calls += R.info.render.calls; P.tris += R.info.render.triangles; P.passes++; };
  const loop = () => { P.frames++; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  return true;
})()`;

async function programs(c) {
  return c.ev(`(() => {
    const names = ${JSON.stringify(DECODE_NAMES)};
    const R = window.__autowala.gfx.renderer; const scene = window.__autowala.gfx.scene;
    const progs = R.info.programs || [];
    const users = new Map();
    const add = (cp, o, m) => { if (!cp) return; let u = users.get(cp.cacheKey); if (!u) users.set(cp.cacheKey, (u = { mats: new Set(), objs: 0, samples: [] })); u.mats.add(m.uuid); u.objs++; if (u.samples.length < 3) u.samples.push((o.name || o.type) + ':' + (m.name || m.type)); };
    scene.traverse((o) => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) { const pr = R.properties.get(m); add(pr && pr.currentProgram, o, m); } });
    const rows = progs.map((p) => {
      const parts = String(p.cacheKey).split(',');
      const n = parts.length; const custom = parts[n - 1]; const cs = parts[n - 2]; const b2 = parts[n - 3]; const b1 = parts[n - 4];
      const fields = parts.slice(n - 4 - names.length, n - 4);
      const dec = {}; names.forEach((nm, i) => { dec[nm] = fields[i]; });
      const u = users.get(p.cacheKey);
      return { name: p.name, id: p.id, used: p.usedTimes, custom, b1: +b1, b2: +b2, lights: [dec.numDirLights, dec.numPointLights, dec.numSpotLights, dec.numHemiLights].join('/'), shadow: [dec.numDirLightShadows, dec.shadowMapType].join('/'), fogExp2: dec.fogExp2, tone: dec.toneMapping, mats: u ? u.mats.size : 0, objs: u ? u.objs : 0, ex: u ? u.samples.join(' | ') : '' };
    });
    return { total: rows.length, rows, geometries: R.info.memory.geometries, textures: R.info.memory.textures };
  })()`);
}

async function cost(c) {
  if (args.poi) await pin(c, String(args.poi), +(args.hour || 18), +(args.weather || 0));
  await c.ev(INSTRUMENT);
  await c.sleep(800);
  const a = await c.ev('({ ...window.__awProbe })');
  await c.sleep(SEC * 1000);
  const b = await c.ev(`(() => { const P = { ...window.__awProbe }; const R = window.__autowala.gfx.renderer; const g = window.__autowala.gfx; return { P, mem: { geometries: R.info.memory.geometries, textures: R.info.memory.textures, programs: R.info.programs.length }, cost: g.cost ? (typeof g.cost === 'function' ? g.cost() : g.cost) : null, q: g.quality, pr: R.getPixelRatio(), size: [R.domElement.width, R.domElement.height] }; })()`);
  const f = b.P.frames - a.frames;
  return {
    frames: f,
    callsPerFrame: +((b.P.calls - a.calls) / f).toFixed(1),
    trisPerFrame: Math.round((b.P.tris - a.tris) / f),
    shadowCallsPerFrame: +((b.P.shCalls - a.shCalls) / f).toFixed(1),
    shadowTrisPerFrame: Math.round((b.P.shTris - a.shTris) / f),
    renderCallsPerFrame: +((b.P.passes - a.passes) / f).toFixed(2),
    ...b.mem, cost: b.cost, quality: b.q, pixelRatio: b.pr, canvas: b.size,
  };
}

/** Park the player at a landmark with the clock pinned, so every config is measured on the same picture. */
async function pin(c, poi = 'charminar', hour = 18, weather = 0, heading = 0) {
  await c.ev(`(() => { const g = window.__autowala; g.debug.drive(null); const p = g.world.city.poiById[${JSON.stringify(poi)}]; const f = p.front || p; g.debug.teleport(f.x, f.z, ${heading}); g.debug.weather(${weather}); g.debug.hour(${hour}); clearInterval(window.__pinT); window.__pinT = setInterval(() => g.debug.hour(${hour}), 100); return true; })()`);
}
/**
 * One-page experiment matrix on the CURRENT build (needs the tier() hook for tuning): each variant switches ONE cost at run time, waits for
 * recompiles, then measures frame time and the CPU time of gfx.render. A frame that is as slow as its render() call but does not get
 * faster when pixels or shadows go away is bound by draw / uniform work; one that does is bound by the GPU.
 */
const EXP_VARIANTS = [
  { name: 'as-is' },
  { name: 'scale-0.5', set: 'g.gfx.setScale(0.5)', reset: 'g.gfx.setScale(1)' },
  { name: 'shadows-off', set: 'g.world.sky.setShadows(2048, false)', reset: 'g.world.sky.setShadows(g.gfx.cfg.shadow, true)' },
  { name: 'shadows-1024', set: 'g.world.sky.setShadows(1024, true)', reset: 'g.world.sky.setShadows(g.gfx.cfg.shadow, true)' },
  { name: 'no-bloom', tune: { bloom: false, bloomLevels: 0 } },
  { name: 'no-fxaa', tune: { fxaa: false } },
  { name: 'msaa-4', tune: { msaa: 4 } },
  { name: 'lights-0', set: 'g.world.props.setLightCount(0)', reset: 'g.world.props.setLightCount(5)' },
  { name: 'lights-2', set: 'g.world.props.setLightCount(2)', reset: 'g.world.props.setLightCount(5)' },
  { name: 'no-traffic-peds', set: 'g.ctx.gfx.cfg.traffic = 0; g.ctx.gfx.cfg.peds = 0', reset: '' },
  { name: 'as-is-again' },
];
async function exp(c) {
  await pin(c, args.poi || 'charminar', +(args.hour || 19), +(args.weather || 0));
  await c.ev(`(() => { const g = window.__autowala.gfx; const P = window.__expP = { cpu: 0, n: 0 }; const r = g.render.bind(g); g.render = (dt) => { const t = performance.now(); r(dt); P.cpu += performance.now() - t; P.n++; }; return true; })()`);
  const rows = [];
  for (const v of EXP_VARIANTS) {
    await c.ev(`(() => { const g = window.__autowala; globalThis.__awTune = { ${tier || 'medium'}: ${JSON.stringify(v.tune || {})} }; ${v.set || ''}; g.gfx.resize(window.innerWidth, window.innerHeight); return true; })()`);
    await c.sleep(2500);
    const r = await c.ev(`(async () => {
      const g = window.__autowala.gfx; const R = g.renderer; const P = window.__expP; P.cpu = 0; P.n = 0;
      const dts = []; let last = performance.now(); const end = last + ${SEC} * 1000;
      await new Promise((res) => { const f = (n) => { dts.push(n - last); last = n; if (n < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      dts.shift(); const s = dts.slice().sort((a, b) => a - b); const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
      return { fps: +(1000 / mean).toFixed(1), mean: +mean.toFixed(2), p99: +s[Math.min(s.length - 1, Math.floor(s.length * 0.99))].toFixed(1), cpuRenderMs: +(P.cpu / Math.max(1, P.n)).toFixed(2), calls: g.cost.calls, q: g.quality };
    })()`);
    rows.push({ name: v.name, ...r });
    await c.ev(`(() => { const g = window.__autowala; ${v.reset || ''}; return true; })()`);
  }
  return rows;
}
/** Which scene objects the draw calls come from: per top-level scene child, in the camera pass (V) and the shadow pass (S), averaged per frame. */
async function drawsplit(c) {
  if (args.poi) await pin(c, String(args.poi), +(args.hour || 18), +(args.weather || 0));
  const frames = +(args.frames || 90);
  return c.ev(`(async () => {
    const g = window.__autowala.gfx; const R = g.renderer; const scene = g.scene;
    const tally = new Map(); let inShadow = false; let nFrames = 0; let lastMat = null; let lastProg = null; const sw = { vMat: 0, vProg: 0, sMat: 0, sProg: 0 }; const matSet = new Set(); const progTally = new Map();
    const sm = R.shadowMap; const sr = sm.render.bind(sm);
    sm.render = (...a) => { inShadow = true; try { sr(...a); } finally { inShadow = false; } };
    const orig = R.renderBufferDirect.bind(R);
    const label = (r) => { const i = scene.children.indexOf(r); let s = i + ':' + r.type + (r.name ? ':' + r.name : ''); if (!r.name) { let m = r.isMesh ? r : null; if (!m) r.traverse((o) => { if (!m && o.isMesh) m = o; }); if (m) s += ':' + (m.isInstancedMesh ? 'inst' : 'mesh') + ':' + (Array.isArray(m.material) ? m.material[0].type : m.material.type); } return s; };
    R.renderBufferDirect = function (camera, sc, geometry, material, object, group) {
      let r = object; while (r.parent && r.parent !== scene) r = r.parent;
      if (material !== lastMat) { lastMat = material; inShadow ? sw.sMat++ : sw.vMat++; if (!inShadow) matSet.add(material.uuid); const p = R.properties.get(material).currentProgram; if (p !== lastProg) { lastProg = p; inShadow ? sw.sProg++ : sw.vProg++; } }
      if (!inShadow) { const pr = R.properties.get(material).currentProgram; if (pr) { let e = progTally.get(pr.id); if (!e) progTally.set(pr.id, (e = { id: pr.id, calls: 0, mat: material.type, key: String(pr.cacheKey).split(',').slice(-1)[0].slice(0, 24), inst: !!object.isInstancedMesh, mats: new Set() })); e.calls++; e.mats.add(material.uuid); } }
      const key = (inShadow ? 'S ' : 'V ') + label(r);
      let t = tally.get(key); if (!t) tally.set(key, (t = { calls: 0, tris: 0, inst: 0, ms: 0 }));
      if (material !== t.lastM) { t.lastM = material; t.ms++; }
      t.calls++;
      const idx = geometry.index; const cnt = idx ? idx.count : geometry.attributes.position.count;
      const n = object.isInstancedMesh ? object.count : 1;
      t.tris += (cnt / 3) * n; t.inst += object.isInstancedMesh ? 1 : 0;
      return orig(camera, sc, geometry, material, object, group);
    };
    await new Promise((res) => { let k = 0; const f = () => { if (++k < ${frames}) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    R.renderBufferDirect = orig; sm.render = sr;
    const rows = [...tally.entries()].map(([k, v]) => ({ k, calls: +(v.calls / ${frames}).toFixed(1), tris: Math.round(v.tris / ${frames}), mats: +(v.ms / ${frames}).toFixed(1) })).sort((a, b) => b.calls - a.calls);
    const sum = (p) => rows.filter((r) => r.k.startsWith(p)).reduce((a, r) => ({ calls: a.calls + r.calls, tris: a.tris + r.tris }), { calls: 0, tris: 0 });
    const programs = [...progTally.values()].map((e) => ({ id: e.id, calls: +(e.calls / ${frames}).toFixed(1), mat: e.mat, key: e.key, inst: e.inst, mats: e.mats.size })).sort((a, b) => b.calls - a.calls);
    return { view: sum('V '), shadow: sum('S '), programs, switches: { viewMaterials: +(sw.vMat / ${frames}).toFixed(1), viewPrograms: +(sw.vProg / ${frames}).toFixed(1), shadowMaterials: +(sw.sMat / ${frames}).toFixed(1), shadowPrograms: +(sw.sProg / ${frames}).toFixed(1), distinctViewMaterials: matSet.size }, rows: rows.slice(0, ${+(args.top || 40)}) };
  })()`);
}

/**
 * GPU time (EXT_disjoint_timer_query_webgl2, TIME_ELAPSED: one query at a time, so frames take turns): whole frame, scene pass (incl. the
 * shadow pass inside it), shadow pass alone, post chain (bloom + composite). Averages in ms over `--seconds`. Frames alternate between the
 * four measurements, so the picture is the same for all of them.
 */
async function gpuTimes(c) {
  if (args.poi) await pin(c, String(args.poi), +(args.hour || 18), +(args.weather || 0));
  return c.ev(`(async () => {
    const g = window.__autowala.gfx; const R = g.renderer; const gl = R.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return { error: 'no timer query' };
    const NAMES = ['frame', 'scenePass', 'shadow', 'post'];
    const pending = []; let k = 0; let variant = 0; let q = null; let passN = 0;
    const begin = () => { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); };
    const end = () => { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ q, variant }); q = null; };
    const sm = R.shadowMap; const sr = sm.render.bind(sm);
    sm.render = (...a) => { if (variant === 2) begin(); sr(...a); if (variant === 2) end(); };
    const r0 = R.render.bind(R);
    R.render = (s, cam) => {
      if (passN === 0 && variant === 1) begin();
      r0(s, cam);
      if (passN === 0 && variant === 1) end();
      if (passN === 0 && variant === 3) begin();
      passN++;
    };
    const gr = g.render.bind(g);
    g.render = (dt) => { variant = k++ % 4; passN = 0; if (variant === 0) begin(); gr(dt); if (variant === 0) end(); if (variant === 3 && q) end(); };
    await new Promise((res) => setTimeout(res, ${SEC} * 1000));
    g.render = gr; R.render = r0; sm.render = sr;
    await new Promise((res) => setTimeout(res, 800));
    const sums = [0, 0, 0, 0]; const cnt = [0, 0, 0, 0]; let lost = 0;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    for (const p of pending) { if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) { lost++; continue; } sums[p.variant] += Number(gl.getQueryParameter(p.q, gl.QUERY_RESULT)) / 1e6; cnt[p.variant]++; }
    const ms = {}; NAMES.forEach((n, i) => { ms[n] = cnt[i] ? +(sums[i] / cnt[i]).toFixed(2) : null; });
    return { frames: k, samples: cnt, unavailable: lost, disjoint: !!disjoint, ms };
  })()`);
}
/** The scene graph at a glance: every top-level child with its mesh / instanced / triangle counts and who owns it (by userData / name). */
async function sceneMap(c) {
  return c.ev(`(() => {
    const g = window.__autowala.gfx; const scene = g.scene;
    return scene.children.map((r, i) => {
      let meshes = 0, inst = 0, tris = 0, shadow = 0, mats = new Set(), maxDepth = 0, frozen = 0;
      const walk = (o, d) => { maxDepth = Math.max(maxDepth, d); if (o.isMesh || o.isPoints || o.isLine) { meshes++; if (o.isInstancedMesh) inst++; if (o.castShadow) shadow++; if (!o.matrixAutoUpdate) frozen++; const geo = o.geometry; const n = o.isInstancedMesh ? o.count : 1; tris += ((geo.index ? geo.index.count : geo.attributes.position.count) / 3) * n; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m && mats.add(m.uuid)); } o.children.forEach((c) => walk(c, d + 1)); };
      walk(r, 0);
      return { i, type: r.type, name: r.name || '', vis: r.visible, children: r.children.length, meshes, inst, frozen, castShadow: shadow, tris: Math.round(tris), mats: mats.size, depth: maxDepth, auto: r.matrixAutoUpdate };
    });
  })()`);
}

/** Same numbers as bench.mjs (uncapped rAF frame times, long tasks, counters) plus the gfx.cost of the last frame, a CPU profile and a screenshot. */
async function bench(c) {
  await c.ev(`window.__bootLongs = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__bootLongs.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch {} true`);
  await c.sleep(WARM * 1000);
  const profile = args.profile ? await c.cpuProfile(Math.min(6000, SEC * 1000), 14) : null;
  const m = await c.ev(`(async () => {
    const g = window.__autowala.gfx; const R = g.renderer;
    const dts = []; const longs = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch {}
    let last = performance.now(); const end = last + ${SEC} * 1000;
    await new Promise((res) => { const f = (n) => { dts.push(n - last); last = n; if (n < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    dts.shift(); const s = dts.slice().sort((a, b) => a - b); const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
    const mean = dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length);
    return { tier: g.quality, scale: g.scale, pr: R.getPixelRatio(), canvas: [R.domElement.width, R.domElement.height], fps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), maxMs: +s[s.length - 1].toFixed(1), frames: dts.length,
      hitches50: dts.filter((d) => d > 50).length, hitchMs: Math.round(dts.filter((d) => d > 50).reduce((a, b) => a + b, 0)), longTasks: longs.length,
      cost: g.cost ? { ...g.cost } : { calls: R.info.render.calls, triangles: R.info.render.triangles, programs: R.info.programs.length }, geometries: R.info.memory.geometries, textures: R.info.memory.textures,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
  })()`);
  const boot = await c.ev('({ n: window.__bootLongs.length, ms: Math.round(window.__bootLongs.reduce((a, b) => a + b, 0)), worst: Math.round(Math.max(0, ...window.__bootLongs)) })');
  if (args.shot && args.shot !== true) await c.shot(String(args.shot));
  return { ...m, boot, profile };
}
/** How many GL calls of each kind one frame makes (wraps WebGL2RenderingContext.prototype): where the CPU time of gfx.render goes. */
async function glCalls(c) {
  if (args.poi) await pin(c, String(args.poi), +(args.hour || 18), +(args.weather || 0));
  return c.ev(`(async () => {
    const proto = WebGL2RenderingContext.prototype; const counts = new Map(); const orig = {};
    for (const k of Object.getOwnPropertyNames(proto)) { let d; try { d = Object.getOwnPropertyDescriptor(proto, k); } catch { continue; } if (!d || typeof d.value !== 'function' || k === 'constructor') continue; orig[k] = d.value; proto[k] = function (...a) { counts.set(k, (counts.get(k) || 0) + 1); return orig[k].apply(this, a); }; }
    let frames = 0; await new Promise((res) => { const f = () => { if (++frames < ${+(args.frames || 30)}) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    for (const k of Object.keys(orig)) proto[k] = orig[k];
    const rows = [...counts.entries()].map(([k, v]) => [k, +(v / frames).toFixed(1)]).sort((a, b) => b[1] - a[1]);
    return { frames, total: +rows.reduce((a, r) => a + r[1], 0).toFixed(0), top: rows.slice(0, 18) };
  })()`);
}
const LEGS = [
  ['charminar', 12, 0], ['charminar', 19.2, 0], ['cyber', 22.5, 0], ['cyber', 12, 1], ['birla', 19, 0], ['golconda', 23, 0], ['airport', 8, 0], ['paradise', 21, 0],
  ['stadium', 22, 1], ['station', 17.6, 0], ['mecca', 12, 0], ['garage', 5, 0], ['cng_north', 15, 0.6], ['hospital', 0.5, 0],
];

async function tour(c) {
  await c.ev(`(() => { window.__tour = { longs: [] }; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__tour.longs.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch {} return true; })()`);
  const rows = [];
  for (const [poi, hour, weather] of LEGS) {
    await c.ev(`(() => { const g = window.__autowala; const p = g.world.city.poiById[${JSON.stringify(poi)}]; if (p) { const f = p.front || p; g.debug.teleport(f.x, f.z, 0); } g.debug.hour(${hour}); g.debug.weather(${weather}); window.__tour.longs.length = 0; return !!p; })()`);
    const r = await c.ev(`(async () => {
      const R = window.__autowala.gfx.renderer; const p0 = R.info.programs.length; const t0 = R.info.memory.textures; const g0 = R.info.memory.geometries;
      const dts = []; let last = performance.now(); const end = last + ${LEG} * 1000;
      await new Promise((res) => { const f = (n) => { dts.push(n - last); last = n; if (n < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      dts.shift(); const s = dts.slice().sort((a, b) => a - b);
      return { fps: +(1000 / (dts.reduce((a, b) => a + b, 0) / dts.length)).toFixed(1), p99: +s[Math.floor(s.length * 0.99)].toFixed(1), max: +s[s.length - 1].toFixed(0), hitches50: dts.filter((d) => d > 50).length, longTasks: window.__tour.longs.length, newPrograms: R.info.programs.length - p0, newTextures: R.info.memory.textures - t0, newGeometries: R.info.memory.geometries - g0, q: window.__autowala.gfx.quality };
    })()`);
    rows.push({ poi, hour, weather, ...r });
  }
  const sum = rows.reduce((a, r) => ({ hitches50: a.hitches50 + r.hitches50, newPrograms: a.newPrograms + r.newPrograms, newTextures: a.newTextures + r.newTextures, worst: Math.max(a.worst, r.max) }), { hitches50: 0, newPrograms: 0, newTextures: 0, worst: 0 });
  return { sum, rows };
}

/**
 * Fixed pictures for before / after comparisons (same camera, hour, weather). The camera stands on the road in front of a landmark
 * (`dist` m from its centre, `h` m up) and looks at a point `aim` m above its centre; `cam: null` = the game's own chase camera.
 */
const SHOTS = [
  { name: 'day-street', poi: 'garage', hour: 12, weather: 0, cam: null },
  { name: 'day-charminar', poi: 'charminar', hour: 10, weather: 0, dist: 70, h: 6, aim: 14 },
  { name: 'dusk-cyber', poi: 'cyber', hour: 18.6, weather: 0, dist: 120, h: 14, aim: 40 },
  { name: 'night-paradise', poi: 'paradise', hour: 22.2, weather: 0, dist: 40, h: 4.5, aim: 6 },
  { name: 'night-birla', poi: 'birla', hour: 21.5, weather: 0, dist: 85, h: 9, aim: 16 },
  { name: 'rain-night', poi: 'charminar', hour: 21, weather: 1, dist: 48, h: 4.5, aim: 12 },
  { name: 'rain-day', poi: 'station', hour: 14, weather: 1, dist: 55, h: 5, aim: 10 },
  { name: 'auto-close', poi: 'garage', hour: 17.8, weather: 0, cam: null },
];
const HIDE_HUD = "(() => { const s = document.createElement('style'); s.textContent = '.aw > *:not(.aw-canvas) { display: none !important; }'; document.head.appendChild(s); return true; })()";

async function shots(c) {
  fs.mkdirSync(dir, { recursive: true });
  await c.ev(HIDE_HUD);
  const out = [];
  for (const s of SHOTS.filter((x) => !args.only || String(args.only).split(',').includes(x.name))) {
    await c.ev(`(() => { const g = window.__autowala; g.debug.drive(null); const p = g.world.city.poiById[${JSON.stringify(s.poi)}]; const f = p.front || p;
      g.debug.teleport(f.x, f.z, 0);
      g.debug.hour(${s.hour}); g.debug.weather(${s.weather});
      ${s.cam === null ? 'g.debug.cam(null);' : `{ let dx = f.x - p.x, dz = f.z - p.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const cx = p.x + dx * ${s.dist}, cz = p.z + dz * ${s.dist}; const hd = Math.hypot(p.x - cx, p.z - cz);
        g.debug.cam({ x: cx, y: ${s.h}, z: cz, yaw: Math.atan2(p.x - cx, p.z - cz), pitch: Math.atan2(${s.aim} - ${s.h}, hd), fov: 62 }); }`} return true; })()`);
    await c.sleep(2500);
    const file = path.join(dir, `${label}-${s.name}.jpg`);
    await c.shot(file);
    out.push(file);
  }
  return out;
}
async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(W, H, DPR, false);
    await c.ev('1');
    const startMs = await START(c);
    if (cmd === 'boot') {
      await c.ev(`window.__bootLongs = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__bootLongs.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch {} true`);
    }
    if (cmd === 'boot') await c.ev(`window.__first = []; (() => { let last = performance.now(); const f = (n) => { window.__first.push(+(n - last).toFixed(1)); last = n; if (window.__first.length < 400) requestAnimationFrame(f); }; requestAnimationFrame(f); })(); true`);
    await c.sleep(WARM * 1000);
    let result;
    if (cmd === 'programs') result = await programs(c);
    else if (cmd === 'cost') result = await cost(c);
    else if (cmd === 'tour') result = await tour(c);
    else if (cmd === 'shots') result = await shots(c);
    else if (cmd === 'exp') result = await exp(c);
    else if (cmd === 'draws') result = await drawsplit(c);
    else if (cmd === 'scene') result = await sceneMap(c);
    else if (cmd === 'gpu') result = await gpuTimes(c);
    else if (cmd === 'bench') result = await bench(c);
    else if (cmd === 'suite') {
      // one lock hold, one page: frame times -> draw-call attribution -> GPU time per pass -> teleport tour (hitches)
      const b = await bench(c);
      const d = await drawsplit(c);
      const g = await gpuTimes(c);
      const tr = args['no-tour'] ? null : await tour(c);
      result = { bench: b, draws: d, gpu: g, tour: tr };
    }
    else if (cmd === 'glcalls') result = await glCalls(c);
    else if (cmd === 'eval') result = await c.ev(String(args.js)); // --js "<expression>": anything in the page (may be async)
    else if (cmd === 'boot') result = await c.ev('({ boot: window.__autowalaBoot && window.__autowalaBoot.ms, longs: window.__bootLongs, firstFramesOver40: window.__first.map((d, i) => [i, d]).filter((x) => x[1] > 40).slice(0, 25), framesSeen: window.__first.length, programs: window.__autowala.gfx.renderer.info.programs.length, world: window.__autowala.world.timings, sys: window.__autowala.boot && window.__autowala.boot.systems, compile: window.__autowala.boot && window.__autowala.boot.compile })');
    const info = await c.ev('({ tier: window.__autowala.gfx.quality, gpu: (() => { const gl = window.__autowala.gfx.renderer.getContext(); const e = gl.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "?"; })(), timer: !!window.__autowala.gfx.renderer.getContext().getExtension("EXT_disjoint_timer_query_webgl2") })');
    return { label, cmd, tierAsked: tier || 'auto', viewport: `${W}x${H}@${DPR}`, startMs, ...info, errors: c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource/.test(l)).slice(0, 8), result };
  } finally {
    c.close();
  }
}

const row = args['no-lock'] ? await run() : await withBenchLock(run);
const text = JSON.stringify(row, null, args.compact ? 0 : 1);
if (args.out && args.out !== true) fs.writeFileSync(String(args.out), text);
console.log(cmd === 'programs' && !args.full ? summarisePrograms(row) : text);
process.exit(0);

function summarisePrograms(r) {
  const rows = r.result.rows;
  const lines = [`label=${r.label} tier=${r.tier} programs=${r.result.total} geometries=${r.result.geometries} textures=${r.result.textures}`];
  const byName = new Map();
  for (const p of rows) { const k = p.name; (byName.get(k) || byName.set(k, []).get(k)).push(p); }
  for (const [k, v] of [...byName.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`\n${k}: ${v.length}`);
    for (const p of v) lines.push(`   id${p.id} used=${p.used} mats=${p.mats} objs=${p.objs} lights(d/p/s/h)=${p.lights} shadow=${p.shadow} fog2=${p.fogExp2} b1=${p.b1} b2=${p.b2} custom=${p.custom.slice(0, 28)} :: ${p.ex.slice(0, 110)}`);
  }
  return lines.join('\n');
}
