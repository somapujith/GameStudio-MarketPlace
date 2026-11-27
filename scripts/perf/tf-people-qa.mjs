// Packed people vs the rig's own meshes, side by side: the SAME six customers (every kind, fixed seeds) are built twice in a live page, once with the rig's ~60
// meshes each (pack off) and once packed (models/pack.js), placed in a row at the customer spots, and photographed from the cook's eyes.
//
//   node scripts/perf/tf-people-qa.mjs --base http://127.0.0.1:5854 --port 9964 --out docs/perf/tf-prog2 [--hours 13,19.5] [--soft] [--no-lock]
//
// It needs a Vite DEV server as --base (the page imports the model modules by URL; they are the very instances the game uses). Writes <out>/people-rig-h<hour>.jpg and
// people-pack-h<hour>.jpg and prints the difference between each pair (tf-diff.mjs semantics). The street is hidden so the only thing that differs is the people.
import fs from 'node:fs';
import path from 'node:path';
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = args.base || 'http://127.0.0.1:5854';
const port = +(args.port || 9964);
const out = String(args.out || 'docs/perf/tf-prog2');
const W = +(args.w || 1280);
const H = +(args.h || 720);
const hours = String(args.hours || '13,19.5').split(',').map(Number);
const tier = String(args.tier || 'medium');

const PLACE = (pack, kinds) => `(async () => {
  const M = '/src/games/tiffin-centre/models/';
  const m = await import(M + 'index.js');
  const cq = await import(M + 'charquality.js');
  const cat = await import('/shared/tiffin-centre/catalog.js');
  const kit = await import('/src/games/tiffin-centre/scene/kit.js');
  const ins = await import(M + 'inspector.js');
  const dbg = window.__tiffin.scene.debug; const sc = dbg.gfx.scene;
  let root = sc.getObjectByName('qa-people'); if (root) { sc.remove(root); root.userData.models?.forEach((x) => x.dispose?.()); }
  cq.setCharacterDrawMode({ merge: false, baked: false, limitShadows: true, pack: ${pack} });
  const models = [];
  const Obj3D = Object.getPrototypeOf(sc.constructor);
  root = new Obj3D();
  root.name = 'qa-people';
  const kinds = ${JSON.stringify(kinds)};
  kinds.forEach((k, i) => {
    const mdl = k === 'inspector' ? ins.buildInspector(7) : k === 'delivery' ? ins.buildDeliveryBoy(7) : k === 'avatar' ? m.buildAvatar({ color: '#ff8a1f', name: 'x' }) : m.buildCustomer(k, 7 + i);
    mdl.group.position.set(cat.LAYOUT.spotX(i), 0, cat.LAYOUT.spotZ);
    kit.shade(mdl.group);
    root.add(mdl.group);
    models.push(mdl);
  });
  root.userData.models = models;
  sc.add(root);
  for (let f = 0; f < 8; f++) models.forEach((mdl) => { mdl.setMood?.('waiting'); mdl.update?.(0.05, 1 + f * 0.05); });
  return models.map((x) => x.group.userData.kind + ':' + x.triangles).join(' ');
})()`;

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  const rows = [];
  try {
    await c.viewport(W, H, 1, false);
    await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
    await c.waitFor("[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 120000);
    await c.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === '${tier}')?.click(); true`);
    await c.sleep(300);
    await c.ev("[...document.querySelectorAll('button')].filter((b) => /Start tutorial/.test(b.textContent)).pop().click(); true");
    await c.waitFor('!!(window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug)', 240000);
    await c.sleep(3000);
    await c.ev('(() => { const g = window.__tiffin.scene.debug.gfx; g.holdAdaptation(1e6); g.setScale(1); return true; })()');
    await c.ev("document.querySelectorAll('.tc > *:not(canvas)').forEach((e) => { e.style.visibility = 'hidden'; }); true");
    await c.ev('(() => { const d = window.__tiffin.scene.debug; d.street.root.visible = false; window.__tiffin.scene.setReducedMotion(true); return true; })()'); // no head bob: two shots differ only in the people
    const kinds = String(args.kinds || 'office,student,family,uncle,autowala,techie').split(','); // also: inspector, delivery, avatar
    for (const h of hours) {
      const files = {};
      for (const [name, pack] of [['rig', false], ['pack', true]]) {
        await c.ev(`window.__tiffin.scene.debug.setHour(${h}); true`);
        const info = await c.ev(PLACE(pack, kinds));
        await c.sleep(2500);
        const f = path.join(out, `${args.name || 'people'}-${name}-h${String(h).replace('.', '_')}.jpg`);
        await c.shot(f, { jpeg: true, quality: 82 });
        files[name] = f;
        rows.push({ hour: h, mode: name, info, file: f });
      }
    }
    return rows;
  } finally {
    c.close();
  }
}

fs.mkdirSync(out, { recursive: true });
const res = args['no-lock'] ? await run() : await withBenchLock(run, { maxWaitMs: 60 * 60 * 1000 });
console.log(JSON.stringify(res, null, 1));
process.exit(0);
