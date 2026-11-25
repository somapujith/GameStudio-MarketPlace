// OWNER: minimap agent. Small vector icons for the map (canvas 2D): wrench, pump, cross, star, cup, flag, customer.
export const PAL = {
  pink: '#ff3d9a', cyan: '#37e6ff', violet: '#8f6bff', gold: '#ffc857', lime: '#a6ff3d', ink: '#120824', red: '#ff5470', green: '#4dff9a',
};

/** Which icon a point of interest gets: { kind, color } or null for the ones we do not mark. */
export function poiIcon(poi) {
  if (!poi) return null;
  if (poi.id === 'garage') return { kind: 'wrench', color: PAL.gold };
  if (poi.kind === 'cng') return { kind: 'pump', color: PAL.lime };
  if (poi.id === 'hospital') return { kind: 'cross', color: PAL.red };
  if (poi.kind === 'monument') return { kind: 'star', color: PAL.gold };
  if (poi.kind === 'shop') return { kind: 'cup', color: '#c3a8ff' };
  return { kind: 'dot', color: PAL.violet };
}

/** Icon for a shop by its category string (restaurant / sweets / hotel / stall...). */
export function shopIcon(shop) {
  const k = `${shop?.kind || ''} ${shop?.brand || ''}`.toLowerCase();
  if (/sweet|mithai|bakery|jalebi/.test(k)) return { kind: 'sweet', color: '#ff9ad0' };
  if (/hotel|lodge|inn|stay/.test(k)) return { kind: 'bed', color: '#9ad7ff' };
  if (/rest|food|biryani|cafe|irani|dhaba|eat|tiffin/.test(k)) return { kind: 'fork', color: PAL.gold };
  return { kind: 'stall', color: '#c3a8ff' };
}

function star(g, r, inner = 0.45) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
}

/** Draw a round badge with a glyph at (x, y), radius r. */
export function drawBadge(g, kind, x, y, r, color, alpha = 1) {
  g.save();
  g.translate(x, y);
  g.globalAlpha = alpha;
  g.fillStyle = 'rgba(18,8,36,0.88)';
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.2, r * 0.2);
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const u = r * 0.52; // glyph half-size
  switch (kind) {
    case 'cross': {
      const t = u * 0.62;
      g.fillRect(-t / 2, -u, t, u * 2);
      g.fillRect(-u, -t / 2, u * 2, t);
      break;
    }
    case 'pump': {
      g.fillRect(-u * 0.75, -u, u * 1.1, u * 2);
      g.fillStyle = 'rgba(18,8,36,0.9)';
      g.fillRect(-u * 0.5, -u * 0.72, u * 0.62, u * 0.55);
      g.fillStyle = color;
      g.lineWidth = Math.max(1, u * 0.28);
      g.beginPath();
      g.moveTo(u * 0.45, -u * 0.4);
      g.lineTo(u * 0.85, -u * 0.1);
      g.lineTo(u * 0.85, u * 0.7);
      g.stroke();
      break;
    }
    case 'wrench': {
      g.lineWidth = Math.max(1.2, u * 0.34);
      g.beginPath();
      g.moveTo(-u * 0.75, u * 0.75);
      g.lineTo(u * 0.25, -u * 0.25);
      g.stroke();
      g.lineWidth = Math.max(1, u * 0.3);
      g.beginPath();
      g.arc(u * 0.42, -u * 0.42, u * 0.5, 0.35 * Math.PI, 2.5 * Math.PI);
      g.stroke();
      break;
    }
    case 'star': {
      star(g, u * 1.25);
      g.fill();
      break;
    }
    case 'cup': {
      g.beginPath();
      g.moveTo(-u * 0.7, -u * 0.5);
      g.lineTo(u * 0.7, -u * 0.5);
      g.lineTo(u * 0.5, u * 0.7);
      g.lineTo(-u * 0.5, u * 0.7);
      g.closePath();
      g.fill();
      break;
    }
    case 'fork': {
      g.lineWidth = Math.max(1, u * 0.26);
      for (const dx of [-0.5, 0, 0.5]) {
        g.beginPath();
        g.moveTo(dx * u, -u);
        g.lineTo(dx * u, u * 0.1);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(0, u * 0.1);
      g.lineTo(0, u);
      g.stroke();
      break;
    }
    case 'sweet': {
      g.beginPath();
      g.moveTo(0, -u);
      g.lineTo(u, 0);
      g.lineTo(0, u);
      g.lineTo(-u, 0);
      g.closePath();
      g.fill();
      break;
    }
    case 'bed': {
      g.fillRect(-u, -u * 0.1, u * 2, u * 0.65);
      g.fillRect(-u, -u * 0.7, u * 0.3, u * 1.3);
      g.beginPath();
      g.arc(-u * 0.2, -u * 0.35, u * 0.28, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'stall': {
      g.beginPath();
      g.moveTo(-u, -u * 0.1);
      g.lineTo(-u * 0.6, -u * 0.8);
      g.lineTo(u * 0.6, -u * 0.8);
      g.lineTo(u, -u * 0.1);
      g.closePath();
      g.fill();
      g.fillRect(-u * 0.7, -u * 0.05, u * 1.4, u * 0.8);
      break;
    }
    case 'flag': {
      g.lineWidth = Math.max(1.2, u * 0.3);
      g.beginPath();
      g.moveTo(-u * 0.6, u);
      g.lineTo(-u * 0.6, -u);
      g.stroke();
      g.beginPath();
      g.moveTo(-u * 0.6, -u);
      g.lineTo(u * 0.9, -u * 0.45);
      g.lineTo(-u * 0.6, u * 0.1);
      g.closePath();
      g.fill();
      break;
    }
    default: {
      g.beginPath();
      g.arc(0, 0, u * 0.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

/** The player's arrow, pointing along `angle` (0 = up, clockwise). */
export function drawPlayerArrow(g, x, y, angle, size, glow = true) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  if (glow) {
    g.shadowColor = PAL.cyan;
    g.shadowBlur = size * 0.9;
  }
  g.fillStyle = '#ffffff';
  g.strokeStyle = PAL.cyan;
  g.lineWidth = Math.max(1.5, size * 0.16);
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.72, size * 0.78);
  g.lineTo(0, size * 0.34);
  g.lineTo(-size * 0.72, size * 0.78);
  g.closePath();
  g.fill();
  g.shadowBlur = 0;
  g.stroke();
  g.restore();
}

/** Colour of a patience ring: green when fresh, gold when getting bored, pink-red when about to leave. */
export function patienceColor(p) {
  return p > 0.6 ? PAL.green : p > 0.3 ? PAL.gold : PAL.red;
}

/** A waiting customer: pulsing pink dot + a ring that shrinks with their patience. `big` for the targeted one. */
export function drawCustomer(g, x, y, patience, t, big) {
  const r = big ? 7.5 : 5;
  const pulse = (t * (big ? 1.5 : 1)) % 1;
  g.save();
  g.translate(x, y);
  g.strokeStyle = PAL.pink;
  g.globalAlpha = (1 - pulse) * (big ? 0.7 : 0.45);
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(0, 0, r + 2 + pulse * (big ? 14 : 9), 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;
  // patience ring (full circle = fresh)
  const p = Math.max(0, Math.min(1, Number.isFinite(patience) ? patience : 1));
  g.lineWidth = big ? 3 : 2.2;
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.beginPath();
  g.arc(0, 0, r + 3.2, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = patienceColor(p);
  g.lineCap = 'round';
  g.beginPath();
  g.arc(0, 0, r + 3.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
  g.stroke();
  g.shadowColor = PAL.pink;
  g.shadowBlur = big ? 12 : 7;
  g.fillStyle = PAL.pink;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** A small arrow on the rim pointing at something off the map. */
export function drawEdgeArrow(g, x, y, angle, color, size = 7) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = color;
  g.strokeStyle = 'rgba(18,8,36,0.9)';
  g.lineWidth = 1.5;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.9, size * 0.7);
  g.lineTo(-size * 0.9, size * 0.7);
  g.closePath();
  g.stroke();
  g.fill();
  g.restore();
}
