// Hyderabad Hustle player tokens: six little game pieces standing on a round base in the player's colour.
// 40x40 box, ground at y ~34. Every main shape carries a neutral ink outline so a token reads on any tile colour;
// the player's colour tints the base and the body of the object. No filters (dozens of these can be on a board).
import { memo, useId } from 'react';
import { lighten, darken, mix } from './palette.js';
import '@/styles/characterMotion.css';
import { useArtMap, ANDHRA } from './andhra/artMap.js';
import { ANDHRA_DRAW } from './andhra/pieces.jsx';

const OUT = '#1b1340';
const OW = 1.3; // outline width in the 40-unit box
export const PIECE_IDS = ['pearl', 'auto', 'handi', 'chai', 'bat', 'camera'];
export const PIECE_NAMES = {
  pearl: 'Pearl',
  auto: 'Auto-rickshaw',
  handi: 'Biryani handi',
  chai: 'Irani chai glass',
  bat: 'Cricket bat',
  camera: 'Film camera',
};

const o = (fill, extra) => ({ fill, stroke: OUT, strokeWidth: OW, strokeLinejoin: 'round', ...extra });

function Base({ c }) {
  return (
    <g>
      <ellipse cx="20.6" cy="35.2" rx="13.4" ry="3.6" fill={OUT} opacity=".26" />
      <path d="M9.4 31.4V33Q9.4 35.6 20 35.6Q30.6 35.6 30.6 33V31.4Z" {...o(darken(c, 0.32))} />
      <ellipse cx="20" cy="31.4" rx="10.6" ry="3.2" {...o(c)} />
      <path d="M12.6 30.6Q15 29.3 19 29.1" fill="none" stroke={lighten(c, 0.55)} strokeWidth="1.1" strokeLinecap="round" opacity=".9" />
    </g>
  );
}

function Pearl({ c, uid }) {
  const g = uid + 'pg';
  return (
    <g>
      <defs>
        <radialGradient id={g} cx=".36" cy=".32" r=".72">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".5" stopColor={mix(c, '#ffffff', 0.78)} />
          <stop offset="1" stopColor={mix(c, '#d9d3ee', 0.55)} />
        </radialGradient>
      </defs>
      {/* little cup stand */}
      <path d="M16.6 31V27.6H23.4V31Z" {...o(darken(c, 0.12))} />
      <path d="M12.4 24.4Q13.4 28.4 20 28.4Q26.6 28.4 27.6 24.4Z" {...o(lighten(c, 0.12))} />
      <circle cx="20" cy="16.6" r="9" fill={`url(#${g})`} stroke={OUT} strokeWidth={OW} />
      <path d="M13.6 19.6Q15.6 24 20.4 24.4" fill="none" stroke={mix(c, '#8f86c7', 0.5)} strokeWidth="1.2" strokeLinecap="round" opacity=".55" />
      <ellipse className="piece-part piece-gleam" cx="16.8" cy="12.8" rx="2.6" ry="1.9" fill="#fff" transform="rotate(-30 16.8 12.8)" />
      <circle cx="23.4" cy="20.6" r=".9" fill="#fff" opacity=".8" />
      {/* prongs */}
      <path d="M13.2 24.6L12.4 21.6M26.8 24.6L27.6 21.6" stroke={OUT} strokeWidth="1" strokeLinecap="round" />
    </g>
  );
}

function Auto({ c, base }) {
  const y = base ? 0 : 2;
  const top = '#2b2260';
  return (
    <g transform={`translate(0 ${y})`}>
      {/* canopy */}
      <path d="M13.6 13.6Q14.4 7.2 19.4 7.2H31.2Q34.2 7.2 34.2 10.2V24H31.2V10.6H19.6Q17 10.6 16.4 13.6Z" {...o(top)} />
      <path d="M18 8.6H30.8" stroke={lighten(top, 0.45)} strokeWidth="1" strokeLinecap="round" />
      {/* cabin interior + seat */}
      <path d="M17.6 10.6H31.2V20H17.6Z" fill="#4a3f8f" />
      <path d="M26.4 13.4H30.6V20H26.4Z" fill={lighten(c, 0.3)} opacity=".9" />
      {/* body */}
      <path d="M6.6 28.4V23Q6.6 18.4 11.4 17.4L14.4 12.4H17.2L16 19.6H34.2V28.4Z" {...o(c)} />
      <path d="M8.4 24.4H34.2" stroke={darken(c, 0.25)} strokeWidth="1.3" />
      <path d="M16 19.6H34.2" stroke={lighten(c, 0.4)} strokeWidth="1" opacity=".9" />
      {/* windscreen */}
      <path d="M14.7 13.2L17.4 12.2L16.3 18.4L12.6 18.4Z" fill="#9fe3f5" stroke={OUT} strokeWidth=".9" strokeLinejoin="round" />
      {/* headlight + bumper */}
      <circle cx="8.6" cy="21.6" r="1.5" fill="#ffe27a" stroke={OUT} strokeWidth=".8" />
      <path d="M6 28.4H11" stroke={OUT} strokeWidth="1.6" strokeLinecap="round" />
      {/* wheels */}
      <g className="piece-part piece-wheel">
        <circle cx="11.6" cy="29.4" r="3.4" {...o('#2b2260')} />
        <circle cx="11.6" cy="29.4" r="1.2" fill="#c9c3e6" />
        <path d="m10 27.8 3.2 3.2m0-3.2L10 31" stroke="#c9c3e6" strokeWidth=".7" />
      </g>
      <g className="piece-part piece-wheel">
        <circle cx="29" cy="29.4" r="3.4" {...o('#2b2260')} />
        <circle cx="29" cy="29.4" r="1.2" fill="#c9c3e6" />
        <path d="m27.4 27.8 3.2 3.2m0-3.2L27.4 31" stroke="#c9c3e6" strokeWidth=".7" />
      </g>
    </g>
  );
}

function Handi({ c }) {
  const brass = '#e0a64a';
  return (
    <g>
      <g className="piece-part piece-steam" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity=".85">
        <path d="M16.4 7.4C14.8 5.6 17.6 4.4 16 2.4" />
        <path d="M23.8 7.4C22.2 5.6 25 4.4 23.4 2.4" />
      </g>
      {/* handles */}
      <path d="M8.6 18.6Q5.6 19 6.4 22Q7.2 23.6 9 23" fill="none" stroke={OUT} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M31.4 18.6Q34.4 19 33.6 22Q32.8 23.6 31 23" fill="none" stroke={OUT} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M8.6 18.6Q5.6 19 6.4 22Q7.2 23.6 9 23M31.4 18.6Q34.4 19 33.6 22Q32.8 23.6 31 23" fill="none" stroke={brass} strokeWidth="1.1" strokeLinecap="round" />
      {/* pot */}
      <path d="M8 21.4Q8 31.2 20 31.2Q32 31.2 32 21.4Q32 16.6 27 15.4H13Q8 16.6 8 21.4Z" {...o(c)} />
      <path d="M8.6 24.4Q12 27 20 27Q28 27 31.4 24.4" fill="none" stroke={darken(c, 0.28)} strokeWidth="1.4" />
      <path d="M11 20Q11.4 17.8 13.6 17.2" fill="none" stroke={lighten(c, 0.6)} strokeWidth="1.6" strokeLinecap="round" />
      {/* rim + dough seal + lid */}
      <ellipse cx="20" cy="15.2" rx="8.6" ry="2.6" {...o(brass)} />
      <path d="M11.8 14.6Q20 17.2 28.2 14.6" fill="none" stroke="#fff1cf" strokeWidth="1.8" strokeLinecap="round" />
      <g className="piece-part piece-lid">
        <path d="M12.6 14.2Q13 9.2 20 9.2Q27 9.2 27.4 14.2Q20 16 12.6 14.2Z" {...o(lighten(brass, 0.2))} />
        <path d="M15 12.2Q16.4 10.6 19 10.4" fill="none" stroke="#fff6d6" strokeWidth="1" strokeLinecap="round" />
        <circle cx="20" cy="8.6" r="1.7" {...o(brass, { strokeWidth: 1 })} />
      </g>
    </g>
  );
}

function Chai({ c }) {
  return (
    <g>
      <g className="piece-part piece-steam" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity=".85">
        <path d="M17.4 6.6C15.8 4.8 18.6 3.6 17 1.6" />
        <path d="M23.2 6.8C21.6 5 24.4 3.8 22.8 1.8" />
      </g>
      {/* saucer */}
      <ellipse cx="20" cy="27.6" rx="12.4" ry="3.4" {...o(c)} />
      <ellipse cx="20" cy="27.2" rx="7.4" ry="1.8" fill={darken(c, 0.18)} />
      {/* glass */}
      <path d="M12.6 8.4H27.4L25.6 26.4Q20 28.2 14.4 26.4Z" fill="#eaf8ff" stroke={OUT} strokeWidth={OW} strokeLinejoin="round" />
      <path d="M13.2 13.2H26.8L25.6 26.4Q20 28.2 14.4 26.4Z" fill="#c97a35" />
      <path d="M20.6 13.2H26.8L25.6 26.4Q23.4 27.2 21 27.3Z" fill="#a85f25" opacity=".7" />
      <ellipse cx="20" cy="13.2" rx="6.8" ry="1.6" fill="#e6a45e" />
      <path d="M15.6 15V25.4M18.6 15V26.6M21.6 15V26.6M24.6 15V25.4" stroke="#fff" strokeWidth=".7" opacity=".35" />
      <ellipse cx="20" cy="8.4" rx="7.4" ry="1.8" fill="none" stroke={OUT} strokeWidth="1.1" />
      <path d="M14.2 10.4L15.2 23" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity=".85" />
    </g>
  );
}

function Bat({ c }) {
  return (
    <g>
      <g className="piece-part piece-bat"><g transform="rotate(-20 19 22)">
        {/* handle + grip */}
        <rect x="17.6" y="2.4" width="3.4" height="11" rx="1.6" {...o(c)} />
        <path d="M17.8 5H20.8M17.8 7.6H20.8M17.8 10.2H20.8" stroke={darken(c, 0.3)} strokeWidth=".9" />
        {/* blade */}
        <path d="M15.2 13.4Q19.3 11.4 23.4 13.4V29.4Q23.4 31.4 19.3 31.4Q15.2 31.4 15.2 29.4Z" {...o('#f2cf8e')} />
        <path d="M20.6 13V31.2" stroke="#d9a75b" strokeWidth="2" opacity=".7" />
        <rect x="15.8" y="17.6" width="7" height="2.6" fill={c} opacity=".95" />
        <path d="M16.8 14.6V28.6" stroke="#fff7df" strokeWidth="1" strokeLinecap="round" />
      </g></g>
      {/* ball */}
      <circle cx="28.4" cy="27" r="3.8" {...o('#d62839')} />
      <path d="M26.2 24.2Q28.6 27 26.6 30M30.4 24.2Q28.4 27 30.6 29.8" fill="none" stroke="#fff" strokeWidth=".7" strokeDasharray="1 .8" />
      <circle cx="27.2" cy="25.6" r=".9" fill="#ff9aa6" />
    </g>
  );
}

function Camera({ c }) {
  const dark = '#2b2260';
  const reel = (cx, cy, r) => (
    <g className="piece-part piece-reel">
      <circle cx={cx} cy={cy} r={r} {...o(dark)} />
      <circle cx={cx} cy={cy} r={r * 0.32} fill="#c9c3e6" />
      {[0, 120, 240].map((a) => (
        <circle key={a} cx={cx + Math.cos((a * Math.PI) / 180) * r * 0.62} cy={cy + Math.sin((a * Math.PI) / 180) * r * 0.62} r={r * 0.2} fill="#6f66b8" />
      ))}
    </g>
  );
  return (
    <g>
      {reel(15.4, 11.4, 5)}
      {reel(25.4, 10, 5.6)}
      {/* body */}
      <rect x="11" y="15.4" width="20" height="13.6" rx="2.4" {...o(c)} />
      <path d="M12.6 17.4H29.4" stroke={lighten(c, 0.45)} strokeWidth="1.2" strokeLinecap="round" />
      <rect x="24.4" y="20.4" width="4.6" height="3.4" rx="1" fill={darken(c, 0.3)} />
      {/* lens */}
      <path d="M11 19.6H7.4L4.6 18V27.4L7.4 25.8H11Z" {...o(dark)} />
      <ellipse cx="4.8" cy="22.7" rx="1.6" ry="4.4" fill="#79d3ea" stroke={OUT} strokeWidth=".9" />
      <path d="M4.4 20.4V22" stroke="#fff" strokeWidth=".8" strokeLinecap="round" />
      {/* side handle */}
      <path d="M31 20.4H33.4V26.4H31" fill="none" stroke={OUT} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="16" cy="23.6" r="1.4" fill="#ff5d73" />
    </g>
  );
}

const DRAW = { pearl: Pearl, auto: Auto, handi: Handi, chai: Chai, bat: Bat, camera: Camera };

/**
 * The token as a bare <g> in a 40x40 box (for composing inside another SVG, e.g. the hub cover).
 * `base={false}` drops the round player-colour stand.
 */
export function PieceGlyph({ piece = 'pearl', color = '#ff4d6d', base = true, uid = 'pc', map }) {
  const Draw = (map === ANDHRA && ANDHRA_DRAW[piece]) || DRAW[piece] || Pearl; // the Andhra map re-skins the same six ids (andhra/pieces.jsx)
  return (
    <g>
      {base ? <Base c={color} /> : <ellipse cx="20.4" cy="33.6" rx="12" ry="2.8" fill={OUT} opacity=".22" />}
      <Draw c={color} uid={uid} base={base} />
    </g>
  );
}

function PieceArtBase({ piece = 'pearl', color = '#ff4d6d', size = 32, title, className, base = true, style }) {
  const map = useArtMap();
  const uid = 'pa' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const label = title || undefined;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={{ flex: 'none', overflow: 'visible', ...style }}
    >
      {label ? <title>{label}</title> : null}
      <PieceGlyph piece={DRAW[piece] ? piece : 'pearl'} color={color || '#ff4d6d'} base={base} uid={uid} map={map} />
    </svg>
  );
}

export const PieceArt = memo(PieceArtBase);
export default PieceArt;
