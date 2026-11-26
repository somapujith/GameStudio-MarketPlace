// What survives leaving Autowala? Enters and leaves the game N times in one tab (client-side navigation), takes a heap snapshot after the 1st and
// after the last visit (after a forced GC) and prints the classes / closures whose count and size grew.
//   node scripts/perf/aw-heapdiff.mjs --base http://127.0.0.1:5730 --port 9770 --tier low --cycles 4
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GPU_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const base = args.base || 'http://127.0.0.1:5730';
const port = +(args.port || 9770);
const tier = args.tier && args.tier !== true ? String(args.tier) : 'low';
const cycles = +(args.cycles || 4);

/** Heap snapshot -> Map(name -> { n, size }) for objects and closures (the flat `nodes` array, see the V8 heap snapshot format). */
async function snapshot(c) {
  const chunks = [];
  const off = c.on;
  let handler;
  const done = new Promise((resolve) => {
    handler = (d) => { if (d.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(d.params.chunk); };
    off(handler);
    resolve();
  });
  await done;
  await c.send('HeapProfiler.collectGarbage');
  await c.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  const snap = JSON.parse(chunks.join(''));
  const f = snap.snapshot.meta.node_fields;
  const types = snap.snapshot.meta.node_types[0];
  const stride = f.length;
  const iT = f.indexOf('type');
  const iN = f.indexOf('name');
  const iS = f.indexOf('self_size');
  const out = new Map();
  for (let i = 0; i < snap.nodes.length; i += stride) {
    const t = types[snap.nodes[i + iT]];
    if (t !== 'object' && t !== 'closure' && t !== 'array' && t !== 'native') continue;
    const key = `${t}:${snap.strings[snap.nodes[i + iN]]}`.slice(0, 90);
    const e = out.get(key) || { n: 0, size: 0 };
    e.n++;
    e.size += snap.nodes[i + iS];
    out.set(key, e);
  }
  return out;
}

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
      await c.sleep(5000);
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
