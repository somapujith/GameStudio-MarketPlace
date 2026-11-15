// Pure helpers of the tour engine: which steps can be shown right now, how to move between them, where the card goes.
// Nothing here touches React; the DOM is only read through `resolveTarget` / `isRenderable`, which tests can replace.

/** Connected, displayed and not zero-sized (a hidden or collapsed target must never get a spotlight). */
export function isRenderable(el) {
  if (!el || !el.isConnected) return false;
  try {
    if (el.getClientRects().length === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  } catch {
    return false;
  }
}

/** The element a step points at: a CSS selector string or a function returning an Element. null when absent. */
export function resolveTarget(target) {
  if (!target || typeof document === 'undefined') return null;
  try {
    if (typeof target === 'function') {
      const el = target();
      return el && el.nodeType === 1 ? el : null;
    }
    if (typeof target === 'string') {
      // several matches (the same control in the panel and in the dock): the first one that is on screen wins
      const all = document.querySelectorAll(target);
      for (const el of all) if (isRenderable(el)) return el;
      return all[0] || null;
    }
    return target.nodeType === 1 ? target : null;
  } catch {
    return null;
  }
}

/** Rounded viewport rect of an element (px), the unit of the cheap equality check. */
export function measure(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
}

export const sameRect = (a, b) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/** Grow a rect by `pad` on every side. */
export const padRect = (r, pad = 8) => ({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 });

/** Phone overrides applied to a step: `{ target, placement, body }` from `step.phone` win on phones. */
export function applyLayout(step, phone) {
  const o = phone && step.phone && typeof step.phone === 'object' ? step.phone : null;
  const has = (k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  return {
    ...step,
    target: has('target') ? o.target : step.target,
    placement: (has('placement') && o.placement) || step.placement || 'auto',
    body: (has('body') && o.body) || step.body,
  };
}

/**
 * The step as it can be shown right now, or null (its `when()` is false, or its target is missing / hidden).
 * A step with no target at all is a centred card. Returns the step with `el` (Element | null) and `center`.
 */
export function resolveStep(step, { phone = false, resolve = resolveTarget, renderable = isRenderable } = {}) {
  if (!step) return null;
  try {
    if (typeof step.when === 'function' && !step.when()) return null;
  } catch {
    return null;
  }
  const s = applyLayout(step, phone);
  if (!s.target || s.placement === 'center') return { ...s, el: null, center: true, placement: 'center' };
  const el = resolve(s.target);
  if (!el || !renderable(el)) return null;
  return { ...s, el, center: false };
}

/** All steps that can be shown right now, in order (resolved). */
export function visibleSteps(steps, opts = {}) {
  const out = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    const r = resolveStep(step, opts);
    if (r) out.push(r);
  }
  return out;
}

/** Index of the next step after `from` that `isShown(step, index)` accepts, or -1 (= finish). */
export function nextIndex(steps, from, isShown = () => true) {
  for (let i = from + 1; i < steps.length; i += 1) if (isShown(steps[i], i)) return i;
  return -1;
}

/** Index of the previous step before `from` that `isShown(step, index)` accepts, or -1 (= none). */
export function prevIndex(steps, from, isShown = () => true) {
  for (let i = from - 1; i >= 0; i -= 1) if (isShown(steps[i], i)) return i;
  return -1;
}

/** "3 of 9" bookkeeping among the steps that can be shown: { pos (0-based), total }. */
export function progressOf(steps, index, isShown = () => true) {
  let pos = 0;
  let total = 0;
  steps.forEach((s, i) => {
    if (i === index || isShown(s, i)) {
      if (i < index) pos += 1;
      total += 1;
    }
  });
  return { pos, total };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * Where the card goes. `rect` is the (already padded) spotlight rect, `card` its size { w, h }, `viewport` { width, height }.
 * placement: 'auto' | 'top' | 'bottom' | 'left' | 'right' | 'center'. Flips to the side that fits, clamps into the viewport
 * (a card bigger than the screen is shrunk: `w` / `h` in the result), and when nothing fits beside the target (a very big
 * target) sits inside the viewport at the edge with the most room.
 * -> { left, top, w, h, placement: 'top'|'bottom'|'left'|'right'|'center'|'inside', arrow: { edge, offset } | null }
 */
export function placeCard(rect, card, viewport, placement = 'auto', { gap = 14, margin = 12 } = {}) {
  const vw = Math.max(0, viewport.width);
  const vh = Math.max(0, viewport.height);
  const w = Math.min(card.w, Math.max(0, vw - margin * 2));
  const h = Math.min(card.h, Math.max(0, vh - margin * 2));
  if (!rect || placement === 'center') {
    return { left: Math.round((vw - w) / 2), top: Math.round((vh - h) / 2), w, h, placement: 'center', arrow: null };
  }

  const space = {
    top: rect.y - gap - margin,
    bottom: vh - (rect.y + rect.h) - gap - margin,
    left: rect.x - gap - margin,
    right: vw - (rect.x + rect.w) - gap - margin,
  };
  const fits = (side) => (side === 'top' || side === 'bottom' ? space[side] >= h : space[side] >= w);
  const order = ['bottom', 'top', 'right', 'left'];
  const wanted = order.includes(placement) ? placement : null;
  const candidates = wanted
    ? [wanted, OPPOSITE[wanted], ...order.filter((s) => s !== wanted && s !== OPPOSITE[wanted])]
    : [...order].sort((a, b) => space[b] - space[a] || order.indexOf(a) - order.indexOf(b));
  const side = candidates.find(fits);

  if (!side) {
    // nothing fits beside the target: tuck the card against the vertical edge that has more room, over the target
    const below = space.bottom >= space.top;
    return {
      left: Math.round(clamp((vw - w) / 2, margin, vw - margin - w)),
      top: Math.round(below ? vh - margin - h : margin),
      w, h, placement: 'inside', arrow: null,
    };
  }

  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let left;
  let top;
  if (side === 'top' || side === 'bottom') {
    left = clamp(cx - w / 2, margin, vw - margin - w);
    top = side === 'bottom' ? rect.y + rect.h + gap : rect.y - gap - h;
  } else {
    top = clamp(cy - h / 2, margin, vh - margin - h);
    left = side === 'right' ? rect.x + rect.w + gap : rect.x - gap - w;
  }
  left = Math.round(left);
  top = Math.round(top);
  const horizontal = side === 'top' || side === 'bottom';
  const offset = horizontal ? clamp(cx - left, 18, w - 18) : clamp(cy - top, 18, h - 18);
  return { left, top, w, h, placement: side, arrow: { edge: OPPOSITE[side], offset: Math.round(offset) } };
}

/** The spotlight as one SVG path: the whole screen with a rounded hole cut out (fill-rule evenodd). Pure. */
export function spotlightPath(rect, viewport, radius = 14) {
  const { width: W, height: H } = viewport;
  const outer = `M0 0H${W}V${H}H0Z`;
  if (!rect) return outer;
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const w = Math.min(W, rect.x + rect.w) - x;
  const h = Math.min(H, rect.y + rect.h) - y;
  if (w <= 0 || h <= 0) return outer;
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  return `${outer}M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
}
