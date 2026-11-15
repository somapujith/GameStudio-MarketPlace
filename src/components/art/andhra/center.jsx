// The middle of the Andhra board: a Kalamkari-bordered folk-art map of the state (an original, simplified outline, not
// traced from any map) with the Krishna and Godavari, the Bay of Bengal coast, Konaseema palms, a Vizag port,
// Rayalaseema fort and the Amaravati skyline. Static, decorative, drawn once behind the control panel (aria-hidden).
// Repeated shapes are <symbol>/<use>. No gradients over text, no filters, nothing animated except the optional kite
// sway (transform only, switched off by reduced motion and data-perf='low' in map-andhra.css).
import { memo, useId } from 'react';
import { K, Bull } from './kit.jsx';

const LAND = 'M80 6C74 14 70 20 66 26C62 32 58 38 56 44C52 48 49 54 46 58C42 64 40 70 37 78C35 84 34 88 32 92L22 95C16 90 10 82 7 74C5 66 8 56 11 50C14 44 22 42 28 42C36 40 42 36 46 31C50 26 54 22 58 18C64 14 70 10 74 7Z';

function CentreBase() {
  const u = `ah${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const id = (n) => `${u}${n}`;
  return (
    <svg className="ah-centre" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-map="andhra">
      <defs>
        <clipPath id={id('land')}><path d={LAND} /></clipPath>
        <symbol id={id('fl')} viewBox="-4 -4 8 8">
          {[0, 60, 120].map((r) => <ellipse key={r} rx="1.2" ry="3.4" fill={K.turm} transform={`rotate(${r})`} />)}
          <circle r="1" fill={K.terra} />
        </symbol>
        <symbol id={id('pm')} viewBox="-6 -12 12 14">
          <path d="M0 2Q1-4 0-9" fill="none" stroke="#9a6a44" strokeWidth="1" />
          <path d="M0-9Q-4-12-8-9Q-4-9 0-9ZM0-9Q4-12 8-9Q4-9 0-9ZM0-9Q-2-14-5-13Q-2-11 0-9ZM0-9Q2-14 5-13Q2-11 0-9Z" fill={K.leaf} />
        </symbol>
        <symbol id={id('tw')} viewBox="0 -10 4 10"><path d="M0 0V-8L2-10 4-8V0Z" fill={K.turm} /></symbol>
      </defs>

      {/* night ground + a soft glow where the coast meets the sea */}
      <rect width="100" height="100" fill="#171d58" />
      <path d="M100 0V100H30C60 70 64 30 100 0Z" fill="#1d3f8a" opacity=".55" />
      <path d="M84 100C70 80 62 60 76 36 86 18 94 12 100 4V100Z" fill="#2b6fb5" opacity=".32" />

      {/* Bay of Bengal swell and a fishing boat */}
      <g fill="none" stroke="#8fd3f0" strokeWidth=".6" opacity=".6" strokeLinecap="round">
        <path d="M78 30q3-1.6 6 0t6 0M72 40q3-1.6 6 0t6 0M80 50q3-1.6 6 0t6 0M70 60q3-1.6 6 0t6 0M78 70q3-1.6 6 0t6 0M66 80q3-1.6 6 0t6 0" />
      </g>
      <path d="M86 44l5-1-1 3.4h-6z" fill={K.terra} /><path d="M88.4 43.4v-5l3 4.6z" fill={K.cream} />

      {/* the state: three regions in folk colours, clipped to one outline */}
      <g clipPath={`url(#${id('land')})`}>
        <path d={LAND} fill="#e6d29c" />
        <path d="M52 24L60 0H100V34Z" fill="#9a6fc4" opacity=".78" />
        <path d="M52 24L100 34V100H28L34 70 40 50 46 40Z" fill="#3fa36b" opacity=".78" />
        <path d="M0 36H46L40 50 34 70 28 100H0Z" fill="#cf5a3e" opacity=".85" />
        <path d="M52 24L46 40 40 50 34 70 28 100M52 24L100 34" fill="none" stroke={K.cream} strokeWidth=".55" strokeDasharray="1.2 1.4" opacity=".85" />
      </g>
      <path d={LAND} fill="none" stroke={K.turm} strokeWidth="1.1" strokeLinejoin="round" />
      <path d={LAND} fill="none" stroke="#fff3c4" strokeWidth=".35" strokeLinejoin="round" strokeDasharray="1.2 1.6" transform="translate(.6 .4)" opacity=".7" />

      {/* Krishna and Godavari */}
      <path d="M17 45C27 45 35 41 41 45S47 53 46.6 58" fill="none" stroke="#7fd0f2" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M55 21C58 25 55 29 59 33S62 40 58 44" fill="none" stroke="#7fd0f2" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M17 45C27 45 35 41 41 45S47 53 46.6 58M55 21C58 25 55 29 59 33S62 40 58 44" fill="none" stroke={K.ink} strokeWidth=".3" strokeLinecap="round" opacity=".55" />

      {/* Konaseema palms on the Godavari delta */}
      <use href={`#${id('pm')}`} x="52" y="38" width="6" height="7" /><use href={`#${id('pm')}`} x="57" y="40" width="5" height="6" /><use href={`#${id('pm')}`} x="54" y="43" width="5" height="6" />
      {/* Araku hills */}
      <path d="M58 14l4-5 4 5zM63 15l3-4 3 4z" fill="#3a7d57" stroke={K.ink} strokeWidth=".3" />
      {/* Visakhapatnam port: two cranes and a ship */}
      <g stroke={K.ink} strokeWidth=".3"><path d="M68 25V21h5v-1M70 25V21" fill="none" strokeWidth=".6" stroke={K.indigo} /><path d="M72 26l4 0 1 2h-7z" fill={K.indigo} /><rect x="72.5" y="24.4" width="1.6" height="1.6" fill={K.terra} /><rect x="74.3" y="24.4" width="1.6" height="1.6" fill={K.turm} /></g>
      {/* Amaravati skyline by the Krishna */}
      <g stroke={K.ink} strokeWidth=".25"><path d="M42 52v-6h2v6zM44.4 52v-9h2.2v9zM47 52v-5h2v5z" fill={K.indigo} /><path d="M39.4 52q0-4 2-4t2 4z" fill={K.cream} /></g>
      {/* Guntur chilli, Tirupati hills, Srisailam forest, Kurnool fort, Lepakshi bull */}
      <path d="M38.5 56c2 0 3 2 2.6 5-1-2-2-3-3.4-3.6z" fill={K.chilli} stroke={K.ink} strokeWidth=".25" />
      <path d="M22 90Q24 85 26 89Q28 84 30 89Q32 85 34 90" fill="#6fa889" stroke={K.ink} strokeWidth=".3" />
      <path d="M22 48l2-4 2 4zM25 49l2-4 2 4zM28 47l2-4 2 4z" fill="#2f7d4f" stroke={K.ink} strokeWidth=".25" />
      <path d="M12 58v-4h6v4h-1v-1.4h-1V58h-1v-1.4h-1V58z" fill={K.stone} stroke={K.ink} strokeWidth=".25" />
      <g stroke={K.ink} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"><Bull x={9} y={77} s={0.15} c={K.cream} /></g>

      {/* Kalamkari border: a gold double line with a flower row and lotus corners */}
      <rect x="1.6" y="1.6" width="96.8" height="96.8" rx="4" fill="none" stroke={K.turm} strokeWidth=".7" />
      <rect x="3.4" y="3.4" width="93.2" height="93.2" rx="3" fill="none" stroke={K.terra} strokeWidth=".4" strokeDasharray="1 1.2" />
      {Array.from({ length: 11 }, (_, i) => 12 + i * 7.6).map((p) => (
        <g key={p}>
          <use href={`#${id('fl')}`} x={p - 2} y="0.4" width="4" height="4" />
          <use href={`#${id('fl')}`} x={p - 2} y="95.6" width="4" height="4" />
          <use href={`#${id('fl')}`} x="0.4" y={p - 2} width="4" height="4" />
          <use href={`#${id('fl')}`} x="95.6" y={p - 2} width="4" height="4" />
        </g>
      ))}
      {[[5, 5], [95, 5], [5, 95], [95, 95]].map(([x, y]) => <use key={`${x}${y}`} href={`#${id('fl')}`} x={x - 4} y={y - 4} width="8" height="8" />)}

      {/* a kite over the empty north-west and the title in Telugu */}
      <g className="ah-kite" fill="none">
        <path d="M22 18l5 7-5 8-5-8z" fill={K.rose} stroke={K.cream} strokeWidth=".4" />
        <path d="M22 18V33M17 25h10" stroke={K.cream} strokeWidth=".3" />
        <path d="M22 33q-3 4 0 7t-1 6" stroke={K.cream} strokeWidth=".4" />
      </g>
      <text className="ah-title" x="7.5" y="64" fontSize="3.1" fontWeight="700" fill={K.turm} fillOpacity=".5" stroke="none" fontFamily="'Noto Sans Telugu','Nirmala UI','Gautami','Telugu Sangam MN',sans-serif">ఆంధ్ర ఆటలు</text>
    </svg>
  );
}

export const AndhraCentre = memo(CentreBase);
export default AndhraCentre;
