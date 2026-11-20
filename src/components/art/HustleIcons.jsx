// Hyderabad Hustle tile icons, 64x64, same flat + soft-highlight style as TileIcon.jsx (ground shadow at y ~58).
// Specials: luck drama auto metro mmts traffic chai municipal auction start.
// Collections (property tiles, tinted by the group colour): bazaar oldcity everyday twin lake luxury cyber newcity.
import { PAL, lighten, darken } from './palette.js';

const INK = '#1b1340';
const Shadow = ({ rx = 20, y = 58, cx = 32 }) => <ellipse cx={cx} cy={y} rx={rx} ry="3" fill={INK} opacity=".16" />;

/** Hand-drawn 5-point star centred on (x,y). */
const star = (x, y, r, k = 0.45) => {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * k : r;
    d += (i ? 'L' : 'M') + (x + Math.cos(a) * rr).toFixed(2) + ' ' + (y + Math.sin(a) * rr).toFixed(2);
  }
  return d + 'Z';
};

/* ---------------- Nawabi Luck: crescent + star lantern ---------------- */
export function Luck() {
  const em = '#0f8f6a';
  const gold = '#f4c14f';
  return (
    <g>
      <circle cx="32" cy="32" r="26" fill={gold} opacity=".18" />
      <Shadow rx={14} />
      <path d="M32 2V9" stroke="#b78a2e" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="32" cy="3.6" r="2.2" fill="none" stroke={gold} strokeWidth="1.4" />
      {/* cap */}
      <path d="M21 16Q22 8.6 32 8.6Q42 8.6 43 16Z" fill={gold} />
      <path d="M32 8.6Q42 8.6 43 16H32Z" fill="#d9a23a" />
      <rect x="19" y="15.4" width="26" height="3.2" rx="1.4" fill="#d9a23a" />
      {/* glass body */}
      <path d="M20.4 18.6H43.6L46 36L40 48H24L18 36Z" fill={em} />
      <path d="M32 18.6H43.6L46 36L40 48H32Z" fill="#0a6e52" />
      <path d="M23 21.6H41L43 36L38.4 45H25.6L21 36Z" fill="#ffe7a3" opacity=".9" />
      {/* crescent + star cut-out in the glow */}
      <path d="M33.6 25.6A8.2 8.2 0 1 0 33.6 41.4A6.4 6.4 0 1 1 33.6 25.6Z" fill={em} />
      <path d={star(37.6, 31.4, 3.4)} fill={em} />
      {/* jaali ribs */}
      <path d="M32 18.6V48M20.4 18.6L24 48M43.6 18.6L40 48" stroke={gold} strokeWidth="1.2" opacity=".85" />
      <path d="M18 36H46" stroke={gold} strokeWidth="1.4" />
      <rect x="22" y="47" width="20" height="3.2" rx="1.4" fill="#d9a23a" />
      <path d="M27 50.2H37L32 56Z" fill={gold} />
      <path d="M24.6 23.4L23.4 33" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
      <g fill="#fff3c4">
        <path d={star(11, 18, 3)} />
        <path d={star(54, 26, 2.4)} />
      </g>
    </g>
  );
}

/* ---------------- City Drama: masks + honk ---------------- */
export function Drama() {
  return (
    <g>
      <Shadow rx={22} />
      {/* honk burst */}
      <g stroke={PAL.gold} strokeWidth="2.2" strokeLinecap="round">
        <path d="M52 8L56 4M55 14H60M49 4V0" />
      </g>
      {/* indigo (worried) mask, behind */}
      <g transform="rotate(14 40 30)">
        <path d="M27 12H55Q56 30 49 40Q44 47 41 47Q38 47 33 40Q26 30 27 12Z" fill="#4b3fb5" />
        <path d="M41 12H55Q56 30 49 40Q44 47 41 47Z" fill="#3a2f8c" />
        <path d="M32 22Q35 19.4 38 22M44 22Q47 19.4 50 22" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <path d="M35 38Q41 32 47 38" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M33 25.6L32.4 29" stroke="#8fe3ff" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      {/* rose (laughing) mask, front */}
      <g transform="rotate(-12 24 34)">
        <path d="M9 16H37Q38 34 31 44Q26 51 23 51Q20 51 15 44Q8 34 9 16Z" fill="#ff5d73" />
        <path d="M23 16H37Q38 34 31 44Q26 51 23 51Z" fill="#e23d5c" />
        <path d="M14 26Q17 23 20 26M26 26Q29 23 32 26" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M15.4 35Q23 44 30.6 35Z" fill="#7a1430" />
        <path d="M17 35.6Q23 38 29 35.6" fill="none" stroke="#fff" strokeWidth="1.4" />
        <circle cx="13.6" cy="31" r="1.8" fill="#ffb3c0" />
        <path d="M12 19L11.6 26" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".6" />
      </g>
    </g>
  );
}

/* ---------------- Auto Stand ---------------- */
export function AutoIcon() {
  const body = '#ffd23f', green = '#2fae6a', top = '#2b2260';
  return (
    <g>
      <Shadow rx={26} y={57} />
      <path d="M19 19Q20.6 8 29 8H50Q55 8 55 13V40H50V13.6H29.6Q25 13.6 24 19Z" fill={top} />
      <path d="M27 10.4H49.6" stroke="#4e4597" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="24.6" y="13.6" width="25.4" height="17" fill="#4a3f8f" />
      <rect x="40" y="18" width="9" height="12.6" rx="1" fill="#e9e3ff" opacity=".85" />
      <path d="M6 48V39Q6 31 14 29.6L19.6 20.6H24.4L22.4 31H55V48Z" fill={body} />
      <path d="M6 41H55V48H6Z" fill={green} />
      <path d="M22.4 31H55" stroke="#fff3b0" strokeWidth="1.4" />
      <path d="M20.4 21.6L24.4 20.6L22.6 30H16Z" fill="#9fe3f5" />
      <path d="M21 23L19.6 28" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="9.6" cy="36.4" r="2.4" fill="#fff3b8" />
      <rect x="4" y="47" width="9" height="2.6" rx="1.3" fill="#3a2f8c" />
      {[[16, 50], [45, 50]].map(([x, y]) => (
        <g key={x}>
          <circle cx={x} cy={y} r="6" fill="#2b2260" />
          <circle cx={x} cy={y} r="2.4" fill="#c9c3e6" />
        </g>
      ))}
      <path d="M58 22H62M57 28H62" stroke={PAL.gold} strokeWidth="1.8" strokeLinecap="round" opacity=".9" />
    </g>
  );
}

/* ---------------- Metro Interchange: train on an elevated viaduct ---------------- */
export function MetroBridge() {
  return (
    <g>
      <Shadow rx={26} />
      {/* pillars */}
      {[16, 48].map((x) => (
        <g key={x}>
          <rect x={x - 3} y="40" width="6" height="18" fill="#d8d0f3" />
          <rect x={x} y="40" width="3" height="18" fill="#b6acdf" />
          <path d={`M${x - 8} 40H${x + 8}L${x + 4} 44H${x - 4}Z`} fill="#c9c0ea" />
        </g>
      ))}
      <rect x="2" y="36" width="60" height="5" rx="1" fill="#efeaff" />
      <rect x="2" y="39.4" width="60" height="1.6" fill="#a99fd6" />
      {/* train */}
      <path d="M4 34V20Q4 15 9 15H48Q58 15 60 25L61 34Z" fill="#ffffff" />
      <path d="M4 30H61V34H4Z" fill="#d8d0f3" />
      <path d="M4 26H60.4V28.4H4Z" fill={PAL.rose} />
      <path d="M50 17.4Q56 18 58.4 24H50Z" fill="#2e2475" />
      {[8, 18, 28, 38].map((x) => <rect key={x} x={x} y="18" width="7.4" height="6" rx="1.2" fill="#2e2475" />)}
      {[8, 18, 28, 38].map((x) => <path key={x} d={`M${x + 1} 23L${x + 4} 18.6`} stroke="#6f66d8" strokeWidth="1.2" opacity=".8" />)}
      <rect x="2" y="34" width="60" height="2" fill="#8c84c8" />
      <path d="M26 10V15M38 10V15M22 10H42" stroke="#8c84c8" strokeWidth="1.4" strokeLinecap="round" />
    </g>
  );
}

/* ---------------- MMTS Express: suburban train, head-on, on rails ---------------- */
export function Mmts() {
  const maroon = '#a8324a', cream = '#fff1d6';
  return (
    <g>
      {/* rails in perspective */}
      <path d="M22 44L8 62H56L42 44Z" fill="#b9a782" opacity=".55" />
      {[48, 53, 58].map((y, i) => <rect key={y} x={18 - i * 3.6} y={y} width={28 + i * 7.2} height="1.8" fill="#8a6f4e" />)}
      <path d="M26 44L15 62M38 44L49 62" stroke="#6a62b4" strokeWidth="2" strokeLinecap="round" />
      {/* body */}
      <path d="M15 48V18Q15 6 32 6Q49 6 49 18V48Z" fill={cream} />
      <path d="M32 6Q49 6 49 18V48H32Z" fill="#ecdcbc" />
      <path d="M15 34H49V48H15Z" fill={maroon} />
      <path d="M32 34H49V48H32Z" fill="#8a2840" />
      <path d="M18.6 17Q18.6 11 32 11Q45.4 11 45.4 17V27H18.6Z" fill="#2e2475" />
      <path d="M21 16Q22 13 27 12.6L22 25H21Z" fill="#6f66d8" opacity=".8" />
      <rect x="29" y="27.6" width="6" height="6" rx="1" fill="#2e2475" />
      <circle cx="21" cy="40" r="2.8" fill={PAL.gold} />
      <circle cx="43" cy="40" r="2.8" fill={PAL.gold} />
      <circle cx="32" cy="8.6" r="2" fill="#fff8d6" />
      <rect x="22" y="44.4" width="20" height="2" fill="#5a1626" />
    </g>
  );
}

/* ---------------- Traffic Jam ---------------- */
function CarFront({ x, y, c, s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-12 0V-7Q-12 -10 -9 -11L-6.6 -17Q-5.6 -19 -3 -19H3Q5.6 -19 6.6 -17L9 -11Q12 -10 12 -7V0Z" fill={c} />
      <path d="M0 -19H3Q5.6 -19 6.6 -17L9 -11Q12 -10 12 -7V0H0Z" fill={darken(c, 0.2)} />
      <path d="M-5.4 -16.6H5.4L7.2 -11.4H-7.2Z" fill="#9fe3f5" />
      <rect x="-10.4" y="-8" width="4.4" height="2.6" rx="1.2" fill="#fff3b8" />
      <rect x="6" y="-8" width="4.4" height="2.6" rx="1.2" fill="#fff3b8" />
      <rect x="-12" y="-2" width="24" height="2.4" rx="1" fill="#3a2f8c" />
      <rect x="-11" y="0" width="4" height="3" rx="1" fill="#2b2260" />
      <rect x="7" y="0" width="4" height="3" rx="1" fill="#2b2260" />
    </g>
  );
}
function TrafficCone({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-6" y="-1.6" width="12" height="2.6" rx="1" fill="#e0571f" />
      <path d="M-4.6 -1.6L-1.4 -14H1.4L4.6 -1.6Z" fill="#ff8a3d" />
      <path d="M-3.4 -6.4H3.4L2.8 -9H-2.8Z" fill="#fff" />
      <path d="M0 -14H1.4L4.6 -1.6H0Z" fill="#e0571f" opacity=".45" />
    </g>
  );
}
export function Traffic() {
  return (
    <g>
      <Shadow rx={28} />
      {/* signal */}
      <rect x="6.4" y="20" width="2.4" height="36" fill="#6a62b4" />
      <rect x="2" y="4" width="11" height="22" rx="3" fill="#2b2260" />
      <circle cx="7.5" cy="9.6" r="3" fill="#ff4d5e" />
      <circle cx="7.5" cy="9.6" r="5.6" fill="#ff4d5e" opacity=".25" />
      <circle cx="7.5" cy="16.4" r="2.6" fill="#5a4a2a" />
      <circle cx="7.5" cy="22.4" r="2.6" fill="#2e4a3a" />
      <CarFront x={42} y={36} c="#7b6dff" s={0.86} />
      <CarFront x={28} y={50} c="#ff5d73" />
      <CarFront x={52} y={52} c="#2ec4b6" s={0.78} />
      <TrafficCone x={14} y={57} s={0.9} />
      <TrafficCone x={60} y={40} s={0.6} />
      {/* honk marks */}
      <path d="M24 14L22 10M30 12V7.6M36 14L38 10" stroke={PAL.gold} strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

/* ---------------- Chai Adda: kettle pouring into an Irani chai glass ---------------- */
export function ChaiAdda() {
  return (
    <g>
      <Shadow rx={26} />
      {/* bench */}
      <rect x="4" y="50" width="56" height="4" rx="1.6" fill="#a8673a" />
      <rect x="8" y="54" width="3" height="4" fill="#8a4f26" />
      <rect x="53" y="54" width="3" height="4" fill="#8a4f26" />
      {/* kettle */}
      <path d="M8 26Q8 20 16 19H26Q33 20 33 26V46Q33 50 28 50H13Q8 50 8 46Z" fill="#c9cde6" />
      <path d="M20.6 19H26Q33 20 33 26V46Q33 50 28 50H20.6Z" fill="#a6abd0" />
      <path d="M12 16Q12 12.6 20.6 12.6Q29 12.6 29 16V19H12Z" fill="#dfe2f4" />
      <circle cx="20.6" cy="11" r="2" fill="#8d93c4" />
      <path d="M8 28Q2 28 2.6 36Q3.4 42 8 42" fill="none" stroke="#8d93c4" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M33 30L42 22.6L43.6 24.4L35 35Z" fill="#a6abd0" />
      <path d="M12 24V42" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".7" />
      {/* pour */}
      <path d="M43.2 24.6Q47 28 47 36" fill="none" stroke="#c97a35" strokeWidth="2" strokeLinecap="round" />
      {/* glass */}
      <path d="M39.4 33H55.6L54 50Q47.5 51.6 41 50Z" fill="#eaf8ff" />
      <path d="M40 37.6H55L54 50Q47.5 51.6 41 50Z" fill="#c97a35" />
      <ellipse cx="47.5" cy="37.6" rx="7.6" ry="1.6" fill="#e6a45e" />
      <path d="M42 39.4L42.8 48" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity=".8" />
      {/* Osmania biscuits */}
      <ellipse cx="57" cy="50" rx="5" ry="1.8" fill="#e8b35c" />
      <ellipse cx="57" cy="48.4" rx="5" ry="1.8" fill="#f2c877" />
      <g fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".9">
        <path d="M45 28C42 24 48 22 45 16" />
        <path d="M51 28C48 24 54 22 51 17" />
      </g>
    </g>
  );
}

/* ---------------- Municipal Charges: civic office + receipt ---------------- */
export function Municipal() {
  const stone = '#f1e2c0', stoneD = '#d8c49a';
  return (
    <g>
      <Shadow rx={26} />
      <rect x="6" y="50" width="44" height="5" rx="1.4" fill="#c9b58e" />
      <rect x="8" y="22" width="40" height="28" fill={stone} />
      <rect x="28" y="22" width="20" height="28" fill={stoneD} opacity=".55" />
      <rect x="5" y="19" width="46" height="4" rx="1.4" fill="#e9d8b0" />
      <path d="M17 19Q17 7 28 7Q39 7 39 19Z" fill="#7b6dff" />
      <path d="M28 7Q39 7 39 19H28Z" fill="#5b4cc4" />
      <path d="M28 7V2.6" stroke={PAL.gold} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M28.4 2.6H33.6L32 4.2L33.6 5.8H28.4Z" fill={PAL.saffron} />
      {[12, 20, 34, 42].map((x) => <rect key={x} x={x - 1.4} y="24" width="2.8" height="26" fill="#fff8e6" />)}
      <path d="M24 50V38Q24 33 28 33Q32 33 32 38V50Z" fill="#2e2475" />
      {/* receipt */}
      <g transform="rotate(8 48 40)">
        <path d="M38 26H58V54L55.5 52L53 54L50.5 52L48 54L45.5 52L43 54L40.5 52L38 54Z" fill="#fffdf6" />
        <path d="M48 26H58V54L55.5 52L53 54L50.5 52L48 54Z" fill="#efe6cf" opacity=".6" />
        <rect x="41" y="30" width="10" height="2.4" rx="1.2" fill="#2e2475" />
        <rect x="41" y="35" width="14" height="1.8" rx=".9" fill="#c9c3e6" />
        <rect x="41" y="39" width="12" height="1.8" rx=".9" fill="#c9c3e6" />
        <path d="M41 45.6H48M41 45.6H48M41.4 43.6H48M42 43.6Q46.4 43.6 46.4 45.2Q46.4 46.8 42 46.8L47 50" fill="none" stroke={PAL.rose} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  );
}

/* ---------------- Bazaar Auction: gavel under a bazaar awning ---------------- */
export function Auction() {
  const stripes = [];
  for (let i = 0; i < 8; i++) stripes.push(<rect key={i} x={2 + i * 7.5} y="4" width="7.5" height="10" fill={i % 2 ? '#fff7e6' : PAL.saffron} />);
  let sc = 'M2 14';
  for (let i = 0; i < 8; i++) sc += `A3.75 3.2 0 0 0 ${2 + (i + 1) * 7.5} 14`;
  return (
    <g>
      <Shadow rx={24} />
      <rect x="2" y="2" width="60" height="3" rx="1.4" fill="#a8673a" />
      {stripes}
      <path d={sc + 'Z'} fill="#e0702a" />
      {/* sound block */}
      <path d="M14 50H42L38 56H18Z" fill="#8a4f26" />
      <rect x="14" y="46" width="28" height="5" rx="1.6" fill="#b8733a" />
      <rect x="14" y="46" width="28" height="2" rx="1" fill="#d39a5a" />
      {/* gavel */}
      <g transform="rotate(-34 36 34)">
        <rect x="33.8" y="30" width="4.4" height="26" rx="2" fill="#b8733a" />
        <rect x="36" y="30" width="2.2" height="26" rx="1" fill="#8a4f26" />
        <rect x="24" y="20" width="24" height="11" rx="3" fill="#a8673a" />
        <rect x="24" y="20" width="24" height="4" rx="2" fill="#d39a5a" />
        <rect x="22" y="19" width="4" height="13" rx="1.6" fill={PAL.gold} />
        <rect x="46" y="19" width="4" height="13" rx="1.6" fill={PAL.gold} />
      </g>
      <g stroke={PAL.gold} strokeWidth="2" strokeLinecap="round">
        <path d="M10 38L5 35M9 44H3M46 40L52 37M47 46H54" />
      </g>
    </g>
  );
}

/* ---------------- START: Namma Hyderabad gateway ---------------- */
export function Gateway() {
  const stone = '#ecc98c', shade = '#c99a58', green = '#1f9e6e', gold = PAL.gold;
  return (
    <g>
      <Shadow rx={28} />
      {/* road + arrow through the gate */}
      <path d="M22 58L27 40H37L42 58Z" fill="#5c5a7a" />
      <path d="M32 56V46M28 49.6L32 45L36 49.6" fill="none" stroke="#fff7e6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {/* pillars */}
      {[10, 46].map((x) => (
        <g key={x}>
          <rect x={x} y="18" width="8" height="38" fill={stone} />
          <rect x={x + 4} y="18" width="4" height="38" fill={shade} />
          <rect x={x - 1.4} y="14.6" width="10.8" height="4" rx="1" fill={shade} />
          <path d={`M${x - 0.6} 14.6Q${x + 4} 6 ${x + 8.6} 14.6Z`} fill={green} />
          <path d={`M${x + 4} 9V4`} stroke={gold} strokeWidth="1.4" strokeLinecap="round" />
          <rect x={x + 2} y="26" width="4" height="7" rx="2" fill={green} />
        </g>
      ))}
      {/* pointed arch span */}
      <path d="M18 40V26Q18 16 32 12Q46 16 46 26V40H42V28Q42 20 32 17Q22 20 22 28V40Z" fill={stone} />
      <path d="M32 12Q46 16 46 26V40H42V28Q42 20 32 17Z" fill={shade} />
      <path d="M18 24H46" stroke={green} strokeWidth="2.4" />
      <path d="M18 22.6H46" stroke={gold} strokeWidth="1" />
      {/* bunting */}
      <path d="M18 30Q32 36 46 30" fill="none" stroke="#5a4a8a" strokeWidth=".8" />
      {[[22, 31.6, PAL.rose], [27, 33.2, gold], [32, 33.8, PAL.teal], [37, 33.2, PAL.saffron], [42, 31.6, PAL.rose]].map(([x, y, c]) => (
        <path key={x} d={`M${x - 1.8} ${y}H${x + 1.8}L${x} ${y + 3.6}Z`} fill={c} />
      ))}
      <path d="M32 12V6" stroke={gold} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M32.4 6H38L36.2 8L38 10H32.4Z" fill={green} />
    </g>
  );
}

/* ====================== collections (property tiles) ====================== */
export function BazaarIcon({ c }) {
  const st = [];
  for (let i = 0; i < 6; i++) st.push(<rect key={i} x={8 + i * 8} y="12" width="8" height="9" fill={i % 2 ? '#fff7e6' : c} />);
  let sc = 'M8 21';
  for (let i = 0; i < 6; i++) sc += `A4 3.4 0 0 0 ${8 + (i + 1) * 8} 21`;
  return (
    <g>
      <Shadow rx={26} />
      <rect x="9" y="12" width="3" height="44" fill="#8a4f26" />
      <rect x="52" y="12" width="3" height="44" fill="#8a4f26" />
      <path d="M6 12L12 4H52L58 12Z" fill={darken(c, 0.2)} />
      {st}
      <path d={sc + 'Z'} fill={darken(c, 0.15)} />
      <rect x="10" y="38" width="44" height="17" rx="2" fill="#b8733a" />
      <rect x="10" y="38" width="44" height="4" rx="1.6" fill="#d39a5a" />
      {[[17, 34, '#ff8a3d'], [22, 34, '#ffb100'], [19.5, 30.4, '#ff5d73'], [32, 34, '#8de05a'], [37, 34, '#3fa862'], [34.5, 30.4, '#8de05a'], [47, 34, '#ffd34e'], [44.5, 30.4, '#ffb100']].map(([x, y, col], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={col} />
      ))}
      <rect x="14" y="46" width="14" height="5" rx="1" fill={lighten(c, 0.3)} />
    </g>
  );
}

export function OldCityIcon({ c }) {
  const stone = '#ecc98c', shade = '#c99a58', dome = '#f7e2b6', domeD = '#dcb67a';
  return (
    <g>
      <Shadow rx={26} />
      {[[14, 9], [50, 9], [32, 12]].map(([x, r]) => (
        <g key={x}>
          <rect x={x - r * 0.6} y={25 - r * 0.7} width={r * 1.2} height={r * 0.7} fill={stone} />
          <path d={`M${x - r * 0.8} ${25 - r * 0.7}Q${x - r * 0.8} ${25 - r * 1.8} ${x} ${25 - r * 2}Q${x + r * 0.8} ${25 - r * 1.8} ${x + r * 0.8} ${25 - r * 0.7}Z`} fill={dome} />
          <path d={`M${x} ${25 - r * 2}Q${x + r * 0.8} ${25 - r * 1.8} ${x + r * 0.8} ${25 - r * 0.7}H${x}Z`} fill={domeD} />
          <path d={`M${x} ${25 - r * 2}V${25 - r * 2.5}`} stroke={PAL.gold2} strokeWidth="1.4" strokeLinecap="round" />
        </g>
      ))}
      <rect x="8" y="28" width="48" height="28" fill={stone} />
      <rect x="32" y="28" width="24" height="28" fill={shade} opacity=".45" />
      <rect x="6" y="24.6" width="52" height="4" rx="1.4" fill={shade} />
      <rect x="6" y="24.6" width="52" height="1.6" fill={c} />
      {[12, 42].map((x) => <path key={x} d={`M${x} 56V42Q${x} 36 ${x + 5} 36Q${x + 10} 36 ${x + 10} 42V56Z`} fill="#2e2475" />)}
      <path d="M25 56V40Q25 32 32 32Q39 32 39 40V56Z" fill={darken(c, 0.3)} />
      <path d="M27.6 56V41Q27.6 35 32 35Q36.4 35 36.4 41V56Z" fill={c} />
      {/* pearl string */}
      {[16, 21, 26, 31, 36, 41, 46].map((x, i) => <circle key={x} cx={x} cy={30.4 + Math.sin((i / 6) * Math.PI) * 1.4} r="1.3" fill="#fff" />)}
    </g>
  );
}

export function EverydayIcon({ c }) {
  // stacked tiffin carrier
  const tier = (y, col) => (
    <g key={y}>
      <rect x="14" y={y} width="36" height="11" rx="3" fill={col} />
      <rect x="32" y={y} width="18" height="11" rx="3" fill={darken(col, 0.16)} />
      <rect x="14" y={y + 8.4} width="36" height="2.6" fill={darken(col, 0.3)} />
      <path d={`M17 ${y + 3}V${y + 7}`} stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
    </g>
  );
  return (
    <g>
      <Shadow rx={22} />
      <path d="M18 22V8Q18 4 22 4H42Q46 4 46 8V22" fill="none" stroke="#8d93c4" strokeWidth="3" strokeLinecap="round" />
      <rect x="28" y="2.4" width="8" height="4" rx="2" fill={c} />
      {tier(20, '#dfe2f4')}
      {tier(31, c)}
      {tier(42, '#dfe2f4')}
      <rect x="11" y="18" width="4" height="36" rx="2" fill="#a6abd0" />
      <rect x="49" y="18" width="4" height="36" rx="2" fill="#8d93c4" />
      <g fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" opacity=".85">
        <path d="M56 16C54 13 58 11 56 7" />
      </g>
    </g>
  );
}

export function TwinIcon({ c }) {
  // clock tower
  return (
    <g>
      <Shadow rx={20} />
      <rect x="14" y="52" width="36" height="5" rx="1.4" fill="#c9b58e" />
      <rect x="22" y="18" width="20" height="34" fill="#f1e2c0" />
      <rect x="32" y="18" width="10" height="34" fill="#d8c49a" />
      <rect x="20" y="16" width="24" height="4" rx="1.4" fill={c} />
      <path d="M20 16L32 4L44 16Z" fill={darken(c, 0.15)} />
      <path d="M32 4L44 16H32Z" fill={darken(c, 0.32)} />
      <circle cx="32" cy="29" r="7" fill="#fff" stroke={darken(c, 0.2)} strokeWidth="1.6" />
      <path d="M32 24.4V29L35.4 31" fill="none" stroke="#2e2475" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M28 52V44Q28 40 32 40Q36 40 36 44V52Z" fill="#2e2475" />
      <rect x="25" y="38" width="3" height="6" rx="1.4" fill="#79d3ea" />
      <rect x="36" y="38" width="3" height="6" rx="1.4" fill="#79d3ea" />
      <path d="M8 56L12 48L16 56Z" fill={PAL.grassDark} />
      <path d="M48 56L52 46L56 56Z" fill={PAL.grass} />
    </g>
  );
}

export function LakeIcon({ c }) {
  return (
    <g>
      <circle cx="44" cy="18" r="9" fill={PAL.gold} opacity=".9" />
      <circle cx="44" cy="18" r="13" fill={PAL.gold} opacity=".18" />
      <path d="M2 38Q14 26 24 32Q34 22 46 30Q54 26 62 32V40H2Z" fill={PAL.grass} />
      <path d="M2 36H62V58Q32 62 2 58Z" fill={c} />
      <path d="M2 36H62V40Q32 43 2 40Z" fill={lighten(c, 0.35)} />
      <path d="M8 48h10M28 52h12M44 46h10" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
      {/* swan boat */}
      <path d="M16 46H38L35 52H19Z" fill="#fff" />
      <path d="M36 46Q42 40 38 34Q36 32 34 34" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M33 33.4L31 34.6" stroke={PAL.saffron} strokeWidth="2" strokeLinecap="round" />
      <path d="M19 46V40H31V46" fill={darken(c, 0.2)} />
    </g>
  );
}

export function LuxuryIcon({ c }) {
  // film clapperboard + star
  return (
    <g>
      <Shadow rx={24} />
      <rect x="8" y="26" width="44" height="28" rx="3" fill="#2b2260" />
      <rect x="8" y="26" width="44" height="7" fill={c} />
      {[12, 22, 32, 42].map((x) => <path key={x} d={`M${x} 26L${x + 5} 33H${x + 9}L${x + 4} 26Z`} fill="#fff" opacity=".9" />)}
      <g transform="rotate(-16 10 22)">
        <rect x="8" y="16" width="44" height="7" rx="1" fill={c} />
        {[12, 22, 32, 42].map((x) => <path key={x} d={`M${x} 16L${x + 5} 23H${x + 9}L${x + 4} 16Z`} fill="#fff" opacity=".9" />)}
      </g>
      <circle cx="10" cy="23.6" r="2" fill="#c9c3e6" />
      <rect x="13" y="38" width="20" height="2.4" rx="1.2" fill="#8c84c8" />
      <rect x="13" y="44" width="14" height="2.4" rx="1.2" fill="#8c84c8" />
      <path d={star(50, 44, 9)} fill={PAL.gold} />
      <path d={star(50, 44, 4.4)} fill="#fff3b8" />
      <path d="M58 10L59.2 13L62 14L59.2 15L58 18L56.8 15L54 14L56.8 13Z" fill="#fff3c4" />
    </g>
  );
}

export function CyberIcon({ c }) {
  return (
    <g>
      <Shadow rx={22} />
      <path d="M18 56V12L34 6V56Z" fill="#79d3ea" />
      <path d="M34 6L44 12V56H34Z" fill="#3f8fc4" />
      {[16, 22, 28, 34, 40, 46].map((y) => <path key={y} d={`M18 ${y + 2}L34 ${y - 2}L44 ${y + 2}`} fill="none" stroke="#1f4f8c" strokeWidth=".8" opacity=".5" />)}
      <path d="M20 54V16L26 13.6V54Z" fill="#fff" opacity=".3" />
      <rect x="32.6" y="2" width="2.4" height="5" fill="#c8c0e6" />
      <circle cx="33.8" cy="2" r="1.8" fill={PAL.rose} />
      {/* circuit nodes */}
      <path d="M44 24H52V16M44 36H56M44 46H50V54" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {[[52, 15], [57, 36], [50, 55]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.6" fill={c} />)}
      <path d="M8 56V38H18V56Z" fill={c} />
      <path d="M13 38H18V56H13Z" fill={darken(c, 0.25)} />
      {[42, 47, 52].map((y) => <rect key={y} x="9.6" y={y} width="2.4" height="2.4" fill="#ffd36e" />)}
    </g>
  );
}

export function NewCityIcon({ c }) {
  return (
    <g>
      <Shadow rx={26} />
      {/* crane */}
      <path d="M48 56V10M48 10H62M48 10H40M48 14L60 10" stroke="#ffb100" strokeWidth="2" strokeLinecap="round" />
      <path d="M60 10V22" stroke="#8d93c4" strokeWidth="1" />
      <rect x="57.6" y="22" width="4.6" height="3.6" fill={c} />
      {/* towers */}
      <path d="M8 56V24L18 20V56Z" fill={lighten(c, 0.35)} />
      <path d="M18 20L24 24V56H18Z" fill={c} />
      <path d="M22 56V14Q30 8 38 14V56Z" fill="#79d3ea" />
      <path d="M30 10.4Q34 11 38 14V56H30Z" fill="#3f8fc4" />
      {[20, 26, 32, 38, 44, 50].map((y) => <path key={y} d={`M22 ${y}H38`} stroke="#1f4f8c" strokeWidth=".8" opacity=".45" />)}
      <path d="M24 54V18L27 15.6V54Z" fill="#fff" opacity=".35" />
      <path d="M36 56V34H48V56Z" fill={darken(c, 0.1)} />
      <path d="M42 34H48V56H42Z" fill={darken(c, 0.3)} />
      {[38, 44, 50].map((y) => <rect key={y} x="37.6" y={y} width="3" height="3" fill="#ffd36e" />)}
    </g>
  );
}

export const HUSTLE_ICONS = {
  luck: Luck,
  drama: Drama,
  auto: AutoIcon,
  metro: MetroBridge,
  mmts: Mmts,
  traffic: Traffic,
  chai: ChaiAdda,
  municipal: Municipal,
  auction: Auction,
  start: Gateway,
};
export const COLLECTION_ICONS = {
  bazaar: BazaarIcon,
  oldcity: OldCityIcon,
  everyday: EverydayIcon,
  twin: TwinIcon,
  lake: LakeIcon,
  luxury: LuxuryIcon,
  cyber: CyberIcon,
  newcity: NewCityIcon,
};
export const COLLECTION_ACCENT = {
  bazaar: '#c98b4a', oldcity: '#e2725b', everyday: '#f2b134', twin: '#3fb68b',
  lake: '#3aa7e0', luxury: '#b06ad9', cyber: '#4f7cff', newcity: '#1fb5a6',
};
