import { memo } from 'react';
import { cosmeticById } from '@shared/cosmetics.js';
import { lighten, darken } from './palette.js';

/** A dice skin id / short id / item -> the catalogue item of kind 'dice' (falls back to ivory). */
function diceItem(ref) {
  const item = typeof ref === 'object' && ref ? ref : cosmeticById(ref) || cosmeticById(`dice-${ref}`);
  return item && item.kind === 'dice' ? item : cosmeticById('dice-ivory');
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
  const item = diceItem(skin);
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
