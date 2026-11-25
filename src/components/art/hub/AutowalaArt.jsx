// Autowala cover (16:9) + app icon, drawn for the hub: a Hyderabad auto-rickshaw with its headlight on, driving into a
// dusk street under an octagonal pixel sun, with an old-city skyline (minarets and domes) behind it. The left third of the
// cover is deliberately calm so card/hero text can sit on it. Pure inline SVG, no assets.
import { memo } from 'react';
import { CoverSvg, IconSvg, Sparkle, Stars, COVER_CSS, f, rng, skyline, useUid } from './kit.jsx';

const HZ = 318; // horizon (cover)
const OCTAGON = (cx, cy, r) => {
  const k = r * 0.4142; // regular octagon, flat top
  const pts = [[-k, -r], [k, -r], [r, -k], [r, k], [k, r], [-k, r], [-r, k], [-r, -k]];
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(cx + x)} ${f(cy + y)}`).join('') + 'Z';
};

/** A minaret + dome silhouette, ~16 wide, standing on y = 0 and rising to y = -h. */
function Minaret({ x, h = 60, c }) {
  return (
    <g transform={`translate(${x} 0)`} fill={c}>
      <rect x="-3" y={-h} width="6" height={h} />
      <rect x="-5" y={-h * 0.62} width="10" height="3" />
      <rect x="-5" y={-h * 0.3} width="10" height="3" />
      <path d={`M-4.5 ${-h}Q0 ${-h - 11} 4.5 ${-h}Z`} />
      <rect x="-0.6" y={-h - 16} width="1.2" height="6" />
    </g>
  );
}

/**
 * The auto, side on, facing right, in a 120 x 76 box whose bottom edge is the road. Colours are fixed (the bright
 * yellow body and dark roof read on both dusk and night backgrounds).
 */
function Auto({ uid, beam = true }) {
  return (
    <g>
      {beam && <path d="M114 50 L330 14 L330 92 Z" fill={`url(#${uid}beam)`} />}
      <ellipse cx="62" cy="76" rx="62" ry="4.5" fill="#05020a" opacity=".5" />
      {/* roof (dark) and canopy shine */}
      <path d="M6 34Q6 5 30 4H72Q84 4 86 16L88 34Z" fill="#1f1a15" />
      <path d="M12 12Q16 7 30 7H70" fill="none" stroke="#5a4a3a" strokeWidth="2" strokeLinecap="round" />
      {/* cabin (open side): seat in shadow */}
      <rect x="5" y="34" width="84" height="27" fill="#ffc928" />
      <rect x="13" y="37" width="52" height="19" rx="3" fill="#35211a" />
      <path d="M17 52Q17 44 25 44H55Q62 44 62 52V56H17Z" fill="#9a3b27" />
      {/* windscreen + nose */}
      <path d="M84 14 102 37H87Z" fill="#bfe9ff" opacity=".8" />
      <path d="M86 34 102 37Q116 41 116 55V62Q116 66 110 66H86Z" fill="#ffd54a" />
      <path d="M86 34 102 37Q108 38 111 41" fill="none" stroke="#fff3b0" strokeWidth="1.6" strokeLinecap="round" />
      {/* base stripe, tail light, plate */}
      <rect x="5" y="58" width="111" height="4" fill="#1f1a15" />
      <rect x="2" y="42" width="4.5" height="9" rx="1.5" fill="#ff4d4d" />
      <rect x="12" y="55" width="22" height="6" rx="1" fill="#fff7e0" />
      <rect x="15" y="57" width="16" height="2" fill="#35211a" opacity=".55" />
      {/* headlight */}
      <circle cx="113" cy="50" r="9" fill={`url(#${uid}hl)`} />
      <circle cx="113" cy="50" r="4.4" fill="#fff8d0" />
      {/* wheels */}
      {[[27, 65, 11], [103, 66, 10]].map(([cx, cy, r]) => (
        <g key={cx}>
          <circle cx={cx} cy={cy} r={r} fill="#15110e" />
          <circle cx={cx} cy={cy} r={r * 0.46} fill="#a29a90" />
          <circle cx={cx} cy={cy} r={r * 0.16} fill="#15110e" />
        </g>
      ))}
    </g>
  );
}

function Defs({ uid }) {
  return (
    <defs>
      <radialGradient id={uid + 'hl'} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#fff6c0" stopOpacity=".95" />
        <stop offset="1" stopColor="#ffd966" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={uid + 'beam'} gradientUnits="userSpaceOnUse" x1="114" y1="0" x2="330" y2="0">
        <stop offset="0" stopColor="#fff2b0" stopOpacity=".55" />
        <stop offset="1" stopColor="#fff2b0" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

function AutowalaCoverBase({ className, title, animated = true }) {
  const u = useUid();
  const rand = rng(41);
  const far = skyline(rng(17), { x0: -10, x1: 810, base: HZ, hmin: 18, hmax: 70, wmin: 18, wmax: 38, lit: 0.05, spire: 0.15 });
  const near = skyline(rng(29), { x0: 250, x1: 810, base: HZ + 4, hmin: 30, hmax: 92, wmin: 24, wmax: 44, lit: 0.22, gap: [2, 6] });
  const dashes = [];
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const y = HZ + 8 + t * t * 118;
    const w = 3 + t * 30;
    dashes.push(<rect key={i} x={f(400 - w / 2)} y={f(y)} width={f(w)} height={f(2 + t * 7)} fill="#ffd966" opacity={f(0.35 + t * 0.4)} />);
  }
  return (
    <CoverSvg className={className} title={title} css={animated ? COVER_CSS : COVER_CSS.replace(/animation:[^;}]+/g, 'animation:none')}>
      <defs>
        <linearGradient id={u + 'sky'} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={HZ}>
          <stop offset="0" stopColor="#12060a" />
          <stop offset=".32" stopColor="#3b1209" />
          <stop offset=".62" stopColor="#8a3410" />
          <stop offset=".86" stopColor="#e8742a" />
          <stop offset="1" stopColor="#ffc16a" />
        </linearGradient>
        <radialGradient id={u + 'sun'} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#ffd27a" stopOpacity=".75" />
          <stop offset="1" stopColor="#ff8a3d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={u + 'road'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a1c10" />
          <stop offset="1" stopColor="#120805" />
        </linearGradient>
        <pattern id={u + 'scan'} width="4" height="3" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" y="2" fill="#000" opacity=".16" />
        </pattern>
      </defs>
      <Defs uid={u} />
      <rect width="800" height="450" fill={`url(#${u}sky)`} />
      <Stars rand={rand} n={26} ymax={170} c="#ffe9c4" o={0.7} />
      <circle cx="590" cy="262" r="150" fill={`url(#${u}sun)`} />
      <path d={OCTAGON(590, 262, 62)} fill="#ffae4d" opacity=".92" />
      <path d={OCTAGON(590, 262, 62)} fill="none" stroke="#ffd27a" strokeWidth="3" opacity=".6" />
      {/* city */}
      <path d={far.body} fill="#4a1d0d" />
      <g transform={`translate(0 ${HZ})`}>
        <Minaret x={430} h={78} c="#321107" />
        <Minaret x={486} h={78} c="#321107" />
        <rect x="428" y="-34" width="60" height="34" fill="#321107" />
        <path d="M436 0V-18Q458 -30 480 -18V0Z" fill="#4a1d0d" />
      </g>
      <path d={near.body} fill="#2a0e06" />
      <path d={near.w1} fill="#ffc16a" opacity=".85" />
      <path d={near.w2} fill="#ff9d4d" opacity=".6" />
      {/* street */}
      <rect y={HZ + 4} width="800" height={450 - HZ} fill={`url(#${u}road)`} />
      <rect y={HZ + 4} width="800" height="3" fill="#ffae4d" opacity=".45" />
      {dashes}
      {/* the auto: outer group places it, inner group bobs */}
      <g transform="translate(402 266) scale(2.15)">
        <g className="hub-bob">
          <Auto uid={u} />
        </g>
      </g>
      <Sparkle x={716} y={92} s={6} c="#ffe9c4" />
      <Sparkle x={86} y={120} s={4} c="#ffd27a" />
      <rect width="800" height="450" fill={`url(#${u}scan)`} />
    </CoverSvg>
  );
}
export const AutowalaCover = memo(AutowalaCoverBase);

function AutowalaIconBase({ size = 64, title, className, rounded }) {
  const u = useUid();
  const s = 0.84;
  return (
    <IconSvg size={size} title={title} className={className} rounded={rounded} uid={u}>
      <defs>
        <linearGradient id={u + 'bg'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a0a07" />
          <stop offset=".5" stopColor="#6a2a0c" />
          <stop offset=".82" stopColor="#e8742a" />
          <stop offset="1" stopColor="#ffc16a" />
        </linearGradient>
      </defs>
      <Defs uid={u} />
      <rect width="128" height="128" fill={`url(#${u}bg)`} />
      <path d={OCTAGON(78, 62, 30)} fill="#ffae4d" opacity=".95" />
      <path d={OCTAGON(78, 62, 30)} fill="none" stroke="#ffd27a" strokeWidth="2" opacity=".55" />
      <g transform="translate(0 92)">
        <Minaret x={22} h={34} c="#2a0e06" />
        <Minaret x={44} h={34} c="#2a0e06" />
        <rect x="19" y="-18" width="28" height="18" fill="#2a0e06" />
        <rect x="58" y="-24" width="14" height="24" fill="#3b1209" />
        <rect x="76" y="-14" width="16" height="14" fill="#3b1209" />
        <rect x="96" y="-30" width="12" height="30" fill="#2a0e06" />
      </g>
      <rect y="92" width="128" height="36" fill="#1a0a07" />
      <rect y="92" width="128" height="2" fill="#ffae4d" opacity=".5" />
      <g transform={`translate(${f(64 - 60 * s + 8)} ${f(121 - 76 * s)}) scale(${s})`}>
        <Auto uid={u} beam={false} />
      </g>
      <Sparkle x={104} y={24} s={5} c="#fff3c4" />
    </IconSvg>
  );
}
export const AutowalaIcon = memo(AutowalaIconBase);
