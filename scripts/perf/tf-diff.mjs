// How different are two screenshots? (before / after proofs.) Decodes both JPEGs in Chrome, compares them pixel by pixel and, optionally, writes a heat map.
//
//   node scripts/perf/tf-diff.mjs --a docs/perf/tf-cpu/before-h9.jpg --b docs/perf/tf-cpu/after-h9.jpg [--port 9817] [--map out.jpg] [--region x,y,w,h]
//
// Prints { meanAbs (0..255 per channel), pctOver16, pctOver48, psnr } for the whole picture and for --region (in image pixels). Things that move by themselves
// (traffic, flames, cloth, the shimmer of bloom) differ a little between two runs: what must be ~0 is the stall itself (shapes, colours, shadows, lights).
import fs from 'node:fs';
import { GPU_FLAGS, SOFT_FLAGS, launch } from './cdp.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const b64 = (f) => fs.readFileSync(String(f)).toString('base64');
const region = args.region ? String(args.region).split(',').map(Number) : null;
const port = +(args.port || 9817);

const c = await launch({ port, w: 800, h: 600, gl: args.gpu ? GPU_FLAGS : SOFT_FLAGS });
try {
  await c.goto('about:blank');
  await c.sleep(300);
  const res = await c.ev(`(async () => {
    const load = (b) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/jpeg;base64,' + b; });
    const A = await load('${b64(args.a)}'); const B = await load('${b64(args.b)}');
    const w = Math.min(A.width, B.width); const h = Math.min(A.height, B.height);
    const get = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h); };
    const a = get(A), b = get(B);
    const reg = ${JSON.stringify(region)};
    const stat = (x0, y0, x1, y1) => {
      let sum = 0, over16 = 0, over48 = 0, sq = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4; let d = 0;
        for (let k = 0; k < 3; k++) { const e = Math.abs(a.data[i + k] - b.data[i + k]); d += e; sq += e * e; }
        d /= 3; sum += d; if (d > 16) over16++; if (d > 48) over48++; n++;
      }
      const mse = sq / (n * 3);
      return { px: n, meanAbs: +(sum / n).toFixed(2), pctOver16: +(100 * over16 / n).toFixed(2), pctOver48: +(100 * over48 / n).toFixed(2), psnr: mse ? +(10 * Math.log10(255 * 255 / mse)).toFixed(1) : 99 };
    };
    const out = { size: [w, h], whole: stat(0, 0, w, h) };
    if (reg) out.region = stat(reg[0], reg[1], Math.min(w, reg[0] + reg[2]), Math.min(h, reg[1] + reg[3]));
    ${args.map ? `
    const m = document.createElement('canvas'); m.width = w; m.height = h; const g = m.getContext('2d'); const id = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { let d = 0; for (let k = 0; k < 3; k++) d += Math.abs(a.data[i * 4 + k] - b.data[i * 4 + k]); d = Math.min(255, (d / 3) * 4); id.data[i * 4] = d; id.data[i * 4 + 1] = d * 0.4; id.data[i * 4 + 2] = 0; id.data[i * 4 + 3] = 255; }
    g.putImageData(id, 0, 0); out.map = m.toDataURL('image/jpeg', 0.7).slice(23);` : ''}
    return out;
  })()`);
  if (res.map) {
    fs.writeFileSync(String(args.map), Buffer.from(res.map, 'base64'));
    delete res.map;
  }
  console.log(JSON.stringify(res));
} finally {
  c.close();
}
process.exit(0);
