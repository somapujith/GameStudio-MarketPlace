// Autowala actors probe: draw calls of the people and the player's auto, split camera pass / shadow pass, per actor.
// Used by the aw-gpu-actors stream; same launch / lock / tier handling as aw-probe.mjs, plus: the quality tier is HELD from the first frame
// (the renderer's frame-time sampler steps the tier down on a busy shared GPU, which silently turns the shadow pass off).
//
//   node scripts/perf/aw-actors.mjs --base http://127.0.0.1:5724 --port 9771 --cmd actors|suite|shots|frames [--soft --no-lock] [--poi charminar --hour 14]
//
//   actors  per top-level scene child: draw calls / triangles in the camera pass (v) and the shadow pass (s), averaged over --frames (90);
//           rigs (customers) and the auto are labelled. --near cam parks the auto 40 m from the nearest customer and looks at them.
//   suite   actors at the POI, frame time + gfx.render CPU ms, three customers in view one after another, then the auto alone (garage) with
//           the default look, a fully customised one and the high canopy
//   shots   JPEGs in --dir: customers with FIXED looks in a hand-set pose (the data is rewritten and the body rebuilt), the auto in three
//           finishes, default / fully customised / canopy, and the workshop showroom; the HUD is hidden
//   frames  --rounds x --seconds of frame time at the POI
// Draw calls do not depend on the GPU: --soft --no-lock gives the same counts on SwiftShader without waiting for the GPU lock.
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
const base = args.base || 'http://127.0.0.1:5724';
const W = +(args.w || 1536);
const H = +(args.h || 864);
const DPR = +(args.dpr || 1.25);
const tier = args.tier && args.tier !== true ? String(args.tier) : 'medium';
const cmd = String(args.cmd || 'actors');
const label = String(args.label || 'run');
const port = +(args.port || 9771);
const dir = String(args.dir || path.join(os.tmpdir(), 'aw-actors-shots'));
const poiId = String(args.poi || 'charminar');
const hour = +(args.hour || 14);

const START = async (c) => {
  await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); if (String(k).startsWith('jalebi.autowala.v')) { try { const d = JSON.parse(v || '{}'); d.settings = { ...(d.settings || {}), quality: '${tier}' }; return JSON.stringify(d); } catch { return v; } } return v; }; })();`,
  });
  // hold the tier from the first frame: wrap gfx.render the moment the game object is published
  await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "(() => { let v; Object.defineProperty(window, '__autowala', { configurable: true, get: () => v, set: (x) => { v = x; try { const g = x.gfx; const r = g.render.bind(g); g.render = (dt) => r(Math.min(dt, 0.016)); } catch (e) {} } }); })();",
  });
  await c.goto(`${base}/play/autowala`);
  await c.waitFor("!!document.querySelector('.aw-go')", 180000);
  await c.ev("document.querySelector('.aw-go').click()");
  await c.waitFor('!!window.__autowala', 60000);
  await c.ev('window.__autowala.debug.drive(null); true');
};

const pin = (poi, h, weather = 0, heading = 0) =>
  `(() => { const g = window.__autowala; g.debug.drive(null); const p = g.world.city.poiById[${JSON.stringify(poi)}]; const f = p.front || p; g.debug.teleport(f.x, f.z, ${heading}); g.debug.weather(${weather}); g.debug.hour(${h}); clearInterval(window.__pinT); window.__pinT = setInterval(() => g.debug.hour(${h}), 100); g.debug.cam(null); return true; })()`;

/** The n-th nearest waiting customer with a body: the auto parks 40 m in front of them (so nobody boards), the camera optionally looks at them. */
const nearCust = (cam, nth = 0) => `(() => {
  const g = window.__autowala; const list = g.ctx.fares.waiting;
  const c = list.filter((x) => x.rig).sort((a, b) => a.dist - b.dist)[${nth}] || list[0];
  if (!c) return { ok: false };
  const fx = Math.sin(c.face), fz = Math.cos(c.face);
  g.debug.teleport(c.x + fx * 40, c.z + fz * 40, c.face + Math.PI);
  ${cam ? `g.debug.cam({ x: c.x + fx * ${cam.d}, y: ${cam.y}, z: c.z + fz * ${cam.d}, yaw: c.face + Math.PI, pitch: ${cam.pitch}, fov: ${cam.fov || 50} });` : ''}
  return { ok: true, id: c.id, pax: c.pax, kind: c.kind, luggage: !!c.luggage, waiting: list.length, rigs: list.filter((x) => x.rig).length };
})()`;

/** Per top-level scene child: draw calls and triangles in the camera pass (v) and the shadow pass (s), per frame. */
const TALLY = (frames, top) => `(async () => {
  const g = window.__autowala.gfx; const R = g.renderer; const scene = g.scene;
  const tally = new Map(); let inShadow = false;
  const sm = R.shadowMap; const sr = sm.render.bind(sm);
  sm.render = (...a) => { inShadow = true; try { sr(...a); } finally { inShadow = false; } };
  const orig = R.renderBufferDirect.bind(R);
  const kindOf = (r) => { const u = r.userData || {}; if (u.persons) return 'rig'; if (u.body && u.wheels) return 'auto'; return 'other'; };
  R.renderBufferDirect = function (camera, sc, geometry, material, object, group) {
    let r = object; while (r.parent && r.parent !== scene) r = r.parent;
    let t = tally.get(r); if (!t) tally.set(r, (t = { v: 0, s: 0, vt: 0, st: 0 }));
    const cnt = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    if (inShadow) { t.s++; t.st += cnt / 3; } else { t.v++; t.vt += cnt / 3; }
    return orig(camera, sc, geometry, material, object, group);
  };
  await new Promise((res) => { let k = 0; const f = () => { if (++k < ${frames}) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  R.renderBufferDirect = orig; sm.render = sr;
  const N = ${frames};
  const rows = [];
  for (const [r, t] of tally) {
    let meshes = 0, casters = 0; const mats = new Set(); r.traverse((o) => { if (o.isMesh) { meshes++; if (o.castShadow) casters++; mats.add(o.material.uuid); } });
    rows.push({ idx: scene.children.indexOf(r), kind: kindOf(r), meshes, casters, mats: mats.size, v: +(t.v / N).toFixed(1), s: +(t.s / N).toFixed(1), vt: Math.round(t.vt / N), st: Math.round(t.st / N), pax: r.userData && r.userData.persons ? r.userData.persons.length : 0 });
  }
  rows.sort((a, b) => (b.v + b.s) - (a.v + a.s));
  const sum = (f) => rows.filter(f).reduce((a, r) => ({ v: +(a.v + r.v).toFixed(1), s: +(a.s + r.s).toFixed(1), n: a.n + 1 }), { v: 0, s: 0, n: 0 });
  return { totalV: +rows.reduce((a, r) => a + r.v, 0).toFixed(1), totalS: +rows.reduce((a, r) => a + r.s, 0).toFixed(1), rigs: sum((r) => r.kind === 'rig'), auto: sum((r) => r.kind === 'auto'), top: rows.slice(0, ${top}) };
})()`;

const FARES = '(() => { const w = window.__autowala.ctx.fares.waiting; return { n: w.length, withRig: w.filter((x) => x.rig).length, pax2: w.filter((x) => x.rig && x.pax > 1).length, luggage: w.filter((x) => x.rig && x.luggage).length }; })()';

async function actors(c) {
  const out = {};
  await c.ev(pin(poiId, hour));
  await c.sleep(3000);
  if (args.near) out.near = await c.ev(nearCust(args.near === 'cam' ? { d: 4.5, y: 1.5, pitch: -0.05 } : null));
  await c.sleep(2500);
  out.tally = await c.ev(TALLY(+(args.frames || 90), +(args.top || 30)));
  out.fares = await c.ev(FARES);
  out.info = await c.ev('(() => { const g = window.__autowala.gfx; return { q: g.quality, size: [g.renderer.domElement.width, g.renderer.domElement.height] }; })()');
  return out;
}

/** Frame time and the CPU cost of gfx.render (one timing wrapper, installed once). */
async function frameCost(c, seconds = 6) {
  await c.ev(`(() => { const g = window.__autowala.gfx; const P = window.__fc = window.__fc || { cpu: 0, n: 0 }; if (!window.__fcWrapped) { const r = g.render.bind(g); g.render = (dt) => { const t = performance.now(); r(dt); P.cpu += performance.now() - t; P.n++; }; window.__fcWrapped = true; } return true; })()`);
  await c.sleep(1500);
  return c.ev(`(async () => {
    const P = window.__fc; P.cpu = 0; P.n = 0; const R = window.__autowala.gfx.renderer;
    const dts = []; let last = performance.now(); const end = last + ${seconds} * 1000;
    await new Promise((res) => { const f = (n) => { dts.push(n - last); last = n; if (n < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    dts.shift(); const s = dts.slice().sort((a, b) => a - b); const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
    return { frames: dts.length, fps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), p99: +s[Math.floor(s.length * 0.99)].toFixed(1), hitches50: dts.filter((d) => d > 50).length, cpuRenderMs: +(P.cpu / Math.max(1, P.n)).toFixed(2), programs: R.info.programs.length, geometries: R.info.memory.geometries, textures: R.info.memory.textures, q: window.__autowala.gfx.quality };
  })()`);
}

const FULL = { paint: { body: 'neon-pink', roof: 'white', finish: 'pearl' }, roofStyle: 'dome-lights', rear: { cover: 'led-rainbow', bumper: 'spiked', flaps: 'peacock', ladder: true, antenna: true, sideGuards: true }, lights: { head: 'cyan', under: 'rainbow', tail: 'cyan' }, interior: { seats: 'leopard', garland: true } };
const loadout = (extra) => `(() => { const g = window.__autowala; const L = JSON.parse(JSON.stringify(g.ctx.profile.data.loadout)); Object.assign(L, ${JSON.stringify(extra)}); g.ctx.emit('loadout', { loadout: L, preview: true }); return true; })()`;
const realLoadout = "(() => { const g = window.__autowala; g.ctx.emit('loadout', { loadout: JSON.parse(JSON.stringify(g.ctx.profile.data.loadout)), preview: false }); g.debug.cam(null); return true; })()";

async function suite(c) {
  const out = {};
  await c.ev(pin(poiId, hour));
  await c.sleep(3500);
  out.poi = await c.ev(TALLY(+(args.frames || 90), 12));
  out.poiFrame = await frameCost(c, +(args.seconds || 6));
  out.customers = [];
  for (let i = 0; i < 3; i++) {
    const near = await c.ev(nearCust({ d: 4.5, y: 1.5, pitch: -0.05 }, i));
    await c.sleep(2500);
    const t = await c.ev(TALLY(+(args.frames || 90), 12));
    out.customers.push({ near, rigs: t.rigs, rows: t.top.filter((r) => r.kind === 'rig') });
  }
  await c.ev(pin(poiId, hour));
  await c.sleep(2500);
  out.fares = await c.ev(FARES);
  // the auto alone at the garage, seen from behind and above
  await c.ev(pin(String(args.autopoi || 'garage'), hour));
  await c.sleep(3000);
  await c.ev("(() => { const g = window.__autowala; const p = g.ctx.v; g.debug.cam({ x: p.x - 3.6, y: 2.4, z: p.z - 4.4, yaw: Math.atan2(3.6, 4.4), pitch: -0.18, fov: 42 }); return true; })()");
  await c.sleep(2000);
  out.autoDefault = (await c.ev(TALLY(+(args.frames || 90), 40))).auto;
  await c.ev(loadout(FULL));
  await c.sleep(2500);
  out.autoFull = (await c.ev(TALLY(+(args.frames || 90), 40))).auto;
  await c.ev(loadout({ ...FULL, roofStyle: 'high-canopy' }));
  await c.sleep(2500);
  out.autoCanopy = (await c.ev(TALLY(+(args.frames || 90), 40))).auto;
  await c.ev(realLoadout);
  out.info = await c.ev('(() => { const g = window.__autowala.gfx; return { q: g.quality, size: [g.renderer.domElement.width, g.renderer.domElement.height], programs: g.renderer.info.programs.length }; })()');
  return out;
}

const HIDE_HUD = "(() => { const s = document.createElement('style'); s.textContent = '.aw > *:not(.aw-canvas) { display: none !important; }'; document.head.appendChild(s); return true; })()";

/** Customers with FIXED looks (their data is rewritten, then the body is dropped and rebuilt), frozen in a hand-set pose through the limb handles. */
const CUSTOMERS = [
  { name: 'solo', look: { shirt: '#2d7be8', skin: '#a86e4a', hair: '#1b1220', female: false }, pax: 1, kind: 'regular', female: false, luggage: false, angry: false },
  { name: 'duo-bag', look: { shirt: '#e8453c', skin: '#c08a62', hair: '#2a1a12', female: true }, look2: { shirt: '#f2c230' }, pax: 2, kind: 'tourist', female: true, luggage: true, angry: false },
  { name: 'angry-elder', look: { shirt: '#2fb572', skin: '#6f4430', hair: '#3a2a22', female: false }, pax: 1, kind: 'elder', female: false, luggage: false, angry: true },
];

async function shots(c) {
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  const wanted = String(args.set || 'cust,auto,shop');
  await c.ev(HIDE_HUD);
  await c.ev(pin(poiId, hour));
  await c.sleep(3500);
  const take = async (name, extra = {}) => {
    const f = path.join(dir, `${label}-${name}.jpg`);
    await c.shot(f);
    out.push({ f, ...extra });
  };
  if (wanted.includes('cust')) {
    for (let i = 0; i < CUSTOMERS.length; i++) {
      const v = CUSTOMERS[i];
      const prep = await c.ev(`(() => { const g = window.__autowala; const list = g.ctx.fares.waiting.filter((x) => x.rig).sort((a, b) => a.dist - b.dist);
        const cu = list[${i}]; if (!cu) return { ok: false };
        const v = ${JSON.stringify(v)};
        cu.look = v.look; cu.look2 = v.look2 || null; cu.pax = v.pax; cu.kind = v.kind; cu.female = v.female; cu.luggage = v.luggage; cu.patience = v.angry ? 0.1 : 1; cu.patienceTotal = 1e9;
        window.__cust = cu; const half = g.world.city.half || 800; const tx = cu.x > 0 ? Math.max(-half + 30, cu.x - 700) : Math.min(half - 30, cu.x + 700); g.debug.teleport(tx, cu.z, 0); return { ok: true, id: cu.id }; })()`);
      await c.sleep(2500); // far away: the body is dropped
      const d = v.pax > 1 ? 4.6 : 3.2;
      await c.ev(`(() => { const g = window.__autowala; const cu = window.__cust; const fx = Math.sin(cu.face), fz = Math.cos(cu.face);
        g.debug.teleport(cu.x + fx * 40, cu.z + fz * 40, cu.face + Math.PI);
        g.debug.cam({ x: cu.x + fx * ${d}, y: 1.45, z: cu.z + fz * ${d}, yaw: cu.face + Math.PI, pitch: -0.08, fov: 45 }); return true; })()`);
      await c.sleep(1800); // back: the body is rebuilt from the rewritten data
      const posed = await c.ev(`(() => { const g = window.__autowala; const cu = window.__cust; if (!cu || !cu.rig) return { ok: false, why: 'no rig' };
        g.state.paused = true; cu.rig.visible = true;
        for (const p of cu.rig.userData.persons) { const u = p.userData; const a = 0.5; u.rArm.rotation.z = -a; u.rArm.position.set(0.25 + Math.sin(a) * 0.23, 1.19 + Math.cos(a) * 0.23, 0.06);
          ${v.angry ? 'const b = 0.45; u.lArm.rotation.z = b; u.lArm.position.set(-0.25 - Math.sin(b) * 0.23, 1.19 + Math.cos(b) * 0.23, 0.06);' : ''}
          p.position.y = 0; }
        return { ok: true, persons: cu.rig.userData.persons.length, type: cu.rig.type }; })()`);
      await c.sleep(1200);
      await take(`cust-${v.name}`, { prep, posed });
      await c.ev('window.__autowala.state.paused = false; true');
    }
  }
  if (wanted.includes('auto')) {
    await c.ev(pin(String(args.autopoi || 'garage'), hour));
    await c.sleep(3000);
    for (const fin of ['gloss', 'matte', 'pearl']) {
      await c.ev(`(() => { const g = window.__autowala; const p = g.ctx.v;
        const L = JSON.parse(JSON.stringify(g.ctx.profile.data.loadout)); L.paint = { ...(L.paint || {}), body: 'neon-pink', roof: 'white', finish: ${JSON.stringify(fin)} };
        g.ctx.emit('loadout', { loadout: L, preview: true });
        g.debug.cam({ x: p.x + 3.4, y: 1.9, z: p.z + 4.2, yaw: Math.atan2(-3.4, -4.2), pitch: -0.12, fov: 42 }); return true; })()`);
      await c.sleep(2200);
      await take(`auto-${fin}`);
    }
    await c.ev(`(() => { const g = window.__autowala; const p = g.ctx.v; g.ctx.emit('loadout', { loadout: JSON.parse(JSON.stringify(g.ctx.profile.data.loadout)), preview: false }); g.debug.cam({ x: p.x - 3.6, y: 2.6, z: p.z - 4.4, yaw: Math.atan2(3.6, 4.4), pitch: -0.2, fov: 42 }); return true; })()`);
    await c.sleep(2200);
    await take('auto-default-rear');
    await c.ev(`${loadout(FULL)}; (() => { const g = window.__autowala; const p = g.ctx.v; g.debug.cam({ x: p.x - 3.6, y: 2.0, z: p.z - 4.4, yaw: Math.atan2(3.6, 4.4), pitch: -0.1, fov: 42 }); return true; })()`);
    await c.sleep(2500);
    await take('auto-full-rear');
    await c.ev("(() => { const g = window.__autowala; const p = g.ctx.v; g.debug.cam({ x: p.x + 3.6, y: 2.0, z: p.z + 4.4, yaw: Math.atan2(-3.6, -4.4), pitch: -0.1, fov: 42 }); return true; })()");
    await c.sleep(1500);
    await take('auto-full-front');
    await c.ev(`${loadout({ ...FULL, roofStyle: 'high-canopy' })}; (() => { const g = window.__autowala; const p = g.ctx.v; g.debug.cam({ x: p.x - 4.2, y: 1.9, z: p.z + 3.4, yaw: Math.atan2(4.2, -3.4), pitch: -0.05, fov: 42 }); return true; })()`);
    await c.sleep(2500);
    await take('auto-canopy');
    await c.ev(realLoadout);
  }
  if (wanted.includes('shop')) {
    const opened = await c.ev('(() => { const g = window.__autowala; g.debug.cam(null); return g.ctx.workshop.open(); })()');
    for (let k = 0; k < 40; k++) {
      if (await c.ev("window.__autowala.ctx.workshop.phase === 'open'")) break;
      await c.sleep(500);
    }
    for (const view of ['front34', 'rear34']) {
      await c.ev(`window.__autowala.ctx.workshop.camera.setView(${JSON.stringify(view)}); true`);
      await c.sleep(3500);
      await take(`workshop-${view}`, { opened });
    }
    await c.ev('(() => { window.__autowala.ctx.workshop.close(); return true; })()');
  }
  return out;
}

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(W, H, DPR, false);
    await c.ev('1');
    await START(c);
    await c.sleep(+(args.warm || 5) * 1000);
    let result;
    if (cmd === 'actors') result = await actors(c);
    else if (cmd === 'suite') result = await suite(c);
    else if (cmd === 'shots') result = await shots(c);
    else if (cmd === 'frames') {
      await c.ev(pin(poiId, hour));
      await c.sleep(3000);
      const rows = [];
      for (let k = 0; k < +(args.rounds || 3); k++) rows.push(await frameCost(c, +(args.seconds || 8)));
      result = { rows };
    }
    return { label, cmd, tier, errors: c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource|KHR_parallel/.test(l)).slice(0, 8), result };
  } finally {
    c.close();
  }
}
const row = args['no-lock'] ? await run() : await withBenchLock(run);
const text = JSON.stringify(row, null, args.compact ? 0 : 1);
if (args.out && args.out !== true) fs.writeFileSync(String(args.out), text);
console.log(text);
process.exit(0);
