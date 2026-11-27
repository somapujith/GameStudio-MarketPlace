// What survives leaving Autowala? Enters and leaves the game N times in one tab (client-side navigation), takes a heap snapshot after the 1st and
// after the last visit (after a forced GC) and prints the classes / closures whose count and size grew.
//   node scripts/perf/aw-heapdiff.mjs --base http://127.0.0.1:5730 --port 9770 --tier low --cycles 4
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GPU_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';
import { takeClasses as snapshot } from './heapsnap.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const base = args.base || 'http://127.0.0.1:5730';
const port = +(args.port || 9770);
const tier = args.tier && args.tier !== true ? String(args.tier) : 'low';
const cycles = +(args.cycles || 4);
const play = +(args.play || 0); // seconds of driving per visit (a scripted steer / throttle), 0 = stand on the start screen / idle

const run = async () => {
  const c = await launch({ port, w: 1536, h: 864, gl: GPU_FLAGS });
  try {
    await c.viewport(1536, 864, 1.25, false);
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); if (String(k).startsWith('jalebi.autowala.v')) { try { const d = JSON.parse(v || '{}'); d.settings = { ...(d.settings || {}), quality: '${tier}' }; return JSON.stringify(d); } catch { return v; } } return v; }; })();` });
    await c.send('HeapProfiler.enable');
    await c.send('Page.navigate', { url: `${base}/play/autowala` });
    const enter = async () => {
      await c.waitFor("!!document.querySelector('.aw-go')", 180000);
      await c.ev("document.querySelector('.aw-go').click(); true");
      await c.waitFor('!!window.__autowala', 60000);
      if (play > 0) {
        // drive: the auto weaves along with a slow sine on the steering (it crashes into things, which is also play)
        await c.ev('(() => { const G = window.__autowala; let t = 0; window.__heapDrive = setInterval(() => { t += 0.25; G.debug.drive({ throttle: 0.8, steer: Math.sin(t * 0.6) * 0.5 }); }, 250); return true; })()');
        await c.sleep(play * 1000);
        await c.ev('clearInterval(window.__heapDrive); window.__autowala && window.__autowala.debug.drive(null); true');
      } else await c.sleep(5000);
    };
    const go = (p) => c.ev(`history.pushState({}, '', ${JSON.stringify(p)}); window.dispatchEvent(new PopStateEvent('popstate')); true`);
    await enter();
    let first = null;
    for (let i = 1; i <= cycles; i++) {
      await go('/');
      await c.sleep(2500);
      if (i === 1) first = await snapshot(c);
      if (i < cycles) {
        await go('/play/autowala');
        await enter();
      }
    }
    const last = await snapshot(c);
    const total = (m) => [...m.values()].reduce((a, e) => a + e.size, 0);
    console.log(`heap after the 1st visit ${(total(first) / 1048576).toFixed(1)} MB, after the last ${(total(last) / 1048576).toFixed(1)} MB (objects, closures, arrays, native)`);
    const rows = [];
    for (const [k, v] of last) {
      const a = first.get(k) || { n: 0, size: 0 };
      if (v.n > a.n || v.size > a.size) rows.push({ k, dn: v.n - a.n, dsize: v.size - a.size, n: v.n });
    }
    rows.sort((x, y) => y.dsize - x.dsize);
    console.log(`grew between the first and the last visit (${cycles - 1} visits later), by bytes:`);
    for (const r of rows.slice(0, 30)) console.log(`${String(r.dsize).padStart(9)} B  ${String(r.dn).padStart(6)} objects  (now ${r.n})  ${r.k}`);
    console.log('by count:');
    for (const r of rows.sort((x, y) => y.dn - x.dn).slice(0, 20)) console.log(`${String(r.dn).padStart(6)} objects  ${String(r.dsize).padStart(9)} B  ${r.k}`);
  } finally {
    c.close();
  }
};

await withBenchLock(run);
process.exit(0);
