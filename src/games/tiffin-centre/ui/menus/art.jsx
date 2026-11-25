// Tiffin Centre menus: small SVG illustrations (CSS/SVG only, no assets). Street style: tin roof, painted signs, chalk stars, galla notes.
// Colours read the --tc-* palette with fallbacks so these also render outside the .tc root (tests, storybook).

const C = {
  saffron: 'var(--tc-saffron, #ff8a1f)',
  turmeric: 'var(--tc-turmeric, #ffc83d)',
  chilli: 'var(--tc-chilli, #e0392b)',
  leaf: 'var(--tc-curry-leaf, #2f9e5b)',
  teal: 'var(--tc-teal, #12908e)',
  cream: 'var(--tc-cream, #fff4dc)',
  char: 'var(--tc-charcoal, #241a14)',
  steel: 'var(--tc-steel, #c9d1d6)',
  night: 'var(--tc-night, #141a33)',
};

/** Tin-roof stall front with awning, bulbs on a wire, steel counter and a steaming kadai. Decorative. */
export function StallHeroArt({ className = '' }) {
  const stripes = Array.from({ length: 10 }, (_, i) => i);
  return (
    <svg className={`tc-menu-art tc-menu-hero__art ${className}`.trim()} viewBox="0 0 400 210" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="tcm-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b2a55" />
          <stop offset=".55" stopColor="#d9692e" />
          <stop offset="1" stopColor="#ffc15a" />
        </linearGradient>
        <linearGradient id="tcm-tin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#aab4ba" />
          <stop offset="1" stopColor="#6d777d" />
        </linearGradient>
        <pattern id="tcm-corr" width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="5" height="10" fill="rgba(255,255,255,.22)" />
          <rect x="5" width="5" height="10" fill="rgba(0,0,0,.18)" />
        </pattern>
        <radialGradient id="tcm-bulb"><stop offset="0" stopColor="#fff6c8" /><stop offset=".45" stopColor="#ffd25a" /><stop offset="1" stopColor="rgba(255,200,61,0)" /></radialGradient>
      </defs>
      <rect width="400" height="210" fill="url(#tcm-sky)" />
      {/* Charminar in the haze */}
      <g fill="rgba(60,30,50,.45)">
        <rect x="262" y="60" width="9" height="60" /><rect x="318" y="60" width="9" height="60" />
        <rect x="262" y="50" width="9" height="10" rx="4" /><rect x="318" y="50" width="9" height="10" rx="4" />
        <rect x="271" y="86" width="47" height="34" />
        <path d="M278 120v-18a16 16 0 0 1 32 0v18z" fill="rgba(255,190,120,.28)" />
        <circle cx="266" cy="46" r="3" /><circle cx="322" cy="46" r="3" />
      </g>
      {/* poles and bunting */}
      <rect x="40" y="62" width="6" height="140" fill="#8a5a2b" />
      <rect x="354" y="62" width="6" height="140" fill="#8a5a2b" />
      {/* tin roof */}
      <path d="M22 66 L60 30 H340 L378 66 Z" fill="url(#tcm-tin)" />
      <path d="M22 66 L60 30 H340 L378 66 Z" fill="url(#tcm-corr)" />
      <path d="M22 66 H378" stroke="#4d565b" strokeWidth="3" />
      {/* striped awning with scallops */}
      <g>
        {stripes.map((i) => (
          <path key={i} d={`M${40 + i * 32} 66 h32 v18 a16 16 0 0 1 -32 0 z`} fill={i % 2 ? C.teal : C.saffron} />
        ))}
        <path d="M40 66 H360" stroke="rgba(0,0,0,.25)" strokeWidth="2" />
      </g>
      {/* bulbs on a wire */}
      <path d="M46 104 Q200 128 354 104" fill="none" stroke="#2a1d14" strokeWidth="1.5" />
      {[78, 128, 178, 228, 278, 328].map((x, i) => {
        const y = 104 + Math.sin(((x - 46) / 308) * Math.PI) * 17;
        return (
          <g key={x} className="tc-menu-bulb" style={{ animationDelay: `${i * 0.35}s` }}>
            <circle cx={x} cy={y + 6} r="15" fill="url(#tcm-bulb)" />
            <circle cx={x} cy={y + 6} r="4" fill="#fff6c8" />
          </g>
        );
      })}
      {/* counter and steel plates */}
      <rect x="40" y="150" width="320" height="52" fill="#4a3322" />
      <rect x="34" y="144" width="332" height="10" rx="2" fill="url(#tcm-tin)" />
      {[0, 1, 2, 3].map((i) => (
        <ellipse key={i} cx={64 + i * 5} cy={140 - i * 3} rx="22" ry="5" fill="#d4dbdf" stroke="#8c979d" strokeWidth="1" />
      ))}
      {/* tiffin drum + kadai with steam */}
      <rect x="296" y="108" width="40" height="36" rx="4" fill="#b8c1c6" stroke="#7d878c" />
      <rect x="296" y="116" width="40" height="5" fill="#8d979c" />
      <ellipse cx="200" cy="140" rx="42" ry="9" fill="#2b2420" />
      <path d="M160 138 a40 26 0 0 0 80 0z" fill="#3b312b" />
      <ellipse cx="200" cy="138" rx="36" ry="6" fill="#e9a93a" />
      <g className="tc-menu-steam" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="3" strokeLinecap="round">
        <path d="M184 128 q-8 -14 0 -26 q8 -12 0 -24" />
        <path d="M204 126 q-8 -14 0 -26 q8 -12 0 -24" style={{ animationDelay: '.6s' }} />
        <path d="M222 128 q-8 -14 0 -26 q8 -12 0 -24" style={{ animationDelay: '1.2s' }} />
      </g>
      <rect x="0" y="202" width="400" height="8" fill="#2c211a" />
    </svg>
  );
}

/** Chotu, the stall helper: cap, gamcha on the shoulder, big grin, a glass of chai. */
export function ChotuAvatar({ size = 56, className = '' }) {
  return (
    <svg className={`tc-menu-art tc-menu-chotu ${className}`.trim()} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Chotu, the stall helper" focusable="false">
      <circle cx="32" cy="32" r="31" fill="#ffd9a0" stroke="#241a14" strokeWidth="2" />
      <path d="M10 56 q22 -10 44 0 v8 H10z" fill={C.chilli} />
      <path d="M10 56 l10 -6 l-2 14 z M54 56 l-10 -6 l2 14 z" fill="#fff4dc" opacity=".9" />
      <circle cx="32" cy="32" r="15" fill="#c98b5b" />
      <ellipse cx="17.5" cy="33" rx="3" ry="4" fill="#c98b5b" /><ellipse cx="46.5" cy="33" rx="3" ry="4" fill="#c98b5b" />
      <path d="M16 28 q0 -17 16 -17 q16 0 16 17 q-16 -7 -32 0z" fill="#241a14" />
      <path d="M17 24 q15 -6 30 0" fill="none" stroke={C.turmeric} strokeWidth="3" />
      <circle cx="26" cy="33" r="2.2" fill="#241a14" /><circle cx="38" cy="33" r="2.2" fill="#241a14" />
      <path d="M25 39 q7 8 14 0 z" fill="#fff" stroke="#241a14" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M44 48 h9 v8 a3 3 0 0 1 -3 3 h-3 a3 3 0 0 1 -3 -3z" fill="#b5651d" stroke="#241a14" strokeWidth="1.5" />
      <path d="M46 46 q-2 -3 0 -5 M50 46 q-2 -3 0 -5" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity=".8" />
    </svg>
  );
}

const STAR = 'M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z';

/** A chalk star: `on` = filled in turmeric chalk, otherwise a dashed outline. */
export function ChalkStar({ on = false, size = 22, className = '' }) {
  return (
    <svg className={`tc-menu-star ${on ? 'is-on' : ''} ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={STAR} fill={on ? C.turmeric : 'none'} stroke={on ? '#fff4dc' : 'rgba(255,244,220,.55)'} strokeWidth="1.6" strokeLinejoin="round" strokeDasharray={on ? undefined : '2.4 2.2'} />
    </svg>
  );
}

/** Row of three chalk stars with an accessible name. */
export function StarRow({ value = 0, size = 22, label = true }) {
  return (
    <span className="tc-menu-starrow" role={label ? 'img' : undefined} aria-label={label ? `${value} of 3 stars` : undefined} aria-hidden={label ? undefined : true}>
      {[0, 1, 2].map((i) => <ChalkStar key={i} on={i < value} size={size} />)}
    </span>
  );
}

/** Tiny glyph for a dish's station kind: tawa, steamer, kadai, chai. */
export function DishGlyph({ station, size = 26 }) {
  const common = { width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': true, focusable: 'false', className: 'tc-menu-glyph' };
  switch (station) {
    case 'steamer':
      return (<svg {...common}><rect x="6" y="14" width="20" height="12" rx="2" fill="#c9d1d6" stroke="#241a14" strokeWidth="1.6" /><rect x="8" y="9" width="16" height="6" rx="2" fill="#e5eaed" stroke="#241a14" strokeWidth="1.6" /><path d="M12 6q-2-2 0-4M20 6q-2-2 0-4" fill="none" stroke="#241a14" strokeWidth="1.5" strokeLinecap="round" /></svg>);
    case 'kadai':
      return (<svg {...common}><path d="M3 15h26a13 11 0 0 1-26 0z" fill="#3b312b" stroke="#241a14" strokeWidth="1.6" /><path d="M2 14l-1-2M30 14l1-2" stroke="#241a14" strokeWidth="2" strokeLinecap="round" /><ellipse cx="16" cy="15" rx="12" ry="2.5" fill="#e9a93a" /></svg>);
    case 'chai':
      return (<svg {...common}><path d="M8 11h14v9a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6z" fill="#fff4dc" stroke="#241a14" strokeWidth="1.6" /><path d="M9 14h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" fill="#b5651d" /><path d="M22 13h2a3 3 0 0 1 0 6h-2" fill="none" stroke="#241a14" strokeWidth="1.6" /></svg>);
    default:
      return (<svg {...common}><ellipse cx="16" cy="19" rx="13" ry="6" fill="#2b2420" stroke="#241a14" strokeWidth="1.6" /><ellipse cx="16" cy="17" rx="11" ry="4.5" fill="#e9b04a" /><path d="M5 14l4 3" stroke="#241a14" strokeWidth="1.6" strokeLinecap="round" /></svg>);
  }
}

/** A rupee note (for the galla tally). `tilt` in degrees. */
export function RupeeNote({ tilt = 0, className = '', tone = 'green' }) {
  const fill = tone === 'orange' ? '#f1a35b' : '#9cc78a';
  return (
    <svg className={`tc-menu-note ${className}`.trim()} style={{ transform: `rotate(${tilt}deg)` }} width="64" height="32" viewBox="0 0 64 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="62" height="30" rx="3" fill={fill} stroke="#3b4a2a" strokeWidth="1.5" />
      <rect x="5" y="5" width="54" height="22" rx="2" fill="none" stroke="rgba(59,74,42,.55)" strokeDasharray="2 2" />
      <circle cx="32" cy="16" r="8" fill="rgba(255,255,255,.4)" stroke="#3b4a2a" />
      <text x="32" y="20" textAnchor="middle" fontSize="11" fontWeight="800" fill="#2c3a1e" fontFamily="sans-serif">{'₹'}</text>
    </svg>
  );
}

export function Coin({ size = 18, className = '' }) {
  return (
    <svg className={`tc-menu-coin ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10.5" fill={C.turmeric} stroke="#8a5a14" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="7.2" fill="none" stroke="#b9801f" strokeWidth="1.2" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="800" fill="#6b4410" fontFamily="sans-serif">{'₹'}</text>
    </svg>
  );
}

export function Padlock({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="tc-menu-padlock">
      <path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="#c9d1d6" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="4.5" y="10.5" width="15" height="11" rx="2" fill="#e0a526" stroke="#241a14" strokeWidth="1.6" />
      <circle cx="12" cy="15.5" r="1.6" fill="#241a14" /><path d="M12 16.5v2.4" stroke="#241a14" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Sun / moon / festival flag in the sky strip of a level signboard. */
export function SkyGlyph({ sky }) {
  const common = { width: 34, height: 34, viewBox: '0 0 34 34', 'aria-hidden': true, focusable: 'false', className: 'tc-menu-skyglyph' };
  if (sky === 'night') return (<svg {...common}><path d="M24 20a10 10 0 1 1-10-14 8 8 0 0 0 10 14z" fill="#fff4dc" /><circle cx="27" cy="8" r="1.4" fill="#fff4dc" /><circle cx="6" cy="10" r="1.1" fill="#fff4dc" /></svg>);
  if (sky === 'festival') return (<svg {...common}><path d="M2 8h30" stroke="#241a14" strokeWidth="1.5" /><path d="M3 8l4.5 11L12 8z" fill="#e0392b" stroke="#241a14" strokeWidth="1" /><path d="M12 8l4.5 11L21 8z" fill="#ffc83d" stroke="#241a14" strokeWidth="1" /><path d="M21 8l4.5 11L30 8z" fill="#2f9e5b" stroke="#241a14" strokeWidth="1" /></svg>);
  const low = sky === 'evening' || sky === 'morning';
  return (<svg {...common}><circle cx="17" cy={low ? 22 : 15} r={sky === 'noon' ? 8 : 10} fill={sky === 'noon' ? '#fff3b0' : '#ffb347'} />{sky === 'noon' && <g stroke="#fff3b0" strokeWidth="2" strokeLinecap="round"><path d="M17 1v4M17 25v4M3 15h4M27 15h4M7 5l3 3M24 8l3-3" /></g>}</svg>);
}

/** Rolled-down shutter for a failed shift. */
export function ShutterArt() {
  return (
    <svg className="tc-menu-shutter" viewBox="0 0 160 70" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="156" height="66" rx="3" fill="#8f979c" stroke="#241a14" strokeWidth="2" />
      {Array.from({ length: 8 }, (_, i) => <path key={i} d={`M3 ${10 + i * 8}H157`} stroke="rgba(0,0,0,.28)" strokeWidth="2" />)}
      <rect x="68" y="56" width="24" height="8" rx="2" fill="#3b312b" /><circle cx="80" cy="60" r="2" fill="#e0a526" />
    </svg>
  );
}

const FEATURE_PATHS = {
  gas: 'M8 9h8v10a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 19zM9.5 9V7a2.5 2.5 0 0 1 5 0v2M12 4.5V3M8 13.5h8',
  rain: 'M7 14.5a4 4 0 0 1-.5-7.9A5.5 5.5 0 0 1 17 7.5a3.5 3.5 0 0 1 0 7zM9 17.5 8 20M13 17.5 12 20M17 17.5 16 20',
  power: 'M13 3 5 13.5h6L10 21l8-10.5h-6z',
  festival: 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z',
  inspector: 'M8 4.5h8v3H8zM6.5 6h11v14h-11zM9 12h6M9 15.5h4',
  delivery: 'M3 6.5h11v9H3zM14 10h4l3 3v2.5h-7zM7 18.5h.01M17 18.5h.01',
  cricket: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM6.5 7c3 2.5 3 7.500 0 10M17.5 7c-3 2.500-3 7.500 0 10',
  stock: 'M4 10h16l-1.5 9.5h-13zM8 10l3-5.5M16 10l-3-5.5',
  heat: 'M12 3c1 3.5 4.5 5 4.5 9.2A4.5 4.5 0 0 1 12 17a4.5 4.5 0 0 1-4.5-4.8c0-2 1-3.2 2-4.2.2 1.2.8 2 1.6 2.5',
  market: 'M6 8h12l1 12.5H5zM9 8V6.5a3 3 0 0 1 6 0V8',
  requests: 'M12 5v14M5 12h14',
  regulars: 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z',
  big: 'M5 20V6l7-2.5V20M12 9h7v11M8.5 9h.01M8.5 12.5h.01M8.5 16h.01M15.5 13h.01M15.5 16.5h.01M3 20h18',
};

/** A tiny stroke icon for one of the shift features (gas, rain, power cut, inspector ...). Decorative: the chip carries the words. */
export function FeatureGlyph({ id, size = 14 }) {
  const d = FEATURE_PATHS[id] || FEATURE_PATHS.requests;
  return (
    <svg className="tc-menu-art" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
