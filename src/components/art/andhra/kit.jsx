// Andhra Aatalu art kit: the palette and the small flat shapes every scene, icon and building is composed from.
// "Modern Telugu folk art": deep indigo, terracotta, turmeric, river green, coastal blue, antique cream.
// Plain inline SVG, no filters / blurs / blend modes. Stroke attributes inherit from the scene's root <g>.

export const K = {
  ink: '#1d1840',
  indigo: '#26307a',
  indigoL: '#4a58b0',
  night: '#171c52',
  terra: '#c4553a',
  terraD: '#8f3a2b',
  turm: '#f2b11d',
  turmD: '#c98a0a',
  green: '#2f9e6b',
  greenD: '#1f6e4a',
  leaf: '#69bd6a',
  blue: '#2b8fc7',
  sea: '#46a9d6',
  seaD: '#2b7fb3',
  cream: '#f6ebd2',
  creamD: '#e4d2a8',
  rose: '#d9507f',
  earth: '#b86a45',
  wood: '#8a5a3a',
  stone: '#a9927a',
  stoneD: '#7d6a58',
  white: '#fffaf0',
  chilli: '#d62f2f',
};

/** Collection accent colours (fallback when the active map gives none); index = collection 0..7. */
export const ACCENTS = ['#a8643a', '#4aa3d8', '#3a9d62', '#8a52b8', '#e58a2c', '#c9433a', '#e0a81e', '#27337f'];

/* ---------------- nature ---------------- */

export const Palm = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M0 0Q5-20 1-40" fill="none" stroke={K.wood} strokeWidth="4.5" />
    <path d="M1-40Q-14-54-32-42Q-14-44 1-40ZM1-40Q16-54 34-42Q16-44 1-40ZM1-40Q-8-60 2-64Q8-52 1-40Z" fill={K.green} strokeWidth="1" />
  </g>
);

export const Cloud = ({ x, y, s = 1, o = 0.7 }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 10q-2-9 7-9 3-8 12-4 8-5 14 3 9-2 9 10z" fill={K.white} opacity={o} stroke="none" />
);

export const Waves = ({ y, c = '#cdeefa', n = 2, w = 2 }) => (
  <path d={Array.from({ length: n }, (_, i) => `M0 ${y + i * 9}q25-6 50 0t50 0 50 0 50 0 50 0 50 0 50 0 50 0`).join('')} fill="none" stroke={c} strokeWidth={w} opacity=".8" />
);

export const Tree = ({ x, y, s = 1, c = K.green }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M0 0V-22" stroke={K.wood} strokeWidth="5" />
    <path d="M-17-18Q-21-40-3-42Q8-52 18-38Q26-24 12-17Q-4-12-17-18Z" fill={c} />
  </g>
);

/* ---------------- animals and figures ---------------- */

export const Bull = ({ x, y, s = 1, c = K.white, dark = K.stone }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-26-22Q-28-31-18-32Q-6-34 2-43Q10-49 16-39Q24-34 33-29L44-21Q46-14 40-12Q35-10 31-12Q27-6 23-4V0H17V-6H5V0H-1V-8H-14V0H-20V-10Q-26-14-26-22Z" fill={c} />
    <path d="M23-30Q22-42 31-44" fill="none" strokeWidth="2.4" />
    <path d="M14-30Q8-28 10-22" fill="none" stroke={dark} strokeWidth="1.2" />
    <path d="M-26-22Q-35-18-32-4" fill="none" strokeWidth="1.8" />
    <circle cx="34" cy="-24" r="1.4" fill={K.ink} stroke="none" />
    <path d="M28-10Q24-4 20-8" fill="none" stroke={dark} strokeWidth="1.2" />
  </g>
);

export const Elephant = ({ x = 0, y = 0, s = 1, c = K.turm, trim = K.terra }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-20 0V-10Q-24-30-6-32H12Q26-30 26-16L36-8Q40 2 32 4Q28 4 28-2L24-8V0H17V-6H4V0H-3V-6H-12V0Z" fill={c} />
    <path d="M-4-32Q-8-46 6-48Q18-48 20-36Q22-28 12-26Z" fill={c} />
    <path d="M20-36Q30-34 28-20" fill="none" strokeWidth="1.2" />
    <path d="M-8-14h28v8H-8z" fill={trim} />
    <path d="M-6-10h24M-3-14v8M5-14v8M13-14v8" fill="none" stroke={K.cream} strokeWidth="1" />
    <circle cx="14" cy="-40" r="1.4" fill={K.ink} stroke="none" />
    <path d="M22-34l9 3" fill="none" stroke={K.cream} strokeWidth="2.4" />
  </g>
);

export const Figure = ({ x, y, c = K.terra, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-6 0L-4-20H4L6 0Z" fill={c} />
    <circle cy="-27" r="6" fill="#9a6548" />
    <path d="M-6-29Q0-38 6-29Z" fill={K.ink} stroke="none" />
  </g>
);

export const Kite = ({ x, y, c = K.rose, c2 = K.turm, r = 0, s = 1 }) => (
  <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
    <path d="M0-14L9 0 0 16-9 0Z" fill={c} />
    <path d="M0-14V16M-9 0H9" stroke={c2} strokeWidth="1.2" fill="none" />
    <path d="M0 16q-6 8 0 14t-2 12" fill="none" strokeWidth="1.2" />
  </g>
);

export const Chilli = ({ x, y, s = 1, r = 0 }) => (
  <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
    <path d="M0 0C9 0 15 9 13 24C8 14 3 9-3 5Z" fill={K.chilli} />
    <path d="M-3 5L-1-2" stroke={K.green} strokeWidth="2.6" fill="none" />
  </g>
);

/* ---------------- structures ---------------- */

export const Fort = ({ x, y, w = 80, h = 34, c = K.stone, towers = true }) => {
  const m = Math.floor(w / 9);
  const top = Array.from({ length: m }, (_, i) => `h4v-5h5v5`).join('');
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M0 0V-${h}${top}V0Z`} fill={c} />
      {towers && <path d={`M-8 0V-${h + 14}h16v-5h4v5h4V0Z`} fill={c} transform={`translate(${w - 4} 0)`} />}
      <path d={`M${w * 0.4} 0v-14a${w * 0.1} ${w * 0.1} 0 0 1 ${w * 0.2} 0V0z`} fill={K.stoneD} />
    </g>
  );
};

/** Layered hill silhouette: `d` is the ridge line path, closed down to y=160. */
export const Hill = ({ d, c, o = 1 }) => <path d={`${d}V162H${/^M(-?[\d.]+)/.exec(d)?.[1] ?? 0}Z`} fill={c} opacity={o} stroke="none" />;

export const Crane = ({ x, y, s = 1, c = K.turm }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-2 0V-52M26 0V-52M-2-30H26" fill="none" stroke={K.stoneD} strokeWidth="3" />
    <path d="M-16-52H70l-6-6H-10Z" fill={c} />
    <path d="M62-52V-34" stroke={K.ink} strokeWidth="1.2" fill="none" />
    <rect x="58" y="-34" width="9" height="7" fill={K.terra} />
  </g>
);

export const Ship = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-46-12H50L40 4H-38Z" fill={K.indigo} />
    {[-34, -14, 6, 26].map((a, i) => <rect key={a} x={a} y={-24} width="18" height="12" fill={[K.terra, K.turm, K.green, K.sea][i]} />)}
    <rect x="30" y="-32" width="14" height="20" fill={K.white} />
  </g>
);

export const Boat = ({ x, y, s = 1, c = K.terra }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-26-6Q-4 4 26-8L22 4Q-2 12-22 4Z" fill={c} />
    <path d="M0-4V-26M0-26L16-8H0" fill={K.cream} />
    <path d="M-12-6V-14" stroke={K.ink} fill="none" />
  </g>
);

export const Tower = ({ x, y, w = 16, h = 60, c = K.indigo, lit = K.turm, rows = 5 }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d={`M0 0V-${h}l${w / 2}-6 ${w / 2} 6V0Z`} fill={c} />
    <path d={Array.from({ length: rows }, (_, i) => `M3-${10 + Math.round(i * ((h - 14) / rows))}h${w - 6}`).join('')} stroke={lit} strokeWidth="2" opacity=".9" fill="none" />
  </g>
);

export const Gopuram = ({ x, y, s = 1, c = K.terra }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-22 0V-12H22V0ZM-17-12V-22H17V-12ZM-13-22V-31H13V-22ZM-9-31V-39H9V-31ZM-5-39V-46H5V-39Z" fill={c} />
    <path d="M0-46V-54" stroke={K.turm} strokeWidth="2.4" fill="none" />
    <path d="M-5 0V-8a5 5 0 0 1 10 0V0Z" fill={K.ink} stroke="none" />
    <path d="M-17-17h34M-13-26h26M-9-35h18" stroke={K.turm} strokeWidth="1.4" fill="none" />
  </g>
);

export const Diya = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-7 0Q0 9 7 0Z" fill={K.terra} />
    <path d="M0-1Q-4-8 0-14Q4-8 0-1Z" fill={K.turm} strokeWidth=".8" />
  </g>
);

/** A little border strip used on the scene footer: kalamkari-style repeating lotus dots. */
export const Border = ({ c }) => (
  <g stroke="none">
    <rect y="211" width="400" height="9" fill={c} />
    <path d="M0 215.5H400" stroke={K.cream} strokeWidth="3.4" strokeDasharray="1.6 7" strokeLinecap="round" />
  </g>
);
