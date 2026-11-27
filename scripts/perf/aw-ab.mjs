// Interleaved A/B on one page session: the machine is shared and its speed drifts by 20-40 % over a minute, so two builds (or two settings) are
// only comparable when they are measured ROUND-ROBIN, a few seconds each, in the same page. Every variant is a snippet of JS run in the game page
// (window.__autowala is the game); each round applies one variant, lets it settle, and measures the frame times (rAF deltas), the CPU time of
// gfx.render and the GPU time of the frame (the game's own EXT_disjoint_timer_query). The result is the median over rounds per variant.
//
//   node scripts/perf/aw-ab.mjs --base http://127.0.0.1:5863 --port 9912 --tier medium --poi charminar --hour 19.2 \
//        --variants "base=|scale.7=gfx.setScale(0.7)|bloom0=gfx.post.setLevels(0)" [--rounds 4] [--seconds 3] [--settle 1.2] [--soft --no-lock]
//
// Named presets (use the name alone, or name=custom snippet): see PRESETS. Each variant's `reset` is the next variant's baseline: a variant is
// applied on top of "base" (every round starts by running the reset snippet of the previous one).
import fs from 'node:fs';
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = args.base || 'http://127.0.0.1:5863';
const W = +(args.w || 1536);
const H = +(args.h || 864);
const DPR = +(args.dpr || 1.25);
const ROUNDS = +(args.rounds || 4);
const SEC = +(args.seconds || 3);
const SETTLE = +(args.settle || 1.2);
const tier = args.tier && args.tier !== true ? String(args.tier) : 'medium';
const port = +(args.port || 9912);

/** name -> [apply, reset]. `tune(q, {...})` sets the live tier overrides renderer.js reads through tier(). */
const T = (o) => `globalThis.__awTune = { ...(globalThis.__awTune || {}), ${tier}: { ...((globalThis.__awTune || {}).${tier} || {}), ${o} } }`;
const PRESETS = {
  base: ['', ''],
  'scale.8': ['gfx.setScale(0.8)', 'gfx.setScale(1)'],
  'scale.6': ['gfx.setScale(0.6)', 'gfx.setScale(1)'],
  'scale.5': ['gfx.setScale(0.5)', 'gfx.setScale(1)'],
  bloom0: ['gfx.post.setLevels(0)', `gfx.post.setLevels(${tier === 'high' ? 5 : 4})`],
  bloom2: ['gfx.post.setLevels(2)', `gfx.post.setLevels(${tier === 'high' ? 5 : 4})`],
  shadow50: [T('shadowInterval: 0.05'), T('shadowInterval: 0.024')],
  shadow100: [T('shadowInterval: 0.1'), T('shadowInterval: 0.024')],
  shadow1024: ['g.world.sky.setShadows(1024, true)', 'g.world.sky.setShadows(gfx.cfg.shadow, true)'],
  noshadow: ['g.world.sky.setShadows(2048, false)', 'g.world.sky.setShadows(gfx.cfg.shadow, true)'],
  lights0: ['g.world.props.setLightCount(0)', 'g.world.props.setLightCount(3)'],
  lights1: ['g.world.props.setLightCount(1)', 'g.world.props.setLightCount(3)'],
  lights2: ['g.world.props.setLightCount(2)', 'g.world.props.setLightCount(3)'],
  notraffic: ['g.ctx.gfx.cfg.traffic = 0; g.ctx.gfx.cfg.peds = 0', 'g.ctx.gfx.cfg.traffic = 36; g.ctx.gfx.cfg.peds = 170'],
};
const specs = String(args.variants || 'base|scale.5|bloom0|shadow50|noshadow|lights0')
  .split('|')
  .map((s) => {
    const [name, ...rest] = s.split('=');
    const custom = rest.join('=');
    const preset = PRESETS[name.trim()];
    return { name: name.trim(), apply: custom || (preset ? preset[0] : ''), reset: preset ? preset[1] : '' };
  });

const START = async (c) => {
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); if (String(k).startsWith('jalebi.autowala.v')) { try { const d = JSON.parse(v || '{}'); d.settings = { ...(d.settings || {}), quality: '${tier}' }; return JSON.stringify(d); } catch { return v; } } return v; }; })();` });
  await c.goto(`${base}/play/autowala`);
  await c.waitFor("!!document.querySelector('.aw-go')", 240000);
  await c.ev("document.querySelector('.aw-go').click()");
  await c.waitFor('!!window.__autowala', 120000);
  await c.ev('window.__autowala.gfx.autoTier = false; true'); // hold tier and scale: the variants are the only thing that changes
  await c.ev(`(() => { const g = window.__autowala; g.debug.drive(null); const p = g.world.city.poiById[${JSON.stringify(String(args.poi || 'charminar'))}]; const f = p.front || p; g.debug.teleport(f.x, f.z, 0); g.debug.weather(${+(args.weather || 0)}); const hr = ${+(args.hour || 19.2)}; g.debug.hour(hr); clearInterval(window.__pinT); window.__pinT = setInterval(() => g.debug.hour(hr), 100); return true; })()`);
};

const MEASURE = (seconds) => `(async () => {
  const g = window.__autowala; const gfx = g.gfx; const timer = g.adaptive && g.adaptive.timer;
  const dts = []; const gpu = []; let cpu = 0; let n = 0;
  const r0 = gfx.render; gfx.render = (dt) => { const t = performance.now(); r0(dt); cpu += performance.now() - t; n++; };
  let last = performance.now(); const end = last + ${seconds} * 1000;
  await new Promise((res) => { const f = (t) => { dts.push(t - last); last = t; if (timer && timer.lastMs > 0) gpu.push(timer.lastMs); if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  gfx.render = r0; dts.shift();
  const s = dts.slice().sort((a, b) => a - b); const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
  return { frames: dts.length, mean, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1], over50: dts.filter((d) => d > 50).length, cpuRender: n ? cpu / n : 0, gpu: gpu.length ? gpu.reduce((a, b) => a + b, 0) / gpu.length : -1, calls: gfx.cost.calls, shadowCalls: gfx.cost.shadowCalls, programs: gfx.cost.programs };
})()`;

const med = (a) => {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(W, H, DPR, false);
    await START(c);
    await c.sleep(+(args.warm || 6) * 1000);
    const ctxPrefix = 'const g = window.__autowala; const gfx = g.gfx;';
    const apply = (code) => c.ev(`(() => { ${ctxPrefix} ${code}; return true; })()`);
    // build every variant's programs once (a variant that changes the light set compiles on first use): not part of any measurement
    for (const v of specs) {
      await apply(v.apply);
      await c.sleep(2500);
      await apply(v.reset);
    }
    await c.sleep(1000);
    const rows = new Map(specs.map((v) => [v.name, []]));
    for (let r = 0; r < ROUNDS; r++) {
      for (const v of specs) {
        await apply(v.apply);
        await c.sleep(SETTLE * 1000);
        rows.get(v.name).push(await c.ev(MEASURE(SEC)));
        await apply(v.reset);
      }
    }
    const out = specs.map((v) => {
      const m = rows.get(v.name);
      const k = (key) => +med(m.map((x) => x[key])).toFixed(2);
      return { variant: v.name, rounds: m.length, fps: +(1000 / k('mean')).toFixed(1), meanMs: k('mean'), p50: k('p50'), p99: k('p99'), over50: m.reduce((a, x) => a + x.over50, 0), cpuRenderMs: k('cpuRender'), gpuMs: k('gpu'), calls: k('calls'), shadowCalls: k('shadowCalls'), per: m.map((x) => +x.mean.toFixed(1)) };
    });
    return { label: String(args.label || tier), tier, viewport: `${W}x${H}@${DPR}`, poi: args.poi || 'charminar', hour: +(args.hour || 19.2), gpu: await c.ev("(() => { const gl = window.__autowala.gfx.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })()"), out, errors: c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource/.test(l)).slice(0, 6) };
  } finally {
    c.close();
  }
}

const res = args['no-lock'] ? await run() : await withBenchLock(run);
console.log(JSON.stringify({ ...res, out: undefined }));
console.log('variant      fps    mean   p50    p99   over50  cpu(render)  gpu    calls  per-round mean');
for (const r of res.out) console.log(`${r.variant.padEnd(12)} ${String(r.fps).padStart(5)} ${String(r.meanMs).padStart(6)} ${String(r.p50).padStart(6)} ${String(r.p99).padStart(6)} ${String(r.over50).padStart(6)} ${String(r.cpuRenderMs).padStart(11)} ${String(r.gpuMs).padStart(6)} ${String(r.calls).padStart(6)}  ${r.per.join(' ')}`);
if (args.out && args.out !== true) fs.writeFileSync(String(args.out), JSON.stringify(res, null, 1));
process.exit(0);
