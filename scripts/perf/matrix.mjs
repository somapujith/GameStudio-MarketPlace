// Runs several perf-script invocations under ONE hold of the machine-wide bench lock (the lock is a queue of many people: six separate
// bench.mjs runs can spend an hour waiting, while the same six in one hold take five minutes). Hold at most ~8 minutes: the lock is treated as
// abandoned after 10.
//
//   node scripts/perf/matrix.mjs --script bench.mjs --common "--game autowala --base http://127.0.0.1:5861" --runs "--tier low --label a | --label b --w 1920 --h 1080 --dpr 1"
//
// Every run is `node scripts/perf/<script> <common> <run> --no-lock` (the script must accept --no-lock: bench.mjs, aw-probe.mjs, aw-hitch.mjs do); its
// stdout goes to this process's stdout, prefixed by a header line. A failing run is reported and the next one still runs.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, String(args.script || 'bench.mjs'));
const split = (s) => String(s || '').match(/"[^"]*"|'[^']*'|\S+/g)?.map((t) => t.replace(/^["']|["']$/g, '')) ?? [];
const common = split(args.common);
const runs = String(args.runs || '').split('|').map((r) => split(r)).filter((r) => r.length);

const exec = (list) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...common, ...list, '--no-lock'], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.on('exit', (code) => resolve(code));
    child.on('error', () => resolve(-1));
  });

await withBenchLock(async () => {
  for (const [i, r] of runs.entries()) {
    console.log(`--- run ${i + 1}/${runs.length}: ${r.join(' ')}`);
    const code = await exec(r);
    if (code) console.log(`--- run ${i + 1} exited with ${code}`);
  }
});
process.exit(0);
