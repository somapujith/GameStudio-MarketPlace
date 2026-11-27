// Tiffin Centre: the SHADER PROGRAM census. Which materials / objects own the programs, which cache-key tokens split them, and whether any program
// appears after the reveal.
//
//   node scripts/perf/tf-census.mjs --base http://127.0.0.1:5770 --port 9880 [--tier medium] [--level 1] [--seconds 60] [--json out.json] [--strict] [--no-lock]
//   (--strict: exit 1 when any shader program is created after the reveal)
//
// --level 0 (default) plays the tutorial; --level N starts practice level N (customers, dishes, events and weather appear by themselves).
// Samples renderer.info.programs / calls once a second after `window.__tiffin` exists (= after the reveal) and reports every second in which a program was
// created (a compile the player would feel), then the census: programs by shader name, by owner group, the cache-key tokens that vary, and the programs no
// live material references any more.
import fs from 'node:fs';
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';
import { formatCensus, programCensus } from '../../src/platform/gfx/warmup.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = args.base || 'http://127.0.0.1:5770';
const port = +(args.port || 9880);
const tier = args.tier && args.tier !== true ? String(args.tier) : '';
const level = +(args.level || 0);
const seconds = +(args.seconds || 60);

const SNAP = `(() => {
  const d = window.__tiffin.scene.debug; const R = d.gfx.renderer; const scene = d.gfx.scene;
  const props = R.properties;
  const progs = R.info.programs.map((p) => ({ id: p.id, name: p.name, cacheKey: p.cacheKey, usedTimes: p.usedTimes }));
  const byProg = new Map();
  const top = (o) => { const path = []; for (let p = o; p && p !== scene; p = p.parent) path.unshift(p.name || p.type); return path.slice(0, 2).join('/'); };
  scene.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      const pr = props.get(m); const cp = pr && pr.currentProgram; if (!cp) continue;
      let e = byProg.get(cp.id); if (!e) byProg.set(cp.id, (e = { mats: new Set(), owners: {}, types: {}, instanced: 0, skinned: 0 }));
      e.mats.add(m); const k = top(o).replace(/#\\d+/g, ''); e.owners[k] = (e.owners[k] || 0) + 1; e.types[m.type] = 1;
    }
  });
  const used = progs.map((p) => { const e = byProg.get(p.id); return { id: p.id, name: p.name, mats: e ? e.mats.size : 0, owners: e ? Object.keys(e.owners).slice(0, 4).join(',') : '', types: e ? Object.keys(e.types).join('+') : '' }; });
  const late = progs.filter((p) => !window.__known.has(p.id)).map((p) => { const e = byProg.get(p.id); return { id: p.id, key: p.cacheKey.split(',').slice(0, 3).join(',') + ' ... ' + p.cacheKey.split(',').slice(-4).join(','), owners: e ? Object.keys(e.owners).join(',') : '', types: e ? Object.keys(e.types).join('+') : '' }; });
  return { late, programs: progs, used, calls: R.info.render.calls, tris: R.info.render.triangles, scale: d.gfx.scale, quality: d.gfx.quality, reveal: d.reveal || null };
})()`;

async function run() {
  const c = await launch({ port, w: +(args.w || 1536), h: +(args.h || 864), gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(+(args.w || 1536), +(args.h || 864), +(args.dpr || 1.25), false);
    // level > 0 needs the tutorial done; levels above the first need stars (the bare, pre-envelope progress format is still read)
    const best = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i + 1, { stars: 3, earned: 1000 }]));
    if (level > 0) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('jalebi.tutorial.v1.tiffin-centre', '1'); localStorage.setItem('jalebi.progress.v1.tiffin-centre', ${JSON.stringify(JSON.stringify({ best }))}); } catch {}` });
    await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
    await c.waitFor(level > 0 ? "!!document.querySelector('.tc-menu-lvl__btn')" : "[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 90000);
    if (tier) {
      await c.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === '${tier.toLowerCase()}')?.click(); true`);
      await c.sleep(300);
    }
    if (level > 0) {
      const btns = await c.ev("document.querySelectorAll('.tc-menu-lvl__btn').length");
      await c.ev(`document.querySelectorAll('.tc-menu-lvl__btn')[${Math.min(btns - 1, level - 1)}].click(); true`);
      await c.waitFor("[...document.querySelectorAll('button')].some((b) => /Open the stall/.test(b.textContent))", 30000);
      await c.ev("[...document.querySelectorAll('button')].find((b) => /Open the stall/.test(b.textContent)).click(); true");
    } else await c.ev("[...document.querySelectorAll('button')].filter((b) => /Start tutorial/.test(b.textContent)).pop().click(); true");
    const t0 = Date.now();
    await c.waitFor('!!(window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug)', 240000);
    const readyAfter = Date.now() - t0;
    const timeline = [];
    let first = null;
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      const s = await c.ev('(() => { const R = window.__tiffin.scene.debug.gfx.renderer; if (!window.__known) window.__known = new Set(R.info.programs.map((p) => p.id)); return { n: R.info.programs.length, calls: R.info.render.calls }; })()');
      if (!first) first = s.n;
      timeline.push([Math.round((Date.now() - t0 - readyAfter) / 100) / 10, s.n, s.calls]);
      await c.sleep(1000);
    }
    const snap = await c.ev(SNAP);
    return { readyAfter, programsAtReveal: first, timeline, snap, errors: c.logs.slice(0, 5) };
  } finally {
    c.close();
  }
}

const res = args['no-lock'] ? await run() : await withBenchLock(run, { maxWaitMs: 60 * 60 * 1000 });
if (args.json) fs.writeFileSync(String(args.json), JSON.stringify(res, null, 1));
const { snap } = res;
const growth = [];
for (let i = 1; i < res.timeline.length; i++) if (res.timeline[i][1] > res.timeline[i - 1][1]) growth.push(`t+${res.timeline[i][0]}s +${res.timeline[i][1] - res.timeline[i - 1][1]}`);
console.log(`tier ${snap.quality} scale ${snap.scale}; reveal at ${res.readyAfter} ms after the wait started; programs at the reveal ${res.programsAtReveal}, after ${seconds} s ${snap.programs.length}; calls ${snap.calls}; tris ${snap.tris}`);
if (snap.late.length) console.log(['late programs:', ...snap.late.map((l) => `  #${l.id} ${l.types} ${l.owners} ${l.key}`)].join('\n'));
console.log(`programs created after the reveal: ${growth.length ? growth.join(', ') : 'none'}`);
// the game's own counter (scene.debug.reveal: programs the renderer holds now that it did not hold when the loading screen went)
const revealLate = snap.reveal ? snap.reveal.count : 0;
if (snap.reveal) console.log(`scene.debug.reveal: ${snap.reveal.atReveal} programs at the reveal, ${revealLate} created since${revealLate ? ': ' + snap.reveal.late.map((p) => `#${p.id} ${p.name || p.key}`).join(', ') : ''}`);
if (args.strict && (growth.length || revealLate)) {
  console.log('STRICT: a shader program was compiled after the reveal');
  process.exitCode = 1;
}
const live = snap.used.filter((u) => u.mats > 0);
console.log(`live programs ${live.length}, dead ${snap.used.length - live.length}`);
const byOwner = {};
for (const u of live) for (const o of u.owners.split(',').filter(Boolean).slice(0, 1)) byOwner[o] = (byOwner[o] || 0) + 1;
console.log('live programs by first owner: ' + JSON.stringify(byOwner));
const byType = {};
for (const u of live) byType[`${u.name}/${u.types}`] = (byType[`${u.name}/${u.types}`] || 0) + 1;
console.log('live programs by shader/material type: ' + JSON.stringify(byType));
console.log(formatCensus(programCensus(snap.programs, { maxDiff: 1, maxPairs: 30 })));
if (res.errors.length) console.log('console: ' + res.errors.join(' | '));
process.exit(process.exitCode || 0);
