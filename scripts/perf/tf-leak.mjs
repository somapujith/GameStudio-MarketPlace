// Tiffin Centre leak and soak checks.
//
//   node scripts/perf/tf-leak.mjs --mode cycle --base http://127.0.0.1:5770 --port 9815 [--n 5] [--tier medium] [--level 0|1] [--json out.json] [--no-lock]
//   node scripts/perf/tf-leak.mjs --mode soak  --base ... --port 9815 [--minutes 5] [--sample 30] [--tier medium]
//
// cycle: start a shift, let it run a few seconds, leave through the pause menu, wait, force GC, and repeat N times in ONE page (single-page navigation, no
//        reload). Per cycle it prints: renderer.info.memory (geometries / textures) and programs of the live scene, the JS heap after a forced GC, DOM nodes,
//        event listeners (CDP DOMDebugger via Memory.getDOMCounters) and the live WebGL objects of every context ever created (counted by patching the
//        create / delete calls). A healthy build returns to the baseline after leaving: 0 live WebGL objects on contexts that are not the current one.
// soak:  one practice shift (level 1, played by the bot `__tiffin.bot` = chooseAutoAction) for --minutes, sampling heap (after GC), renderer.info.memory,
//        programs, JS event-listener count and frame times every --sample seconds. Heap must not grow.
// Needs a production build served by vite preview (`?tcdebug=1` exposes window.__tiffin).
import fs from 'node:fs';
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = args.base || 'http://127.0.0.1:5770';
const port = +(args.port || 9815);
const tier = args.tier && args.tier !== true ? String(args.tier) : '';
const mode = args.mode || 'cycle';

// counts WebGL objects per context: created - deleted (a lost / destroyed context's objects are gone with it)
const INIT = `(() => {
  window.__ctxs = [];
  const kinds = ['Texture', 'Buffer', 'Framebuffer', 'Renderbuffer', 'Program', 'Shader', 'VertexArray', 'Sampler', 'Query'];
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    for (const k of kinds) {
      const create = C.prototype['create' + k]; const del = C.prototype['delete' + k];
      if (!create || !del) continue;
      C.prototype['create' + k] = function (...a) { const o = create.apply(this, a); const s = this.__st || (this.__st = (window.__ctxs.push(this), {})); if (o) s[k] = (s[k] || 0) + 1; return o; };
      C.prototype['delete' + k] = function (o) { const s = this.__st || (this.__st = (window.__ctxs.push(this), {})); if (o) s[k] = (s[k] || 0) - 1; return del.call(this, o); };
    }
  }
  window.__glLive = () => window.__ctxs.map((c) => ({ lost: c.isContextLost(), live: c.__st }));
})();`;

const SAMPLE = `(async () => {
  const t = window.__tiffin;
  const R = t && t.scene && t.scene.debug && t.scene.debug.gfx.renderer;
  return {
    geometries: R ? R.info.memory.geometries : null, textures: R ? R.info.memory.textures : null, programs: R ? R.info.programs.length : null,
    contexts: window.__glLive ? window.__glLive() : null,
  };
})()`;

async function gc(c) {
  await c.send('HeapProfiler.enable');
  for (let i = 0; i < 3; i++) {
    await c.send('HeapProfiler.collectGarbage');
    await c.sleep(150);
  }
  const u = await c.send('Runtime.getHeapUsage');
  const d = await c.send('Memory.getDOMCounters');
  // the listeners on window and document, by type (a leaked effect shows up as a type that grows from cycle to cycle)
  const lis = {};
  for (const expr of ['window', 'document']) {
    try {
      const { result } = await c.send('Runtime.evaluate', { expression: expr });
      const { listeners } = await c.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      for (const l of listeners) lis[`${expr}.${l.type}`] = (lis[`${expr}.${l.type}`] || 0) + 1;
    } catch { /* not available */ }
  }
  return { heapMB: +(u.usedSize / 1048576).toFixed(1), domNodes: d.nodes, jsListeners: d.jsEventListeners, documents: d.documents, listenersByType: lis };
}

const liveSummary = (ctxs) => {
  if (!ctxs) return null;
  const sum = (c) => Object.values(c.live || {}).reduce((a, b) => a + Math.max(0, b), 0);
  const alive = ctxs.filter((c) => !c.lost);
  return { contexts: ctxs.length, lost: ctxs.length - alive.length, objectsOnLiveContexts: alive.map(sum), objectsOnAllContexts: ctxs.map(sum) };
};

async function startShift(c, level) {
  await c.waitFor(level > 0 ? "!!document.querySelector('.tc-menu-lvl__btn')" : "[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 90000);
  if (level > 0) {
    await c.ev("document.querySelector('.tc-menu-lvl__btn').click(); true");
    await c.waitFor("[...document.querySelectorAll('button')].some((b) => /Open the stall/.test(b.textContent))", 30000);
  await c.ev("[...document.querySelectorAll('button')].find((b) => /Open the stall/.test(b.textContent)).click(); true");
  } else await c.ev("[...document.querySelectorAll('button')].filter((b) => /Start tutorial/.test(b.textContent)).pop().click(); true");
  await c.waitFor('!!(window.__tiffin && window.__tiffin.scene && window.__tiffin.scene.debug)', 180000);
}

async function leave(c) {
  await c.ev("document.querySelector('button[aria-label^=\"Pause\"]').click(); true");
  await c.sleep(500);
  await c.ev("[...document.querySelectorAll('button')].find((b) => /Leave the stall/.test(b.textContent)).click(); true");
  await c.sleep(400);
  await c.ev("[...document.querySelectorAll('.tc-menu-confirm button, [role=alertdialog] button')].find((b) => /^Leave$/.test(b.textContent.trim())).click(); true");
  await c.waitFor('!window.__tiffin', 30000);
}

async function run() {
  const c = await launch({ port, w: 1536, h: 864, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  const out = { mode, tier: tier || 'auto', cycles: [] };
  try {
    await c.viewport(1536, 864, 1.25, false);
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
    const level0 = +(args.level ?? (mode === 'soak' ? 1 : 0));
    if (level0 > 0) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('jalebi.tutorial.v1.tiffin-centre', '1'); } catch {}" });
    await c.goto(`${base}/play/tiffin-centre?tcdebug=1`);
    await c.waitFor(level0 > 0 ? "!!document.querySelector('.tc-menu-lvl__btn')" : "[...document.querySelectorAll('button')].some((b) => /Start tutorial/.test(b.textContent))", 90000);
    if (tier) {
      await c.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === '${tier.toLowerCase()}')?.click(); true`);
      await c.sleep(300);
    }
    const level = +(args.level ?? (mode === 'soak' ? 1 : 0));
    out.baseline = await gc(c);
    if (mode === 'route') {
      // control: no game at all, only the hub's own routes (is the growth the game's, or the app shell's?)
      const n = +(args.n || 5);
      for (let i = 1; i <= n; i++) {
        await c.ev("window.history.pushState({}, '', '/games/tiffin-centre'); window.dispatchEvent(new PopStateEvent('popstate')); true");
        await c.sleep(2500);
        await c.ev("window.history.pushState({}, '', '/play/tiffin-centre?tcdebug=1'); window.dispatchEvent(new PopStateEvent('popstate')); true");
        await c.sleep(2500);
        const after = await gc(c);
        after.attachedNodes = await c.ev('document.querySelectorAll("*").length');
        const row = { cycle: i, after };
        out.cycles.push(row);
        console.log(JSON.stringify(row));
      }
    } else if (mode === 'cycle') {
      const n = +(args.n || 5);
      for (let i = 1; i <= n; i++) {
        const t0 = Date.now();
        await startShift(c, level);
        const readyMs = Date.now() - t0;
        await c.sleep(4000);
        const during = await c.ev(SAMPLE);
        await leave(c);
        await c.sleep(1500);
        // single-page navigation back to the solo screen (a reload would hide a leak)
        await c.ev("window.history.pushState({}, '', '/play/tiffin-centre?tcdebug=1'); window.dispatchEvent(new PopStateEvent('popstate')); true");
        await c.sleep(1500);
        const after = await gc(c);
        after.attachedNodes = await c.ev('document.querySelectorAll("*").length');
        after.canvases = await c.ev('document.querySelectorAll("canvas").length');
        const gl = await c.ev('(window.__glLive ? window.__glLive() : null)');
        const row = { cycle: i, readyMs, during: { geometries: during.geometries, textures: during.textures, programs: during.programs, ...liveSummary(during.contexts) }, after: { ...after, gl: liveSummary(gl) } };
        out.cycles.push(row);
        console.log(JSON.stringify(row));
      }
    } else {
      const minutes = +(args.minutes || 5);
      const every = +(args.sample || 30) * 1000;
      await startShift(c, level);
      await c.ev("window.__botOn = true; (async () => { const m = window.__tiffin.bot; window.__botTimer = setInterval(() => { try { const s = window.__tiffin.session; if (!s || !s.state || s.status !== 'playing') return; const a = m(s.state, s.meId); if (a) s.dispatch(a); } catch (e) { window.__botErr = String(e); } }, 400); })(); true");
      await c.ev(`window.__frames = []; (() => { let last = 0; const f = (n) => { if (last) window.__frames.push(n - last); last = n; requestAnimationFrame(f); }; requestAnimationFrame(f); })(); true`);
      const t0 = Date.now();
      while (Date.now() - t0 < minutes * 60000) {
        await c.sleep(every);
        const s = await c.ev(SAMPLE);
        const g = await gc(c);
        const fr = await c.ev(`(() => { const f = window.__frames.splice(0); const s = f.slice().sort((a, b) => a - b); return { n: f.length, mean: +(f.reduce((a, b) => a + b, 0) / Math.max(1, f.length)).toFixed(1), p99: s.length ? +s[Math.floor(s.length * 0.99)].toFixed(1) : null, over50: f.filter((d) => d > 50).length, state: window.__tiffin && window.__tiffin.session.state && { tick: window.__tiffin.session.state.tick, customers: window.__tiffin.session.state.customers.length, money: window.__tiffin.session.state.money }, botErr: window.__botErr || null }; })()`);
        const row = { t: Math.round((Date.now() - t0) / 1000), geometries: s.geometries, textures: s.textures, programs: s.programs, ...g, frames: fr };
        out.cycles.push(row);
        console.log(JSON.stringify(row));
      }
    }
    if (args.snapshot) {
      // a V8 heap snapshot after the last cycle (open it in DevTools, or scripts/perf/tf-heap.mjs-style tooling): look for "Detached ..." nodes
      const chunks = [];
      c.on((d) => { if (d.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(d.params.chunk); });
      await c.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      fs.writeFileSync(String(args.snapshot), chunks.join(''));
    }
    out.errors = c.logs.filter((l) => !/GL Driver|GPU stall|ReadPixels|AudioContext|api\/(config|me)|Failed to load resource|Program Info Log|X4000|X3595/.test(l)).slice(0, 6);
    return out;
  } finally {
    c.close();
  }
}

const res = args['no-lock'] ? await run() : await withBenchLock(run, { maxWaitMs: 60 * 60 * 1000 });
if (args.json) fs.writeFileSync(String(args.json), JSON.stringify(res, null, 1));
console.log('baseline', JSON.stringify(res.baseline));
if (res.errors?.length) console.log('errors', JSON.stringify(res.errors));
process.exit(0);
