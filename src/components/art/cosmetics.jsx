// Shop cosmetics art: avatar frames, dice-skin swatches, title chips and a kind-dispatching preview.
// Items come from shared/cosmetics.js; every component accepts an item object, a full id ('frame-lake') or a short id ('lake').
import { memo, useId } from 'react';
import { cosmeticById } from '@shared/cosmetics.js';
import { lighten, darken, mix } from './palette.js';
import { Avatar } from './Avatar.jsx';
import { VoiceArt } from '../voice/VoiceShop.jsx';

export const RARITY_COLORS = { common: '#9fb0d8', rare: '#4cc9f0', epic: '#c58cff' };
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

function FrameRing({ item, u }) {
  const [a, b] = item.colors || ['#ffffff', '#c9c3e6'];
  const key = frameKey(item);
  const g = `url(#${u}g)`;
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
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      >
        <FrameRing item={item} u={u} />
      </svg>
    </span>
  );
}

const PIPS = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[30, 26], [70, 26], [30, 50], [70, 50], [30, 74], [70, 74]],
};

/** Small die preview drawn from a dice skin's [face, pip, edge] colours. */
function DiceSwatchBase({ skin = 'dice-ivory', size = 32, face = 5, className, title }) {
  const item = resolveCosmetic(skin, 'dice') || resolveCosmetic('dice-ivory', 'dice');
  const [fc, pc, ec] = (item && item.colors) || ['#fbf7ef', '#1b1340', '#d9cdb5'];
  const label = title || undefined;
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
      <ellipse cx="54" cy="94" rx="36" ry="5" fill="#05031a" opacity=".28" />
      <rect x="10" y="12" width="80" height="80" rx="20" fill={darken(ec, 0.2)} />
      <rect x="8" y="6" width="80" height="80" rx="20" fill={ec} />
      <rect x="8" y="6" width="76" height="76" rx="19" fill={fc} />
      <path d="M20 16Q30 11 50 11" fill="none" stroke={lighten(fc, 0.6)} strokeWidth="4" strokeLinecap="round" opacity=".65" />
      <g transform="translate(-4 -6)">
        {(PIPS[face] || PIPS[5]).map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="8" fill={pc} />
        ))}
      </g>
    </svg>
  );
}
export const DiceSwatch = memo(DiceSwatchBase);

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
