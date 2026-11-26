// Proof that the landscape gate works in a real Chrome: the screen shows on an upright touch device, the game loop and the GPU really stop,
// turning the phone resumes it within a frame or two, and desktop is never gated.
//
//   node scripts/perf/landscape-proof.mjs [--base http://127.0.0.1:5800] [--port 9840] [--out docs/perf/landscape] [--uncapped] [--soft] [--no-lock] [--no-shots] [--only autowala|tiffin]
//
// Chrome device emulation: Emulation.setDeviceMetricsOverride with mobile + screenOrientation, touch emulation and a mobile user agent. The
// loop is measured two ways: the number of requestAnimationFrame callbacks the page ran in a window (a patched rAF counts them) and the
// three.js renderer's own `info.render.frame`; the GPU / renderer process CPU time comes from SystemInfo.getProcessInfo on the browser target.
// Default is the real GPU WITH vsync (60 Hz, what a phone does), so CPU / GPU percentages mean something; --uncapped turns vsync and the frame cap off.
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
const base = args.base || 'http://127.0.0.1:5800';
const port = +(args.port || 9840);
const out = String(args.out && args.out !== true ? args.out : 'docs/perf/landscape');
const only = args.only && args.only !== true ? String(args.only) : '';
const shots = !args['no-shots'];
const VSYNC_FLAGS = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

const UA = {
  pixel: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

// every requestAnimationFrame callback the page runs is counted (the page's own copy of the original is kept for the probes)
const PATCH_RAF = `(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__rafOrig = raf;
  window.__raf = 0;
  window.__rafSrc = {};
  window.requestAnimationFrame = (cb) => raf((t) => {
    window.__raf++;
    const k = (cb.name || '') + ' ' + String(cb).slice(0, 70).replace(/\\s+/g, ' ');
    window.__rafSrc[k] = (window.__rafSrc[k] || 0) + 1;
    return cb(t);
  });
})();`;

const report = { base, at: new Date().toISOString(), gpuFlags: args.soft ? 'swiftshader' : args.uncapped ? 'real GPU (ANGLE d3d11), vsync and frame cap off' : 'real GPU (ANGLE d3d11), vsync on', steps: [] };
const log = (name, data) => {
  report.steps.push({ name, ...data });
  console.log(`- ${name}: ${JSON.stringify(data)}`);
};

/** The browser-target client: SystemInfo only exists there. Resolves { cpu() } -> { gpu, renderer } cumulative CPU seconds. */
async function browserClient() {
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d);
        pending.delete(d.id);
      }
    };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    return {
      async cpu() {
        const r = await send('SystemInfo.getProcessInfo');
        const list = (r.result && r.result.processInfo) || [];
        const sum = (t) => list.filter((p) => p.type === t).reduce((a, p) => a + p.cpuTime, 0);
        return { gpu: sum('GPU'), renderer: sum('renderer'), browser: sum('browser') };
      },
      close: () => ws.close(),
    };
  } catch {
    return null;
  }
}

async function main(c) {
  const bc = await browserClient();
  const sleep = c.sleep;
  const shot = async (name, quality = 70) => {
    if (!shots) return;
    await c.shot(path.join(out, `${name}.jpg`), { jpeg: true, quality }); // a 3D scene at 2x needs a lower quality to stay under 150 KB
  };

  /** Emulate a device: size, dpr, touch + mobile UA (or a plain desktop). `portrait` only matters for `screenOrientation`. */
  const device = async ({ w, h, dpr = 1, touch = false, ua = null }) => {
    const portrait = h >= w;
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: dpr,
      mobile: touch,
      ...(touch ? { screenOrientation: { type: portrait ? 'portraitPrimary' : 'landscapePrimary', angle: portrait ? 0 : 90 } } : {}),
    });
    await c.send('Emulation.setTouchEmulationEnabled', touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    if (ua) await c.send('Emulation.setUserAgentOverride', { userAgent: ua });
  };
  const env = () =>
    c.ev(`({
      w: innerWidth, h: innerHeight,
      coarse: matchMedia('(pointer: coarse)').matches, fine: matchMedia('(pointer: fine)').matches, hover: matchMedia('(hover: hover)').matches,
      touchPoints: navigator.maxTouchPoints, orientation: screen.orientation && screen.orientation.type,
      pageTouchAction: getComputedStyle(document.documentElement).touchAction, pageOverscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
      gate: !!document.querySelector('[data-og-gate]'), state: (document.querySelector('[data-og]') || {}).dataset ? document.querySelector('[data-og]').dataset.og : null,
    })`);
  const renderer = (game) => (game === 'autowala' ? 'window.__autowala && window.__autowala.gfx.renderer' : 'window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug && window.__tiffin.scene.debug.gfx.renderer');

  /** What the loop does over `ms`: rAF callbacks run, renderer frames drawn, renderer-process and GPU-process CPU seconds, script time. */
  const loop = async (game, ms = 1500) => {
    await c.send('Performance.enable');
    const m0 = Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const cpu0 = bc ? await bc.cpu() : null;
    const probe = `({ raf: window.__raf, src: { ...window.__rafSrc }, frame: (${renderer(game)} || { info: { render: { frame: 0 } } }).info.render.frame, t: performance.now() })`;
    const a = await c.ev(probe);
    await sleep(ms);
    const b = await c.ev(probe);
    const cpu1 = bc ? await bc.cpu() : null;
    const m1 = Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const secs = (b.t - a.t) / 1000;
    // who is still asking for animation frames: the heaviest callbacks by source text
    const top = Object.entries(b.src)
      .map(([k, n]) => [k, n - (a.src[k] || 0)])
      .filter(([, n]) => n > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 4)
      .map(([k, n]) => `${+(n / secs).toFixed(1)}/s ${k.slice(0, 48)}`);
    return {
      seconds: +secs.toFixed(2),
      rafPerSec: +((b.raf - a.raf) / secs).toFixed(1),
      ...(top.length ? { rafTop: top } : {}),
      framesPerSec: +((b.frame - a.frame) / secs).toFixed(1),
      scriptMsPerSec: +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / secs).toFixed(1),
      taskMsPerSec: +(((m1.TaskDuration - m0.TaskDuration) * 1000) / secs).toFixed(1),
      ...(cpu0 && cpu1 ? { gpuProcCpuPct: +(((cpu1.gpu - cpu0.gpu) / secs) * 100).toFixed(1), rendererProcCpuPct: +(((cpu1.renderer - cpu0.renderer) / secs) * 100).toFixed(1) } : {}),
    };
  };

  /** Rotate and time how long until the gate is gone and the loop has drawn again (in-page timers, so the DevTools round trip is not counted). */
  const rotate = async (game, to) => {
    await c.ev(`(() => {
      window.__lat = null;
      const R = () => ${renderer(game)};
      // capture phase on window: this runs BEFORE the app's own resize listeners, so t0 is the moment the browser announced the new size
      window.addEventListener('resize', () => {
        const t0 = performance.now(); let ticks = 0;
        const f0 = R() ? R().info.render.frame : 0;
        const wasGated = !!document.querySelector('[data-og-gate]');
        window.__lat = { wasGated };
        const poll = () => {
          ticks++;
          const now = +(performance.now() - t0).toFixed(1);
          const gone = !document.querySelector('[data-og-gate]');
          const frames = (R() ? R().info.render.frame : 0) - f0;
          if (wasGated && gone && window.__lat.gateGoneMs == null) { window.__lat.gateGoneMs = now; window.__lat.gateGoneFrames = ticks; }
          if (!wasGated && !gone && window.__lat.gateShownMs == null) { window.__lat.gateShownMs = now; window.__lat.gateShownFrames = ticks; }
          if (frames > 0 && window.__lat.firstDrawMs == null) { window.__lat.firstDrawMs = now; window.__lat.firstDrawFrames = ticks; }
          if (ticks < 120) window.__rafOrig(poll);
        };
        window.__rafOrig(poll);
      }, { once: true, capture: true });
      return true;
    })()`);
    await device(to);
    await sleep(1200);
    return c.ev('window.__lat');
  };

  // ============================================================ Autowala
  if (!only || only === 'autowala') {
    console.log('\n== Autowala');
    const aw = { w: 390, h: 844 };

    // desktop 1280x800: never gated
    await device({ w: 1280, h: 800, dpr: 1 });
    await c.goto(`${base}/play/autowala`);
    await c.waitFor("!!document.querySelector('.aw-go')", 180000);
    await c.ev("document.querySelector('.aw-go').click()");
    await c.waitFor('!!window.__autowala', 60000);
    await sleep(2500);
    log('desktop 1280x800', { env: await env(), loop: await loop('autowala') });
    await shot('autowala-desktop-1280x800');

    // narrow, tall desktop window without touch: never gated
    await device({ w: 600, h: 900, dpr: 1 });
    await sleep(600);
    log('desktop narrow 600x900 (no touch)', { env: await env(), loop: await loop('autowala') });

    // a phone opened upright: the gate shows, and the loop is NOT running
    await device({ w: aw.w, h: aw.h, dpr: 2, touch: true, ua: UA.pixel });
    await c.goto(`${base}/play/autowala`);
    await c.waitFor("!!document.querySelector('[data-og-gate]')", 60000);
    await c.waitFor('!!window.__autowala', 180000);
    await sleep(2500);
    log('phone 390x844 upright, just loaded (the game keeps loading behind the screen; its HUD loops may still run)', { env: await env(), loop: await loop('autowala') });
    await shot('autowala-gate-portrait-390x844');
    await sleep(5000); // past the freeze grace period (orientationFreeze.FREEZE_GRACE_MS = 6 s)
    log('same phone, 9 s upright (frozen)', { loop: await loop('autowala', 2000) });

    // turn it sideways: resumes within a frame or two
    const up = await rotate('autowala', { w: 844, h: 390, dpr: 2, touch: true, ua: UA.pixel });
    await c.ev("document.querySelector('.aw-go') && document.querySelector('.aw-go').click(); window.__autowala.debug.drive({ throttle: 1 }); true");
    await sleep(2500);
    log('rotated to 844x390 (resume)', { latency: up, env: await env(), loop: await loop('autowala') });
    await shot('autowala-landscape-844x390', 62);

    // and back upright mid-game: the loop stops again and the game keeps its state
    const pos = () => c.ev('(() => { const s = window.__autowala.snapshot(); return { kmh: s.kmh, x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10 }; })()');
    const before = await pos();
    const down = await rotate('autowala', { w: aw.w, h: aw.h, dpr: 2, touch: true, ua: UA.pixel });
    await sleep(3500); // the game's one-off render-target resize is over; this is the steady state
    const p1 = await pos();
    const paused = await loop('autowala', 2000);
    const p2 = await pos();
    log('rotated back to 390x844 (pause)', { latency: down, env: await env(), loop: paused, stateBefore: before, whilePausedStart: p1, whilePausedEnd2sLater: p2 });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(500);
    log('same, prefers-reduced-motion (the gate itself animates nothing)', { loop: await loop('autowala', 2000) });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const up2 = await rotate('autowala', { w: 844, h: 390, dpr: 2, touch: true, ua: UA.pixel });
    await sleep(1500);
    log('rotated to 844x390 again: the drive carries on from where it stopped', { latency: up2, resumedAt: await pos(), loop: await loop('autowala') });

    // a tablet held upright is gated too
    await device({ w: 820, h: 1180, dpr: 2, touch: true, ua: UA.ipad });
    await sleep(800);
    log('tablet 820x1180 upright', { env: await env(), loop: await loop('autowala', 1000) });
    await shot('autowala-gate-tablet-820x1180');
  }

  // ============================================================ Tiffin Centre
  if (!only || only === 'tiffin') {
    console.log('\n== Tiffin Centre');
    const startTutorial = async () => {
      await c.waitFor("[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 90000);
      await c.ev("[...document.querySelectorAll('button')].filter((b) => /Start tutorial/.test(b.textContent)).pop().click(); true");
      await c.waitFor('!!(window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug)', 180000);
    };

    // desktop: never gated, even in a narrow window
    await device({ w: 1280, h: 800, dpr: 1 });
    await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
    await startTutorial();
    await sleep(3000);
    log('desktop 1280x800', { env: await env(), loop: await loop('tiffin') });
    await device({ w: 600, h: 900, dpr: 1 });
    await sleep(600);
    log('desktop narrow 600x900 (no touch)', { env: await env(), loop: await loop('tiffin') });

    // a phone opened upright: the solo home is gated; turn it, start the tutorial, then turn it upright mid-shift
    await device({ w: 390, h: 844, dpr: 2, touch: true, ua: UA.iphone });
    await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
    await c.waitFor("!!document.querySelector('[data-og-gate]')", 60000);
    await sleep(800);
    log('phone 390x844 upright, solo home', { env: await env() });
    await shot('tiffin-gate-portrait-390x844');

    await device({ w: 844, h: 390, dpr: 2, touch: true, ua: UA.iphone });
    await startTutorial();
    await sleep(4000);
    const live = await loop('tiffin');
    const tf = () => c.ev('({ status: window.__tiffin.session.status, soundMuted: window.__tiffin.audio && window.__tiffin.audio.isMuted && window.__tiffin.audio.isMuted() })');
    const s0 = await tf();
    log('landscape 844x390, tutorial running', { env: await env(), loop: live, session: s0 });
    await shot('tiffin-landscape-844x390', 58);

    const down = await rotate('tiffin', { w: 390, h: 844, dpr: 2, touch: true, ua: UA.iphone });
    await sleep(3500);
    const paused = await loop('tiffin', 2000);
    const s1 = await tf();
    log('rotated to 390x844 mid-shift (pause)', { latency: down, env: await env(), loop: paused, session: s1 });

    const up = await rotate('tiffin', { w: 844, h: 390, dpr: 2, touch: true, ua: UA.iphone });
    await sleep(1500);
    const again = await loop('tiffin');
    const s2 = await tf();
    log('rotated back to 844x390 (resume)', { latency: up, env: await env(), loop: again, session: s2 });
  }
  if (bc) bc.close();
}

const run = async () => {
  const c = await launch({ port, w: 1280, h: 800, gl: args.soft ? SOFT_FLAGS : args.uncapped ? GPU_FLAGS : VSYNC_FLAGS });
  try {
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PATCH_RAF });
    await main(c);
    report.errors = c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource/.test(l)).slice(0, 12);
  } finally {
    c.close();
  }
};
if (args['no-lock']) await run();
else await withBenchLock(run);
console.log('\n' + JSON.stringify(report.errors || []));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(process.env.TEMP || process.env.TMPDIR || '.', 'landscape-proof.json'), JSON.stringify(report, null, 2));
process.exit(0);
