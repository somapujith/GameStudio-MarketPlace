// Card backs for the two Hyderabad Hustle decks, 100x140 (5:7).
//   luck  - Nawabi Luck: emerald field, gold jaali lattice, crescent-and-star lantern medallion.
//   drama - City Drama: rose -> indigo field, playful zig-zag traffic stripes, autos, cones and the two masks.
// `size` is the rendered WIDTH (height = size * 1.4). No text on the art: callers overlay the deck name if they want.
import { memo, useId } from 'react';
import { PAL } from './palette.js';
import { Luck, Drama } from './HustleIcons.jsx';

const W = 100;
const H = 140;

function Frame({ stroke, inner }) {
  return (
    <g fill="none">
      <rect x="5" y="5" width="90" height="130" rx="9" stroke={stroke} strokeWidth="2.2" />
      <rect x="9.5" y="9.5" width="81" height="121" rx="6" stroke={inner} strokeWidth=".9" />
    </g>
  );
}

function Corner({ x, y, rot, c }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} fill={c}>
      <path d="M0 0Q9 0 12 -3Q9 0 9 9Q9 0 0 0Z" transform="translate(4 4) rotate(45) scale(.7)" />
      <circle cx="6" cy="6" r="1.6" />
    </g>
  );
}

function LuckBack({ u }) {
  const gold = '#f4c14f';
  return (
    <g>
      <defs>
        <linearGradient id={u + 'bg'} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0f8f6a" />
          <stop offset=".55" stopColor="#0a6e52" />
          <stop offset="1" stopColor="#064534" />
        </linearGradient>
        <radialGradient id={u + 'gl'} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#ffe7a3" stopOpacity=".55" />
          <stop offset="1" stopColor="#ffe7a3" stopOpacity="0" />
        </radialGradient>
        {/* jaali: interlocking eight-point stars */}
        <pattern id={u + 'jl'} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="translate(-2 0)">
          <g fill="none" stroke={gold} strokeWidth=".8" opacity=".5">
            <rect x="3.5" y="3.5" width="7" height="7" />
            <rect x="3.5" y="3.5" width="7" height="7" transform="rotate(45 7 7)" />
            <path d="M0 0L3.5 3.5M14 0L10.5 3.5M0 14L3.5 10.5M14 14L10.5 10.5" />
          </g>
          <circle cx="7" cy="7" r="1.1" fill={gold} opacity=".55" />
        </pattern>
      </defs>
      <rect width={W} height={H} rx="11" fill={`url(#${u}bg)`} />
      <rect x="9.5" y="9.5" width="81" height="121" rx="6" fill={`url(#${u}jl)`} />
      <Frame stroke={gold} inner="#ffe7a3" />
      {[[9.5, 9.5, 0], [90.5, 9.5, 90], [90.5, 130.5, 180], [9.5, 130.5, 270]].map(([x, y, r]) => <Corner key={r} x={x} y={y} rot={r} c={gold} />)}
      {/* medallion */}
      <circle cx="50" cy="70" r="36" fill={`url(#${u}gl)`} />
      <path d="M50 36L58 46L70 46L70 58L80 70L70 82L70 94L58 94L50 104L42 94L30 94L30 82L20 70L30 58L30 46L42 46Z" fill="#064534" stroke={gold} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="50" cy="70" r="24" fill="#0a6e52" stroke="#ffe7a3" strokeWidth=".8" />
      <g transform="translate(26 44) scale(.75)"><Luck /></g>
      {/* top / bottom arch motifs */}
      <path d="M38 22Q50 12 62 22" fill="none" stroke={gold} strokeWidth="1.4" />
      <path d="M38 118Q50 128 62 118" fill="none" stroke={gold} strokeWidth="1.4" />
      <circle cx="50" cy="16" r="1.6" fill={gold} />
      <circle cx="50" cy="124" r="1.6" fill={gold} />
    </g>
  );
}

function MiniAuto({ x, y, s = 1, c = PAL.gold }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M2 -12Q3 -18 8 -18H18Q20 -18 20 -16V-6H18V-15.6H8Q5.6 -15.6 5 -12Z" fill="#1b1340" />
      <path d="M-4 -2V-5Q-4 -8.6 0 -9.4L2.6 -13H5L4 -9H20V-2Z" fill={c} />
      <circle cx="1" cy="-1" r="2.4" fill="#1b1340" />
      <circle cx="16" cy="-1" r="2.4" fill="#1b1340" />
    </g>
  );
}

function Cone({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-5" y="-1.4" width="10" height="2.2" rx="1" fill="#e0571f" />
      <path d="M-3.8 -1.4L-1.2 -12H1.2L3.8 -1.4Z" fill="#ff8a3d" />
      <path d="M-2.8 -5.4H2.8L2.3 -7.6H-2.3Z" fill="#fff" />
    </g>
  );
}

function DramaBack({ u }) {
  const zig = (y) => {
    let d = `M8 ${y}`;
    for (let i = 0; i < 12; i++) d += `L${8 + (i + 1) * 7} ${y + (i % 2 ? 0 : 5)}`;
    return d;
  };
  return (
    <g>
      <defs>
        <linearGradient id={u + 'bg'} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff5d73" />
          <stop offset=".5" stopColor="#a8379a" />
          <stop offset="1" stopColor="#2e2475" />
        </linearGradient>
        <radialGradient id={u + 'sp'} cx=".5" cy=".45" r=".5">
          <stop offset="0" stopColor="#fff3c4" stopOpacity=".5" />
          <stop offset="1" stopColor="#fff3c4" stopOpacity="0" />
        </radialGradient>
        <pattern id={u + 'dt'} width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r=".9" fill="#fff" opacity=".22" />
          <circle cx="6.5" cy="6.5" r=".9" fill="#fff" opacity=".14" />
        </pattern>
      </defs>
      <rect width={W} height={H} rx="11" fill={`url(#${u}bg)`} />
      <rect x="9.5" y="9.5" width="81" height="121" rx="6" fill={`url(#${u}dt)`} />
      {/* traffic zig-zags */}
      <path d={zig(20)} fill="none" stroke="#ffd23f" strokeWidth="1.6" strokeLinejoin="round" opacity=".8" />
      <path d={zig(114)} fill="none" stroke="#4cc9f0" strokeWidth="1.6" strokeLinejoin="round" opacity=".8" />
      <Frame stroke="#fff3f6" inner="#ffd23f" />
      {/* spotlight + masks */}
      <circle cx="50" cy="68" r="34" fill={`url(#${u}sp)`} />
      <circle cx="50" cy="68" r="25" fill="#2e2475" stroke="#fff3f6" strokeWidth="1.4" />
      <circle cx="50" cy="68" r="21" fill="none" stroke="#ff5d73" strokeWidth="1" strokeDasharray="3 2.4" />
      <g transform="translate(27 45) scale(.72)"><Drama /></g>
      {/* street life */}
      <MiniAuto x={18} y={106} s={0.9} c="#ffd23f" />
      <Cone x={76} y={106} s={0.9} />
      <Cone x={84} y={106} s={0.7} />
      <g stroke="#ffd23f" strokeWidth="1.6" strokeLinecap="round">
        <path d="M18 34L14 30M24 32V27M30 34L34 30" />
      </g>
      <g fill="#fff">
        <path d="M80 30l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2Z" />
        <path d="M72 40l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z" opacity=".8" />
      </g>
    </g>
  );
}

function CardBackBase({ deck = 'luck', size = 100, className, title, style }) {
  const u = 'cb' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const label = title || undefined;
  return (
    <svg
      className={className}
      width={size}
      height={Math.round(size * 1.4)}
      viewBox={`0 0 ${W} ${H}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={{ flex: 'none', display: 'block', ...style }}
    >
      {label ? <title>{label}</title> : null}
      {deck === 'drama' ? <DramaBack u={u} /> : <LuckBack u={u} />}
    </svg>
  );
}

export const CardBack = memo(CardBackBase);
export default CardBack;
