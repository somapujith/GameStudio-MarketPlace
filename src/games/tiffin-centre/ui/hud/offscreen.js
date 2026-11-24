// Off-screen customers, pure: where an arrow chip sits at the screen edge for a customer the head is not turned towards.
// Input is what `scene.project(target, out)` returns: { x, y, visible, edge?: { side: 'left' | 'right' | 'behind', x, y } } in CSS px.
export const CHIP_W = 64;
export const CHIP_H = 52;
const PAD = 6;

const fin = (n) => Number.isFinite(n);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Is this projection inside the viewport (so the customer is in view)? */
export function isOnScreen(p, vw, vh, slack = 12) {
  if (!p || p.visible === false || !fin(p.x) || !fin(p.y)) return false;
  return p.x > -slack && p.x < vw + slack && p.y > -slack && p.y < vh + slack;
}

/**
 * Which edge and where. `fallbackSide` is used when the scene gave no edge hint (it is never needed with the first-person scene, but
 * an older scene still works): the side the customer's spot is on relative to where the cook stands.
 * Returns null when the customer is on screen.
 */
export function edgePlacement(p, vw, vh, fallbackSide = 'right') {
  if (isOnScreen(p, vw, vh)) return null;
  const e = p?.edge;
  let side = e && (e.side === 'left' || e.side === 'right' || e.side === 'behind') ? e.side : null;
  if (!side && p && fin(p.x) && p.visible !== false) side = p.x <= 0 ? 'left' : p.x >= vw ? 'right' : null;
  if (!side) side = fallbackSide === 'left' ? 'left' : 'right';
  let x;
  let y;
  if (e && fin(e.x) && fin(e.y)) {
    x = e.x;
    y = e.y;
  } else if (side === 'left') {
    x = 0;
    y = p && fin(p.y) ? p.y : vh * 0.5;
  } else if (side === 'right') {
    x = vw;
    y = p && fin(p.y) ? p.y : vh * 0.5;
  } else {
    x = p && fin(p.x) ? p.x : vw * 0.5;
    y = vh;
  }
  return { side, x, y };
}

/**
 * Lay the chips out: every chip is pulled inside `bounds` ({ top, bottom, left, right }: the free area between the HUD bands),
 * left / right chips stack along their edge, 'behind' chips sit in a row along the bottom of the free area, and nobody overlaps.
 * items: [{ id, side, x, y }] -> [{ id, side, x, y }] (x, y = the chip's CENTRE, CSS px).
 */
export function layoutEdgeChips(items, bounds, size = { w: CHIP_W, h: CHIP_H }) {
  const { top, bottom, left, right } = bounds;
  const hw = size.w / 2;
  const hh = size.h / 2;
  const out = [];
  for (const side of ['left', 'right']) {
    const col = items.filter((i) => i.side === side).sort((a, b) => a.y - b.y || String(a.id).localeCompare(String(b.id)));
    const x = side === 'left' ? left + PAD + hw : right - PAD - hw;
    const lo = top + PAD + hh;
    const hi = bottom - PAD - hh;
    let prev = -Infinity;
    const ys = col.map((i) => {
      const y = Math.max(clamp(fin(i.y) ? i.y : (lo + hi) / 2, lo, hi), prev + size.h + 4);
      prev = y;
      return y;
    });
    // pushing down may overflow the bottom: shift the whole stack back up
    const over = ys.length ? ys[ys.length - 1] - hi : 0;
    col.forEach((i, k) => out.push({ id: i.id, side, x, y: Math.max(lo, ys[k] - Math.max(0, over)) }));
  }
  const back = items.filter((i) => i.side === 'behind').sort((a, b) => a.x - b.x || String(a.id).localeCompare(String(b.id)));
  const y = bottom - PAD - hh;
  const lo = left + PAD + hw;
  const hi = right - PAD - hw;
  let prev = -Infinity;
  const xs = back.map((i) => {
    const x = Math.max(clamp(fin(i.x) ? i.x : (lo + hi) / 2, lo, hi), prev + size.w + 4);
    prev = x;
    return x;
  });
  const over = xs.length ? xs[xs.length - 1] - hi : 0;
  back.forEach((i, k) => out.push({ id: i.id, side: 'behind', x: Math.max(lo, xs[k] - Math.max(0, over)), y }));
  return out;
}

/** Side to use when the scene gives no hint: which way the customer's spot lies from the cook's x. */
export function fallbackSideFor(spotX, cookX) {
  return spotX < cookX ? 'left' : 'right';
}
