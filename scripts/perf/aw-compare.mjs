// Before / after table from two aw-hitch.mjs JSON reports (--json):
//   node scripts/perf/aw-compare.mjs before.json after.json [more-before.json more-after.json ...]
// One row per scenario and metric, markdown on stdout. Pairs of files are compared one after the other (e.g. auto, low, medium, high).
import fs from 'node:fs';

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const pairs = [];
const files = process.argv.slice(2);
for (let i = 0; i + 1 < files.length; i += 2) pairs.push([files[i], files[i + 1]]);
if (!pairs.length) {
  console.error('usage: aw-compare.mjs before.json after.json [...]');
  process.exit(1);
}

const METRICS = [
  ['fps', 'fps'],
  ['meanMs', 'mean frame ms'],
  ['p99', 'p99 ms'],
  ['maxMs', 'worst frame ms'],
  ['hitches50', 'frames > 50 ms'],
  ['hitches100', 'frames > 100 ms'],
  ['longTasks', 'long tasks (> 50 ms)'],
  ['programsCreated', 'shader programs built'],
];
const val = (v) => (v === undefined || v === null ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v));

for (const [bf, af] of pairs) {
  const b = read(bf);
  const a = read(af);
  console.log(`\n### ${a.label} vs ${b.label} (tier ${a.tier}, ${a.viewport})\n`);
  console.log('| scenario | metric | before | after |');
  console.log('|---|---|---:|---:|');
  const boot = (r) => ({ 'boot ms (game build)': r.boot && r.boot.ms, 'first-frame stall ms (game start)': r.bootPhase && r.bootPhase.maxMs, 'long tasks while loading': r.bootPhase && r.bootPhase.longTasksAll, 'long-task ms while loading': r.bootPhase && r.bootPhase.longTaskMsAll, 'worst long task while loading ms': r.bootPhase && r.bootPhase.worstLong });
  const bb = boot(b);
  const ba = boot(a);
  for (const k of Object.keys(bb)) console.log(`| boot | ${k} | ${val(bb[k])} | ${val(ba[k])} |`);
  if (b.startScreen || a.startScreen) {
    for (const [k, name] of [['maxMs', 'worst frame ms'], ['hitches50', 'frames > 50 ms']]) console.log(`| start menu | ${name} | ${val(b.startScreen && b.startScreen[k])} | ${val(a.startScreen && a.startScreen[k])} |`);
  }
  for (const name of new Set([...Object.keys(b.scenarios), ...Object.keys(a.scenarios)])) {
    const sb = b.scenarios[name] || {};
    const sa = a.scenarios[name] || {};
    for (const [k, label] of METRICS) {
      if (sb[k] === undefined && sa[k] === undefined) continue;
      console.log(`| ${name} | ${label} | ${val(sb[k])} | ${val(sa[k])} |`);
    }
    if (sb.react || sa.react) console.log(`| ${name} | React components rendered per second | ${val(sb.react && +(sb.react.commitsPerSec * sb.react.componentsPerCommit).toFixed(0))} | ${val(sa.react && +(sa.react.commitsPerSec * sa.react.componentsPerCommit).toFixed(0))} |`);
  }
}
