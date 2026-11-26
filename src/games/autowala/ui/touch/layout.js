// Where every touch control goes. Pure (viewport + settings in, pixel boxes out) so it is unit-tested in layout.test.js.
// Coordinates are measured from the control's own edge: `x` from the WHEEL side or the PEDAL side of the screen (the left-handed mirror
// just swaps which physical side that is), `y` from the bottom. Safe-area insets are added by the renderer (CSS env()).
import { SIZE_SCALE } from './touchSettings.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v);

/** Which physical side ('left' | 'right') a zone sits on. zone: 'wheel' (steering) or 'pedal' (pedals + action buttons). */
export function sideFor(hand, zone) {
  const wheelLeft = hand !== 'left';
  if (zone === 'wheel') return wheelLeft ? 'left' : 'right';
  return wheelLeft ? 'right' : 'left';
}

/** Mirror a box from one physical side to the other inside a viewport of width `vw`: x is the left edge of a box `w` wide. */
export function mirrorX(x, w, vw) {
  return vw - x - w;
}

/** 'land' (wider than tall) or 'port'. */
export const orientationOf = (w, h) => (w > h ? 'land' : 'port');

/** Action buttons in the order they appear on the thumb cluster. kind: 'hold' stays down while pressed, 'tap' fires once. */
export const MAIN_ACTIONS = [
  { id: 'boost', label: 'Boost', kind: 'hold', input: 'boost' },
  { id: 'handbrake', label: 'Handbrake and drift', kind: 'hold', input: 'handbrake' },
  { id: 'interact', label: 'Interact', kind: 'tap', input: 'interact' },
  { id: 'horn', label: 'Horn', kind: 'tap', input: 'horn' },
  { id: 'camera', label: 'Camera', kind: 'tap', input: 'camera' },
];
/** The small, rarely used actions (a row on roomy screens, the "..." tray on small ones). */
export const MINOR_ACTIONS = [
  { id: 'map', label: 'Map', input: 'map' },
  { id: 'radio', label: 'Radio', input: 'radio' },
  { id: 'phone', label: 'Phone', input: 'phone' },
  { id: 'quests', label: 'Quests', input: 'quests' },
  { id: 'pause', label: 'Pause', input: 'pause' },
];

/**
 * The whole layout. Returns
 *   { mode, scale, margin, btn, mini, wheel:{size,x,y}, gas:{w,h,x,y}, brake:{w,h,x,y}, actions:[{id,x,y}], tray:{x,y,inline,from}, minor:{x,y,from}|null,
 *     arrows:{w,h,x,y,gap}, leftW, rightW, h }
 * `leftW`/`rightW` are the widths (px, before safe-area insets) the wheel side / pedal side occupy, `h` the height from the bottom.
 */
export function computeLayout({ w, h }, { size = 'M' } = {}) {
  const sc = SIZE_SCALE[size] || 1;
  const mode = orientationOf(w, h);
  let btn = size === 'S' ? 48 : size === 'L' ? 56 : 52;
  if (mode === 'port' && w < 400) btn = Math.min(btn, 48); // keep a row of six inside a 360 px phone
  const mini = size === 'L' ? 44 : 40;
  const gap = 8;
  const m = mode === 'land' ? 14 : 12;
  let wheel;
  let gasW;
  let gasH;
  if (mode === 'land') {
    wheel = clamp(Math.min(w * 0.28, h * 0.46), 116, 250) * sc;
    gasW = clamp(h * 0.23, 68, 112) * sc;
    gasH = clamp(h * 0.34, 104, 190) * sc;
  } else {
    wheel = clamp(w * 0.36, 112, 230) * sc;
    gasW = clamp(w * 0.2, 62, 104) * sc;
    gasH = clamp(w * 0.34, 98, 170) * sc;
  }
  let brakeW = gasW * 0.76;
  let brakeH = gasH * 0.68;
  const trayInline = mode === 'port' ? w >= 560 : h >= 560; // roomy: show the small row, else a "..." tray

  const build = (f) => {
    const W = wheel * f;
    const GW = gasW * f;
    const GH = gasH * f;
    const BW = brakeW * f;
    const BH = brakeH * f;
    const pedalsW = GW + gap + BW;
    const out = {
      mode, scale: sc * f, margin: m, btn, mini,
      wheel: { size: round(W), x: m, y: m },
      gas: { w: round(GW), h: round(GH), x: m, y: m },
      brake: { w: round(BW), h: round(BH), x: round(m + GW + gap), y: m },
      arrows: { w: round(W * 0.5), h: round(W * 0.72), x: m, y: m, gap: round(Math.max(10, W * 0.06)) },
      actions: [],
      tray: { x: m, y: round(m + W + 8), inline: trayInline, from: 'wheel' },
      minor: null,
    };
    if (mode === 'land') {
      const gx = round(m + (GW - btn) / 2); // over the gas
      const bx = round(m + GW + gap + (BW - btn) / 2); // over the brake
      const step = btn + 10;
      const wide = w >= 780; // roomy: a third column beside the pedals; narrow: stack above them so the road stays free
      const col = round(m + pedalsW + 14);
      out.actions = wide
        ? [
            { id: 'boost', x: gx, y: round(m + GH + 10) },
            { id: 'handbrake', x: bx, y: round(m + BH + 10) },
            { id: 'interact', x: col, y: m },
            { id: 'horn', x: col, y: m + step },
            { id: 'camera', x: col, y: m + 2 * step },
          ]
        : [
            { id: 'boost', x: gx, y: round(m + GH + 10) },
            { id: 'horn', x: gx, y: round(m + GH + 10 + step) },
            { id: 'handbrake', x: bx, y: round(m + BH + 10) },
            { id: 'interact', x: bx, y: round(m + BH + 10 + step) },
            // the camera is the least urgent: on a narrow screen it sits above the wheel, next to the "..." tray
            { id: 'camera', x: round(m + btn + 4), y: round(m + W + 8), from: 'wheel' },
          ];
      if (trayInline) out.minor = { x: m, y: round(m + W + 8), from: 'wheel' };
      let rightW = m + pedalsW + m;
      let top = m + Math.max(GH, BH);
      for (const a of out.actions) {
        if (a.from === 'wheel') continue;
        rightW = Math.max(rightW, a.x + btn + m);
        top = Math.max(top, a.y + btn);
      }
      const leftW = m + W + m;
      const leftTop = m + W + 8 + (trayInline ? mini : btn);
      return { ...out, leftW: round(leftW), rightW: round(rightW), h: round(Math.max(top, leftTop) + 6) };
    }
    // portrait: the actions are one row above the wheel and pedals, the pedal-side edge aligned
    const base = round(m + Math.max(W, GH) + 10);
    const n = MAIN_ACTIONS.length;
    const rowGap = 6;
    out.actions = MAIN_ACTIONS.map((a, i) => ({ id: a.id, x: round(m + i * (btn + rowGap)), y: base }));
    // the tray button sits at the far (wheel-side) end of the row; the inline small row goes above
    out.tray = { x: round(m + n * (btn + rowGap)), y: base, inline: trayInline, from: 'pedal' };
    if (trayInline) out.minor = { x: m, y: round(base + btn + 8), from: 'pedal' };
    const top = base + btn + (trayInline ? 8 + mini : 0) + 6;
    return { ...out, leftW: round(m + W + m), rightW: round(m + pedalsW + m), h: round(top) };
  };

  // keep the middle of the screen (the road) free: if the two sides eat more than ~62% of the width, shrink them
  let f = 1;
  let L = build(1);
  if (mode === 'land') {
    const cap = w * 0.62;
    for (let i = 0; i < 4 && L.leftW + L.rightW > cap && f > 0.62; i++) {
      f = Math.max(0.62, f * (cap / (L.leftW + L.rightW)));
      L = build(f);
    }
  }
  return { ...L, fit: f };
}

/**
 * The occupied regions (CSS pixels from the screen edges) from measured boxes. `items`: [{ zone: 'wheel' | 'pedal' | 'row', rect }].
 * 'row' (the portrait action row that spans both sides) only counts toward the height. Returns { left, right, h } in the PHYSICAL
 * sides, so the HUD never needs to know about handedness.
 */
export function regionsFromRects(items, vw, vh, hand = 'right') {
  let wheelW = 0;
  let pedalW = 0;
  let top = vh;
  const wheelLeft = hand !== 'left';
  for (const it of items) {
    const r = it && it.rect;
    if (!r || !(r.width > 0 || r.right - r.left > 0)) continue;
    if (it.zone === 'wheel') wheelW = Math.max(wheelW, wheelLeft ? r.right : vw - r.left);
    else if (it.zone === 'pedal') pedalW = Math.max(pedalW, wheelLeft ? vw - r.left : r.right);
    top = Math.min(top, r.top);
  }
  const hOut = top < vh ? Math.round(vh - top) : 0;
  const a = Math.round(wheelW);
  const b = Math.round(pedalW);
  return wheelLeft ? { left: a, right: b, h: hOut } : { left: b, right: a, h: hOut };
}

/** CSS position for a box anchored `x` px from a physical side and `y` px from the bottom, inside the safe area. */
export function place(side, x, y) {
  return {
    [side]: `calc(${x}px + env(safe-area-inset-${side}, 0px))`,
    bottom: `calc(${y}px + env(safe-area-inset-bottom, 0px))`,
  };
}
