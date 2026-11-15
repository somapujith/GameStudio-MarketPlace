// Pure helpers for the emote burst: tiny reactions fly out of the big emoji on a ballistic path (an initial push in an
// upward fan, then gravity), so a reaction feels thrown rather than faded in.

/**
 * Where particle `i` of `n` is at `steps + 1` moments of its flight, as `[{ x, y, s, o }]` (px offsets from the burst
 * centre, scale, opacity). `radius` = how far the push carries it, `gravity` = how far it falls back (px).
 * The fan spans -160deg..-20deg (upwards), so a one-particle burst goes straight up.
 */
export function burstPath(i, n, { radius = 46, gravity = 30, steps = 6 } = {}) {
  const count = Math.max(1, n | 0);
  const a = count === 1 ? -90 : -160 + (140 * (i | 0)) / (count - 1);
  const rad = (a * Math.PI) / 180;
  const vx = Math.cos(rad) * radius;
  const vy = Math.sin(rad) * radius;
  const out = [];
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    out.push({
      x: vx * t,
      y: vy * t + gravity * t * t,
      s: t < 0.2 ? 0.3 + t * 3.5 : 1 - (t - 0.2) * 0.55,
      o: t < 0.12 ? t / 0.12 : t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1,
    });
  }
  return out;
}

/** The sideways sway of the big emoji as it rises: a damped sine, `steps + 1` x offsets in px. */
export function swayPath(amplitude = 7, steps = 8) {
  const out = [];
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    out.push(Math.sin(t * Math.PI * 3) * amplitude * (1 - t * 0.6));
  }
  return out;
}
