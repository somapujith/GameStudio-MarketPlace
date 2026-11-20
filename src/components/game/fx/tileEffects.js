// The tile effects, drawn on the overlay (never inside a tile, so the board's own CSS is untouched) and glued to the
// tile by fxRuntime.tileScope. All of them are transform / opacity WAAPI animations on small pooled nodes, at most ~6
// at a time per effect. One motion language: anticipation -> action -> settle with the spring / out easings.
//
//   land      a soft ripple + dust puffs where a pawn lands
//   buy       an owner-colour shockwave when a district is bought
//   sold      a 'SOLD' stamp thuds on the tile (auction) + the shockwave
//   snatch    a 'SNATCHED' stamp + the shockwave
//   toll      a gold light sweeps along the tile when rent is due
//   upgrade   a sparkle burst
//   lock      a padlock puffs on (mortgage); unlock = it springs open in gold
//   set       a ribbon of colour sweeps along every tile of the collection, one after the other
//   pulse     two gold rings, twice: "look here" (a feed row was tapped)

const GOLD = '#ffca7a';

/** Durations / easings from the motion tokens (tokens.css), read once per effect. */
export function motionSet(read) {
  const ms = (name, d) => (typeof read.ms === 'function' ? read.ms(name, d) : d);
  const tok = (name, d) => (typeof read.token === 'function' ? read.token(name, d) : d);
  return {
    d2: ms('--dur-2', 220),
    d3: ms('--dur-3', 360),
    d4: ms('--dur-4', 600),
    out: tok('--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)'),
    spring: tok('--ease-spring', 'cubic-bezier(0.34, 1.56, 0.64, 1)'),
    std: tok('--ease-std', 'cubic-bezier(0.4, 0, 0.2, 1)'),
  };
}

const CENTER = 'translate(-50%, -50%)';
const sc = (s, extra = '') => `${CENTER} ${extra} scale(${s})`.replace(/\s+/g, ' ');

function ring(S, host, { color = GOLD, from = 0.3, to = 1.5, delay = 0, dur = 600, o = 0.9, width = 2, ease, cls = 'fx-ring' }) {
  const n = S.node(cls, host);
  n.style.setProperty('--fxc', color);
  if (width !== 2) n.style.setProperty('--fxw', `${width}px`);
  S.anim(
    n,
    [
      { transform: sc(from), opacity: 0 },
      { transform: sc(from + (to - from) * 0.3), opacity: o, offset: 0.22 },
      { transform: sc(to), opacity: 0 },
    ],
    { duration: dur, delay, easing: ease },
  );
  return n;
}

function flash(S, host, { color = GOLD, o = 0.55, delay = 0, dur = 420, ease }) {
  const n = S.node('fx-flash', host);
  n.style.setProperty('--fxc', color);
  S.anim(n, [{ opacity: 0 }, { opacity: o, offset: 0.18 }, { opacity: 0 }], { duration: dur, delay, easing: ease });
  return n;
}

function star(S, host, { angle, dist, delay = 0, dur = 560, size = 0.2, color = '#fff1b0', ease }) {
  const n = S.node('fx-star', host);
  n.style.setProperty('--fxc', color);
  n.style.setProperty('--fxs', `${(size * 100).toFixed(0)}%`);
  const rad = (angle * Math.PI) / 180;
  const x = Math.cos(rad);
  const y = Math.sin(rad);
  S.anim(
    n,
    [
      { transform: `translate(-50%, -50%) translate(0px, 0px) scale(0.1) rotate(0deg)`, opacity: 0 },
      { transform: `translate(-50%, -50%) translate(calc(var(--d) * ${(x * dist * 0.55).toFixed(3)}), calc(var(--d) * ${(y * dist * 0.55).toFixed(3)})) scale(1.1) rotate(60deg)`, opacity: 1, offset: 0.4 },
      { transform: `translate(-50%, -50%) translate(calc(var(--d) * ${(x * dist).toFixed(3)}), calc(var(--d) * ${(y * dist).toFixed(3)})) scale(0.2) rotate(140deg)`, opacity: 0 },
    ],
    { duration: dur, delay, easing: ease },
  );
  return n;
}

/** Soft ripple + dust where a pawn comes to rest. */
function land(S, host, mo, spec) {
  ring(S, host, { color: 'rgba(255, 255, 255, 0.9)', from: 0.35, to: 1.55, dur: mo.d4 * 1.05, o: 0.75, ease: mo.out });
  ring(S, host, { color: spec.color || GOLD, from: 0.3, to: 1.25, dur: mo.d4, delay: 120, o: 0.7, ease: mo.out });
  const spread = [-0.46, -0.16, 0.18, 0.46];
  spread.forEach((dx, i) => {
    const n = S.node('fx-dust', host);
    S.anim(
      n,
      [
        { transform: `translate(-50%, -50%) translate(calc(var(--d) * ${(dx * 0.35).toFixed(3)}), calc(var(--d) * 0.28)) scale(0.3)`, opacity: 0 },
        { transform: `translate(-50%, -50%) translate(calc(var(--d) * ${(dx * 0.8).toFixed(3)}), calc(var(--d) * 0.18)) scale(1)`, opacity: 0.6, offset: 0.35 },
        { transform: `translate(-50%, -50%) translate(calc(var(--d) * ${(dx * 1.25).toFixed(3)}), calc(var(--d) * 0.02)) scale(1.5)`, opacity: 0 },
      ],
      { duration: mo.d4 * (0.85 + (i % 2) * 0.2), delay: 40 + i * 25, easing: mo.out },
    );
  });
}

/** The owner-colour shockwave (district bought / won). */
function buy(S, host, mo, spec) {
  const color = spec.color || GOLD;
  flash(S, host, { color, o: 0.6, dur: mo.d3 + 140, ease: mo.out });
  ring(S, host, { color, from: 0.2, to: 2.7, dur: mo.d4 + 120, o: 1, width: 3, ease: mo.out });
  ring(S, host, { color: '#fff', from: 0.2, to: 1.9, dur: mo.d4, delay: 90, o: 0.8, ease: mo.out });
  [-30, 90, 210].forEach((a, i) => star(S, host, { angle: a, dist: 1.35, delay: 60 + i * 40, color, size: 0.22, ease: mo.out, dur: mo.d4 }));
}

/** A rubber stamp thuds onto the tile: scale down from big, slight tilt, hold, fade. */
function stamp(S, host, mo, spec, word) {
  const color = spec.color || GOLD;
  buy(S, host, mo, { ...spec, color });
  const n = S.node('fx-stamp-tag', host);
  n.style.setProperty('--fxc', color);
  n.textContent = word;
  S.anim(
    n,
    [
      { transform: `${CENTER} rotate(-20deg) scale(2.6)`, opacity: 0 },
      { transform: `${CENTER} rotate(-12deg) scale(0.9)`, opacity: 1, offset: 0.22 },
      { transform: `${CENTER} rotate(-12deg) scale(1)`, opacity: 1, offset: 0.3 },
      { transform: `${CENTER} rotate(-12deg) scale(1)`, opacity: 1, offset: 0.78 },
      { transform: `${CENTER} rotate(-12deg) scale(1.04)`, opacity: 0 },
    ],
    { duration: mo.d4 * 2.6, easing: mo.spring },
  );
}

/** Keep a sweeping light inside its tile (rings and stars, which burst past the tile, do not call this). */
function clipTo(host) {
  host.style.overflow = 'hidden';
  host.style.borderRadius = '7%';
}

/** Rent is due: a gold light sweeps across the tile, a red tint pulses under it. */
function toll(S, host, mo, spec) {
  clipTo(host);
  flash(S, host, { color: spec.color || '#ff5d73', o: 0.4, dur: mo.d4 * 1.1, ease: mo.std });
  const n = S.node('fx-sweep', host);
  S.anim(
    n,
    [
      { transform: 'translateX(-160%) skewX(-18deg)', opacity: 0 },
      { transform: 'translateX(-60%) skewX(-18deg)', opacity: 1, offset: 0.2 },
      { transform: 'translateX(260%) skewX(-18deg)', opacity: 0.9, offset: 0.85 },
      { transform: 'translateX(300%) skewX(-18deg)', opacity: 0 },
    ],
    { duration: mo.d4 * 1.25, delay: 80, easing: mo.std },
  );
}

/** Upgrade: a sparkle burst (more and wider for the top level). */
function upgrade(S, host, mo, spec) {
  const color = spec.color || GOLD;
  const n = spec.top ? 6 : 5;
  for (let i = 0; i < n; i += 1) star(S, host, { angle: (360 / n) * i - 90, dist: spec.top ? 1.5 : 1.25, delay: i * 35, size: spec.top ? 0.34 : 0.3, ease: mo.out, dur: mo.d4 + 100 });
  ring(S, host, { color, from: 0.25, to: spec.top ? 2.2 : 1.7, dur: mo.d4, o: 0.9, width: 3, ease: mo.out });
}

/** Mortgage: a padlock puffs on and settles; unlock: it springs open in gold. */
function lock(S, host, mo, spec, open) {
  const smoke = S.node('fx-smoke', host);
  S.anim(
    smoke,
    [
      { transform: sc(0.3), opacity: 0 },
      { transform: sc(0.9), opacity: 0.55, offset: 0.3 },
      { transform: sc(1.8), opacity: 0 },
    ],
    { duration: mo.d4 + 120, easing: mo.out },
  );
  const n = S.node(`fx-lock${open ? ' is-open' : ''}`, host);
  S.anim(
    n,
    [
      { transform: `${CENTER} translateY(-40%) scale(0.3) rotate(${open ? 14 : -14}deg)`, opacity: 0 },
      { transform: `${CENTER} translateY(0) scale(1.3) rotate(${open ? -8 : 8}deg)`, opacity: 1, offset: 0.35 },
      { transform: `${CENTER} translateY(0) scale(1) rotate(0deg)`, opacity: 1, offset: 0.5 },
      { transform: `${CENTER} translateY(0) scale(1) rotate(0deg)`, opacity: 1, offset: 0.82 },
      { transform: `${CENTER} translateY(-18%) scale(0.9) rotate(0deg)`, opacity: 0 },
    ],
    { duration: mo.d4 * 2.2, easing: mo.spring },
  );
  if (open) ring(S, host, { color: spec.color || GOLD, from: 0.3, to: 1.6, dur: mo.d4, o: 0.9, ease: mo.out });
}

/** Pulse ring on a tile ("look here"): two gold rings, twice. */
function pulse(S, host, mo) {
  for (let i = 0; i < 2; i += 1) {
    ring(S, host, { color: GOLD, from: 0.4, to: 1.7, dur: mo.d4 * 1.2, delay: i * mo.d4 * 0.9, o: 0.95, width: 3, ease: mo.out });
  }
  const n = S.node('fx-outline', host);
  S.anim(n, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.2, offset: 0.5 }, { opacity: 0.9, offset: 0.65 }, { opacity: 0 }], { duration: mo.d4 * 2.2, easing: mo.std });
}

const KINDS = {
  land: (S, h, mo, spec) => land(S, h, mo, spec),
  buy: (S, h, mo, spec) => buy(S, h, mo, spec),
  sold: (S, h, mo, spec) => stamp(S, h, mo, spec, 'SOLD'),
  snatch: (S, h, mo, spec) => stamp(S, h, mo, spec, 'SNATCHED'),
  toll: (S, h, mo, spec) => toll(S, h, mo, spec),
  upgrade: (S, h, mo, spec) => upgrade(S, h, mo, spec),
  lock: (S, h, mo, spec) => lock(S, h, mo, spec, false),
  unlock: (S, h, mo, spec) => lock(S, h, mo, spec, true),
  pulse: (S, h, mo) => pulse(S, h, mo),
};

/** Per-kind lifetime guard (ms): an effect whose animations never end is released after this. */
export const MAX_LIFE = 3200;

/**
 * Play one effect `spec = { kind, tile, color?, top? }` (kind 'set' takes `tiles`) on the runtime `rt`.
 * `onEnd` runs once when the whole effect is gone. Returns false when nothing was drawn (tile not on screen).
 */
export function playTileEffect(rt, spec, mo, onEnd) {
  if (spec.kind === 'set') return playSet(rt, spec, mo, onEnd);
  const draw = KINDS[spec.kind];
  if (!draw) return false;
  const ts = rt.tileScope(spec.tile, onEnd);
  if (!ts) return false;
  draw(ts.scope, ts.host, mo, spec);
  ts.scope.settle();
  return true;
}

/** Set complete: a ribbon of the owner's colour sweeps along the tiles of the collection, tile after tile. */
function playSet(rt, spec, mo, onEnd) {
  const tiles = spec.tiles || [];
  let open = 0;
  let drawn = 0;
  const end = () => {
    open -= 1;
    if (open <= 0 && onEnd) onEnd();
  };
  tiles.forEach((tile, i) => {
    open += 1;
    const ts = rt.tileScope(tile, end);
    if (!ts) {
      open -= 1;
      return;
    }
    drawn += 1;
    const { scope: S, host } = ts;
    clipTo(host);
    const color = spec.color || GOLD;
    flash(S, host, { color, o: 0.55, delay: i * 130, dur: mo.d4 * 1.4, ease: mo.std });
    const band = S.node('fx-sweep is-ribbon', host);
    band.style.setProperty('--fxc', color);
    S.anim(
      band,
      [
        { transform: 'translateX(-160%) skewX(-18deg)', opacity: 0 },
        { transform: 'translateX(-60%) skewX(-18deg)', opacity: 1, offset: 0.2 },
        { transform: 'translateX(260%) skewX(-18deg)', opacity: 0.95, offset: 0.85 },
        { transform: 'translateX(300%) skewX(-18deg)', opacity: 0 },
      ],
      { duration: mo.d4 * 1.3, delay: i * 130, easing: mo.std },
    );
    if (i === tiles.length - 1) ring(S, host, { color, from: 0.3, to: 2.2, delay: i * 130 + 200, dur: mo.d4, o: 1, width: 3, ease: mo.out });
    S.settle();
  });
  if (!drawn && onEnd) onEnd();
  return drawn > 0;
}

export const EFFECT_KINDS = Object.keys(KINDS).concat('set');
