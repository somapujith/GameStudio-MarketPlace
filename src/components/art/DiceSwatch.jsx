import { memo, useId } from 'react';
import { cosmeticById } from '@shared/cosmetics.js';
import { lighten, mix } from './palette.js';

/** A dice skin id / short id / item -> the catalogue item of kind 'dice' (falls back to ivory). */
function diceItem(ref) {
  const item = typeof ref === 'object' && ref ? ref : cosmeticById(ref) || cosmeticById(`dice-${ref}`);
  return item && item.kind === 'dice' ? item : cosmeticById('dice-ivory');
}

// ---- the cube: three visible faces, lit from the top-left ----------------------------------------------------------
// Each face is drawn on its own 100x100 square (so pips and material bands are written once) and laid onto the cube by a
// matrix [a b c d e f] that maps the square's (0,0) / (100,0) / (0,100) corners onto the cube's corners.
const FACES = {
  top: { m: '.4 .22 -.4 .22 50 4', poly: '50,4 90,26 50,48 10,26', v: [0, 1, 1, 0] },
  left: { m: '.4 .22 0 .44 10 26', poly: '10,26 50,48 50,92 10,70', v: [0, 0, 1, 1] },
  right: { m: '.4 -.22 0 .44 50 48', poly: '50,48 90,26 90,70 50,92', v: [0, 0, 1, 1] },
};
const KEYS = ['top', 'left', 'right'];
const OUTLINE = '50,4 90,26 90,70 50,92 10,70 10,26';

const PIPS = {
  1: [[50, 50]],
  2: [[26, 26], [74, 74]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[26, 26], [74, 26], [26, 74], [74, 74]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[26, 24], [74, 24], [26, 50], [74, 50], [26, 76], [74, 76]],
};

/** The value on the top and right faces, given the one on the left: two faces that touch it and each other. */
function neighbours(face) {
  const left = PIPS[face] ? face : 5;
  const near = [1, 2, 3, 4, 5, 6].filter((n) => n !== left && n !== 7 - left);
  const top = near[0];
  return { left, top, right: near.find((n) => n !== top && n !== 7 - top) };
}

// the face-space shapes below: polygons are bands/streaks (the points sit outside the square so they run edge to edge)
const band = (a, b) => `-10,${a} ${a},-10 ${b},-10 -10,${b}`;
const STAR = (x, y, s) => `M${x} ${y - s}L${x + s * 0.27} ${y - s * 0.27}L${x + s} ${y}L${x + s * 0.27} ${y + s * 0.27}L${x} ${y + s}L${x - s * 0.27} ${y + s * 0.27}L${x - s} ${y}L${x - s * 0.27} ${y - s * 0.27}Z`;
const RING = [[0, 0], [50, 0], [100, 0], [100, 50], [100, 100], [50, 100], [0, 100], [0, 50]];

const HOLO = ['#ff9df5', '#b69bff', '#6fe0ff', '#7dffc4', '#fff58a', '#ffa98a'];

/**
 * The material of a skin: `stops` = the colour ramp of every face (diagonal from the light, or `vert`), `light` = how much
 * lighter the top and darker the sides get, `pip` = how the pips are cut, `layers(g)` = the face-space artwork on top
 * (g = id of the shared soft-band gradient). Skins without a finish get a plain lit cube from their three colours.
 */
function material(item) {
  const [fc, pc, ec] = item.colors || ['#fbf7ef', '#1b1340', '#d9cdb5'];
  const glow = item.glow || ec;
  const base = { fc, pc, ec, glow, stroke: mix(ec, '#000000', 0.45), shade: mix(ec, '#000000', 0.55), top: 0.2, side: 0.3, pip: 'plain', vert: false, defs: null, layers: () => null };
  const rim = (c, o = 0.5, w = 6) => <rect x="3" y="3" width="94" height="94" rx="10" fill="none" stroke={c} strokeOpacity={o} strokeWidth={w} />;
  const dots = () => (
    <>
      <circle cx="24" cy="20" r="4" fill="#fff" />
      <circle cx="72" cy="78" r="2.2" fill="#fff" opacity=".8" />
    </>
  );
  const facets = (cx) => (
    <>
      {RING.map(([x, y], i) => {
        const [x2, y2] = RING[(i + 1) % 8];
        return <polygon key={i} points={`50,50 ${x},${y} ${x2},${y2}`} fill={i % 2 ? '#000' : '#fff'} opacity={i % 2 ? 0.2 : 0.16} />;
      })}
      {cx}
      <path d="M0 0L100 100M100 0L0 100" stroke="#fff" strokeOpacity=".3" strokeWidth="1.2" fill="none" />
    </>
  );

  switch (item.finish) {
    case 'gold':
      return { ...base, pip: 'engraved', shade: '#3a1c00', stops: [[0, lighten(fc, 0.55)], [0.3, fc], [0.62, mix(fc, ec, 0.6)], [1, mix(ec, '#2a1500', 0.3)]],
        layers: () => (
          <>
            <ellipse cx="96" cy="100" rx="40" ry="28" fill={glow} opacity=".3" />
            <polygon points={band(34, 52)} fill="#fff" opacity=".62" />
            <polygon points={band(60, 66)} fill="#fff" opacity=".32" />
          </>
        ) };
    case 'silver':
      return { ...base, pip: 'engraved', shade: '#1c2333', stops: [[0, '#f4f7ff'], [0.28, fc], [0.58, mix(fc, ec, 0.6)], [1, mix(ec, '#27304a', 0.5)]],
        defs: (g) => (
          <linearGradient id={g}>
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".5" stopColor="#fff" stopOpacity=".55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        ),
        layers: (g) => (
          <>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={i} x="0" y={i * 12.5 + 3} width="100" height="4" fill="#fff" opacity=".16" />)}
            <rect x="-20" y="-30" width="46" height="170" transform="rotate(35 50 50)" fill={`url(#${g})`} />
          </>
        ) };
    case 'chrome':
      return { ...base, pip: 'engraved', shade: '#0b1020', top: 0.05, side: 0.22, vert: true,
        stops: [[0, '#131d36'], [0.28, '#2c4a7c'], [0.45, '#6f93c9'], [0.482, '#ffffff'], [0.56, '#e8f0fb'], [0.78, '#93a4bf'], [1, '#3d4b66']],
        layers: () => (
          <>
            <rect x="0" y="47" width="100" height="2" fill="#fff" opacity=".85" />
            <polygon points={band(30, 38)} fill="#fff" opacity=".55" />
            <ellipse cx="26" cy="20" rx="18" ry="5" fill="#fff" opacity=".95" transform="rotate(-28 26 20)" />
          </>
        ) };
    case 'rosegold':
      return { ...base, pip: 'engraved', shade: '#3d1620', stops: [[0, lighten(fc, 0.6)], [0.34, fc], [0.66, mix(fc, ec, 0.6)], [1, mix(ec, '#2a0f14', 0.2)]],
        layers: () => (
          <>
            <ellipse cx="92" cy="98" rx="34" ry="24" fill="#ffd6dc" opacity=".35" />
            <polygon points={band(38, 52)} fill="#fff" opacity=".42" />
          </>
        ) };
    case 'bronze':
      return { ...base, pip: 'engraved', shade: '#2a1405', top: 0.14, stops: [[0, lighten(fc, 0.2)], [0.4, fc], [0.72, mix(fc, ec, 0.6)], [1, mix(ec, '#000000', 0.35)]],
        layers: () => (
          <>
            <ellipse cx="84" cy="90" rx="22" ry="16" fill="#5fb89c" opacity=".32" />
            <ellipse cx="8" cy="72" rx="14" ry="10" fill="#5fb89c" opacity=".26" />
            <ellipse cx="24" cy="14" rx="40" ry="24" fill="#fff" opacity=".15" />
          </>
        ) };
    case 'obsidian':
      return { ...base, pip: 'glow', shade: '#02020a', top: 0.1, stops: [[0, mix(fc, '#5a5a82', 0.4)], [0.34, fc], [1, '#07070c']],
        layers: () => (
          <>
            <ellipse cx="90" cy="100" rx="40" ry="26" fill={glow} opacity=".3" />
            <polygon points={band(30, 50)} fill="#fff" opacity=".34" />
            <polygon points={band(56, 62)} fill="#fff" opacity=".2" />
          </>
        ) };
    case 'ruby':
      return { ...base, pip: 'cut', shade: mix(ec, '#000000', 0.55), stops: [[0, lighten(fc, 0.35)], [0.45, fc], [1, mix(fc, '#000000', 0.35)]],
        layers: () => (
          <>
            {facets(<rect x="24" y="24" width="52" height="52" fill="#fff" opacity=".12" stroke="#fff" strokeOpacity=".4" strokeWidth="1.2" />)}
            {rim(glow)}
            {dots()}
          </>
        ) };
    case 'emerald':
      return { ...base, pip: 'cut', shade: mix(ec, '#000000', 0.55), stops: [[0, lighten(fc, 0.35)], [0.45, fc], [1, mix(fc, '#000000', 0.35)]],
        layers: () => (
          <>
            {[[10, 80, 0.06], [22, 56, 0.1], [36, 28, 0.18]].map(([p, w, o]) => (
              <rect key={p} x={p} y={p} width={w} height={w} fill="#fff" opacity={o} stroke="#fff" strokeOpacity=".35" strokeWidth="1.2" />
            ))}
            <path d="M0 0L100 100M100 0L0 100" stroke="#fff" strokeOpacity=".28" strokeWidth="1.2" fill="none" />
            {rim(glow)}
            {dots()}
          </>
        ) };
    case 'crystal':
      return { ...base, pip: 'engraved', shade: '#1d3f66', top: 0.1, side: 0.2, stops: [[0, '#ffffff'], [0.4, fc], [1, mix(ec, fc, 0.45)]],
        layers: () => (
          <>
            <polygon points={band(26, 38)} fill="#7cc8ff" opacity=".34" />
            <polygon points={band(52, 56)} fill="#fff" opacity=".75" />
            <polygon points={band(74, 88)} fill="#6fbfff" opacity=".26" />
            {rim('#fff', 0.55, 5)}
            <ellipse cx="26" cy="18" rx="22" ry="9" fill="#fff" opacity=".55" />
          </>
        ) };
    case 'jade':
      return { ...base, pip: 'engraved', shade: '#0c2a1c', top: 0.16, side: 0.26, stops: [[0, lighten(fc, 0.4)], [0.45, fc], [1, mix(fc, ec, 0.65)]],
        layers: () => (
          <>
            <ellipse cx="70" cy="30" rx="26" ry="18" fill="#fff" opacity=".26" />
            <ellipse cx="30" cy="74" rx="26" ry="20" fill={ec} opacity=".34" />
            <path d="M18 56C34 34 56 72 80 44" stroke="#fff" strokeOpacity=".3" strokeWidth="7" strokeLinecap="round" fill="none" />
            <ellipse cx="24" cy="16" rx="36" ry="18" fill="#fff" opacity=".28" />
          </>
        ) };
    case 'holo':
      return { ...base, pip: 'engraved', shade: '#2a1a5e', top: 0.12, side: 0.24, stops: HOLO.map((c, i) => [i / 5, c]),
        layers: () => (
          <>
            <rect x="0" y="0" width="100" height="100" fill="#fff" opacity=".2" />
            <polygon points={band(28, 40)} fill="#ff9df5" opacity=".38" />
            <polygon points={band(50, 62)} fill="#6fe0ff" opacity=".34" />
            <polygon points={band(72, 84)} fill="#fff58a" opacity=".34" />
            <polygon points={band(18, 24)} fill="#fff" opacity=".7" />
          </>
        ) };
    default:
      // plain skins (ivory, biryani, cyber, bangle): a simply lit cube from [face, pip, edge]
      return { ...base, stops: [[0, lighten(fc, 0.35)], [0.5, fc], [1, mix(fc, ec, 0.55)]] };
  }
}

/** One pip, cut the way the material asks: plain dot, engraved (light lower lip), glowing, or a pale cut-out. */
function Pip({ kind, x, y, r, mat }) {
  switch (kind) {
    case 'engraved':
      return (
        <>
          <circle cx={x} cy={y + r * 0.28} r={r} fill="#fff" opacity=".55" />
          <circle cx={x} cy={y} r={r} fill={mat.pc} />
          <circle cx={x} cy={y - r * 0.2} r={r * 0.72} fill="#000" opacity=".22" />
        </>
      );
    case 'glow':
      return (
        <>
          <circle cx={x} cy={y} r={r * 1.7} fill={mat.pc} opacity=".18" />
          <circle cx={x} cy={y} r={r * 1.3} fill={mat.pc} opacity=".28" />
          <circle cx={x} cy={y} r={r} fill={mat.pc} />
          <circle cx={x - r * 0.25} cy={y - r * 0.3} r={r * 0.35} fill="#fff" opacity=".7" />
        </>
      );
    case 'cut':
      return (
        <>
          <circle cx={x} cy={y - r * 0.25} r={r} fill="#000" opacity=".4" />
          <circle cx={x} cy={y} r={r} fill={mat.pc} />
        </>
      );
    default:
      return (
        <>
          <circle cx={x} cy={y} r={r} fill={mat.pc} />
          <circle cx={x - r * 0.3} cy={y - r * 0.35} r={r * 0.35} fill="#fff" opacity=".22" />
        </>
      );
  }
}

/**
 * Small solid die preview drawn from a dice skin: a pseudo-3D cube (top, left, right; lit from the top-left) with a
 * material per `finish`. `shine` adds the sweep and sparkles of the legendary finishes (CSS in dice-finishes.css, `dsw-*`).
 * No SVG filters: shop grids render many of these at once.
 */
function DiceSwatchBase({ skin = 'dice-ivory', size = 32, face = 5, className, title, shine = false }) {
  const uid = `ds${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const item = diceItem(skin);
  const mat = material(item);
  const label = title || undefined;
  const values = neighbours(face);
  const g = `${uid}g`;
  const light = { top: ['#ffffff', mat.top], left: [mat.shade, 0.1], right: [mat.shade, mat.side] };
  const sparkle = !!shine && item.rarity === 'legendary';

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
    >
      {label ? <title>{label}</title> : null}
      <defs>
        {KEYS.map((k) => {
          const f = FACES[k];
          const v = mat.vert ? [0, 0, 0, 1] : f.v;
          return (
            <linearGradient key={k} id={`${uid}${k}`} x1={v[0]} y1={v[1]} x2={v[2]} y2={v[3]}>
              {mat.stops.map(([o, c], i) => <stop key={i} offset={o} stopColor={c} />)}
            </linearGradient>
          );
        })}
        {KEYS.map((k) => <clipPath key={k} id={`${uid}c${k}`}><polygon points={FACES[k].poly} /></clipPath>)}
        <clipPath id={`${uid}co`}><polygon points={OUTLINE} /></clipPath>
        {mat.defs ? mat.defs(g) : null}
        {sparkle ? (
          <linearGradient id={`${uid}sh`}>
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".5" stopColor="#fff" stopOpacity=".85" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        ) : null}
      </defs>

      {/* cast shadow on the table */}
      <ellipse cx="56" cy="95" rx="36" ry="4.6" fill="#05031a" opacity=".3" />

      {KEYS.map((k) => {
        const f = FACES[k];
        const r = values[k] === 1 ? 15 : 11;
        return (
          <g key={k} clipPath={`url(#${uid}c${k})`}>
            <g transform={`matrix(${f.m})`}>
              <rect x="0" y="0" width="100" height="100" fill={`url(#${uid}${k})`} />
              {mat.layers(g)}
              {(PIPS[values[k]] || PIPS[5]).map(([x, y], i) => <Pip key={i} kind={mat.pip} x={x} y={y} r={r} mat={mat} />)}
            </g>
            {/* the face's angle to the light: the top catches it, the right side turns away */}
            <polygon points={f.poly} fill={light[k][0]} opacity={light[k][1]} />
          </g>
        );
      })}

      {/* bevels: dark seams, a light edge on the lit corner and the front edge, then the glint */}
      {KEYS.map((k) => <polygon key={k} points={FACES[k].poly} fill="none" stroke={mat.stroke} strokeWidth="2.2" strokeLinejoin="round" />)}
      <path d="M11 26.5L50 5L89 26.5" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 50V90" fill="none" stroke="#fff" strokeOpacity=".32" strokeWidth="1.2" strokeLinecap="round" />
      {item.finish ? <path d={STAR(30, 15, 6.5)} fill="#fff" opacity=".92" /> : <ellipse cx="28" cy="14" rx="9" ry="3" fill="#fff" opacity=".4" transform="rotate(-24 28 14)" clipPath={`url(#${uid}co)`} />}

      {sparkle ? (
        <g clipPath={`url(#${uid}co)`} aria-hidden="true">
          <g className="dsw-sweep"><rect x="-6" y="-10" width="16" height="120" transform="skewX(-20)" fill={`url(#${uid}sh)`} /></g>
          <path className="dsw-star dsw-star--a" d={STAR(34, 18, 7)} fill="#fff" />
          <path className="dsw-star dsw-star--b" d={STAR(72, 38, 5.5)} fill="#fff" />
          <path className="dsw-star dsw-star--c" d={STAR(26, 66, 5)} fill="#fff" />
        </g>
      ) : null}
    </svg>
  );
}
export const DiceSwatch = memo(DiceSwatchBase);
