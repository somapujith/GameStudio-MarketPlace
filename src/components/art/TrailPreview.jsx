import { memo, useId } from 'react';
import '@/styles/trails.css';

/**
 * Shop / lobby / results preview of a pawn trail (kind 'trail'): the effect the piece leaves behind as it walks.
 * Props: { item (catalogue item: colors [a, b], finish), size = 64 }.
 *
 * A small puck glides left to right and the item's effect is dropped behind it, in the item's two colours, in the
 * same spirit as the live one (game/TrailFx.jsx). The loop is ~3s of CSS (trails.css, classes `trp-`): the puck
 * glides, each particle starts when it passes (`--t`, seconds), then everything fades. With reduced motion or light
 * graphics there is no animation: the SVG is a still, mid-flight frame (the puck at the end of its lane, the
 * particles frozen where they were dropped, drawn with plain attributes). No SVG filters; gradient ids are unique
 * per instance (a shop grid renders dozens).
 */

const LANE_X = 14; // where the puck starts
const LANE_LEN = 28; // how far it glides (trails.css trp-glide)
const FEET = 44; // the lane's y

/** Deterministic 0..1 wobble from an index, so a frame never changes between renders. */
const wob = (i, k) => {
  const v = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/** x of the i-th of n particles along the lane, and when (seconds into the 3s loop) the puck passes it. */
const along = (i, n) => {
  const u = (i + 0.5) / n;
  return { x: LANE_X + LANE_LEN * u, u, t: Math.round(3 * (0.08 + 0.54 * u) * 100) / 100 };
};
const r1 = (n) => Math.round(n * 10) / 10;

/** A flame tongue / teardrop pointing up from (x, y). */
const drop = (x, y, w, h) =>
  `M${r1(x)} ${r1(y)}C${r1(x - w)} ${r1(y - h * 0.2)} ${r1(x - w)} ${r1(y - h * 0.62)} ${r1(x)} ${r1(y - h)}C${r1(x + w)} ${r1(y - h * 0.62)} ${r1(x + w)} ${r1(y - h * 0.2)} ${r1(x)} ${r1(y)}Z`;
/** A four-pointed star centred on (x, y). */
const star = (x, y, s) =>
  `M${r1(x)} ${r1(y - s)}L${r1(x + s * 0.28)} ${r1(y - s * 0.28)}L${r1(x + s)} ${r1(y)}L${r1(x + s * 0.28)} ${r1(y + s * 0.28)}L${r1(x)} ${r1(y + s)}L${r1(x - s * 0.28)} ${r1(y + s * 0.28)}L${r1(x - s)} ${r1(y)}L${r1(x - s * 0.28)} ${r1(y - s * 0.28)}Z`;

function particles(finish, a, b, id) {
  const out = [];
  const add = (i, n, el) => {
    const { u, t } = along(i, n);
    out.push({ key: `${finish}${i}`, t, o: r1(0.4 + 0.55 * u), ...el });
  };
  const alt = (i) => (i % 2 ? b : a);
  switch (finish) {
    case 'dust':
      for (let i = 0; i < 6; i += 1) {
        const { x } = along(i, 6);
        add(i, 6, { tag: 'circle', props: { cx: r1(x), cy: r1(FEET - 1 - (i % 2) * 2), r: 3 + (i % 3) * 0.8, fill: `url(#${id}p)` } });
      }
      break;
    case 'steam':
      for (let i = 0; i < 5; i += 1) {
        const { x } = along(i, 5);
        add(i, 5, { tag: 'ellipse', props: { cx: r1(x), cy: r1(FEET - 6 - (i % 2) * 4), rx: 2.1, ry: 3.6, fill: `url(#${id}s)` } });
      }
      break;
    case 'petals':
      for (let i = 0; i < 6; i += 1) {
        const { x } = along(i, 6);
        add(i, 6, { tag: 'path', props: { d: `M${r1(x)} ${r1(FEET - 9 + (i % 3) * 3)}c2.4-1 3.6 1.2 3.2 3.2c-2.4 1-3.6-1.2-3.2-3.2z`, fill: alt(i) }, rot: Math.round(wob(i, 1) * 200) });
      }
      break;
    case 'sparks':
      for (let i = 0; i < 7; i += 1) {
        const { x } = along(i, 7);
        add(i, 7, { tag: 'rect', cls: ' trp-spark', props: { x: r1(x), y: FEET - 5.6, width: 5, height: 1.3, rx: 0.65, fill: i % 2 ? `url(#${id}k)` : a }, rot: -20 - Math.round(wob(i, 2) * 140) });
      }
      break;
    case 'coins':
      for (let i = 0; i < 6; i += 1) {
        const { x } = along(i, 6);
        add(i, 6, { tag: 'ellipse', props: { cx: r1(x), cy: r1(FEET - 1.5 - (i % 2) * 1.2), rx: i % 3 === 1 ? 1.2 : 2.4, ry: 2.4, fill: `url(#${id}c)`, stroke: b, strokeWidth: 0.7 } });
      }
      break;
    case 'comet':
      for (let i = 0; i < 3; i += 1) {
        const { x } = along(i + 0.4, 3);
        add(i, 3, { tag: 'circle', props: { cx: r1(x), cy: r1(FEET - 4 - i * 2.5), r: 1.2, fill: i % 2 ? b : a } });
      }
      break;
    case 'flame':
      for (let i = 0; i < 8; i += 1) {
        const { x } = along(i, 8);
        const k = i % 3;
        add(i, 8, { tag: 'path', props: { d: drop(x, FEET + 1, k === 0 ? 3.2 : k === 1 ? 2.4 : 1.6, k === 0 ? 11 : k === 1 ? 8 : 5), fill: k === 0 ? b : k === 1 ? a : '#fff' } });
      }
      break;
    case 'stardust':
      for (let i = 0; i < 8; i += 1) {
        const { x } = along(i, 8);
        add(i, 8, { tag: 'path', props: { d: star(x, FEET - 3 - wob(i, 3) * 12, 1.8 + wob(i, 4) * 1.6), fill: alt(i) }, rot: Math.round(wob(i, 5) * 60) });
      }
      break;
    default:
  }
  return out;
}

/** The lines / tails that grow with the puck (streak, comet), as { d, fill | stroke, o }. */
function lines(finish, a, b, id) {
  if (finish === 'streak') {
    return [
      { key: 'glow', tag: 'polygon', props: { points: `12 ${FEET} 46 ${FEET - 5} 46 ${FEET + 5}`, fill: a }, o: 0.28 },
      { key: 'main', tag: 'polygon', props: { points: `12 ${FEET} 46 ${FEET - 2.6} 46 ${FEET + 2.6}`, fill: `url(#${id}l)` }, o: 1 },
      { key: 'e1', tag: 'line', props: { x1: 16, x2: 44, y1: FEET - 7, y2: FEET - 7, stroke: b, strokeWidth: 0.9, strokeLinecap: 'round' }, o: 0.55 },
      { key: 'e2', tag: 'line', props: { x1: 16, x2: 44, y1: FEET + 7, y2: FEET + 7, stroke: b, strokeWidth: 0.9, strokeLinecap: 'round' }, o: 0.55 },
    ];
  }
  if (finish === 'comet') {
    return [
      { key: 'glow', tag: 'polygon', props: { points: `10 ${FEET - 4} 46 ${FEET - 8} 46 ${FEET + 0}`, fill: `url(#${id}g)` }, o: 0.4 },
      { key: 'tail', tag: 'polygon', props: { points: `10 ${FEET - 4} 46 ${FEET - 6.5} 46 ${FEET - 1.5}`, fill: `url(#${id}l)` }, o: 1 },
    ];
  }
  return [];
}

function TrailPreview({ item, size = 64 }) {
  const uid = `tp${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [a, b] = (item && item.colors) || ['#e3b778', '#a8743a'];
  const finish = (item && item.finish) || 'dust';
  const parts = particles(finish, a, b, uid);
  const tails = lines(finish, a, b, uid);
  const comet = finish === 'comet';

  return (
    <svg
      className="trp"
      data-finish={finish}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={item ? item.name : 'Trail'}
    >
      <defs>
        {/* soft puff (dust) and wisp (steam): the two colours fading out, never a filter */}
        <radialGradient id={`${uid}p`}>
          <stop offset="0" stopColor={a} stopOpacity="0.95" />
          <stop offset="0.6" stopColor={b} stopOpacity="0.6" />
          <stop offset="1" stopColor={b} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}s`}>
          <stop offset="0" stopColor={a} stopOpacity="0.9" />
          <stop offset="0.6" stopColor={b} stopOpacity="0.45" />
          <stop offset="1" stopColor={b} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}c`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.35" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </radialGradient>
        <linearGradient id={`${uid}k`}>
          <stop offset="0" stopColor={a} stopOpacity="0" />
          <stop offset="1" stopColor="#fff" />
        </linearGradient>
        <linearGradient id={`${uid}l`}>
          <stop offset="0" stopColor={b} stopOpacity="0" />
          <stop offset="0.55" stopColor={b} />
          <stop offset="1" stopColor={a} />
        </linearGradient>
        <linearGradient id={`${uid}g`}>
          <stop offset="0" stopColor={b} stopOpacity="0" />
          <stop offset="1" stopColor={b} stopOpacity="0.7" />
        </linearGradient>
        <radialGradient id={`${uid}h`}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.3" stopColor={a} />
          <stop offset="1" stopColor={a} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* the tile it walks along */}
      <ellipse cx="32" cy={FEET + 4} rx="26" ry="3.2" fill="currentColor" opacity="0.1" />

      {tails.map((t) => {
        const Tag = t.tag;
        return <Tag key={t.key} className="trp-line" opacity={t.o} {...t.props} />;
      })}
      {parts.map((p) => {
        const Tag = p.tag;
        return (
          <Tag
            key={p.key}
            className={`trp-p${p.cls || ''}`}
            opacity={p.o}
            style={{ '--t': p.t, '--o': p.o, rotate: p.rot ? `${p.rot}deg` : undefined }}
            {...p.props}
          />
        );
      })}

      <g className="trp-puck">
        {comet ? <circle cx={LANE_X} cy={FEET - 6} r="7.5" fill={`url(#${uid}h)`} /> : null}
        <ellipse cx={LANE_X} cy={FEET + 3.2} rx="6.4" ry="2" fill="#000" opacity="0.28" />
        <ellipse cx={LANE_X} cy={FEET + 1} rx="6" ry="2.6" fill={a} />
        <ellipse cx={LANE_X} cy={FEET - 0.2} rx="6" ry="2.6" fill={b} />
        <path d={`M${LANE_X - 3.6} ${FEET - 0.8}c0.4-5 1.2-6.4 3.6-6.4s3.2 1.4 3.6 6.4z`} fill="#fff" />
        <circle cx={LANE_X} cy={FEET - 9} r="3.4" fill="#fff" />
      </g>
    </svg>
  );
}
export default memo(TrailPreview);
