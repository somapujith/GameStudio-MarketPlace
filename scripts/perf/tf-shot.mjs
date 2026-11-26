// Identical-camera screenshots of Tiffin Centre for before / after proofs.
//
//   node scripts/perf/tf-shot.mjs --base http://127.0.0.1:5770 --port 9816 --out docs/perf/tf-cpu --name after [--tier medium] [--hours 9,13,19.5] [--w 1280 --h 720 --dpr 1]
//        [--customers] [--quality 72] [--no-lock]
//
// Starts the tutorial, pins the render scale to 1 and the clock to each hour in turn, waits for the env map and the lights to settle, and saves
// <out>/<name>-h<hour>.jpg. With --customers it also shows the scene a few seconds after the tutorial spawns its first customer is NOT forced: use a
// practice level instead (--level 1) so customers walk up by themselves. Everything that moves by itself (vehicles, flames, cloth) differs a little between two
// runs; what must NOT differ is the shape, the colours, the shadows and the lights.
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
const base = args.base || 'http://127.0.0.1:5770';
const port = +(args.port || 9816);
const W = +(args.w || 1280);
const H = +(args.h || 720);
const DPR = +(args.dpr || 1);
const out = String(args.out || 'docs/perf/tf-cpu');
const name = String(args.name || 'shot');
const tier = args.tier && args.tier !== true ? String(args.tier) : 'medium';
const hours = String(args.hours || '9,13,19.5').split(',').map(Number);
const level = +(args.level || 0);
const wait = +(args.wait || 3) * 1000;

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  const files = [];
  try {
    await c.viewport(W, H, DPR, false);
    if (level > 0) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('jalebi.tutorial.v1.tiffin-centre', '1'); } catch {}" });
    await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
    await c.waitFor(level > 0 ? "!!document.querySelector('.tc-menu-lvl__btn')" : "[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 90000);
    await c.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === '${tier.toLowerCase()}')?.click(); true`);
    await c.sleep(300);
    if (level > 0) {
      await c.ev("document.querySelector('.tc-menu-lvl__btn').click(); true");
      await c.waitFor("[...document.querySelectorAll('button')].some((b) => /Open the stall/.test(b.textContent))", 30000);
    await c.ev("[...document.querySelectorAll('button')].find((b) => /Open the stall/.test(b.textContent)).click(); true");
    } else await c.ev("[...document.querySelectorAll('button')].filter((b) => /Start tutorial/.test(b.textContent)).pop().click(); true");
    await c.waitFor('!!(window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug)', 240000);
    await c.sleep(2500);
    // a fixed look: full resolution, no adaptation, the camera where the cook stands
    await c.ev('(() => { const g = window.__tiffin.scene.debug.gfx; g.holdAdaptation(1e6); g.setScale(1); return true; })()');
    for (const h of hours) {
      await c.ev(`window.__tiffin.scene.debug.setHour(${h}); true`);
      await c.sleep(wait);
      // freeze the street animation's phase differences as far as possible: nothing to do, the shot is taken between frames
      const file = path.join(out, `${name}-h${String(h).replace('.', '_')}.jpg`);
      await c.shot(file, { jpeg: true, quality: +(args.quality || 72) });
      files.push(file);
    }
    const info = await c.ev('(() => { const g = window.__tiffin.scene.debug.gfx; const i = g.renderer.info; return { tier: g.quality, scale: g.scale, calls: i.render.calls, programs: i.programs.length }; })()');
    return { files, info };
  } finally {
    c.close();
  }
}

fs.mkdirSync(out, { recursive: true });
const res = args['no-lock'] ? await run() : await withBenchLock(run, { maxWaitMs: 60 * 60 * 1000 });
console.log(JSON.stringify(res));
process.exit(0);
