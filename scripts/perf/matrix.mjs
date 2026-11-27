// Runs several perf-script invocations under ONE hold of the machine-wide bench lock (the lock is a queue of many people: six separate
// bench.mjs runs can spend an hour waiting, while the same six in one hold take five minutes). Hold at most ~8 minutes: the lock is treated as
// abandoned after 10, and never kill this process while it holds the lock (the lock directory would stay until it expires).
//
//   node scripts/perf/matrix.mjs --spec runs.json [--maxwait 240] [--dry]   (--dry prints the commands and does not take the lock)
//
// runs.json: { "script": "bench.mjs", "common": ["--game", "autowala"], "runs": [["--base", "http://127.0.0.1:5861", "--label", "a"], ["--tier", "low"]] }
// (a JSON file, because a run's arguments start with `--` and cannot be passed as one option value). Every run is
// `node scripts/perf/<script> <common> <run> --no-lock` (bench.mjs, aw-probe.mjs, aw-ab.mjs and aw-hitch.mjs accept --no-lock); its stdout goes to
// this process's stdout behind a header line. A failing run is reported and the next one still runs. The script name is checked against the
// perf folder, so a spec cannot run anything else.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
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
if (!args.spec || args.spec === true) {
  console.error('usage: node scripts/perf/matrix.mjs --spec runs.json [--maxwait minutes]');
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(String(args.spec), 'utf8'));
const scriptName = String(spec.script || 'bench.mjs');
if (!/^[\w-]+\.mjs$/.test(scriptName) || !fs.existsSync(path.join(here, scriptName))) {
  console.error(`unknown script ${scriptName}`);
  process.exit(2);
}
const script = path.join(here, scriptName);
const common = (spec.common || []).map(String);
const runs = (spec.runs || []).map((r) => r.map(String));
if (!runs.length) {
  console.error('no runs in the spec');
  process.exit(2);
}

if (args.dry) {
  for (const r of runs) console.log(['node', script, ...common, ...r, '--no-lock'].join(' '));
  process.exit(0);
}

const exec = (list) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...common, ...list, '--no-lock'], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.on('exit', (code) => resolve(code));
    child.on('error', () => resolve(-1));
  });

// the queue for the lock is long on a shared machine: wait up to --maxwait minutes (default 240) instead of the library's 25
await withBenchLock(
  async () => {
    for (const [i, r] of runs.entries()) {
      console.log(`--- run ${i + 1}/${runs.length}: ${r.join(' ')}`);
      const code = await exec(r);
      if (code) console.log(`--- run ${i + 1} exited with ${code}`);
    }
    console.log('--- all runs done');
  },
  { maxWaitMs: +(args.maxwait || 240) * 60 * 1000 },
);
process.exit(0);
