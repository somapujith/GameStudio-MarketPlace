import { memo, useId } from 'react';

/**
 * Shop / lobby / results preview of a board theme (kind 'board'): a miniature of the board ring in the theme's colours.
 * Props: { item (catalogue item: colors [night, paper, accent], finish), size = 64 }.
 *
 * Drawn like the real board: a rounded frame in the night colour, a ring of tiles (four corners and five on each edge) on the
 * theme's paper with an accent edge, a few group-colour bands on the inner side of the edge tiles, and the dark middle
 * panel. Each finish adds its own detail (the same ideas as styles/board-themes.css): bazaar a woven weave, lake ripples,
 * grid a neon grid, marble veining, obsidian gold inlay lines and a gloss, emerald a diamond lattice, goldleaf gold-leaf
 * flecks and a static glint.
 *
 * Cheap on purpose (a shop grid renders dozens): the whole tile ring is ONE path and each band colour one path, so a preview
 * is about a dozen elements. No SVG filters; gradient / pattern / clip ids are unique per instance (useId, prefix `bp`).
 */

// geometry in a 64 x 64 box: ring 4..60, corners 10 wide, five edge tiles of 7.2, so the middle is 14..50
const RING = 4;
const CORNER = 10;
const EDGE = 7.2;
const GAP = 0.5; // tiles are inset by half a gap each side
const BAND = 3; // the colour band on the inner side of an edge tile
const MID = RING + CORNER; // 14
const MID_END = MID + EDGE * 5; // 50

/** Collection colours of the board (a few of them), by edge-tile index; null = a plain special square. */
const BANDS = ['#c98b4a', '#3aa7e0', null, '#e2725b', '#3fb68b'];

const r1 = (n) => Math.round(n * 10) / 10;
const rect = (x, y, w, h) => `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}z`;

/** Hex colour mixed toward white (t > 0) or black (t < 0). */
function tone(hex, t) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const to = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const ch = (shift) => Math.round(((n >> shift) & 255) * (1 - k) + to * k);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

/** The ring, computed once: every tile as one path, and the band rects grouped by colour. */
const RING_GEOMETRY = (() => {
  const tiles = [];
  const bands = new Map();
  const addBand = (color, d) => bands.set(color, `${bands.get(color) || ''}${d}`);
  const ins = GAP / 2;
  // corners
  for (const [x, y] of [[RING, RING], [MID_END, RING], [RING, MID_END], [MID_END, MID_END]]) {
    tiles.push(rect(x + ins, y + ins, CORNER - GAP, CORNER - GAP));
  }
  for (let i = 0; i < 5; i += 1) {
    const p = MID + EDGE * i + ins;
    const w = EDGE - GAP;
    const h = CORNER - GAP;
    tiles.push(rect(p, RING + ins, w, h)); // top
    tiles.push(rect(p, MID_END + ins, w, h)); // bottom
    tiles.push(rect(RING + ins, p, h, w)); // left
    tiles.push(rect(MID_END + ins, p, h, w)); // right
    const c = BANDS[i];
    if (c) {
      addBand(c, rect(p, RING + CORNER - BAND - ins, w, BAND)); // top row: band on the lower edge
      addBand(c, rect(p, MID_END + ins, w, BAND)); // bottom row: band on the upper edge
      addBand(c, rect(RING + CORNER - BAND - ins, p, BAND, w)); // left column: band on the right edge
      addBand(c, rect(MID_END + ins, p, BAND, w)); // right column: band on the left edge
    }
  }
  return { tiles: tiles.join(''), bands: [...bands.entries()] };
})();

const CORNER_MARKS = [[RING + CORNER / 2, RING + CORNER / 2], [MID_END + CORNER / 2, RING + CORNER / 2], [RING + CORNER / 2, MID_END + CORNER / 2], [MID_END + CORNER / 2, MID_END + CORNER / 2]];

/** Hair-thin veins across the whole board; clipped to the tiles so they only show on paper. */
const VEINS = [
  { d: 'M0 20C14 28 20 6 34 24S52 40 64 34', o: 0.42, w: 0.5 },
  { d: 'M10 0C20 22 40 30 30 64', o: 0.3, w: 0.4 },
  { d: 'M46 0C50 16 66 20 64 44', o: 0.34, w: 0.45 },
];

function BoardThemePreview({ item, size = 64 }) {
  const u = `bp${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [night, paper, accent] = (item && item.colors) || ['#15173a', '#f6ead4', '#ffc857'];
  const finish = item && item.finish;
  const centre = tone(night, -0.35);
  const edge = finish === 'obsidian' || finish === 'grid' || finish === 'lake' ? accent : tone(accent, -0.15);
  const frameFill = `url(#${u}f)`;

  // frame overlay pattern (under the tiles): the weave, lattice or speckle of the finish
  let frameFx = null;
  let centreFx = null;
  if (finish === 'bazaar') {
    frameFx = <pattern id={`${u}w`} width="3.4" height="3.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 .4H3.4M.4 0V3.4" stroke={accent} strokeOpacity=".32" strokeWidth=".4" fill="none" /></pattern>;
    centreFx = <pattern id={`${u}b`} width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="none" stroke={accent} strokeOpacity=".4" strokeWidth=".35" /></pattern>;
  } else if (finish === 'grid') {
    frameFx = <pattern id={`${u}w`} width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 .2H4M.2 0V4" stroke={accent} strokeOpacity=".3" strokeWidth=".3" fill="none" /></pattern>;
    centreFx = <pattern id={`${u}b`} width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 .2H4M.2 0V4" stroke={accent} strokeOpacity=".28" strokeWidth=".3" fill="none" /></pattern>;
  } else if (finish === 'emerald') {
    frameFx = <pattern id={`${u}w`} width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 0L5 5M5 0L0 5" stroke={accent} strokeOpacity=".3" strokeWidth=".35" fill="none" /></pattern>;
    centreFx = <pattern id={`${u}b`} width="6" height="6" patternUnits="userSpaceOnUse"><path d="M3 0.6L5.4 3 3 5.4 .6 3z" stroke={accent} strokeOpacity=".32" strokeWidth=".35" fill="none" /></pattern>;
  } else if (finish === 'goldleaf') {
    frameFx = (
      <pattern id={`${u}w`} width="9" height="7" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r=".55" fill={accent} fillOpacity=".95" />
        <circle cx="6.5" cy="5" r=".4" fill="#fff2c0" fillOpacity=".9" />
        <path d="M7 1l.6.6-.6.6-.6-.6z" fill={accent} fillOpacity=".8" />
      </pattern>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={item ? item.name : 'Board theme'}>
      <defs>
        <linearGradient id={`${u}f`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={tone(night, 0.16)} />
          <stop offset="0.55" stopColor={night} />
          <stop offset="1" stopColor={tone(night, -0.4)} />
        </linearGradient>
        {frameFx}
        {centreFx}
        <clipPath id={`${u}t`}><path d={RING_GEOMETRY.tiles} /></clipPath>
        {finish === 'goldleaf' || finish === 'obsidian' ? (
          <linearGradient id={`${u}g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0.28" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.48" stopColor="#fff2c0" stopOpacity={finish === 'goldleaf' ? 0.5 : 0.22} />
            <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        ) : null}
      </defs>

      {/* frame */}
      <rect x=".75" y=".75" width="62.5" height="62.5" rx="7" fill={frameFill} stroke={accent} strokeOpacity={finish === 'grid' ? 0.95 : 0.7} strokeWidth="1" />
      {frameFx ? <rect x=".75" y=".75" width="62.5" height="62.5" rx="7" fill={`url(#${u}w)`} /> : null}
      {finish === 'goldleaf' ? <rect x=".75" y=".75" width="62.5" height="62.5" rx="7" fill={`url(#${u}g)`} /> : null}
      {finish === 'obsidian' ? <rect x="1.2" y="1.2" width="61.6" height="22" rx="6.5" fill="#fff" fillOpacity=".1" /> : null}
      {/* gold inlay lines (obsidian) / bevel (goldleaf) just inside the frame edge */}
      {finish === 'obsidian' ? <rect x="2.2" y="2.2" width="59.6" height="59.6" rx="5.6" fill="none" stroke={accent} strokeOpacity=".85" strokeWidth=".4" /> : null}
      {finish === 'goldleaf' ? <rect x="2" y="2" width="60" height="60" rx="5.8" fill="none" stroke="#fff2c0" strokeOpacity=".7" strokeWidth=".5" /> : null}

      {/* middle panel */}
      <rect x={MID + 1.2} y={MID + 1.2} width={MID_END - MID - 2.4} height={MID_END - MID - 2.4} rx="2.6" fill={centre} stroke={accent} strokeOpacity=".5" strokeWidth=".5" />
      {centreFx ? <rect x={MID + 1.2} y={MID + 1.2} width={MID_END - MID - 2.4} height={MID_END - MID - 2.4} rx="2.6" fill={`url(#${u}b)`} /> : null}
      {finish === 'lake' ? (
        <g fill="none" stroke={accent} strokeOpacity=".4" strokeWidth=".5">
          <circle cx="32" cy="32" r="5" />
          <circle cx="32" cy="32" r="9.5" strokeOpacity=".28" />
          <circle cx="32" cy="32" r="14" strokeOpacity=".16" />
        </g>
      ) : null}
      {/* the title bar and die of the control panel, as two accent marks */}
      <rect x="25" y="25" width="14" height="2.2" rx="1.1" fill={accent} fillOpacity=".85" />
      <rect x="29" y="30.5" width="6" height="6" rx="1.3" fill={paper} fillOpacity=".92" />

      {/* tiles: paper with an accent edge, then the collection bands */}
      <path d={RING_GEOMETRY.tiles} fill={paper} stroke={edge} strokeOpacity=".55" strokeWidth=".35" />
      {finish === 'marble' ? (
        <g clipPath={`url(#${u}t)`} fill="none" stroke="#7d7a8c" strokeLinecap="round">
          {VEINS.map((v) => <path key={v.d} d={v.d} strokeOpacity={v.o} strokeWidth={v.w} />)}
        </g>
      ) : null}
      {RING_GEOMETRY.bands.map(([color, d]) => <path key={color} d={d} fill={color} />)}
      {/* the four corner squares carry an accent mark */}
      {CORNER_MARKS.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill={accent} fillOpacity=".9" />)}
    </svg>
  );
}
export default memo(BoardThemePreview);
