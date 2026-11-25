// OWNER: minimap agent. The whole city pre-rendered ONCE into an offscreen canvas (roads by real width and class, lake, parks,
// faint building footprints). The minimap and the big map just draw this image with a transform every frame.
const cache = new WeakMap();

export const CITY_PPM = 1.4; // pixels per metre in the offscreen image (1,400 m city -> ~2,000 px)

const ROAD_CLASSES = [
  { min: 18, fill: '#b49cff', edge: 'rgba(160,230,255,0.55)' },
  { min: 14, fill: '#8a72e6', edge: 'rgba(140,200,255,0.4)' },
  { min: 11, fill: '#6652bc', edge: 'rgba(120,170,255,0.3)' },
  { min: 0, fill: '#54449c', edge: 'rgba(110,150,255,0.24)' },
];

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** -> { canvas, ppm, half, extent } for a city (the image covers world [-half, -half + extent] on both axes); built lazily, cached per city. */
export function getCityMap(city, ppm = CITY_PPM) {
  let m = cache.get(city);
  if (m) return m;
  const margin = 24;
  const half = (city.half || 700) + margin;
  const px = Math.ceil(half * 2 * ppm);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const g = canvas.getContext('2d');
  g.scale(ppm, ppm);
  g.translate(half, half); // world (0,0) at the image centre; world x/z are then used directly

  g.fillStyle = '#150a2a';
  g.fillRect(-half, -half, half * 2, half * 2);

  // the land: a slightly lighter slab inside the ring road
  g.fillStyle = '#1d1038';
  g.fillRect(-city.half, -city.half, city.half * 2, city.half * 2);

  // blocks: faint footprints, greener parks, golden landmark plazas
  for (const b of city.blocks) {
    if (b.type === 'water') continue;
    const inset = 1.5;
    if (b.type === 'park') g.fillStyle = 'rgba(78,200,130,0.26)';
    else if (b.type === 'landmark') g.fillStyle = 'rgba(255,200,87,0.2)';
    else g.fillStyle = 'rgba(190,170,255,0.085)';
    roundRect(g, b.x0 + inset, b.z0 + inset, b.w - inset * 2, b.d - inset * 2, 3);
    g.fill();
    if (b.type === 'normal' && b.w > 26 && b.d > 26) {
      // a hint of building mass: a smaller, brighter footprint in the middle of larger blocks
      g.fillStyle = 'rgba(190,170,255,0.07)';
      roundRect(g, b.x0 + b.w * 0.14, b.z0 + b.d * 0.14, b.w * 0.72, b.d * 0.72, 2);
      g.fill();
    }
  }

  // lake
  const L = city.lake;
  if (L) {
    g.save();
    g.beginPath();
    g.ellipse(L.cx, L.cz, L.rx, L.rz, 0, 0, Math.PI * 2);
    const grad = g.createRadialGradient(L.cx, L.cz, 0, L.cx, L.cz, Math.max(L.rx, L.rz));
    grad.addColorStop(0, '#16407e');
    grad.addColorStop(1, '#0f2c63');
    g.fillStyle = grad;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(55,230,255,0.55)';
    g.stroke();
    g.restore();
  }

  // roads: an edge pass (glow-ish outline), then the fills, narrow classes first so avenues sit on top
  const nodes = city.nodes;
  g.lineJoin = 'round';
  for (const pass of ['edge', 'fill']) {
    for (let ci = ROAD_CLASSES.length - 1; ci >= 0; ci--) {
      const cls = ROAD_CLASSES[ci];
      const hi = ci === 0 ? Infinity : ROAD_CLASSES[ci - 1].min;
      g.strokeStyle = pass === 'edge' ? cls.edge : cls.fill;
      for (const e of city.edges) {
        if (e.w < cls.min || e.w >= hi) continue;
        const a = nodes[e.a];
        const b = nodes[e.b];
        g.lineCap = e.curve ? 'round' : 'square';
        g.lineWidth = e.w + (pass === 'edge' ? 2.4 : 0);
        g.beginPath();
        g.moveTo(a.x, a.z);
        g.lineTo(b.x, b.z);
        g.stroke();
      }
    }
  }
  // a faint centre line on the wide roads
  g.strokeStyle = 'rgba(255,255,255,0.1)';
  g.lineWidth = 0.9;
  g.setLineDash([5, 6]);
  for (const e of city.edges) {
    if (e.w < 14) continue;
    g.beginPath();
    g.moveTo(nodes[e.a].x, nodes[e.a].z);
    g.lineTo(nodes[e.b].x, nodes[e.b].z);
    g.stroke();
  }
  g.setLineDash([]);

  // draw it with drawImage(canvas, -half, -half, extent, extent) in world coordinates
  m = { canvas, ppm, half, extent: px / ppm };
  cache.set(city, m);
  return m;
}
