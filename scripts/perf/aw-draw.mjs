// Autowala draw-call probe (aw-draw stream): deterministic counters per scene, one page session, tier held.
//
//   node scripts/perf/aw-draw.mjs --base http://127.0.0.1:5862 --port 9920 --soft --no-lock --cmd scenes [--only charminar-day,metro] [--out f.json]
//   node scripts/perf/aw-draw.mjs --base ... --cmd tour        # teleport tour: frames > 50 ms, long tasks (+ their length), new programs / textures / geometries per leg
//   node scripts/perf/aw-draw.mjs --base ... --cmd frames      # frame times at charminar (several rounds, same page)
//
// scenes: for each named scene (a pinned player / camera, hour, weather) after `--settle` seconds: camera-pass and shadow-pass draw calls, distinct
// materials / programs in the camera pass, material and program switches, GL calls per frame (and by kind), renderer memory, and the draws by
// top-level scene object. Counts do not depend on the GPU: `--soft --no-lock` (SwiftShader) gives the same numbers as the real GPU.
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
const base = args.base || 'http://127.0.0.1:5862';
const W = +(args.w || 1536);
const H = +(args.h || 864);
const DPR = +(args.dpr || 1.25);
const tier = args.tier && args.tier !== true ? String(args.tier) : 'medium';
const cmd = String(args.cmd || 'scenes');
const port = +(args.port || 9920);
const SETTLE = +(args.settle || 2.5);
const FRAMES = +(args.frames || 45);
const LEG = +(args.leg || 6);
const label = args.label && args.label !== true ? String(args.label) : 'run';
const dir = args.dir && args.dir !== true ? String(args.dir) : path.join(os.tmpdir(), 'aw-draw-shots');

const START = async (c) => {
  await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); if (String(k).startsWith('jalebi.autowala.v')) { try { const d = JSON.parse(v || '{}'); d.settings = { ...(d.settings || {}), quality: '${tier}' }; return JSON.stringify(d); } catch { return v; } } return v; }; })();`,
  });
  await c.goto(`${base}/play/autowala`);
  await c.waitFor("!!document.querySelector('.aw-go')", 180000);
  await c.ev("document.querySelector('.aw-go').click()");
  await c.waitFor('!!window.__autowala', 60000);
  await c.ev('window.__autowala.gfx.autoTier = false; window.__autowala.debug.drive(null); true');
};

/** Park the player (and optionally a free camera) at a POI / station, clock and weather pinned. */
const PIN = (s) => `(() => {
  const g = window.__autowala; g.debug.drive(null); clearInterval(window.__pinT);
  const w = g.world; let at, front;
  if (${JSON.stringify(s.station || '')}) { const st = w.metro.stations.find((x) => x.id === ${JSON.stringify(s.station || '')}) || w.metro.stations[${+(s.stationIndex || 0)}]; at = st; front = st.front || st; }
  else { const p = w.city.poiById[${JSON.stringify(s.poi || 'charminar')}]; at = p; front = p.front || p; }
  g.debug.teleport(front.x, front.z, ${+(s.heading || 0)});
  g.debug.weather(${+(s.weather || 0)}); g.debug.hour(${+(s.hour || 14)});
  window.__pinT = setInterval(() => g.debug.hour(${+(s.hour || 14)}), 100);
  if (${JSON.stringify(!!s.cam)}) { let dx = front.x - at.x, dz = front.z - at.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const cx = at.x + dx * ${+(s.dist || 60)}, cz = at.z + dz * ${+(s.dist || 60)}; const hd = Math.hypot(at.x - cx, at.z - cz);
    g.debug.cam({ x: cx, y: ${+(s.h || 6)}, z: cz, yaw: Math.atan2(at.x - cx, at.z - cz), pitch: Math.atan2(${+(s.aim || 10)} - ${+(s.h || 6)}, hd), fov: 62 }); }
  else g.debug.cam(null);
  if (${JSON.stringify(!!s.workshop)}) { g.ctx.workshop.open(); }
  return true; })()`;

const SCENES = [
  { name: 'charminar-day', poi: 'charminar', hour: 14, cam: true, dist: 70, h: 6, aim: 14 },
  { name: 'street-day', poi: 'irani', hour: 12, cam: true, dist: 45, h: 5, aim: 6 },
  { name: 'shops-paradise', poi: 'paradise', hour: 12, cam: true, dist: 38, h: 4, aim: 6 },
  { name: 'hitech-glass', poi: 'cyber', hour: 11, cam: true, dist: 120, h: 14, aim: 40 },
  { name: 'metro', station: 'red-ameerpet', cam: true, dist: 45, h: 9, aim: 11 },
  { name: 'workshop', poi: 'garage', hour: 12, workshop: true },
  { name: 'night-paradise', poi: 'paradise', hour: 22, cam: true, dist: 38, h: 4, aim: 6 },
  { name: 'rain-night-charminar', poi: 'charminar', hour: 21, weather: 1, cam: true, dist: 48, h: 4.5, aim: 12 },
];

/** Camera / shadow draws attributed to top-level scene objects, switches, materials; GL calls per frame; memory. All in one wrapped run of `n` frames. */
const MEASURE = (n) => `(async () => {
  const g = window.__autowala.gfx; const R = g.renderer; const scene = g.scene; const gl = R.getContext();
  const tally = new Map(); let inShadow = false; let lastMat = null; let lastProg = null;
  const sw = { vMat: 0, vProg: 0, sMat: 0, sProg: 0 }; const matSet = new Set(); const progSet = new Set(); const geoSet = new Set();
  const sm = R.shadowMap; const sr = sm.render.bind(sm);
  sm.render = (...a) => { inShadow = true; try { sr(...a); } finally { inShadow = false; } };
  const orig = R.renderBufferDirect.bind(R);
  let glN = 0; let seg = null; const segs = new Map();
  const closeSeg = () => { if (!seg) return; let t = segs.get(seg.k); if (!t) segs.set(seg.k, (t = { n: 0, calls: 0 })); t.n++; t.calls += glN - seg.at; seg = null; };
  const labelOf = new Map();
  const label = (r) => { let l = labelOf.get(r); if (l) return l; const i = scene.children.indexOf(r); let s = r.name || r.type; let m = r.isMesh ? r : null; if (!m) r.traverse((o) => { if (!m && o.isMesh) m = o; });
    if (!r.name && m) s += ':' + (m.isInstancedMesh ? 'inst' : m.isSkinnedMesh ? 'skin' : 'mesh') + ':' + (Array.isArray(m.material) ? m.material[0].type : m.material.type).replace('Material', '');
    l = (i < 0 ? '?' : i) + ':' + s; labelOf.set(r, l); return l; };
  R.renderBufferDirect = function (camera, sc, geometry, material, object, group) {
    let r = object; while (r.parent && r.parent !== scene) r = r.parent;
    closeSeg(); let cat = 'same';
    if (material !== lastMat) { cat = 'mat'; lastMat = material; inShadow ? sw.sMat++ : sw.vMat++; const p = R.properties.get(material).currentProgram; if (p !== lastProg) { cat = 'prog'; lastProg = p; inShadow ? sw.sProg++ : sw.vProg++; } }
    seg = { k: (inShadow ? 'S:' : 'V:') + cat + (object.isInstancedMesh ? ':inst' : ''), at: glN };
    if (!inShadow) { matSet.add(material.uuid); geoSet.add(geometry.uuid); const p = R.properties.get(material).currentProgram; if (p) progSet.add(p.id); }
    const key = (inShadow ? 'S ' : 'V ') + label(r);
    let t = tally.get(key); if (!t) tally.set(key, (t = { calls: 0, tris: 0, mats: new Set() }));
    t.calls++; t.mats.add(material.uuid);
    const idx = geometry.index; const cnt = idx ? idx.count : geometry.attributes.position.count;
    t.tris += (cnt / 3) * (object.isInstancedMesh ? object.count : 1);
    return orig(camera, sc, geometry, material, object, group);
  };
  const proto = WebGL2RenderingContext.prototype; const counts = new Map(); const origGL = {};
  for (const k of Object.getOwnPropertyNames(proto)) { let d; try { d = Object.getOwnPropertyDescriptor(proto, k); } catch { continue; } if (!d || typeof d.value !== 'function' || k === 'constructor') continue; origGL[k] = d.value; proto[k] = function (...a) { counts.set(k, (counts.get(k) || 0) + 1); glN++; return origGL[k].apply(this, a); }; }
  let frames = 0;
  await new Promise((res) => { const f = () => { if (++frames < ${n}) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  for (const k of Object.keys(origGL)) proto[k] = origGL[k];
  R.renderBufferDirect = orig; sm.render = sr; seg = null;
  const glCat = [...segs.entries()].map(([k, v]) => [k, +(v.n / frames).toFixed(1), +(v.calls / v.n).toFixed(1)]).sort((a, b) => b[1] * b[2] - a[1] * a[2]);
  const rows = [...tally.entries()].map(([k, v]) => ({ k, calls: +(v.calls / frames).toFixed(1), tris: Math.round(v.tris / frames), mats: v.mats.size })).sort((a, b) => b.calls - a.calls);
  const sum = (p) => rows.filter((r) => r.k.startsWith(p)).reduce((a, r) => ({ calls: a.calls + r.calls, tris: a.tris + r.tris }), { calls: 0, tris: 0 });
  const v = sum('V '); const s = sum('S ');
  const glRows = [...counts.entries()].map(([k, c]) => [k, +(c / frames).toFixed(1)]).sort((a, b) => b[1] - a[1]);
  const mem = R.info.memory;
  const objs = { meshes: 0, inst: 0, frozen: 0, objects: 0 }; scene.traverse((o) => { objs.objects++; if (o.isMesh) { objs.meshes++; if (o.isInstancedMesh) objs.inst++; } if (!o.matrixAutoUpdate) objs.frozen++; });
  return { camera: +v.calls.toFixed(1), shadow: +s.calls.toFixed(1), camTris: Math.round(v.tris), shTris: Math.round(s.tris), gl: Math.round(glRows.reduce((a, r) => a + r[1], 0)), glTop: glRows.slice(0, 9), glCat,
    sw: { vMat: +(sw.vMat / frames).toFixed(1), vProg: +(sw.vProg / frames).toFixed(1), sMat: +(sw.sMat / frames).toFixed(1), sProg: +(sw.sProg / frames).toFixed(1) },
    distinct: { materials: matSet.size, programs: progSet.size, geometries: geoSet.size }, mem: { geometries: mem.geometries, textures: mem.textures, programs: R.info.programs.length }, objs, rows: rows.slice(0, ${+(args.top || 16)}) };
})()`;

async function scenes(c) {
  const out = [];
  for (const s of SCENES.filter((x) => !args.only || String(args.only).split(',').includes(x.name))) {
    await c.ev(PIN(s));
    await c.sleep(SETTLE * 1000);
    const m = await c.ev(MEASURE(FRAMES));
    out.push({ name: s.name, ...m });
    if (args.shots) { fs.mkdirSync(dir, { recursive: true }); await c.ev("(() => { if (!document.getElementById('aw-hide-hud')) { const st = document.createElement('style'); st.id = 'aw-hide-hud'; st.textContent = '.aw > *:not(.aw-canvas) { display: none !important; }'; document.head.appendChild(st); } return true; })()"); await c.sleep(300); await c.shot(path.join(dir, `${label}-${s.name}.jpg`)); }
  }
  return out;
}

const LEGS = [
  ['charminar', 12, 0], ['charminar', 19.2, 0], ['cyber', 22.5, 0], ['cyber', 12, 1], ['birla', 19, 0], ['golconda', 23, 0], ['airport', 8, 0], ['paradise', 21, 0],
  ['stadium', 22, 1], ['station', 17.6, 0], ['mecca', 12, 0], ['garage', 5, 0], ['cng_north', 15, 0.6], ['hospital', 0.5, 0],
];
async function tour(c) {
  await c.ev(`(() => { window.__tour = { longs: [] }; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__tour.longs.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch {} return true; })()`);
  const rows = [];
  for (const [poi, hour, weather] of LEGS) {
    await c.ev(`(() => { const g = window.__autowala; const p = g.world.city.poiById[${JSON.stringify(poi)}]; if (p) { const f = p.front || p; g.debug.teleport(f.x, f.z, 0); } g.debug.hour(${hour}); g.debug.weather(${weather}); window.__tour.longs.length = 0; window.__tour.t0 = performance.now(); return !!p; })()`);
    const r = await c.ev(`(async () => {
      const R = window.__autowala.gfx.renderer; const p0 = R.info.programs.length; const t0 = R.info.memory.textures; const g0 = R.info.memory.geometries;
      const dts = []; let last = performance.now(); const end = last + ${LEG} * 1000;
      await new Promise((res) => { const f = (n) => { dts.push(n - last); last = n; if (n < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      dts.shift(); const s = dts.slice().sort((a, b) => a - b);
      const first = dts.slice(0, 30).filter((d) => d > 50).length;
      return { fps: +(1000 / (dts.reduce((a, b) => a + b, 0) / dts.length)).toFixed(1), p99: +s[Math.floor(s.length * 0.99)].toFixed(1), max: +s[s.length - 1].toFixed(0), hitches50: dts.filter((d) => d > 50).length, hitchesFirst30: first, longTasks: window.__tour.longs.length, longMs: window.__tour.longs.reduce((a, b) => a + b, 0), longWorst: Math.max(0, ...window.__tour.longs), newPrograms: R.info.programs.length - p0, newTextures: R.info.memory.textures - t0, newGeometries: R.info.memory.geometries - g0 };
    })()`);
    rows.push({ poi, hour, weather, ...r });
  }
  const sum = rows.reduce((a, r) => ({ hitches50: a.hitches50 + r.hitches50, hitchesFirst30: a.hitchesFirst30 + r.hitchesFirst30, longTasks: a.longTasks + r.longTasks, longMs: a.longMs + r.longMs, worst: Math.max(a.worst, r.max), newPrograms: a.newPrograms + r.newPrograms, newTextures: a.newTextures + r.newTextures, newGeometries: a.newGeometries + r.newGeometries }), { hitches50: 0, hitchesFirst30: 0, longTasks: 0, longMs: 0, worst: 0, newPrograms: 0, newTextures: 0, newGeometries: 0 });
  return { sum, rows };
}

/** Frame time of the CURRENT scene: `--rounds` x `--seconds`, the mean of the frame and of the CPU time of gfx.render. */
async function frames(c) {
  await c.ev(PIN(SCENES[0]));
  await c.sleep(3000);
  await c.ev(`(() => { const g = window.__autowala.gfx; if (!window.__expP) { const P = window.__expP = { cpu: 0, n: 0 }; const r = g.render.bind(g); g.render = (dt) => { const t = performance.now(); r(dt); P.cpu += performance.now() - t; P.n++; }; } return true; })()`);
  const rows = [];
  for (let i = 0; i < +(args.rounds || 3); i++) {
    rows.push(await c.ev(`(async () => {
      const g = window.__autowala.gfx; const P = window.__expP; P.cpu = 0; P.n = 0;
      const dts = []; let last = performance.now(); const end = last + ${+(args.seconds || 6)} * 1000;
      await new Promise((res) => { const f = (n) => { dts.push(n - last); last = n; if (n < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      dts.shift(); const s = dts.slice().sort((a, b) => a - b); const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
      return { fps: +(1000 / mean).toFixed(1), mean: +mean.toFixed(2), p50: +s[Math.floor(s.length * 0.5)].toFixed(1), p99: +s[Math.floor(s.length * 0.99)].toFixed(1), hitches50: dts.filter((d) => d > 50).length, cpuRenderMs: +(P.cpu / Math.max(1, P.n)).toFixed(2), calls: g.cost.calls, q: g.quality };
    })()`));
  }
  return rows;
}

async function gpu(c) {
  await c.ev(PIN(SCENES[0]));
  await c.sleep(3000);
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
    R.render = (s, cam) => { if (passN === 0 && variant === 1) begin(); r0(s, cam); if (passN === 0 && variant === 1) end(); if (passN === 0 && variant === 3) begin(); passN++; };
    const gr = g.render.bind(g);
    g.render = (dt) => { variant = k++ % 4; passN = 0; if (variant === 0) begin(); gr(dt); if (variant === 0) end(); if (variant === 3 && q) end(); };
    await new Promise((res) => setTimeout(res, ${+(args.seconds || 6)} * 1000));
    g.render = gr; R.render = r0; sm.render = sr;
    await new Promise((res) => setTimeout(res, 800));
    const sums = [0, 0, 0, 0]; const cnt = [0, 0, 0, 0]; let lost = 0;
    for (const p of pending) { if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) { lost++; continue; } sums[p.variant] += Number(gl.getQueryParameter(p.q, gl.QUERY_RESULT)) / 1e6; cnt[p.variant]++; }
    const ms = {}; NAMES.forEach((n, i) => { ms[n] = cnt[i] ? +(sums[i] / cnt[i]).toFixed(2) : null; });
    return { frames: k, samples: cnt, unavailable: lost, ms };
  })()`);
}

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(W, H, DPR, false);
    await c.ev('1');
    await START(c);
    await c.sleep(+(args.warm || 5) * 1000);
    let result;
    if (cmd === 'scenes') result = await scenes(c);
    else if (cmd === 'tour') result = await tour(c);
    else if (cmd === 'frames') result = await frames(c);
    else if (cmd === 'gpu') result = await gpu(c);
    else if (cmd === 'eval') {
      if (args.pin) { await c.ev(PIN(SCENES.find((s) => s.name === args.pin))); await c.sleep(SETTLE * 1000); }
      const js = args.jsfile ? fs.readFileSync(String(args.jsfile), 'utf8') : String(args.js);
      result = await c.ev(js);
    }
    const info = await c.ev('({ tier: window.__autowala.gfx.quality, gpu: (() => { const gl = window.__autowala.gfx.renderer.getContext(); const e = gl.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "?"; })() })');
    return { label, cmd, base, ...info, errors: c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource/.test(l)).slice(0, 8), result };
  } finally {
    c.close();
  }
}

const row = args['no-lock'] ? await run() : await withBenchLock(run);
if (args.out && args.out !== true) fs.writeFileSync(String(args.out), JSON.stringify(row));
if (cmd === 'scenes') {
  console.log(`label=${row.label} tier=${row.tier} gpu=${row.gpu} errors=${row.errors.length}`);
  console.log('scene'.padEnd(22), 'cam'.padStart(6), 'shad'.padStart(6), 'GL'.padStart(6), 'mat'.padStart(5), 'prog'.padStart(5), 'geo'.padStart(5), 'vMatSw'.padStart(7), 'vProgSw'.padStart(8), 'rGeo'.padStart(5), 'rTex'.padStart(5), 'rPrg'.padStart(5), 'objects'.padStart(8));
  for (const s of row.result) console.log(s.name.padEnd(22), String(s.camera).padStart(6), String(s.shadow).padStart(6), String(s.gl).padStart(6), String(s.distinct.materials).padStart(5), String(s.distinct.programs).padStart(5), String(s.distinct.geometries).padStart(5), String(s.sw.vMat).padStart(7), String(s.sw.vProg).padStart(8), String(s.mem.geometries).padStart(5), String(s.mem.textures).padStart(5), String(s.mem.programs).padStart(5), String(s.objs.objects).padStart(8));
  if (args.rows) for (const s of row.result) { console.log(`\n-- ${s.name}  gl: ${s.glTop.map((r) => r.join('=')).join(' ')}`); console.log('   per-draw GL [category draws/frame calls/draw]: ' + s.glCat.map((r) => r.join(' ')).join(' | ')); for (const r of s.rows) console.log('  ', String(r.calls).padStart(6), String(r.tris).padStart(8), String(r.mats).padStart(4), r.k); }
} else console.log(JSON.stringify(row.result, null, 1));
process.exit(0);
