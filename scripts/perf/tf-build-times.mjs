// How long the model builders take IN THE BROWSER (real canvas textures, real V8), against a Vite DEV server (it serves the ES modules as they are, so the page can
// import them): customers (every kind, a few seeds), dishes, the officials, an avatar. A build is a main-thread task: anything over ~16 ms is a dropped frame, over
// 50 ms a visible hitch. Not a benchmark of the GPU: no WebGL is touched, so it never needs the bench lock.
//
//   node scripts/perf/tf-build-times.mjs --base http://127.0.0.1:5853 --port 9886 [--pack 1] [--seeds 3] [--tier medium]
import { GPU_FLAGS, launch } from './cdp.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = args.base || 'http://127.0.0.1:5853';
const port = +(args.port || 9886);
const tier = String(args.tier || 'medium');
const pack = args.pack === undefined ? 1 : +args.pack;
const seeds = +(args.seeds || 3);

const PAGE = `(async () => {
  const M = '/src/games/tiffin-centre/models/';
  const m = await import(M + 'index.js');
  const cq = await import(M + 'charquality.js');
  const ins = await import(M + 'inspector.js');
  const util = await import(M + 'util.js');
  const pbr = await import(M + 'pbr.js');
  const cat = await import('/shared/tiffin-centre/catalog.js');
  const tier = ${JSON.stringify(tier)};
  const T = { lite: 'low', low: 'low', medium: 'medium', high: 'high' };
  cq.setCharacterQuality(tier === 'lite' ? 'lite' : tier);
  cq.setCharacterDrawMode({ merge: false, baked: false, limitShadows: true, pack: ${pack ? 'true' : 'false'} });
  util.setTextureQuality(T[tier]); pbr.setQuality(T[tier]);
  const rows = [];
  const time = (name, fn) => { const t0 = performance.now(); const o = fn(); rows.push([name, +(performance.now() - t0).toFixed(1)]); return o; };
  // textures and shared caches are built by the first of everything: report the cold builds, then the warm ones
  for (let pass = 0; pass < 2; pass++) {
    for (const k of m.CUSTOMER_KIND_IDS) for (let s = 0; s < ${seeds}; s++) { const c = time((pass ? 'warm ' : 'cold ') + 'customer ' + k + ' #' + s, () => m.buildCustomer(k, 7 + s * 13)); if (pass) c.dispose(); }
    for (const id of cat.DISH_IDS) { const d = time((pass ? 'warm ' : 'cold ') + 'dish ' + id, () => m.buildDish(id, 'good')); }
    time((pass ? 'warm ' : 'cold ') + 'inspector', () => ins.buildInspector(7));
    time((pass ? 'warm ' : 'cold ') + 'delivery boy', () => ins.buildDeliveryBoy(7));
    time((pass ? 'warm ' : 'cold ') + 'avatar', () => m.buildAvatar({ color: '#ff8a1f', name: 'x' }));
    time((pass ? 'warm ' : 'cold ') + 'viewmodel', () => m.buildViewmodel());
  }
  return rows;
})()`;

const c = await launch({ port, w: 800, h: 500, gl: GPU_FLAGS });
try {
  await c.goto(`${base}/`);
  await c.waitFor('document.readyState === "complete"', 60000);
  await c.sleep(1500);
  const rows = await c.ev(PAGE);
  const by = {};
  for (const [n, ms] of rows) {
    const key = n.replace(/ #\d+$/, '');
    (by[key] ||= []).push(ms);
  }
  for (const [k, v] of Object.entries(by)) console.log(`${k.padEnd(34)} ${v.map((x) => x.toFixed(0)).join(' ')} ms`);
  const cust = rows.filter(([n]) => n.startsWith('warm customer')).map((r) => r[1]);
  console.log(`warm customer builds: mean ${(cust.reduce((a, b) => a + b, 0) / cust.length).toFixed(1)} ms, max ${Math.max(...cust).toFixed(1)} ms`);
  if (c.logs.length) console.log('console: ' + c.logs.slice(0, 5).join(' | '));
} finally {
  c.close();
}
process.exit(0);
