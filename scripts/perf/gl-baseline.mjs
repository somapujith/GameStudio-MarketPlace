// Is the machine itself stalling? A trivial WebGL 2 page (no three.js, no game): ~220 draw calls a frame with a handful of uniform calls each, at the
// size of the game's drawing buffer, for `--seconds`. If THIS page shows frames over 50 ms, the stalls the games report are the driver / GPU process /
// other programs on the shared GPU and not the game; if it is clean, they are the game's own. Same launch, flags and lock as the other perf scripts.
//
//   node scripts/perf/gl-baseline.mjs [--port 9919] [--seconds 30] [--draws 220] [--fill 0] [--fps 60] [--w 1536 --h 864 --dpr 1.25] [--soft] [--no-lock]
// --fill N adds N full-screen ALU-heavy layers a frame: GPU time without extra draws (is the GPU itself shared with someone who preempts it?)
// --fps N paces the work like a game (one frame of work every 1000/N ms, the other rAF callbacks do nothing): with the frame cap off (the perf
// scripts' flags) an un-paced loop floods the GPU queue at ~1000 fps and the stalls it shows are back-pressure from its own flood.
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';
import { withBenchLock } from './lock.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const W = +(args.w || 1536);
const H = +(args.h || 864);
const DPR = +(args.dpr || 1.25);
const SEC = +(args.seconds || 30);
const DRAWS = +(args.draws || 220);
const FPS = +(args.fps || 0);
const FILL = +(args.fill || 0);
const port = +(args.port || 9919);

const PAGE = `(async () => {
  const c = document.createElement('canvas'); c.width = ${Math.round(W * DPR)}; c.height = ${Math.round(H * DPR)}; c.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh';
  document.body.appendChild(c);
  const gl = c.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); return sh; };
  const progs = [0, 1, 2].map((k) => { const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, '#version 300 es\\nin vec3 p; uniform mat4 m; uniform mat4 v; uniform vec3 t; out vec3 n; void main(){ n = p; gl_Position = v * m * vec4(p + t, 1.0); }'));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, '#version 300 es\\nprecision highp float; in vec3 n; uniform vec3 c0; uniform vec3 c1; uniform float k; out vec4 o; void main(){ vec3 a = c0 * (0.5 + 0.5 * n.y) + c1 * k; for (int i = 0; i < ${8 + 0}; i++) a = a * 0.97 + sin(a * float(i + 1)) * 0.01; o = vec4(a, 1.0); }'));
    gl.linkProgram(p); return { p, m: gl.getUniformLocation(p, 'm'), v: gl.getUniformLocation(p, 'v'), t: gl.getUniformLocation(p, 't'), c0: gl.getUniformLocation(p, 'c0'), c1: gl.getUniformLocation(p, 'c1'), k: gl.getUniformLocation(p, 'k') }; });
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0, 1,-1,0, 0,1,0, -1,1,0.5, 1,1,0.5, 0,-1,0.5]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const m = new Float32Array(16); const v = new Float32Array(16); for (let i = 0; i < 4; i++) { m[i * 5] = 0.2; v[i * 5] = 1; }
  gl.enable(gl.DEPTH_TEST); gl.viewport(0, 0, c.width, c.height);
  const dts = []; let last = performance.now(); const end = last + ${SEC} * 1000; let frame = 0;
  const gap = ${FPS} > 0 ? 1000 / ${FPS} - 0.5 : 0;
  await new Promise((res) => { const f = (now) => {
    if (gap && now - last < gap && now < end) { requestAnimationFrame(f); return; }
    dts.push(now - last); last = now; frame++;
    gl.clearColor(0.1, 0.1, 0.2, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    let cur = -1;
    for (let i = 0; i < ${DRAWS}; i++) {
      const P = progs[Math.min(2, Math.floor(i / (${DRAWS} / 3)))]; if (P !== cur) { gl.useProgram(P.p); cur = P; gl.uniformMatrix4fv(P.v, false, v); gl.uniform3f(P.c0, 0.4, 0.5, 0.6); gl.uniform3f(P.c1, 0.2, 0.1, 0.3); gl.uniform1f(P.k, 0.5); }
      m[12] = ((i * 37) % 100) / 100 - 0.5; m[13] = ((i * 53) % 100) / 100 - 0.5; gl.uniformMatrix4fv(P.m, false, m); gl.uniform3f(P.t, 0, 0, i * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    if (${FILL} > 0) {
      const P = progs[0]; gl.useProgram(P.p); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const big = new Float32Array(16); for (let i = 0; i < 4; i++) big[i * 5] = i < 2 ? 4 : 1; gl.uniformMatrix4fv(P.m, false, big); gl.uniformMatrix4fv(P.v, false, v); gl.uniform3f(P.t, 0, 0, 0);
      for (let k = 0; k < ${FILL}; k++) gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
    }
    if (now < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  dts.shift(); const s = dts.slice().sort((a, b) => a - b); const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
  const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
  return { frames: dts.length, fps: +(1000 / mean).toFixed(1), mean: +mean.toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +s[s.length - 1].toFixed(1), over33: dts.filter((d) => d > 33).length, over50: dts.filter((d) => d > 50).length, over100: dts.filter((d) => d > 100).length, gpu: gl.getParameter(gl.RENDERER) };
})()`;

async function run() {
  const c = await launch({ port, w: W, h: H, gl: args.soft ? SOFT_FLAGS : GPU_FLAGS });
  try {
    await c.viewport(W, H, DPR, false);
    await c.goto('about:blank');
    await c.sleep(500);
    return await c.ev(PAGE);
  } finally {
    c.close();
  }
}

const res = args['no-lock'] ? await run() : await withBenchLock(run, { maxWaitMs: 240 * 60 * 1000 });
console.log(JSON.stringify({ label: 'gl-baseline', viewport: `${W}x${H}@${DPR}`, draws: DRAWS, fill: FILL, paced: FPS || 'uncapped', seconds: SEC, ...res }));
process.exit(0);
