// Pure helpers for the money flights (no DOM): how many coins, and the arc they fly along.

/** 1 coin for small change, up to 8 for a big transfer (log scale on rupees). */
export function coinCount(amount) {
  const a = Math.abs(Number(amount) || 0);
  if (a <= 0) return 0;
  if (a < 20000) return 1;
  // 20k -> 2 ... ~5L -> 8
  return Math.max(1, Math.min(8, Math.round(2 + Math.log2(a / 20000) * 1.3)));
}

/**
 * Points of a quadratic arc from `a` to `b` (viewport px), bowing upwards by `lift` (fraction of the distance,
 * at least 40px), as `[{x, y}]` with `steps + 1` entries. `bias` (-1..1) leans the apex sideways so the coins
 * of one flight fan into slightly different arcs.
 */
export function arcPoints(a, b, { steps = 10, lift = 0.35, bias = 0 } = {}) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const h = Math.max(40, dist * lift);
  // control point: midpoint, raised, pushed sideways along the normal by `bias`
  const nx = -dy / dist;
  const ny = dx / dist;
  const cx = (a.x + b.x) / 2 + nx * bias * h * 0.5;
  const cy = Math.min(a.y, b.y) - h + ny * bias * h * 0.5;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y });
  }
  return out;
}
