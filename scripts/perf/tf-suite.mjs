// Back-to-back A/B runs of Tiffin Centre builds under ONE bench lock (a lock wait can be many minutes when other people are benchmarking).
//
//   node scripts/perf/tf-suite.mjs --variants before=C:/tmp/before,after=C:/tmp/after [--port 5770] [--cdp 9810] [--passes 2] [--seconds 25]
//        [--tier medium] [--profile] [--out results.json] [--no-lock]
//
// For every variant it starts `vite preview` on --port for that build folder, runs scripts/perf/tf-load.mjs's loadRun (cold shader cache, then a warm one
// with --passes 2) and stops the server it started (only that PID). Prints one report per run and writes all rows to --out.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBenchLock } from './lock.mjs';
import { loadRun, report, summarise } from './tf-load.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const variants = String(args.variants || '').split(',').filter(Boolean).map((v) => {
  const i = v.indexOf('=');
  return { name: v.slice(0, i), dir: v.slice(i + 1) };
});
if (!variants.length) {
  console.error('--variants name=dir,name2=dir2 is required');
  process.exit(2);
}
let port = +(args.port || 0); // 0: any free port (never collides with somebody else's preview server)
const cdp = +(args.cdp || 9810);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const p = srv.address().port;
    srv.close(() => resolve(p));
  });
});

async function serve(dir) {
  if (!port) port = await freePort();
  const child = spawn(process.execPath, [vite, 'preview', '--outDir', dir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.ok) return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  try { child.kill(); } catch { /* gone */ }
  throw new Error('preview did not start for ' + dir);
}

async function all() {
  const rows = [];
  for (const v of variants) {
    const child = await serve(v.dir);
    try {
      const res = await loadRun({ base: `http://127.0.0.1:${port}`, port: cdp, label: v.name, tier: args.tier, seconds: args.seconds || 25, profile: !!args.profile, passes: args.passes || 1 });
      for (const { row, profile } of res) {
        const prof = profile ? summarise(profile) : null;
        console.log(report(row, prof));
        console.log('');
        rows.push({ ...row, profile: prof });
        if (profile && args.out) fs.writeFileSync(String(args.out).replace(/\.json$/, `-${row.label}.cpuprofile`), JSON.stringify(profile));
      }
    } finally {
      try { child.kill(); } catch { /* gone */ }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return rows;
}

const rows = args['no-lock'] ? await all() : await withBenchLock(all, { maxWaitMs: 60 * 60 * 1000 });
if (args.out) fs.writeFileSync(String(args.out), JSON.stringify(rows, null, 1));
console.log('| run | ready ms | first frame ms | long tasks | long task ms | worst ms | long tasks after 3 s | frames > 50 ms after 3 s | programs | calls |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const m = Object.fromEntries(r.marks);
  console.log(`| ${r.label} | ${r.readyMs} | ${m['tc:first-frame'] ?? r.firstRaf} | ${r.longTaskCount} | ${r.longTaskMs} | ${r.worstLongTask} | ${r.longTasksAfter3s} (${r.longTaskMsAfter3s} ms) | ${r.over50After3s} (${r.over50MsAfter3s} ms) | ${r.programs} | ${r.calls} |`);
}
process.exit(0);
