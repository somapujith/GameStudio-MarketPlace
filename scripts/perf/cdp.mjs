// Minimal Chrome DevTools Protocol client for the perf and screenshot scripts (no dependencies: Node 22+ has fetch and WebSocket).
//   const c = await launch({ port: 9720, gl: GPU_FLAGS });  await c.goto(url);  await c.ev('1+1');  c.close();
// Chrome is found from CHROME_PATH, else the usual Windows / macOS / Linux locations. Only the process this module started is ever killed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

/** Real GPU (whatever Chrome picks: on a hybrid laptop that is usually the integrated one), vsync and the frame cap off so frame time = real cost. */
export const GPU_FLAGS = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
/** The software rasteriser: for layout and screenshot checks only, frame times from it mean nothing. */
export const SOFT_FLAGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export async function launch({ port = 9700, w = 1280, h = 800, gl = GPU_FLAGS, headless = true } = {}) {
  const chrome = CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome not found: set CHROME_PATH');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jalebi-cdp-${port}-`));
  const proc = spawn(
    chrome,
    [...(headless ? ['--headless=new'] : []), `--remote-debugging-port=${port}`, ...gl, `--user-data-dir=${dir}`, '--no-first-run', '--disable-extensions', '--mute-audio', '--autoplay-policy=no-user-gesture-required', `--window-size=${w},${h}`, 'about:blank'],
    { stdio: 'ignore' },
  );
  let ws;
  for (let i = 0; i < 80 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      ws = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    if (!ws) await new Promise((r) => setTimeout(r, 250));
  }
  if (!ws) {
    try { process.kill(proc.pid); } catch { /* already gone */ }
    throw new Error('Chrome did not start');
  }
  const sock = new WebSocket(ws);
  await new Promise((r) => (sock.onopen = r));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  const logs = [];
  sock.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const { res, rej } = pending.get(d.id);
      pending.delete(d.id);
      if (d.error) rej(new Error(JSON.stringify(d.error)));
      else res(d.result);
    } else if (d.method) {
      listeners.forEach((l) => l(d));
      if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(d.params.type)) logs.push(`[${d.params.type}] ` + d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      if (d.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 400));
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  const api = {
    send, logs, pid: proc.pid, on: (fn) => listeners.push(fn),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    /** CSS size + device pixel ratio. mobile=true also turns on touch emulation. */
    async viewport(width, height, dpr = 1, mobile = false) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
      await send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    },
    async goto(url) { await send('Page.navigate', { url }); },
    async ev(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expr, ms = 60000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        try { if (await api.ev(expr)) return true; } catch { /* page not ready */ }
        await api.sleep(250);
      }
      throw new Error('timeout waiting for ' + expr);
    },
    /** Screenshot to a file; JPEG by default (small enough to commit as proof). */
    async shot(file, { jpeg = true, quality = 72 } = {}) {
      const r = await send('Page.captureScreenshot', jpeg ? { format: 'jpeg', quality } : { format: 'png' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    },
    async key(key) {
      const code = key.length === 1 ? 'Key' + key.toUpperCase() : key;
      const vk = { Escape: 27, Enter: 13, ' ': 32, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[key] || key.toUpperCase().charCodeAt(0);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key.length === 1 ? key : undefined });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    },
    async click(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    /** A V8 CPU profile of the next `ms`, summarised as the heaviest self-time functions. */
    async cpuProfile(ms, top = 25) {
      await send('Profiler.enable');
      await send('Profiler.setSamplingInterval', { interval: 500 });
      await send('Profiler.start');
      await api.sleep(ms);
      const { profile } = await send('Profiler.stop');
      const self = new Map();
      const dt = profile.timeDeltas || [];
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      profile.samples.forEach((sid, i) => {
        const cf = byId.get(sid).callFrame;
        const k = `${cf.functionName || '(anon)'}  ${cf.url.replace(/^.*\/(assets|src)\//, '$1/')}:${cf.lineNumber + 1}`;
        self.set(k, (self.get(k) || 0) + (dt[i] || 0));
      });
      const total = [...self.values()].reduce((a, b) => a + b, 0) || 1;
      return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => ({ fn: k, ms: +(v / 1000).toFixed(1), pct: +((v / total) * 100).toFixed(1) }));
    },
    close() {
      try { sock.close(); } catch { /* closed */ }
      try { process.kill(proc.pid); } catch { /* gone */ }
      setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still locked */ } }, 1500);
    },
  };
  return api;
}
