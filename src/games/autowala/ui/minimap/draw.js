// OWNER: minimap agent. Canvas drawing shared by the round minimap and the big map. Everything is read from game.ctx (never the
// snapshot) and every field is optional: no ctx.fares, no ctx.route, no target -> just the player, the roads and the landmarks.
import { DISTRICTS } from '../../world/layout.js';
import { worldToScreen, screenAngleOfHeading, screenDir, clampToCircle, clampToRect, newView, formatDistance } from './mapMath.js';
import { PAL, poiIcon, shopIcon, drawBadge, drawPlayerArrow, drawCustomer, drawEdgeArrow } from './icons.js';

const FONT = '"Bricolage Grotesque Variable", system-ui, sans-serif';
const P = { x: 0, y: 0 };
const C = { x: 0, y: 0, angle: 0, inside: true };
const D = { x: 0, y: 0 };

/** Collect the per-frame facts the map needs from ctx into `out` (reused; no allocation). */
export function readLive(ctx, out) {
  const v = ctx.v || {};
  out.x = v.x || 0;
  out.z = v.z || 0;
  out.heading = Number.isFinite(v.heading) ? v.heading : 0;
  out.speed = v.speed || 0;
  const f = ctx.fares;
  out.waiting = Array.isArray(f?.waiting) ? f.waiting : EMPTY;
  const dest = f?.trip?.dest;
  out.dest = dest && Number.isFinite(dest.x) && Number.isFinite(dest.z) ? dest : null;
  // a shared ride has a second drop-off: riders() builds a small array, so it is read ~10 times a second, not every frame
  if ((out.k = ((out.k | 0) + 1) % 6) === 0) {
    const rs = typeof f?.riders === 'function' ? f.riders() : null;
    const d2 = rs && rs.length > 1 ? rs[1]?.dest : null;
    out.dest2 = d2 && Number.isFinite(d2.x) && Number.isFinite(d2.z) && d2 !== dest ? d2 : null;
  }
  const r = ctx.route;
  out.route = r && Array.isArray(r.points) ? r.points : EMPTY;
  out.target = r?.target || null;
  out.remaining = r?.remaining ?? r?.length ?? 0;
  out.eta = r?.eta ?? 0;
  out.nextTurn = r?.nextTurn || null;
  out.turnDistance = r?.turnDistance || 0;
  out.hasRoute = out.route.length > 1 && !!out.target;
  const w = ctx.world;
  out.metro = w?.metro && Array.isArray(w.metro.lines) ? w.metro : null;
  out.shops = Array.isArray(w?.shops?.shops) ? w.shops.shops : EMPTY;
  return out;
}
const EMPTY = [];
export const newLive = () => ({ x: 0, z: 0, heading: 0, speed: 0, waiting: EMPTY, dest: null, dest2: null, k: 0, route: EMPTY, target: null, remaining: 0, eta: 0, hasRoute: false, metro: null, shops: EMPTY });

function text(g, str, x, y, size, color, { align = 'center', weight = 700, stroke = 'rgba(18,8,36,0.9)', spacing = 0, alpha = 1 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (spacing && 'letterSpacing' in g) g.letterSpacing = `${spacing}px`;
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2, size * 0.28);
  g.strokeStyle = stroke;
  g.strokeText(str, x, y);
  g.fillStyle = color;
  g.fillText(str, x, y);
  g.restore();
}

function drawRoute(g, o) {
  const pts = o.live.route;
  const n = Math.min(pts.length, 240);
  if (n < 2) return;
  const big = o.mode === 'big';
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < n; i++) {
    worldToScreen(o.view, pts[i].x, pts[i].z, P);
    if (i) g.lineTo(P.x, P.y);
    else g.moveTo(P.x, P.y);
  }
  // glow, then a bright gradient core (cyan near the player -> pink at the target), then moving dashes
  const first = worldToScreen(o.view, pts[0].x, pts[0].z, P);
  const sx = first.x;
  const sy = first.y;
  const last = worldToScreen(o.view, pts[n - 1].x, pts[n - 1].z, P);
  const grad = g.createLinearGradient(sx, sy, last.x, last.y);
  grad.addColorStop(0, PAL.cyan);
  grad.addColorStop(1, PAL.pink);
  g.strokeStyle = 'rgba(255,61,154,0.28)';
  g.lineWidth = big ? 11 : 9.5;
  g.stroke();
  g.strokeStyle = 'rgba(18,8,36,0.75)';
  g.lineWidth = big ? 6.5 : 5.8;
  g.stroke();
  g.strokeStyle = grad;
  g.lineWidth = big ? 4.4 : 3.8;
  g.stroke();
  g.setLineDash([2, 13]);
  g.lineDashOffset = -o.t * 22;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = big ? 1.8 : 1.5;
  g.stroke();
  g.restore();
}

function drawDistricts(g, o) {
  const big = o.mode === 'big';
  const size = big ? 15 : 8.5;
  for (const d of DISTRICTS) {
    worldToScreen(o.view, d.center[0], d.center[1], P);
    if (o.mode === 'mini' && Math.hypot(P.x - o.cx, P.y - o.cy) > o.radius - 14) continue;
    text(g, d.name.toUpperCase(), P.x, P.y, size, 'rgba(230,214,255,0.9)', { weight: 800, spacing: big ? 3 : 1.4, alpha: big ? 0.62 : 0.5 });
  }
}

function drawPois(g, o) {
  const big = o.mode === 'big';
  const r = big ? 10 : 6.6;
  for (const poi of o.city.pois) {
    const icon = poiIcon(poi);
    if (!icon) continue;
    worldToScreen(o.view, poi.x, poi.z, P);
    if (big) {
      if (P.x < -30 || P.y < -30 || P.x > o.w + 30 || P.y > o.h + 30) continue;
    } else if (Math.hypot(P.x - o.cx, P.y - o.cy) > o.radius + r) continue;
    drawBadge(g, icon.kind, P.x, P.y, icon.kind === 'dot' ? r * 0.7 : r, icon.color);
    if (big && (icon.kind === 'star' || icon.kind === 'wrench' || icon.kind === 'cross' || o.view.scale > 0.8)) {
      text(g, poi.name, P.x, P.y + r + 9, 11, '#fff3d6', { weight: 700 });
    }
  }
}

/** Elevated metro lines (thin coloured lines with a dark casing) and their "M" station roundels. Defensive: the metro may not exist yet. */
function drawMetro(g, o) {
  const metro = o.live.metro;
  if (!metro) return;
  const big = o.mode === 'big';
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const line of metro.lines || []) {
    const pts = line?.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      worldToScreen(o.view, pts[i].x, pts[i].z, P);
      if (i) g.lineTo(P.x, P.y);
      else g.moveTo(P.x, P.y);
    }
    g.strokeStyle = 'rgba(18,8,36,0.8)';
    g.lineWidth = big ? 5.5 : 3.8;
    g.stroke();
    g.strokeStyle = line.color || PAL.violet;
    g.lineWidth = big ? 3 : 2;
    g.stroke();
  }
  g.restore();
  const stations = Array.isArray(metro.stations) ? metro.stations : EMPTY;
  const r = big ? 7.5 : 4.6;
  for (const s of stations) {
    if (!s || !Number.isFinite(s.x)) continue;
    worldToScreen(o.view, s.x, s.z, P);
    if (o.mode === 'mini' && Math.hypot(P.x - o.cx, P.y - o.cy) > o.radius + r) continue;
    if (big && (P.x < -20 || P.y < -20 || P.x > o.w + 20 || P.y > o.h + 20)) continue;
    const line = (metro.lines || []).find((l) => l.id === s.line);
    g.save();
    g.fillStyle = '#fff';
    g.strokeStyle = line?.color || PAL.violet;
    g.lineWidth = s.interchange ? 2.6 : 1.8;
    g.beginPath();
    g.arc(P.x, P.y, s.interchange ? r * 1.2 : r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
    if (big) {
      text(g, 'M', P.x, P.y + 0.5, 8.5, PAL.ink, { weight: 800, stroke: 'transparent' });
      if (o.view.scale > 0.55 && s.name) text(g, s.name, P.x, P.y + r + 9, 10.5, '#e6d9ff', { weight: 600 });
    }
  }
}

/** Shops (restaurant / sweets / hotel / stall icons): big map only, and only when zoomed in enough to read them. */
function drawShops(g, o) {
  if (o.mode !== 'big' || o.view.scale < 1.1) return;
  const shops = o.live.shops;
  for (const s of shops) {
    if (!s || !Number.isFinite(s.x)) continue;
    worldToScreen(o.view, s.x, s.z, P);
    if (P.x < -20 || P.y < -20 || P.x > o.w + 20 || P.y > o.h + 20) continue;
    const icon = shopIcon(s);
    drawBadge(g, icon.kind, P.x, P.y, 6, icon.color, 0.95);
    if (o.view.scale > 1.9 && s.name) text(g, s.name, P.x, P.y + 14, 9.5, '#fff3d6', { weight: 600 });
  }
}

/** The drop-off flag; `tag` ("1" / "2") is only drawn on a shared ride, so you can tell the two stops apart. */
function drawDest(g, o, d, tag) {
  if (!d) return;
  const at = d.front && Number.isFinite(d.front.x) ? d.front : d;
  worldToScreen(o.view, at.x, at.z, P);
  const big = o.mode === 'big';
  if (o.mode === 'mini') {
    clampToCircle(P.x, P.y, o.cx, o.cy, o.radius - 8, C);
    if (!C.inside) {
      drawEdgeArrow(g, C.x, C.y, C.angle, PAL.green, 7);
      return;
    }
  } else if (!clampToRect(P.x, P.y, 14, 14, o.w - 14, o.h - 14, C).inside) {
    drawEdgeArrow(g, C.x, C.y, C.angle, PAL.green, 9);
    return;
  }
  const pulse = 0.5 + 0.5 * Math.sin(o.t * 4);
  g.save();
  g.shadowColor = PAL.green;
  g.shadowBlur = 8 + pulse * 6;
  drawBadge(g, 'flag', P.x, P.y - (big ? 4 : 2), big ? 12 : 9, PAL.green);
  g.restore();
  if (tag) text(g, tag, P.x + (big ? 14 : 10), P.y - (big ? 12 : 9), big ? 12 : 10, '#fff3d6', { weight: 800 });
  if (big && d.name) text(g, d.name, P.x, P.y + 20, 12, PAL.green);
}

function drawCustomers(g, o) {
  const list = o.live.waiting;
  const big = o.mode === 'big';
  const selId = o.selectedId;
  // the targeted one last so it sits on top
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
      const isSel = selId != null && c.id === selId;
      if ((pass === 1) !== isSel) continue;
      // the citywide board: the minimap shows the nearby ones only, the big map all of them (far ones dimmer)
      const far = c.near === false;
      if (far && !isSel && !big) continue;
      worldToScreen(o.view, c.x, c.z, P);
      let inside;
      if (o.mode === 'mini') inside = clampToCircle(P.x, P.y, o.cx, o.cy, o.radius - 8, C).inside;
      else inside = clampToRect(P.x, P.y, 14, 14, o.w - 14, o.h - 14, C).inside;
      if (inside) {
        const dim = far && !isSel;
        if (dim) g.globalAlpha = 0.55;
        drawCustomer(g, P.x, P.y, c.patience, o.t + i * 0.37, isSel || (big && !far));
        if (big) {
          const label = c.name ? (c.fareEstimate ? `${c.name}  ₹${Math.round(c.fareEstimate)}` : c.name) : '';
          if (label && (!far || isSel || o.view.scale > 0.45)) text(g, label, P.x, P.y + (far ? 19 : 24), far ? 10 : 11.5, isSel ? PAL.pink : '#ffe4f2');
        }
        g.globalAlpha = 1;
      } else if (!big || isSel) {
        drawEdgeArrow(g, C.x, C.y, C.angle, isSel ? PAL.pink : 'rgba(255,61,154,0.8)', isSel ? 8 : 5.5);
        if (isSel) {
          const dist = Math.hypot(c.x - o.live.x, c.z - o.live.z);
          const dir = screenDir(o.view, c.x - o.live.x, c.z - o.live.z, D);
          text(g, formatDistance(dist), C.x - dir.x * 22, C.y - dir.y * 14, 10, '#ffd6ec');
        }
      }
    }
  }
}

function drawPlayer(g, o) {
  const big = o.mode === 'big';
  const a = screenAngleOfHeading(o.view, o.live.heading);
  if (big) {
    worldToScreen(o.view, o.live.x, o.live.z, P);
    drawPlayerArrow(g, P.x, P.y, a, 11);
  } else {
    // faint view cone ahead of the auto
    g.save();
    g.translate(o.cx, o.cy);
    g.rotate(a);
    const cone = g.createLinearGradient(0, 0, 0, -o.radius * 0.7);
    cone.addColorStop(0, 'rgba(55,230,255,0.22)');
    cone.addColorStop(1, 'rgba(55,230,255,0)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-o.radius * 0.3, -o.radius * 0.7);
    g.lineTo(o.radius * 0.3, -o.radius * 0.7);
    g.closePath();
    g.fill();
    g.restore();
    drawPlayerArrow(g, o.cx, o.cy, a, 9.5);
  }
}

function drawCompass(g, o) {
  // N sits on the rim in the direction of north
  screenDir(o.view, 0, -1, D);
  const rr = o.radius - 11;
  const x = o.cx + D.x * rr;
  const y = o.cy + D.y * rr;
  g.save();
  g.fillStyle = 'rgba(18,8,36,0.85)';
  g.strokeStyle = PAL.pink;
  g.lineWidth = 1.4;
  g.beginPath();
  g.arc(x, y, 7.5, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.restore();
  text(g, 'N', x, y + 0.5, 9.5, '#fff', { weight: 800, stroke: 'transparent' });
}

/**
 * Draw one frame. `o`: { city, cityMap, view, live, w, h (css px), dpr, t (s), mode: 'mini' | 'big', cx, cy, radius (mini),
 * selectedId }. The view is the world -> screen matrix from mapMath.makeView.
 */
export function drawMap(g, o) {
  const { dpr, view, cityMap } = o;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, o.w, o.h);
  g.save();
  if (o.mode === 'mini') {
    g.beginPath();
    g.arc(o.cx, o.cy, o.radius, 0, Math.PI * 2);
    g.clip();
  }
  g.fillStyle = '#150a2a';
  g.fillRect(0, 0, o.w, o.h);
  if (cityMap) {
    g.setTransform(view.a * dpr, view.b * dpr, view.c * dpr, view.d * dpr, view.e * dpr, view.f * dpr);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cityMap.canvas, -cityMap.half, -cityMap.half, cityMap.extent, cityMap.extent);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  drawDistricts(g, o);
  if (o.live.hasRoute) drawRoute(g, o);
  drawMetro(g, o);
  drawPois(g, o);
  drawShops(g, o);
  const second = o.live.dest2;
  drawDest(g, o, o.live.dest, second ? '1' : '');
  if (second) drawDest(g, o, second, '2');
  drawCustomers(g, o);
  drawPlayer(g, o);
  if (o.mode === 'mini') {
    // soft vignette so the rim reads as a lens
    const vg = g.createRadialGradient(o.cx, o.cy, o.radius * 0.62, o.cx, o.cy, o.radius);
    vg.addColorStop(0, 'rgba(18,8,36,0)');
    vg.addColorStop(1, 'rgba(18,8,36,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, o.w, o.h);
    drawCompass(g, o);
  }
  g.restore();
}

/** The waiting customer under a screen point (within `r` px), or null. */
export function hitCustomer(view, live, sx, sy, r = 18) {
  let best = null;
  let bestD = r;
  for (const c of live.waiting) {
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
    worldToScreen(view, c.x, c.z, P);
    const d = Math.hypot(P.x - sx, P.y - sy);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export { newView };
