// Shop cosmetics art: avatar frames, dice-skin swatches, title chips and a kind-dispatching preview.
// Items come from shared/cosmetics.js; every component accepts an item object, a full id ('frame-lake') or a short id ('lake').
import { memo, useId } from 'react';
import { cosmeticById } from '@shared/cosmetics.js';
import { lighten, darken, mix } from './palette.js';
import { Avatar } from './Avatar.jsx';
import { VoiceArt } from '../voice/VoiceShop.jsx';
import { DiceSwatch } from './DiceSwatch.jsx';
import TrailPreview from './TrailPreview.jsx';
import BoardThemePreview from './BoardThemePreview.jsx';
import '@/styles/cosmetics-shine.css';

export const RARITY_COLORS = { common: '#9fb0d8', rare: '#4cc9f0', epic: '#c58cff', legendary: '#ffcf5a' };
/** CSS colour for a rarity: the theme's `--rarity-<r>` token (hub.css; darker in the light theme) over the night default. */
export const rarityVar = (rarity) => {
  const r = RARITY_COLORS[rarity] ? rarity : 'common';
  return `var(--rarity-${r}, ${RARITY_COLORS[r]})`;
};

const uidOf = (raw) => 'cs' + raw.replace(/[^a-zA-Z0-9]/g, '');

/** Resolve an item, id or short id of the given kind ('frame' | 'dice' | 'title') -> catalogue item or null. */
export function resolveCosmetic(ref, kind) {
  if (!ref) return null;
  if (typeof ref === 'object') return !kind || ref.kind === kind ? ref : null;
  const item = cosmeticById(ref) || (kind ? cosmeticById(`${kind}-${ref}`) : null);
  return item && (!kind || item.kind === kind) ? item : null;
}

/** Inner diameter left for the avatar inside a frame of `size`. */
export const frameInner = (size = 48) => Math.round(size * 0.78);

const frameKey = (item) => String(item.id).replace(/^frame-/, '');

/* ---- geometry helpers for the newer frames (viewBox 0..100, centre 50,50) ---- */
const f2 = (n) => n.toFixed(2);
const pt = (r, deg) => {
  const t = (deg * Math.PI) / 180;
  return [50 + Math.cos(t) * r, 50 + Math.sin(t) * r];
};
const arcPath = (r, d0, d1) => {
  const [x0, y0] = pt(r, d0);
  const [x1, y1] = pt(r, d1);
  return `M${f2(x0)} ${f2(y0)}A${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${f2(x1)} ${f2(y1)}`;
};
const polyPath = (pts) => 'M' + pts.map(([x, y]) => `${f2(x)} ${f2(y)}`).join('L') + 'Z';
/** Per-instance animation phase (a negative delay, 0..-7.2s) so a screen of legendary frames/chips does not pulse in unison. */
export const shinePhase = (seed) => {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${-((h % 7200) / 1000)}s`;
};

// Emerald-cut stone outline (x runs along the ring), its table (inner step) and the facet lines joining them.
const STONE_HW = 5.4, STONE_HH = 4.2, STONE_CUT = 1.8;
const stoneOctagon = (k) => {
  const w = STONE_HW * k, h = STONE_HH * k, c = STONE_CUT * k;
  return [[-w + c, -h], [w - c, -h], [w, -h + c], [w, h - c], [w - c, h], [-w + c, h], [-w, h - c], [-w, -h + c]];
};
const STONE_OUT = polyPath(stoneOctagon(1));
const STONE_TABLE = polyPath(stoneOctagon(0.56));
const STONE_FACETS = stoneOctagon(1)
  .map((p, i) => `M${f2(p[0])} ${f2(p[1])}L${f2(stoneOctagon(0.56)[i][0])} ${f2(stoneOctagon(0.56)[i][1])}`)
  .join('');

// Round-brilliant stone, top view: 8-sided girdle, table, and star facets (outer vertex <-> table vertex).
const BRILLIANT_OUT = polyPath(Array.from({ length: 8 }, (_, k) => [Math.cos(((k * 45 + 22.5) * Math.PI) / 180) * 4.6, Math.sin(((k * 45 + 22.5) * Math.PI) / 180) * 4.6]));
const BRILLIANT_TABLE = polyPath(Array.from({ length: 8 }, (_, k) => [Math.cos((k * 45 * Math.PI) / 180) * 2.2, Math.sin((k * 45 * Math.PI) / 180) * 2.2]));
const BRILLIANT_FACETS = Array.from({ length: 8 }, (_, k) => {
  // table vertex k (angle k*45) fans out to the two girdle vertices either side of it
  const rad = (deg) => (deg * Math.PI) / 180;
  const xy = (r, deg) => `${f2(Math.cos(rad(deg)) * r)} ${f2(Math.sin(rad(deg)) * r)}`;
  return `M${xy(4.6, k * 45 - 22.5)}L${xy(2.2, k * 45)}L${xy(4.6, k * 45 + 22.5)}`;
}).join('');
const GLINT_STAR = 'M0 -6L1.2 -1.2L6 0L1.2 1.2L0 6L-1.2 1.2L-6 0L-1.2 -1.2Z';

/** The slow specular arc that circles a legendary ring once per loop (CSS-animated `cx-orbit`; a fixed highlight when motion is off). */
function SweepArc({ u, r = 44.5, width = 7 }) {
  const [x0, y0] = pt(r, -155);
  const [x1, y1] = pt(r, -115);
  return (
    <>
      <defs>
        <linearGradient id={u + 'sw'} gradientUnits="userSpaceOnUse" x1={f2(x0)} y1={f2(y0)} x2={f2(x1)} y2={f2(y1)}>
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="cx-orbit" d={arcPath(r, -155, -115)} fill="none" stroke={`url(#${u}sw)`} strokeWidth={width} strokeLinecap="round" />
    </>
  );
}

function FrameRing({ item, u }) {
  const [a, b] = item.colors || ['#ffffff', '#c9c3e6'];
  const key = frameKey(item);
  const g = `url(#${u}g)`;
  if (key === 'silver') {
    const per = (2 * Math.PI * 46.6) / 72;
    return (
      <g>
        <defs>
          <linearGradient id={u + 'g'} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".2" stopColor={a} />
            <stop offset=".44" stopColor={mix(a, b, 0.55)} />
            <stop offset=".6" stopColor={lighten(b, 0.42)} />
            <stop offset=".82" stopColor={b} />
            <stop offset="1" stopColor={darken(b, 0.35)} />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="44.5" fill="none" stroke={g} strokeWidth="8.4" />
        <circle cx="50" cy="50" r="46.6" fill="none" stroke={darken(b, 0.4)} strokeWidth="2.6" strokeDasharray={`.55 ${f2(per - 0.55)}`} opacity=".5" />
        <path d={arcPath(44.5, 15, 105)} fill="none" stroke={darken(b, 0.4)} strokeWidth="8.4" opacity=".22" />
        <circle cx="50" cy="50" r="48.9" fill="none" stroke={darken(b, 0.3)} strokeWidth="1" />
        <circle cx="50" cy="50" r="40.5" fill="none" stroke="#fff" strokeWidth=".8" opacity=".75" />
        <path d={arcPath(43.2, -162, -104)} fill="none" stroke="#eaf6ff" strokeWidth="2" strokeLinecap="round" opacity=".92" />
        <path d={arcPath(46.4, 28, 52)} fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity=".4" />
        <circle cx={f2(pt(43.2, -132)[0])} cy={f2(pt(43.2, -132)[1])} r="1.1" fill="#fff" />
      </g>
    );
  }
  if (key === 'emerald') {
    const stones = [];
    const prongs = [];
    for (let i = 0; i < 8; i++) {
      const [x, y] = pt(44.5, i * 45 - 90);
      stones.push(
        <g key={i} transform={`translate(${f2(x)} ${f2(y)}) rotate(${i * 45})`}>
          <path d={STONE_OUT} fill={`url(#${u}e)`} stroke={`url(#${u}au)`} strokeWidth="1.1" strokeLinejoin="round" />
          <path d={STONE_TABLE} fill={lighten(a, 0.3)} opacity=".45" stroke={lighten(a, 0.6)} strokeWidth=".4" />
          <path d={STONE_FACETS} fill="none" stroke={lighten(a, 0.55)} strokeWidth=".45" opacity=".8" />
          <path d="M-3.2 -2.2L-.6 -2.2" stroke="#fff" strokeWidth=".7" strokeLinecap="round" opacity=".8" />
        </g>,
      );
      const [px, py] = pt(44.5, i * 45 - 90 + 22.5);
      prongs.push(
        <g key={i}>
          <circle cx={f2(px)} cy={f2(py)} r="2.3" fill={`url(#${u}au)`} stroke="#7a4d00" strokeWidth=".5" />
          <circle cx={f2(px - 0.6)} cy={f2(py - 0.7)} r=".7" fill="#fff8d6" />
        </g>,
      );
    }
    return (
      <g>
        <defs>
          <linearGradient id={u + 'g'} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={lighten(b, 0.25)} />
            <stop offset=".5" stopColor={b} />
            <stop offset="1" stopColor={darken(b, 0.45)} />
          </linearGradient>
          <linearGradient id={u + 'e'} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={lighten(a, 0.5)} />
            <stop offset=".45" stopColor={a} />
            <stop offset="1" stopColor={darken(b, 0.1)} />
          </linearGradient>
          <linearGradient id={u + 'au'} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff0b0" />
            <stop offset=".5" stopColor="#e0a21f" />
            <stop offset="1" stopColor="#8f5a0a" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="44.5" fill="none" stroke={g} strokeWidth="6.6" />
        <circle cx="50" cy="50" r="48.4" fill="none" stroke={`url(#${u}au)`} strokeWidth=".9" />
        <circle cx="50" cy="50" r="40.6" fill="none" stroke={`url(#${u}au)`} strokeWidth=".9" />
        {prongs}
        {stones}
      </g>
    );
  }
  if (key === 'obsidian') {
    return (
      <g>
        <defs>
          <linearGradient id={u + 'g'} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={mix(a, '#fff', 0.25)} />
            <stop offset=".22" stopColor={a} />
            <stop offset=".5" stopColor={mix(a, b, 0.6)} />
            <stop offset=".8" stopColor={b} />
            <stop offset="1" stopColor={darken(b, 0.2)} />
          </linearGradient>
          <linearGradient id={u + 'au'} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff0b0" />
            <stop offset=".5" stopColor="#e0a21f" />
            <stop offset="1" stopColor="#8f5a0a" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="44.5" fill="none" stroke={g} strokeWidth="9" />
        <circle cx="50" cy="50" r="49" fill="none" stroke="#07070d" strokeWidth="1.2" />
        <circle cx="50" cy="50" r="40" fill="none" stroke={mix(a, b, 0.4)} strokeWidth=".8" />
        <circle cx="50" cy="50" r="44.5" fill="none" stroke={`url(#${u}au)`} strokeWidth="1" />
        <path d={arcPath(46.3, -172, -104)} fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".6" />
        <path d={arcPath(46.3, -96, -86)} fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".32" />
        <path d={arcPath(42.7, 22, 72)} fill="none" stroke={mix(a, '#fff', 0.4)} strokeWidth="1.4" strokeLinecap="round" opacity=".3" />
      </g>
    );
  }
  if (key === 'aurora') {
    const cols = [a, mix(a, '#4cc9f0', 0.55), mix('#4cc9f0', b, 0.5), b, mix(b, '#ff8fd8', 0.55), mix(b, a, 0.5)];
    const segs = cols.map((c, i) => {
      const [x0, y0] = pt(44.5, i * 60);
      const [x1, y1] = pt(44.5, (i + 1) * 60);
      return { c, n: cols[(i + 1) % cols.length], d: arcPath(44.5, i * 60, (i + 1) * 60 + 1.5), x0, y0, x1, y1 };
    });
    const wave = (phase) => {
      let d = '';
      for (let i = 0; i <= 96; i++) {
        const t = (i / 96) * Math.PI * 2;
        const r = 44.5 + Math.sin(t * 4 + phase) * 2.2;
        d += (i ? 'L' : 'M') + f2(50 + Math.cos(t) * r) + ' ' + f2(50 + Math.sin(t) * r);
      }
      return d + 'Z';
    };
    return (
      <g>
        <defs>
          {segs.map((s, i) => (
            <linearGradient key={i} id={`${u}a${i}`} gradientUnits="userSpaceOnUse" x1={f2(s.x0)} y1={f2(s.y0)} x2={f2(s.x1)} y2={f2(s.y1)}>
              <stop offset="0" stopColor={s.c} />
              <stop offset="1" stopColor={s.n} />
            </linearGradient>
          ))}
        </defs>
        <circle cx="50" cy="50" r="44.5" fill="none" stroke="#150f3a" strokeWidth="9.4" opacity=".6" />
        <g className="cx-drift">
          {segs.map((s, i) => (
            <path key={i} d={s.d} fill="none" stroke={`url(#${u}a${i})`} strokeWidth="8.6" />
          ))}
          <path d={wave(0)} fill="none" stroke="#fff" strokeWidth="2" opacity=".26" strokeLinejoin="round" />
          <path d={wave(Math.PI / 2)} fill="none" stroke={mix(b, '#fff', 0.45)} strokeWidth="1.6" opacity=".4" strokeLinejoin="round" />
        </g>
        <circle cx="50" cy="50" r="48.9" fill="none" stroke={lighten(a, 0.5)} strokeWidth=".8" opacity=".7" />
        <circle cx="50" cy="50" r="40.2" fill="none" stroke={lighten(b, 0.45)} strokeWidth=".8" opacity=".7" />
        <SweepArc u={u} />
      </g>
    );
  }
  if (key === 'golconda') {
    const stones = [];
    for (let i = 0; i < 16; i++) {
      const [x, y] = pt(44.5, i * 22.5 - 90);
      stones.push(<use key={i} href={`#${u}st`} transform={`translate(${f2(x)} ${f2(y)}) rotate(${i * 22.5}) scale(${i % 2 ? 0.62 : 1})`} />);
    }
    const glints = [-135, 45, -45].map((deg, i) => {
      const [x, y] = pt(44.5, deg);
      return (
        <g key={i} transform={`translate(${f2(x)} ${f2(y)})`}>
          <path className={`cx-glint cx-glint--${i + 1}`} d={GLINT_STAR} fill="#fff" />
        </g>
      );
    });
    return (
      <g>
        <defs>
          <linearGradient id={u + 'g'} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".35" stopColor={a} />
            <stop offset=".7" stopColor={mix(a, b, 0.6)} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
          <linearGradient id={u + 's'} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".5" stopColor={a} />
            <stop offset="1" stopColor={mix(b, '#9fe0ff', 0.4)} />
          </linearGradient>
          <g id={u + 'st'}>
            <path d={BRILLIANT_OUT} fill={`url(#${u}s)`} stroke={darken(b, 0.35)} strokeWidth=".6" strokeLinejoin="round" />
            <path d={BRILLIANT_TABLE} fill="#fff" opacity=".6" />
            <path d={BRILLIANT_FACETS} fill="none" stroke={darken(b, 0.15)} strokeWidth=".35" opacity=".75" />
          </g>
        </defs>
        <circle cx="50" cy="50" r="44.5" fill="none" stroke={g} strokeWidth="5.6" />
        <circle cx="50" cy="50" r="48.6" fill="none" stroke={mix(a, '#fff', 0.5)} strokeWidth=".7" opacity=".8" />
        <circle cx="50" cy="50" r="40.4" fill="none" stroke={mix(a, '#fff', 0.5)} strokeWidth=".7" opacity=".8" />
        {stones}
        {glints}
        <SweepArc u={u} />
      </g>
    );
  }
  const defs = (
    <defs>
      <linearGradient id={u + 'g'} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={lighten(a, 0.15)} />
        <stop offset=".5" stopColor={a} />
        <stop offset="1" stopColor={b} />
      </linearGradient>
    </defs>
  );
  if (key === 'pearl') {
    const beads = [];
    const n = 22;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const x = 50 + Math.cos(t) * 44.5, y = 50 + Math.sin(t) * 44.5;
      beads.push(
        <g key={i}>
          <circle cx={x.toFixed(2)} cy={y.toFixed(2)} r="5.4" fill={i % 2 ? a : mix(a, b, 0.35)} stroke={darken(b, 0.2)} strokeWidth=".7" />
          <circle cx={(x - 1.6).toFixed(2)} cy={(y - 1.8).toFixed(2)} r="1.6" fill="#fff" />
        </g>,
      );
    }
    return <g>{defs}<circle cx="50" cy="50" r="44.5" fill="none" stroke={darken(b, 0.1)} strokeWidth="2" />{beads}</g>;
  }
  if (key === 'lake') {
    let wave = '';
    const n = 16;
    for (let i = 0; i <= n * 4; i++) {
      const t = (i / (n * 4)) * Math.PI * 2;
      const r = 44.5 + Math.sin(i * (Math.PI / 2)) * 1.8;
      wave += (i ? 'L' : 'M') + (50 + Math.cos(t) * r).toFixed(2) + ' ' + (50 + Math.sin(t) * r).toFixed(2);
    }
    return (
      <g>
        {defs}
        <circle cx="50" cy="50" r="44.5" fill="none" stroke={g} strokeWidth="9" />
        <path d={wave + 'Z'} fill="none" stroke="#e8fbff" strokeWidth="1.4" strokeLinejoin="round" opacity=".85" />
        <circle cx="50" cy="50" r="40" fill="none" stroke={darken(b, 0.25)} strokeWidth="1" />
        <path d="M18 30A38 38 0 0 1 36 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".7" />
      </g>
    );
  }
  if (key === 'nizam') {
    const jewels = [];
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const x = 50 + Math.cos(t) * 44.5, y = 50 + Math.sin(t) * 44.5;
      jewels.push(
        <g key={i} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(i * 45).toFixed(0)})`}>
          <path d="M0 -6.4L4 0L0 6.4L-4 0Z" fill={lighten(a, 0.3)} stroke={darken(b, 0.3)} strokeWidth=".8" />
          <circle r="2" fill={i % 2 ? '#e23a48' : '#0f8f6a'} />
        </g>,
      );
    }
    return (
      <g>
        {defs}
        <circle cx="50" cy="50" r="44.5" fill="none" stroke={g} strokeWidth="8" />
        <circle cx="50" cy="50" r="48.4" fill="none" stroke={darken(b, 0.2)} strokeWidth="1.2" />
        <circle cx="50" cy="50" r="40.4" fill="none" stroke={darken(b, 0.2)} strokeWidth="1.2" />
        <circle cx="50" cy="50" r="44.5" fill="none" stroke="#fff3c4" strokeWidth=".8" strokeDasharray="1.4 3" opacity=".9" />
        {jewels}
      </g>
    );
  }
  // sandstone (and the generic fallback for any future frame): carved stone ring with notches
  return (
    <g>
      {defs}
      <circle cx="50" cy="50" r="44.5" fill="none" stroke={g} strokeWidth="9" />
      <circle cx="50" cy="50" r="44.5" fill="none" stroke={darken(b, 0.25)} strokeWidth="9" strokeDasharray="1.2 6.8" opacity=".45" />
      <circle cx="50" cy="50" r="49" fill="none" stroke={darken(b, 0.2)} strokeWidth="1" />
      <circle cx="50" cy="50" r="40" fill="none" stroke={darken(b, 0.2)} strokeWidth="1" />
      <path d="M17 28A38 38 0 0 1 34 13" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" opacity=".55" />
    </g>
  );
}

/**
 * Avatar frame. Renders `children` centred inside a decorative ring; with no (or an unknown) frame it renders the
 * children only. `children` may be a function `(innerSize) => node` to size the avatar to the frame's opening.
 */
export function AvatarFrame({ frame, size = 48, children, className, style }) {
  const u = uidOf(useId());
  const item = resolveCosmetic(frame, 'frame');
  const inner = frameInner(size);
  const kids = typeof children === 'function' ? children(item ? inner : size) : children;
  if (!item) return <>{kids}</>;
  return (
    <span
      className={className}
      data-frame={item.id}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, flex: 'none', ...style }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: inner, height: inner, borderRadius: '50%', overflow: 'hidden' }}>{kids}</span>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        aria-hidden="true"
        focusable="false"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'visible',
          // legendary frames loop a sweep / twinkle (cosmetics-shine.css); offset each instance's phase
          ...(item.rarity === 'legendary' ? { '--cx-delay': shinePhase(u) } : null),
        }}
      >
        <FrameRing item={item} u={u} />
      </svg>
    </span>
  );
}

export { DiceSwatch } from './DiceSwatch.jsx';

/** Title badge: catalogue name in a chip tinted by rarity. Unknown title -> nothing. */
export function TitleChip({ title, className, size = 'md', style }) {
  const item = resolveCosmetic(title, 'title');
  if (!item) return null;
  const c = rarityVar(item.rarity);
  const sm = size === 'sm';
  return (
    <span
      className={className}
      data-rarity={item.rarity}
      title={item.name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: sm ? 4 : 6,
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        padding: sm ? '1px 7px 1px 5px' : '3px 10px 3px 7px',
        borderRadius: 999,
        fontSize: sm ? 11 : 12.5,
        fontWeight: 700,
        lineHeight: 1.35,
        letterSpacing: '.01em',
        color: c,
        background: `color-mix(in srgb, ${c} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 55%, transparent)`,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <svg width={sm ? 9 : 11} height={sm ? 9 : 11} viewBox="0 0 10 10" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
        <path d="M5 0L6.2 3.8L10 5L6.2 6.2L5 10L3.8 6.2L0 5L3.8 3.8Z" fill="currentColor" />
      </svg>
      <span data-chip-text="" style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{item.name}</span>
    </span>
  );
}

/** Shop-grid preview for any cosmetic item (object or id). */
export function CosmeticPreview({ item, size = 64, className }) {
  const it = resolveCosmetic(item);
  if (!it) return null;
  if (it.kind === 'frame') {
    return (
      <span className={className} style={{ display: 'inline-flex' }}>
        <AvatarFrame frame={it} size={size}>
          {(inner) => <Avatar preset={3} size={inner} />}
        </AvatarFrame>
      </span>
    );
  }
  if (it.kind === 'dice') {
    return (
      <span className={className} style={{ display: 'inline-flex' }}>
        <DiceSwatch skin={it} size={size} />
      </span>
    );
  }
  if (it.kind === 'title') {
    return (
      <span className={className} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: size, width: '100%', maxWidth: '100%', minWidth: 0 }}>
        <TitleChip title={it} />
      </span>
    );
  }
  if (it.kind === 'trail') {
    return (
      <span className={className} style={{ display: 'inline-flex' }}>
        <TrailPreview item={it} size={size} />
      </span>
    );
  }
  if (it.kind === 'board') {
    return (
      <span className={className} style={{ display: 'inline-flex' }}>
        <BoardThemePreview item={it} size={size} />
      </span>
    );
  }
  if (it.kind === 'voice') {
    // a voice line: its icon (tiger / cat, else the emoji) on a gold-ringed medallion
    return (
      <span className={className} style={{ display: 'inline-flex' }}>
        <VoiceArt item={it} size={size} />
      </span>
    );
  }
  return null;
}
