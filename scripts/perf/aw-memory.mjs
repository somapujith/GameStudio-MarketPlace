// Does the second session start where the first one settled? Plays Autowala for `--seconds` (default 24: the governor writes tier memory after 8 s of stable play),
// reads `jalebi.gfx.v1.autowala` from localStorage, reloads the page IN THE SAME Chrome profile and reports how the second session started (source 'memory', tier, scale,
// whether the calibration ran). Same launch / flags / lock as the other perf scripts.
//
//   node scripts/perf/aw-memory.mjs --base http://127.0.0.1:5866 [--port 9914] [--seconds 24] [--tier low] [--soft] [--no-lock]
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = args.base || 'http://127.0.0.1:5866';
const port = +(args.port || 9914);
const SEC = +(args.seconds || 24);

const STATE = `(() => { const g = window.__autowala; const a = g.adaptive; return { describe: a.describe(), source: a.aq.initial.source, tier: g.gfx.quality, scale: g.gfx.scale, calibrated: !!a.calibration, memory: localStorage.getItem('jalebi.gfx.v1.autowala'), menu: g.ctx.state.menu, gov: (() => { const st = a.governor.stats(); return { stableMs: Math.round(st.stableMs), locked: st.locked, last: st.lastWindow, counts: st.counts, history: st.history.map((h) => h.kind + ' ' + h.from + '->' + h.to + ' @' + h.t + ' ' + h.reason), tierFailures: st.tierFailures, elapsed: Math.round(st.elapsedMs) }; })() }; })()`;

async function run() {
  const c = await launch({ port, w: 1536, h: 864, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(1536, 864, 1.25, false);
    const out = {};
    for (const session of ['first', 'second']) {
      await c.goto(`${base}/play/autowala`);
      await c.waitFor("!!document.querySelector('.aw-go')", 240000);
      out[`${session}Boot`] = await c.ev(STATE);
      await c.ev("document.querySelector('.aw-go').click(); true");
      await c.sleep((session === 'first' ? SEC : 8) * 1000);
      out[`${session}End`] = await c.ev(STATE);
      await c.ev("window.__autowala.dispose && 0; true");
    }
    return out;
  } finally {
    c.close();
  }
}

const res = args['no-lock'] ? await run() : await withBenchLock(run, { maxWaitMs: 240 * 60 * 1000 });
console.log(JSON.stringify(res, null, 1));
process.exit(0);
