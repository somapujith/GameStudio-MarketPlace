// Visual QA shots of Tiffin Centre at several hours and in the rain, for before / after proofs. Same camera every time, HUD hidden, render scale pinned to 1.
//
//   node scripts/perf/tf-qa.mjs --base http://127.0.0.1:5851 --port 9862 --out <dir> --name base [--tier medium] [--w 1536 --h 864 --dpr 1.25]
//        [--shots day13,dusk19.5,night22,rain13,rain22] [--hud] [--quality 72] [--no-lock]
//
// A shot is `<kind><hour>`: `day13` / `dusk19.5` / `night22` all just set the clock hour (the name is a label); `rain<hour>` also adds the rain event to every state the scene
// receives. Output: <out>/<name>-<shot>.jpg
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
const base = args.base || 'http://127.0.0.1:5851';
const port = +(args.port || 9862);
const W = +(args.w || 1536);
const H = +(args.h || 864);
const DPR = +(args.dpr || 1.25);
const out = String(args.out || 'qa');
const name = String(args.name || 'shot');
const tier = args.tier && args.tier !== true ? String(args.tier) : 'medium';
const shots = String(args.shots || 'day13,dusk19.5,night22,rain13').split(',');
const quality = +(args.quality || 72);

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  const files = [];
  try {
    await c.viewport(W, H, DPR, false);
    await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
    await c.waitFor("[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 90000);
    await c.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === '${tier.toLowerCase()}')?.click(); true`);
    await c.sleep(300);
    await c.ev("[...document.querySelectorAll('button')].filter((b) => /Start tutorial/.test(b.textContent)).pop().click(); true");
    await c.waitFor('!!(window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug)', 240000);
    await c.sleep(4000);
    await c.ev(`(() => {
      const sc = window.__tiffin.scene; const g = sc.debug.gfx;
      g.holdAdaptation(1e9); try { sc.debug.governor.hold(1e9); } catch {}
      g.setScale(1);
      window.__qaRain = false;
      const orig = sc.setState.bind(sc);
      sc.setState = (s, t) => orig(window.__qaRain && s ? { ...s, events: [...(s.events || []).filter((e) => e.id !== 'rain'), { id: 'rain', until: 1e9 }] } : s, t);
      return true;
    })()`);
    if (!args.hud) await c.ev("document.querySelectorAll('.tc > *:not(canvas)').forEach((e) => { e.style.visibility = 'hidden'; }); true");
    for (const shot of shots) {
      const m = /^([a-z]+)([0-9.]+)$/.exec(shot);
      if (!m) throw new Error('bad shot ' + shot);
      const hour = +m[2];
      await c.ev(`window.__qaRain = ${m[1] === 'rain'}; window.__tiffin.scene.debug.setHour(${hour}); true`);
      await c.sleep(m[1] === 'rain' ? 9000 : 5500); // the env map, the lights and the rain level settle
      const file = path.join(out, `${name}-${shot.replace('.', '_')}.jpg`);
      await c.shot(file, { jpeg: true, quality });
      files.push(file);
    }
    const info = await c.ev('(() => { const g = window.__tiffin.scene.debug.gfx; const i = g.renderer.info; return { tier: g.quality, scale: g.scale, canvasRatio: g.canvasRatio, calls: i.render.calls, programs: i.programs.length }; })()');
    return { files, info };
  } finally {
    c.close();
  }
}

fs.mkdirSync(out, { recursive: true });
const res = args['no-lock'] ? await run() : await withBenchLock(run, { maxWaitMs: 90 * 60 * 1000 });
console.log(JSON.stringify(res));
process.exit(0);
