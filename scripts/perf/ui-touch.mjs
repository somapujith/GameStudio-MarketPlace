// Layout check of the two 3D games' HUD on touch tablets and phones: measured overlaps (getBoundingClientRect) + screenshots.
//
//   node scripts/perf/ui-touch.mjs --game autowala|tiffin --base http://127.0.0.1:5871 --port 9940 --sizes 842x618,1024x768,1366x1024
//        [--dpr 1] [--worst] [--shots docs/perf/ui-touch --name before] [--soft] [--no-pointer] [--json out.json]
//
// Software GL by default (layout and screenshots only: frame times mean nothing). Touch emulation is on (`pointer: coarse`, 5 touch points).
// Autowala: starts a shift, (with --worst) forces the busiest HUD the stylesheets have to cope with: a trip, a red signal + a camera + a police
// check (the lane shows two), road rage, a prompt, a drift, two toasts and a caption, on top of the tutorial card the game shows by itself.
// Tiffin: starts the tutorial (coach bar) or, with --level N, a practice level N with the dish board full (--worst).
// Output: one JSON line per size { size, boxes, overlaps[], car } on stdout; --shots writes <name>-<game>-<WxH>.jpg.
import fs from 'node:fs';
import path from 'node:path';
import { SOFT_FLAGS, GPU_FLAGS, launch } from './cdp.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const game = String(args.game || 'autowala');
const base = String(args.base || 'http://127.0.0.1:5871');
const port = +(args.port || 9940);
const DPR = +(args.dpr || 1);
const sizes = String(args.sizes || '842x618,1024x768,1180x820,1366x1024').split(',').map((s) => s.split('x').map(Number));
const worst = !!args.worst;
const level = +(args.level || 0);
const shots = args.shots && args.shots !== true ? String(args.shots) : '';
const name = String(args.name || 'shot');

/** In-page: every visible HUD box (by group) and the pairs that overlap. */
const MEASURE_AW = `(() => {
  const SEL = {
    wallet: '.aw-cwallet', trip: '.aw-ctrip, .aw-cfind', clock: '.aw-cclock', more: '.aw-more-btn', pause: '.aw-pausebtn--c',
    minimap: '.aw-mm-disc', pill: '.aw-mm-pill', street: '.aw-mm-street',
    alert: '.aw-alerts .aw-rule, .aw-alerts .aw-rage, .aw-alerts .aw-alert-chip',
    coach: '.aw-quest-coach', tracker: '.aw-quest-tracker', toast: '.aw-toast', burst: '.aw-burst', sub: '.aw-sub', prompt: '.aw-prompt', fare: '.aw-fare',
    drift: '.aw-drift', pod: '.aw-sp', limit: '.aw-limit',
    wheel: '.aw-ct-wheel', pedal: '.aw-ct-pedal', btn: '.aw-ct-btn', mini: '.aw-ct-mini', arrows: '.aw-ct-arrow',
  };
  const root = document.querySelector('.aw');
  const boxes = [];
  for (const [g, sel] of Object.entries(SEL)) {
    let i = 0;
    for (const el of root.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.05 || el.closest('[hidden]')) continue;
      boxes.push({ id: g + (i++ ? '#' + i : ''), g, x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) });
    }
  }
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], c = boxes[j];
    const w = Math.min(a.r, c.r) - Math.max(a.x, c.x), h = Math.min(a.b, c.b) - Math.max(a.y, c.y);
    if (w > 1 && h > 1) overlaps.push({ a: a.id, b: c.id, w, h });
  }
  // the car: the screen box of its body (8 corners of a 1.4 x 1.6 x 2.6 m box)
  let car = null;
  try {
    const G = window.__autowala; const cam = G.gfx.camera; const V = cam.position.constructor; const s = G.vehicle.state;
    const W = innerWidth, H = innerHeight; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    cam.updateMatrixWorld();
    for (const dx of [-0.7, 0.7]) for (const dy of [0, 1.6]) for (const dz of [-1.3, 1.3]) {
      const c = Math.cos(s.heading), sn = Math.sin(s.heading);
      const p = new V(s.x + dx * c + dz * sn, dy, s.z - dx * sn + dz * c).project(cam);
      x0 = Math.min(x0, (p.x * 0.5 + 0.5) * W); x1 = Math.max(x1, (p.x * 0.5 + 0.5) * W);
      y0 = Math.min(y0, (0.5 - p.y * 0.5) * H); y1 = Math.max(y1, (0.5 - p.y * 0.5) * H);
    }
    car = { x: Math.round(x0), y: Math.round(y0), r: Math.round(x1), b: Math.round(y1) };
  } catch (e) { car = { err: String(e) }; }
  const onCar = car && car.x != null ? boxes.filter((a) => { const w = Math.min(a.r, car.r) - Math.max(a.x, car.x), h = Math.min(a.b, car.b) - Math.max(a.y, car.y); return w > 1 && h > 1 && !['wheel','pedal','btn','mini','arrows','pod','prompt'].includes(a.g); }).map((a) => a.id) : [];
  return { vw: innerWidth, vh: innerHeight, layout: root.dataset.awLayout, scale: getComputedStyle(root).getPropertyValue('--aw-ui-scale').trim(), boxes, overlaps, car, onCar };
})()`;

const fare = !!args.fare;
const FORCE_AW = `(() => {
  const G = window.__autowala;
  if (!window.__forceAdded) {
    window.__forceAdded = true;
    G.ctx.addSnapshot(() => ({
      trip: { name: 'Salma Aapa', kind: 'foodie', pax: 2, status: 'riding', fareNow: 148, distanceLeft: 2300, timeLeft: 42, mood: 0.7, dest: { name: 'Charminar Chowrasta', te: 'చార్మినార్' } },
      route: { length: 2300, eta: 190, nextTurn: 'left', turnDistance: 80 },
      rules: { limit: 40, zone: 'city', speeding: true, heat: 0, wanted: false, fines: 0, lastFine: null, signalAhead: { state: 'red', dist: 55, left: 6.2, watched: true }, cameraAhead: { dist: 90, limit: 40 }, checkpoint: { phase: 'near', dist: 28 } },
      rage: { active: true, heat: 0.5, escape: 0.2, caughtIn: 0.1, chasers: 2 },
      prompt: { text: "Press E to enter Mama's Garage", key: 'E' },
      drifting: true, driftCharge: 0.6, waitingCount: 3,
      ...(${fare} ? { fareChoice: { key: 'k1', id: 'pickup', kind: 'pickup', quiet: false, title: { en: 'How will you charge?', te: 'ఎలా వసూలు చేస్తారు?' }, note: 'Salma Aapa is in a hurry', say: null,
        options: [{ n: 1, id: 'meter', label: { en: 'Meter', te: 'మీటర్' }, sub: 'about Rs 148', tone: null }, { n: 2, id: 'fixed', label: { en: 'Fixed Rs 180', te: 'ఫిక్స్డ్' }, sub: '+Rs 32', tone: null }, { n: 3, id: 'bargain', label: { en: 'Bargain', te: 'బేరం' }, sub: 'risky', tone: null }], timeLeft: 6, total: 8 } } : {}),
    }));
  }
  G.ctx.toast('Salma Aapa wants to go to Charminar Chowrasta', { tone: 'info', ms: 600000 });
  G.ctx.toast('Fare collected: Rs 148 and a Rs 20 tip', { tone: 'good', ms: 600000 });
  G.ctx.emit('voice:line', { id: 'x', text: 'ఎక్కడికి సార్?', te: 'ఎక్కడికి సార్? త్వరగా వెళ్ళాలి', en: 'Where to, sir? I am in a hurry', persona: 'x', personaName: 'Salma', speaker: 'Salma', color: '#ffc857', hero: false, ms: 600000 });
  return true;
})()`;

async function runAutowala(c, [w, h]) {
  await c.viewport(w, h, DPR, true);
  await c.goto(`${base}/play/autowala`);
  await c.waitFor("!!document.querySelector('.aw-go')", 180000);
  await c.ev("document.querySelector('.aw-go').click(); true");
  await c.waitFor('!!window.__autowala && document.querySelector(".aw-hud") && document.querySelector(".aw-hud").dataset.menu === ""', 120000);
  await c.waitFor('!!document.querySelector(".aw-quest-coach")', 60000).catch(() => {}); // the tutorial card (a fresh profile runs "Mama\'s First Day")
  await c.sleep(2500);
  const out = {};
  if (worst) {
    await c.ev(FORCE_AW);
    await c.sleep(3500); // software GL runs at a few fps: the snapshot is published on a frame
    await c.waitFor("!!document.querySelector('.aw-toast') && !!document.querySelector('.aw-ctrip')", 20000).catch(() => {});
  }
  Object.assign(out, await c.ev(MEASURE_AW));
  if (shots) await c.shot(path.join(shots, `${name}-autowala-${w}x${h}${worst ? '-worst' : ''}${fare ? '-fare' : ''}.jpg`));
  return out;
}

async function run() {
  const c = await launch({ port, w: 1280, h: 800, gl: args.soft === false || args.gpu ? GPU_FLAGS : SOFT_FLAGS });
  const results = [];
  try {
    for (const size of sizes) {
      // a fresh page per size: the HUD attributes and the touch layer are measured from a clean start
      await c.goto('about:blank');
      const res = game === 'tiffin' ? await (await import('./ui-touch-tiffin.mjs')).runTiffin(c, size, { base, DPR, worst, level, shots, name }) : await runAutowala(c, size);
      results.push({ size: size.join('x'), ...res });
      const sum = (m) => m && { overlaps: m.overlaps, off: m.off, clipped: m.clipped };
      console.log(JSON.stringify({ size: size.join('x'), layout: res.layout, scale: res.scale, overlaps: res.overlaps, onCar: res.onCar, car: res.car, off: res.off, clipped: res.clipped, briefing: sum(res.briefing), pause: sum(res.pause), errors: c.logs.slice(-3) }));
    }
  } finally {
    c.close();
  }
  if (args.json && args.json !== true) fs.writeFileSync(String(args.json), JSON.stringify(results, null, 1));
  return results;
}

if (shots) fs.mkdirSync(shots, { recursive: true });
await run();
process.exit(0);
