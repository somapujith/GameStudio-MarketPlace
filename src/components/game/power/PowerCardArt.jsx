import { memo, useId } from 'react';

/**
 * Illustration for a Power Card: { id: 'shield'|'double'|'steal'|'swap', size = 96 } -> a square <svg> (aria-hidden).
 *   shield  a Charminar-arch shield with a glint
 *   double  two stacked gold coins with a rupee mark and an "x2" badge
 *   steal   a hand snatching a spinning die
 *   swap    two pawns exchanging places along curved arrows
 * Illustrated style of the rest of the game: ink outline `#1b1340`, gradient fills, no filters. Every gradient id is unique per
 * instance (`pc` + useId), so several cards on one page (hand, guide, moment) never collide. Unknown ids draw the shield.
 */
const INK = '#1b1340';
const SW = 3; // outline weight on the 96 grid

const Lin = ({ id, a, b, c }) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stopColor={a} />
    {c ? <stop offset=".55" stopColor={b} /> : null}
    <stop offset="1" stopColor={c || b} />
  </linearGradient>
);

function Shield({ u }) {
  return (
    <>
      <defs>
        <Lin id={`${u}a`} a="#8fe3ff" b="#2f8cf0" c="#1c4fb8" />
        <Lin id={`${u}b`} a="#2b2a7a" b="#1b1340" />
        <Lin id={`${u}c`} a="#fff2a8" b="#ffc83d" />
      </defs>
      <path d="M48 7C59 13 72 15 84 15V46C84 68 69 84 48 92C27 84 12 68 12 46V15C24 15 37 13 48 7Z" fill={`url(#${u}a)`} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M48 14C57 18 67 20 77 20.5V46C77 64 65 77 48 84C31 77 19 64 19 46V20.5C29 20 39 18 48 14Z" fill="none" stroke="#e8f8ff" strokeWidth="1.6" strokeLinejoin="round" opacity=".75" />
      {/* the two outer minarets of the Charminar */}
      <g fill={`url(#${u}c)`} stroke={INK} strokeWidth="2" strokeLinejoin="round">
        <path d="M24 66V40h5v26z" />
        <circle cx="26.5" cy="37" r="3.6" />
        <path d="M67 66V40h5v26z" />
        <circle cx="69.5" cy="37" r="3.6" />
      </g>
      {/* the pointed arch gate */}
      <path d="M35 71V47C35 38 43 34 48 25C53 34 61 38 61 47V71Z" fill={`url(#${u}b)`} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M41 71V50C41 45 45 42 48 38C51 42 55 45 55 50V71Z" fill="#4a3fc4" stroke="#ffc83d" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M48 20.5l1.6 3.4 3.4 1.6-3.4 1.6L48 30.5l-1.6-3.4L43 25.5l3.4-1.6z" fill="#fff2a8" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      {/* glint: a light streak and a four-point sparkle */}
      <path d="M19 24L31 21.5L20.5 36Z" fill="#fff" opacity=".5" />
      <path d="M72 14l2.2 6.6 6.6 2.2-6.6 2.2L72 31.6l-2.2-6.6-6.6-2.2 6.6-2.2z" fill="#fff" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
    </>
  );
}

function Coin({ u, y }) {
  return (
    <g>
      <path d={`M16 ${y}v9a32 11.5 0 0 0 64 0v-9z`} fill={`url(#${u}b)`} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d={`M24 ${y + 8}v5M32 ${y + 12}v5M40 ${y + 14}v5M48 ${y + 15}v5M56 ${y + 14}v5M64 ${y + 12}v5M72 ${y + 8}v5`} stroke="#a86d00" strokeWidth="1.3" strokeLinecap="round" opacity=".55" />
      <ellipse cx="48" cy={y} rx="32" ry="11.5" fill={`url(#${u}a)`} stroke={INK} strokeWidth={SW} />
      <ellipse cx="48" cy={y} rx="25" ry="8.2" fill="none" stroke="#c98a00" strokeWidth="1.6" />
    </g>
  );
}

function Double({ u }) {
  return (
    <>
      <defs>
        <Lin id={`${u}a`} a="#fff7c2" b="#ffc83d" />
        <Lin id={`${u}b`} a="#e0a000" b="#a86d00" />
        <Lin id={`${u}c`} a="#ff8a8a" b="#e23d4c" />
      </defs>
      <Coin u={u} y={63} />
      <Coin u={u} y={47} />
      {/* rupee mark on the top coin */}
      <g transform="translate(48 47) scale(1 .62)" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M-8 -9.5H8M-8 -3.5H8M-8 -9.5H-1C6 -9.5 7 -.5 -1 -.5H-8L3 11" />
      </g>
      <path d="M26 41q4-3 9-3.4" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".7" fill="none" />
      {/* the multiplier badge */}
      <g>
        <circle cx="72" cy="23" r="16" fill={`url(#${u}c)`} stroke={INK} strokeWidth={SW} />
        <circle cx="72" cy="23" r="11.6" fill="none" stroke="#fff" strokeWidth="1.2" opacity=".6" />
        <text x="72" y="29.2" textAnchor="middle" fontFamily="'Segoe UI', system-ui, sans-serif" fontWeight="900" fontSize="17" fill="#fff" stroke={INK} strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">x2</text>
      </g>
      <path d="M17 24l1.8 4.6 4.6 1.8-4.6 1.8L17 36.8l-1.8-4.6-4.6-1.8 4.6-1.8z" fill="#fff" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
    </>
  );
}

function Pip({ x, y }) {
  return <circle cx={x} cy={y} r="2.5" fill={INK} />;
}

function Steal({ u }) {
  return (
    <>
      <defs>
        <Lin id={`${u}a`} a="#ffffff" b="#e8ecff" />
        <Lin id={`${u}b`} a="#ffd9b0" b="#f0a56f" />
        <Lin id={`${u}c`} a="#8ff5cf" b="#2bc79a" c="#0f7f68" />
      </defs>
      {/* spin lines */}
      <path d="M44 14C58 6 78 10 86 24" fill="none" stroke="#2bc79a" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M86 24l-8.4-1.2M86 24l-3.2-7.9" fill="none" stroke="#2bc79a" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M90 52C92 64 84 76 72 80" fill="none" stroke="#2bc79a" strokeWidth="3" strokeLinecap="round" opacity=".7" />
      {/* the die, mid-spin */}
      <g transform="rotate(16 60 44)">
        <rect x="40" y="24" width="40" height="40" rx="9" fill={`url(#${u}a)`} stroke={INK} strokeWidth={SW} />
        <Pip x={50} y={34} /><Pip x={70} y={34} /><Pip x={60} y={44} /><Pip x={50} y={54} /><Pip x={70} y={54} />
      </g>
      {/* the sleeve and the hand closing over the die */}
      <path d="M2 92L10 66L32 72L26 98Z" fill={`url(#${u}c)`} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M8 76L28 82" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
      <path d="M14 66C12 54 20 48 29 52L42 58C48 62 46 71 40 72L24 74Z" fill={`url(#${u}b)`} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <g fill="none" strokeLinecap="round">
        <path d="M26 54C27 42 34 36 43 36" stroke={INK} strokeWidth="11" />
        <path d="M26 54C27 42 34 36 43 36" stroke="#f6b985" strokeWidth="6" />
        <path d="M32 59C34 49 41 43 50 44" stroke={INK} strokeWidth="11" />
        <path d="M32 59C34 49 41 43 50 44" stroke="#f6b985" strokeWidth="6" />
        <path d="M38 65C41 57 48 52 56 53" stroke={INK} strokeWidth="11" />
        <path d="M38 65C41 57 48 52 56 53" stroke="#f6b985" strokeWidth="6" />
        <path d="M24 66C30 76 44 76 53 66" stroke={INK} strokeWidth="11" />
        <path d="M24 66C30 76 44 76 53 66" stroke="#f6b985" strokeWidth="6" />
      </g>
      <path d="M31 43C34 39 38 38 41 38" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" opacity=".7" />
    </>
  );
}

/** A little pawn: round head, cone body, flat base. `x` is its centre, `a`/`b` the gradient ids. */
function Pawn({ x, a, b }) {
  return (
    <g>
      <ellipse cx={x} cy="75" rx="12" ry="4" fill={`url(#${b})`} stroke={INK} strokeWidth="2.4" />
      <path d={`M${x - 10} 74C${x - 10} 62 ${x - 4} 58 ${x - 4} 51H${x + 4}C${x + 4} 58 ${x + 10} 62 ${x + 10} 74C${x + 4} 77 ${x - 4} 77 ${x - 10} 74Z`} fill={`url(#${a})`} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <ellipse cx={x} cy="51" rx="7.4" ry="2.6" fill={`url(#${b})`} stroke={INK} strokeWidth="2.4" />
      <circle cx={x} cy="42" r="9" fill={`url(#${a})`} stroke={INK} strokeWidth={SW} />
      <path d={`M${x - 5} 38.5q2.6-3 5.6-3.2`} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".75" />
    </g>
  );
}

function Swap({ u }) {
  return (
    <>
      <defs>
        <Lin id={`${u}a`} a="#d9c4ff" b="#9b7bff" c="#5b3fc9" />
        <Lin id={`${u}b`} a="#ffe38a" b="#e0a000" />
        <Lin id={`${u}c`} a="#ffe38a" b="#ffb100" c="#e07a00" />
      </defs>
      <Pawn x={29} a={`${u}a`} b={`${u}b`} />
      <Pawn x={67} a={`${u}c`} b={`${u}b`} />
      {/* upper arrow: left to right over the heads; lower arrow: right to left under the bases */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 36C18 8 78 8 82 31" stroke={INK} strokeWidth="9" />
        <path d="M16 36C18 8 78 8 82 31" stroke="#6ee7c8" strokeWidth="4.6" />
        <path d="M72 29l10.4 3.6 3-10.8" stroke={INK} strokeWidth="9" />
        <path d="M72 29l10.4 3.6 3-10.8" stroke="#6ee7c8" strokeWidth="4.6" />
        <path d="M80 64C78 92 18 92 14 69" stroke={INK} strokeWidth="9" />
        <path d="M80 64C78 92 18 92 14 69" stroke="#ff9db0" strokeWidth="4.6" />
        <path d="M24 71l-10.4-3.6-3 10.8" stroke={INK} strokeWidth="9" />
        <path d="M24 71l-10.4-3.6-3 10.8" stroke="#ff9db0" strokeWidth="4.6" />
      </g>
    </>
  );
}

const ART = { shield: Shield, double: Double, steal: Steal, swap: Swap };

function PowerCardArt({ id, size = 96 }) {
  const u = `pc${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const Art = ART[id] || Shield;
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" focusable="false" data-power-art={ART[id] ? id : 'shield'}>
      <Art u={u} />
    </svg>
  );
}
export default memo(PowerCardArt);
