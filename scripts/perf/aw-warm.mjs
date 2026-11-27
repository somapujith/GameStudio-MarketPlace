// Autowala "no program is compiled in play" check (aw-final). Runs a fixed life cycle of the game in ONE page and reports every shader program
// that was built after the loading bar: which phase, which pass (shadow / camera), what it is, and how long the frame that built it took.
//
//   node scripts/perf/aw-warm.mjs --base http://127.0.0.1:5881 --port 9961 [--tier medium] [--soft --no-lock] [--out f.json] [--json]
//
// Phases (hour / weather pinned, the player parked in front of Mama's Garage): `day` (noon), `dusk` (hour 16.5 -> 19.5 at 0.3 h / s: the lamp pool
// comes on, the headlight, the neon), `night`, `dawn` (4.5 -> 7.5), `day2`, `dusk2` (a second pass: nothing may compile twice), `rain-day`,
// `rain-night`, `workshop-day` (open, 5 s, leave), `workshop-night`, `rain-workshop` (workshop in the rain at night: the worst combination),
// then `tour` (teleports to a few landmarks at several hours). Exit code 1 when a program was built in play (`--strict`).
// Counts do not depend on the GPU: `--soft --no-lock` (SwiftShader) gives the same program list; the frame times only mean something on the real GPU.
import fs from 'node:fs';
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = args.base || 'http://127.0.0.1:5881';
const W = +(args.w || 1536);
const H = +(args.h || 864);
const DPR = +(args.dpr || 1.25);
const tier = args.tier && args.tier !== true ? String(args.tier) : 'medium';
const port = +(args.port || 9961);
const label = args.label && args.label !== true ? String(args.label) : 'warm';

const DECODE = ['depthPacking', 'numDirLights', 'numPointLights', 'numSpotLights', 'numHemiLights', 'numDirLightShadows', 'numPointLightShadows', 'numSpotLightShadows'];
const ALL_NAMES = ['precision', 'outputColorSpace', 'envMapMode', 'envMapPMREM', 'envMapMaxLod', 'envMapSize', 'mapUv', 'alphaMapUv', 'lightMapUv', 'aoMapUv', 'bumpMapUv', 'normalMapUv', 'displacementMapUv', 'emissiveMapUv', 'metalnessMapUv', 'roughnessMapUv', 'anisotropyMapUv', 'clearcoatMapUv', 'clearcoatNormalMapUv', 'clearcoatRoughnessMapUv', 'diffuseRoughnessMapUv', 'iridescenceMapUv', 'iridescenceThicknessMapUv', 'sheenColorMapUv', 'sheenRoughnessMapUv', 'specularMapUv', 'specularColorMapUv', 'specularIntensityMapUv', 'transmissionMapUv', 'thicknessMapUv', 'combine', 'fogExp2', 'sizeAttenuation', 'morphTargetsCount', 'numSunLights', 'numDirLights', 'numPointLights', 'numSpotLights', 'numSpotLightMaps', 'numHemiLights', 'numRectAreaLights', 'numSunLightShadows', 'numDirLightShadows', 'numPointLightShadows', 'numSpotLightShadows', 'numSpotLightShadowsWithMaps', 'numLightProbes', 'numLightProbeGrids', 'shadowMapType', 'toneMapping', 'numClippingPlanes', 'numClipIntersection', 'depthPacking'];

const RECORDER = `(() => {
  const g = window.__autowala.gfx; const R = g.renderer; const sm = R.shadowMap; const sr = sm.render.bind(sm);
  const names = ${JSON.stringify(ALL_NAMES)}; const want = ${JSON.stringify(DECODE)};
  const rec = window.__rec = { phase: 'start', events: [], frames: [], frameN: 0, seen: new Set(R.info.programs.map((p) => p.id)), inShadow: 0, shadowNew: 0, t0: performance.now(), over50: 0 };
  // who triggered a new program: the object / material of the draw during which the program count grew (shadow pass and camera pass)
  const rbd = R.renderBufferDirect.bind(R); let inShadowPass = false;
  rec.triggers = [];
  R.renderBufferDirect = function (camera, sc, geometry, material, object, group) {
    const n = R.info.programs.length;
    const out = rbd(camera, sc, geometry, material, object, group);
    if (R.info.programs.length > n && rec.triggers.length < 400) {
      let top = object; while (top.parent && top.parent.type !== 'Scene') top = top.parent;
      rec.triggers.push({ phase: rec.phase, pass: inShadowPass ? 'shadow' : 'camera', obj: (object.name || object.type) + (object.isInstancedMesh ? ':inst' + (object.instanceColor ? '+col' : '') : '') + (object.isSkinnedMesh ? ':skin' : ''), top: top.name || top.type, mat: material.type + (material.name ? '/' + material.name : '') + (object.customDepthMaterial ? '+customDepth' : ''), side: material.side, map: !!material.map, alphaTest: material.alphaTest || 0, added: R.info.programs.length - n });
    }
    return out;
  };
  sm.render = (...a) => { const n = R.info.programs.length; inShadowPass = true; try { sr(...a); } finally { inShadowPass = false; } rec.shadowNew += Math.max(0, R.info.programs.length - n); };
  const describe = (p) => {
    const parts = String(p.cacheKey).split(','); const n = parts.length; const fields = parts.slice(n - 4 - names.length, n - 4); const d = {};
    names.forEach((nm, i) => { if (want.includes(nm)) d[nm] = fields[i]; });
    return { name: p.name, custom: parts[n - 1], dp: d.depthPacking, dir: d.numDirLights, pt: d.numPointLights, spot: d.numSpotLights, dirSh: d.numDirLightShadows };
  };
  const r0 = g.render.bind(g);
  g.render = (dt) => {
    rec.shadowNew = 0; const t = performance.now(); r0(dt); const ms = performance.now() - t;
    rec.frameN++;
    const fresh = []; for (const p of R.info.programs) if (!rec.seen.has(p.id)) { rec.seen.add(p.id); fresh.push(p); }
    if (fresh.length) {
      const depth = fresh.filter((p) => { const d = describe(p); return d.dp && d.dp !== '0'; }).length;
      rec.events.push({ phase: rec.phase, at: Math.round(performance.now() - rec.t0), ms: +ms.toFixed(0), n: fresh.length, inShadowPass: rec.shadowNew, depth, progs: fresh.map(describe) });
    }
    if (ms > 50) rec.over50++;
    rec.frames.push([rec.phase, +ms.toFixed(1)]);
    if (rec.frames.length > 20000) rec.frames.shift();
  };
  return true;
})()`;

const PIN = (poi, hour, weather) => `(() => { const g = window.__autowala; g.debug.drive(null); clearInterval(window.__pinT); const p = g.world.city.poiById[${JSON.stringify(poi)}]; const f = p.front || p; g.debug.teleport(f.x, f.z, 0); g.debug.weather(${weather}); g.debug.hour(${hour}); window.__pinT = setInterval(() => g.debug.hour(${hour}), 100); return true; })()`;
const HOLD = (hour, weather) => `(() => { const g = window.__autowala; clearInterval(window.__pinT); g.debug.weather(${weather}); g.debug.hour(${hour}); window.__pinT = setInterval(() => g.debug.hour(${hour}), 100); return true; })()`;
const SWEEP = (from, to, perSecond, weather) => `(() => { const g = window.__autowala; clearInterval(window.__pinT); g.debug.weather(${weather}); let h = ${from}; g.debug.hour(h); window.__pinT = setInterval(() => { h = Math.min(${to}, h + ${perSecond} / 10); g.debug.hour(h % 24); }, 100); return true; })()`;
const phase = (c, name) => c.ev(`window.__rec.phase = ${JSON.stringify(name)}; true`);

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(W, H, DPR, false);
    await c.ev('1');
    await c.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); if (String(k).startsWith('jalebi.autowala.v')) { try { const d = JSON.parse(v || '{}'); d.settings = { ...(d.settings || {}), quality: '${tier}' }; return JSON.stringify(d); } catch { return v; } } return v; }; })();`,
    });
    await c.goto(`${base}/play/autowala`);
    await c.waitFor("!!document.querySelector('.aw-go')", 180000);
    const t0 = Date.now();
    await c.ev("document.querySelector('.aw-go').click()");
    await c.waitFor('!!window.__autowala', 60000);
    const bootMs = Date.now() - t0;
    await c.ev('window.__autowala.gfx.autoTier = false; true');
    const boot = await c.ev('(() => { const g = window.__autowala; const R = g.gfx.renderer; return { programs: R.info.programs.length, boot: g.boot && { compile: g.boot.compile, programs: g.boot.programs, insured: g.boot.insured || null } }; })()');
    await c.sleep(+(args.warm || 6) * 1000); // the game's own background warm-up gets what it would get in a real session (the start screen is closed)
    await c.ev(RECORDER);
    const S = +(args.speed || 1); // seconds multiplier
    const wait = (s) => c.sleep(s * 1000 * S);
    const steps = [
      ['day', PIN('garage', 12, 0), 5],
      ['dusk', SWEEP(16.5, 19.5, 0.3, 0), 11],
      ['night', HOLD(23, 0), 4],
      ['dawn', SWEEP(4.5, 7.5, 0.3, 0), 11],
      ['day2', HOLD(12, 0), 4],
      ['dusk2', SWEEP(16.5, 19.5, 0.3, 0), 11],
      ['night2', HOLD(22, 0), 3],
      ['rain-night', HOLD(22, 1), 7],
      ['rain-day', HOLD(12, 1), 7],
      ['dry-day', HOLD(12, 0), 3],
      ['workshop-day', `(() => { const g = window.__autowala; clearInterval(window.__pinT); g.debug.hour(12); window.__pinT = setInterval(() => g.debug.hour(12), 100); g.ctx.workshop.open(); return true; })()`, 6],
      ['workshop-leave', `(() => { window.__autowala.ctx.workshop.close(); return true; })()`, 4],
      ['workshop-night', `(() => { const g = window.__autowala; clearInterval(window.__pinT); g.debug.hour(22); window.__pinT = setInterval(() => g.debug.hour(22), 100); g.ctx.workshop.open(); return true; })()`, 6],
      ['workshop-leave2', `(() => { window.__autowala.ctx.workshop.close(); return true; })()`, 4],
      ['rain-workshop', `(() => { const g = window.__autowala; g.debug.weather(1); g.ctx.workshop.open(); return true; })()`, 6],
      ['rain-workshop-leave', `(() => { const g = window.__autowala; g.ctx.workshop.close(); g.debug.weather(0); return true; })()`, 4],
    ];
    if (args.tour) {
      for (const [poi, hour, weather] of [['charminar', 19.2, 0], ['cyber', 22.5, 0], ['cyber', 12, 1], ['birla', 19, 0], ['stadium', 22, 1], ['station', 17.6, 0], ['cng_north', 15, 0.6]]) steps.push([`tour-${poi}-${hour}`, PIN(poi, hour, weather), 5]);
    }
    for (const [name, js, sec] of steps) {
      await phase(c, name);
      await c.ev(js);
      await wait(sec);
    }
    await phase(c, 'end');
    const out = await c.ev(`(() => { const r = window.__rec; const R = window.__autowala.gfx.renderer; const rep = window.__autowala.perf.report(); return { events: r.events, triggers: r.triggers, frameN: r.frameN, over50: r.over50, frames: r.frames, programsEnd: R.info.programs.length, hitches: rep.hitches || null, textures: R.info.memory.textures, geometries: R.info.memory.geometries }; })()`);
    const info = await c.ev('({ tier: window.__autowala.gfx.quality, gpu: (() => { const gl = window.__autowala.gfx.renderer.getContext(); const e = gl.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "?"; })() })');
    return { label, base, bootMs, boot, ...info, errors: c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource/.test(l)).slice(0, 6), ...out };
  } finally {
    c.close();
  }
}

const row = args['no-lock'] ? await run() : await withBenchLock(run);
const frames = row.frames;
delete row.frames;
if (args.out && args.out !== true) fs.writeFileSync(String(args.out), JSON.stringify({ ...row, frames }));
const byPhase = new Map();
for (const e of row.events) {
  const p = byPhase.get(e.phase) || { n: 0, depth: 0, frames: 0, worst: 0 };
  p.n += e.n; p.depth += e.depth; p.frames++; p.worst = Math.max(p.worst, e.ms);
  byPhase.set(e.phase, p);
}
const worstOf = new Map();
for (const [ph, ms] of frames) worstOf.set(ph, Math.max(worstOf.get(ph) || 0, ms));
const over50Of = new Map();
for (const [ph, ms] of frames) if (ms > 50) over50Of.set(ph, (over50Of.get(ph) || 0) + 1);
if (args.json) console.log(JSON.stringify(row));
else {
  console.log(`label=${row.label} tier=${row.tier} gpu=${row.gpu} boot(click->game)=${row.bootMs}ms programs after boot=${row.boot.programs} (game.boot: ${JSON.stringify(row.boot.boot)}) errors=${row.errors.length}`);
  console.log(`frames ${row.frameN}, over 50 ms ${row.over50}, programs at the end ${row.programsEnd}, new in play ${row.events.reduce((a, e) => a + e.n, 0)} (shadow-pass ${row.events.reduce((a, e) => a + e.inShadowPass, 0)}), hitches ${JSON.stringify(row.hitches)}`);
  console.log('phase'.padEnd(22), 'new'.padStart(4), 'depth'.padStart(6), 'worst ms'.padStart(9), '>50ms'.padStart(6));
  for (const name of [...new Set(frames.map((f) => f[0]))]) {
    const p = byPhase.get(name) || { n: 0, depth: 0 };
    console.log(name.padEnd(22), String(p.n).padStart(4), String(p.depth).padStart(6), String(Math.round(worstOf.get(name) || 0)).padStart(9), String(over50Of.get(name) || 0).padStart(6));
  }
  if (args.triggers) for (const t of row.triggers || []) console.log('  trigger', JSON.stringify(t));
  for (const e of row.events) console.log(`  @${e.at}ms ${e.phase}: ${e.n} program(s) (${e.depth} depth, ${e.inShadowPass} in the shadow pass), frame ${e.ms} ms:`, e.progs.map((p) => `${p.name}${p.custom && !/onBeforeCompile/.test(p.custom) ? '[' + p.custom + ']' : ''} ${p.dp && p.dp !== '0' ? 'DEPTH ' : ''}d${p.dir}/p${p.pt}/s${p.spot}/sh${p.dirSh}`).join(', '));
}
if (args.strict && row.events.length) process.exitCode = 1;
process.exit(process.exitCode || 0);
