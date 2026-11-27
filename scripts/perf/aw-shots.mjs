// Autowala picture A/B (aw-final): fixed cameras, the HUD hidden, several VARIANTS of the same page, and a pixel diff between them.
//
//   node scripts/perf/aw-shots.mjs --base http://127.0.0.1:5881 --port 9965 --soft --no-lock --tier medium \
//       --scenes charminar-day,night-paradise --variants "base|nobloom=window.__autowala.gfx.post.setLevels(0)" [--reset "window.__autowala.gfx.post.setLevels(4)"] --dir out
//
// Every scene is pinned (player, camera, hour, weather) and settled; every variant is `name=js` (the first one has no js: it is the reference); the js runs in
// the page, a PNG is captured `--wait` ms later, then the optional per-variant reset (`name=js=reset`). Output: one JPEG per (scene, variant) in --dir (q72)
// and a table of the diff of every variant against the first: mean absolute error (0..255), share of pixels over 2 / 8 / 24 levels, the worst pixel, where.
// Scenes are the ones of aw-draw.mjs (`--list` prints them) plus dusk / night looks. Draw counts and pictures do not depend on the GPU: `--soft --no-lock`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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
const port = +(args.port || 9965);
const dir = args.dir && args.dir !== true ? String(args.dir) : path.join(process.env.TEMP || '.', 'aw-shots-ab');
const WAIT = +(args.wait || 700);
const SETTLE = +(args.settle || 3);
const label = args.label && args.label !== true ? String(args.label) : '';

// ---------------------------------------------------------------------------------------------------------------- PNG decode + diff (no dependencies)
/** 8-bit RGB / RGBA, non-interlaced PNG -> { w, h, px: Uint8Array RGBA }. */
export function decodePng(buf) {
  let o = 8;
  let w = 0;
  let h = 0;
  let ct = 6;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IHDR') { w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12); ct = buf[o + 17]; if (buf[o + 16] !== 8 || buf[o + 20] !== 0) throw new Error('png: 8-bit non-interlaced only'); }
    else if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error('png: colour type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.buffer, raw.byteOffset + y * (stride + 1) + 1, stride).slice();
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      if (f === 1) line[i] = (line[i] + a) & 255;
      else if (f === 2) line[i] = (line[i] + b) & 255;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
    }
    for (let x = 0; x < w; x++) { const s = x * bpp; const d = (y * w + x) * 4; out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = 255; }
    prev = line;
  }
  return { w, h, px: out };
}

/** RGB PNG of the per-pixel difference of two images, amplified (x gain), so a diff can be LOOKED at. */
export function diffPng(a, b, gain = 8) {
  const { w, h } = a;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.min(255, Math.abs(a.px[i + k] - b.px[i + k]) * gain);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function diffImages(a, b) {
  if (a.w !== b.w || a.h !== b.h) return null;
  let sum = 0;
  let n2 = 0;
  let n8 = 0;
  let n24 = 0;
  let worst = 0;
  let wx = 0;
  let wy = 0;
  const N = a.w * a.h;
  for (let i = 0; i < N; i++) {
    const d = Math.max(Math.abs(a.px[i * 4] - b.px[i * 4]), Math.abs(a.px[i * 4 + 1] - b.px[i * 4 + 1]), Math.abs(a.px[i * 4 + 2] - b.px[i * 4 + 2]));
    sum += (Math.abs(a.px[i * 4] - b.px[i * 4]) + Math.abs(a.px[i * 4 + 1] - b.px[i * 4 + 1]) + Math.abs(a.px[i * 4 + 2] - b.px[i * 4 + 2])) / 3;
    if (d > 2) n2++;
    if (d > 8) n8++;
    if (d > 24) n24++;
    if (d > worst) { worst = d; wx = i % a.w; wy = (i / a.w) | 0; }
  }
  return { mae: +(sum / N).toFixed(3), over2: +((100 * n2) / N).toFixed(2), over8: +((100 * n8) / N).toFixed(2), over24: +((100 * n24) / N).toFixed(3), worst, at: [wx, wy] };
}

// ---------------------------------------------------------------------------------------------------------------- scenes
const PIN = (s) => `(() => {
  const g = window.__autowala; g.debug.drive(null); clearInterval(window.__pinT);
  const w = g.world; let at, front;
  const p = w.city.poiById[${JSON.stringify(s.poi || 'charminar')}]; at = p; front = p.front || p;
  g.debug.teleport(front.x, front.z, ${+(s.heading || 0)});
  g.debug.weather(${+(s.weather || 0)}); g.debug.hour(${+(s.hour || 14)});
  window.__pinT = setInterval(() => g.debug.hour(${+(s.hour || 14)}), 100);
  if (${JSON.stringify(!!s.xyz)}) { g.debug.cam({ x: ${+(s.xyz?.[0] || 0)}, y: ${+(s.xyz?.[1] || 6)}, z: ${+(s.xyz?.[2] || 0)}, yaw: ${+(s.yaw || 0)}, pitch: ${+(s.pitch || 0)}, fov: 62 }); }
  else if (${JSON.stringify(!!s.cam)}) { let dx = front.x - at.x, dz = front.z - at.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const cx = at.x + dx * ${+(s.dist || 60)}, cz = at.z + dz * ${+(s.dist || 60)}; const hd = Math.hypot(at.x - cx, at.z - cz);
    g.debug.cam({ x: cx, y: ${+(s.h || 6)}, z: cz, yaw: Math.atan2(at.x - cx, at.z - cz), pitch: Math.atan2(${+(s.aim || 10)} - ${+(s.h || 6)}, hd), fov: 62 }); }
  else g.debug.cam(null);
  if (${JSON.stringify(!!s.workshop)}) { g.ctx.workshop.open(); }
  return true; })()`;

/** After the workshop has opened and settled: a FIXED free camera round the bay (the orbit camera drifts with time, which makes pictures incomparable). */
const WORKSHOP_CAM = (c) => `(() => { const g = window.__autowala; const sp = g.ctx.workshop.spot; const dx = ${c[0]}, dy = ${c[1]}, dz = ${c[2]};
  g.debug.cam({ x: sp.x + dx, y: dy, z: sp.z + dz, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(0.9 - dy, Math.hypot(dx, dz)), fov: 62 }); return true; })()`;

export const SCENES = [
  { name: 'charminar-day', poi: 'charminar', hour: 12, cam: true, dist: 70, h: 6, aim: 14 },
  { name: 'street-day', poi: 'irani', hour: 12, cam: true, dist: 45, h: 5, aim: 6 },
  { name: 'shops-day', poi: 'paradise', hour: 12, cam: true, dist: 38, h: 4, aim: 6 },
  { name: 'hitech-day', poi: 'cyber', hour: 11, cam: true, dist: 120, h: 14, aim: 40 },
  { name: 'sunset-charminar', poi: 'charminar', hour: 17.9, cam: true, dist: 70, h: 6, aim: 14 },
  { name: 'dusk-hitech', poi: 'cyber', hour: 18.6, cam: true, dist: 120, h: 14, aim: 40 },
  { name: 'night-paradise', poi: 'paradise', hour: 22, cam: true, dist: 38, h: 4, aim: 6 },
  { name: 'night-charminar', poi: 'charminar', hour: 21, cam: true, dist: 70, h: 6, aim: 14 },
  { name: 'rain-night-charminar', poi: 'charminar', hour: 21, weather: 1, cam: true, dist: 48, h: 4.5, aim: 12 },
  { name: 'rain-day', poi: 'charminar', hour: 13, weather: 1, cam: true, dist: 60, h: 5, aim: 12 },
  { name: 'workshop-day', poi: 'garage', hour: 12, workshop: true },
  { name: 'workshop-night', poi: 'garage', hour: 22, workshop: true },
  { name: 'wfix-day-a', poi: 'garage', hour: 12, workshop: true, wcam: [5.5, 2.4, 6.5] },
  { name: 'wfix-night-a', poi: 'garage', hour: 22, workshop: true, wcam: [5.5, 2.4, 6.5] },
  { name: 'wfix-night-b', poi: 'garage', hour: 22, workshop: true, wcam: [-6.5, 2.2, 5.0] },
  { name: 'wfix-dusk-b', poi: 'garage', hour: 18.6, workshop: true, wcam: [-6.5, 2.2, 5.0] },
  { name: 'garage-dusk-chase', poi: 'garage', hour: 18.2 },
  { name: 'garage-night-chase', poi: 'garage', hour: 22 },
];

if (args.list) {
  console.log(SCENES.map((s) => s.name).join('\n'));
  process.exit(0);
}

// --compose "a.jpg|b.jpg" --out pair.jpg [--labels "before|after"] [--cell 960x540]: one JPEG (q72) with the pictures side by side (a headless Chrome does the drawing)
if (args.compose) {
  const files = String(args.compose).split('|');
  const labels = String(args.labels || 'before|after').split('|');
  const [cw, ch] = String(args.cell || '960x540').split('x').map(Number);
  const c = await launch({ port, w: 400, h: 300, gl: SOFT_FLAGS });
  try {
    const urls = files.map((f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}`);
    const data = await c.ev(`(async () => {
      const urls = ${JSON.stringify(urls)}; const labels = ${JSON.stringify(labels)};
      const cv = document.createElement('canvas'); cv.width = ${cw} * urls.length; cv.height = ${ch}; const g = cv.getContext('2d');
      for (let i = 0; i < urls.length; i++) {
        const img = new Image(); img.src = urls[i]; await img.decode();
        const k = Math.max(${cw} / img.width, ${ch} / img.height); const w = img.width * k, h = img.height * k; // cover, centred
        g.save(); g.beginPath(); g.rect(i * ${cw}, 0, ${cw}, ${ch}); g.clip(); g.drawImage(img, i * ${cw} + (${cw} - w) / 2, (${ch} - h) / 2, w, h); g.restore();
        g.font = 'bold 20px sans-serif'; g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(i * ${cw}, 0, 150, 30); g.fillStyle = '#fff'; g.fillText(labels[i] || '', i * ${cw} + 10, 22);
      }
      return cv.toDataURL('image/jpeg', 0.72).split(',')[1];
    })()`);
    fs.mkdirSync(path.dirname(String(args.out)), { recursive: true });
    fs.writeFileSync(String(args.out), Buffer.from(data, 'base64'));
    console.log(`${args.out} ${(fs.statSync(String(args.out)).size / 1024).toFixed(0)} KB`);
  } finally {
    c.close();
  }
  process.exit(0);
}

async function run() {
  const variants = String(args.variants || 'base').split('|').map((v) => { const i = v.indexOf('='); return { name: i < 0 ? v : v.slice(0, i), js: i < 0 ? '' : v.slice(i + 1), reset: args.reset && args.reset !== true ? String(args.reset) : '' }; });
  const names = args.scenes && args.scenes !== true ? String(args.scenes).split(',') : SCENES.map((s) => s.name);
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  const results = [];
  try {
    await c.viewport(W, H, DPR, false);
    await c.ev('1');
    await c.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); if (String(k).startsWith('jalebi.autowala.v')) { try { const d = JSON.parse(v || '{}'); d.settings = { ...(d.settings || {}), quality: '${tier}' }; return JSON.stringify(d); } catch { return v; } } return v; }; })();`,
    });
    if (args.tune && args.tune !== true) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `globalThis.__awTune = ${args.tune};` });
    await c.goto(`${base}/play/autowala`);
    await c.waitFor("!!document.querySelector('.aw-go')", 180000);
    await c.ev("document.querySelector('.aw-go').click()");
    await c.waitFor('!!window.__autowala', 60000);
    await c.ev('window.__autowala.gfx.autoTier = false; true');
    await c.sleep(4000);
    await c.ev("(() => { const st = document.createElement('style'); st.textContent = '.aw > *:not(.aw-canvas) { display: none !important; }'; document.head.appendChild(st); return true; })()");
    fs.mkdirSync(dir, { recursive: true });
    for (const name of names) {
      const s = SCENES.find((x) => x.name === name);
      if (!s) throw new Error('unknown scene ' + name);
      await c.ev('window.__autowala.state.paused = false; true');
      await c.ev(PIN(s));
      await c.sleep(SETTLE * 1000);
      if (s.wcam) { await c.sleep(2000); await c.ev(WORKSHOP_CAM(s.wcam)); await c.sleep(500); }
      if (args.pause) { await c.ev('window.__autowala.state.paused = true; true'); await c.sleep(400); } // traffic, people, fares stand still: a diff is the variant, not the city moving
      const imgs = [];
      for (const v of variants) {
        if (v.js) { await c.ev(v.js); await c.sleep(WAIT); }
        const r = await c.send('Page.captureScreenshot', { format: 'png' });
        const buf = Buffer.from(r.data, 'base64');
        const jpg = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
        fs.writeFileSync(path.join(dir, `${label ? label + '-' : ''}${name}-${v.name}.jpg`), Buffer.from(jpg.data, 'base64'));
        imgs.push({ v, img: decodePng(buf) });
        if (v.reset) { await c.ev(v.reset); await c.sleep(WAIT / 2); }
      }
      for (let i = 1; i < imgs.length; i++) {
        results.push({ scene: name, variant: imgs[i].v.name, ...diffImages(imgs[0].img, imgs[i].img) });
        if (args.diffs) fs.writeFileSync(path.join(dir, `${label ? label + '-' : ''}${name}-${imgs[i].v.name}-diff.png`), diffPng(imgs[0].img, imgs[i].img, +(args.gain || 8)));
      }
    }
    return { results, errors: c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource/.test(l)).slice(0, 6) };
  } finally {
    c.close();
  }
}

const out = args['no-lock'] ? await run() : await withBenchLock(run);
console.log('scene'.padEnd(24), 'variant'.padEnd(16), 'MAE'.padStart(7), '>2'.padStart(7), '>8'.padStart(7), '>24'.padStart(7), 'worst'.padStart(6), 'at');
for (const r of out.results) console.log(r.scene.padEnd(24), r.variant.padEnd(16), String(r.mae).padStart(7), (r.over2 + '%').padStart(7), (r.over8 + '%').padStart(7), (r.over24 + '%').padStart(7), String(r.worst).padStart(6), JSON.stringify(r.at));
if (out.errors.length) console.log('errors', out.errors);
console.log('pictures in', dir);
process.exit(0);
