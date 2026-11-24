// Tiffin Centre cover (16:9) + app icon, drawn for the hub: a Hyderabad ROADSIDE tiffin stall on a footpath at golden hour.
// A striped tarpaulin on bamboo poles with a flex banner (Telugu + English), a brick-and-LPG stove with a soot-dark tawa and
// a dosa, a steel idly cooker, a brass kadai, irani chai glasses, steel plates and drums, plastic stools, a hanging tube-light
// and bare bulbs on a wire, an electric pole with tangled wires, an auto passing and a pani-puri cart down the road, wet-road
// puddles, tiny customers eating standing at the counter wearing patience rings (one holds the money out), and the Charminar
// in the haze. The left third stays calm so card/hero text can sit on it. Pure inline SVG, no assets; the only text is the
// banner (system fonts, pinned width), everything else is shapes.
import { memo } from 'react';
import { CoverSvg, IconSvg, Sparkle, COVER_CSS, RUPEE, f, rng, skyline, useUid } from './kit.jsx';

const SAFFRON = '#ff8a1f';
const TEAL = '#12908e';
const CREAM = '#fff4dc';
const CHAR = '#241a14';
const TURMERIC = '#ffc83d';
const HZ = 372; // horizon / street line (cover)
const SIGN_FONT = "'Bricolage Grotesque','Noto Sans Telugu','Nirmala UI','Segoe UI',system-ui,sans-serif";

/** Points along a quadratic curve, for strings of bulbs. */
function strand([x0, y0], [x1, y1], [x2, y2], n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    out.push([f(a * x0 + b * x1 + c * x2), f(a * y0 + b * y1 + c * y2)]);
  }
  return out;
}

/** A glowing bare bulb hanging at (x, y). Needs the `glow` gradient of <CoverDefs>. */
function Bulb({ x, y, uid, r = 4.4 }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r * 3.4} fill={`url(#${uid}glow)`} />
      <rect x={f(x - 1.2)} y={f(y - r - 2.4)} width="2.4" height="3" fill="#1b110c" />
      <circle cx={x} cy={y} r={r} fill="#fff1b8" />
      <circle cx={f(x - r * 0.3)} cy={f(y - r * 0.3)} r={f(r * 0.38)} fill="#fff" opacity=".9" />
    </g>
  );
}

/** The Charminar, front on: four minarets, the arched base, the parapet with its small domes. Base on y = 0, ~100 wide, ~92 tall. */
function Charminar({ x, y, s = 1, c }) {
  return (
    <g transform={`translate(${f(x)} ${f(y)}) scale(${s})`} fill={c}>
      <rect x="-38" y="-52" width="76" height="52" />
      <path d="M-11 0V-24Q0 -38 11 -24V0Z" fill="#1b0d08" opacity=".55" />
      <rect x="-42" y="-58" width="84" height="7" />
      <rect x="-30" y="-66" width="60" height="9" />
      {[-24, -12, 0, 12, 24].map((dx) => (
        <path key={dx} d={`M${dx - 5} -66Q${dx} -80 ${dx + 5} -66Z`} />
      ))}
      <rect x="-0.8" y="-90" width="1.6" height="12" />
      {[-46, 46].map((dx) => (
        <g key={dx} transform={`translate(${dx} 0)`}>
          <rect x="-4.5" y="-86" width="9" height="86" />
          <rect x="-7" y="-60" width="14" height="3.4" />
          <rect x="-7" y="-76" width="14" height="3.4" />
          <path d="M-6.5 -86Q0 -102 6.5 -86Z" />
          <rect x="-0.7" y="-110" width="1.4" height="10" />
        </g>
      ))}
      {[-31, 31].map((dx) => (
        <g key={dx} transform={`translate(${dx} 0)`}>
          <rect x="-3.4" y="-78" width="6.8" height="26" />
          <path d="M-5 -78Q0 -92 5 -78Z" />
        </g>
      ))}
    </g>
  );
}

/**
 * One customer, front on, from the head down (head centre (x, hy)). `ring` = patience left 0..1, `kind` picks the detail,
 * `plate` = eating standing at the counter (a steel plate with a dosa), `note` = holds the money out.
 */
function Customer({ x, hy, kind, ring, scale = 1, note = false, plate = false, showRing = true }) {
  const col = ring > 0.6 ? '#2f9e5b' : ring > 0.3 ? TURMERIC : '#e0392b';
  const C = 2 * Math.PI * 9;
  const body = '#1c110c';
  return (
    <g transform={`translate(${f(x)} ${f(hy)}) scale(${scale})`}>
      {kind === 'student' && <rect x="-23" y="14" width="46" height="46" rx="10" fill="#34503f" />}
      {kind === 'student' && <rect x="-23" y="14" width="46" height="46" rx="10" fill="none" stroke="#6fb38a" strokeWidth="1.2" opacity=".5" />}
      <path d="M-26 70Q-26 14 0 13Q26 14 26 70V140H-26Z" fill={body} />
      <circle r="14" fill={body} />
      {kind === 'uncle' && <path d="M-14 -3Q-14 -17 0 -17Q14 -17 14 -3Q0 -7 -14 -3Z" fill={CREAM} />}
      {kind === 'office' && <path d="M-3 16 0 26 3 16Z" fill="#c7d0d8" />}
      {kind === 'office' && <rect x="-1.4" y="22" width="2.8" height="24" fill={TEAL} opacity=".9" />}
      <path d="M-14 2A14 14 0 0 1 -9 -11M-26 70Q-27 36 -19 22" fill="none" stroke="#ffb25a" strokeWidth="1.6" strokeLinecap="round" opacity=".75" />
      {plate && (
        <g>
          <path d="M20 44 12 36" stroke={body} strokeWidth="9" strokeLinecap="round" fill="none" />
          <ellipse cx="10" cy="33" rx="12" ry="4.4" fill="#cfd6da" />
          <ellipse cx="10" cy="31.6" rx="9" ry="3" fill="#e9a846" />
          <ellipse cx="7" cy="30.6" rx="3" ry="1.1" fill="#fff0b0" opacity=".8" />
        </g>
      )}
      {note && (
        <g>
          <path d="M24 38 40 20" stroke={body} strokeWidth="9" strokeLinecap="round" fill="none" />
          <circle cx="42" cy="16" r="20" fill="#ffe27a" opacity=".22" />
          <g transform="translate(43 15) rotate(-18)">
            <rect x="-13" y="-8" width="26" height="16" rx="2" fill="#d7efb4" stroke="#6faa4a" strokeWidth="1.2" />
            <path d={RUPEE} transform="scale(.8)" fill="none" stroke="#3f7a2a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      )}
      {showRing && (
        <g transform="translate(0 -30)">
          <circle r="11.5" fill={CHAR} opacity=".85" />
          <circle r="9" fill="none" stroke="#fff4dc" strokeOpacity=".16" strokeWidth="3.2" />
          <circle r="9" fill="none" stroke={col} strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${f(C * ring)} ${f(C)}`} transform="rotate(-90)" />
        </g>
      )}
    </g>
  );
}

/** Wavy steam wisps rising from (x, y). */
function Steam({ x, y, h = 38, n = 3, o = 0.55, w = 3 }) {
  return (
    <g fill="none" stroke={CREAM} strokeWidth={w} strokeLinecap="round" opacity={o}>
      {Array.from({ length: n }, (_, i) => {
        const dx = (i - (n - 1) / 2) * 11;
        const hh = h - (i % 2) * 8;
        return <path key={i} d={`M${f(x + dx)} ${y}q-6 ${f(-hh * 0.28)} 0 ${f(-hh * 0.5)}t0 ${f(-hh * 0.5)}`} />;
      })}
    </g>
  );
}

/** A plastic stool (seat centre x, seat y). */
function Stool({ x, y, c }) {
  return (
    <g>
      <path d={`M${x - 13} ${y + 4}l-3 ${28}M${x + 13} ${y + 4}l3 ${28}M${x} ${y + 6}v${26}`} stroke="#1b110c" strokeWidth="3" strokeLinecap="round" fill="none" />
      <ellipse cx={x} cy={y + 3} rx="19" ry="5.6" fill={c} />
      <ellipse cx={x} cy={y} rx="19" ry="5.6" fill={c} />
      <ellipse cx={x} cy={y} rx="19" ry="5.6" fill="#fff" opacity=".22" />
      <path d={`M${x - 15} ${y - 1}Q${x} ${y - 5} ${x + 15} ${y - 1}`} stroke="#fff" strokeWidth="1.4" fill="none" opacity=".45" />
    </g>
  );
}

/** A small auto-rickshaw seen side-on, facing left, ~64 wide, wheels on y = 0 (it is passing down the road). */
function MiniAuto() {
  return (
    <g>
      <ellipse cx="32" cy="1" rx="34" ry="2.6" fill="#05020a" opacity=".5" />
      <path d="M62 -26Q62 -36 50 -37H20Q14 -37 14 -30L12 -22H62Z" fill="#1f1a15" />
      <rect x="12" y="-22" width="50" height="16" fill="#ffc928" />
      <rect x="20" y="-20" width="28" height="11" rx="2" fill="#35211a" />
      <path d="M12 -22 2 -14Q-1 -11 -1 -6V-3Q-1 0 3 0H12Z" fill="#ffd54a" />
      <path d="M12 -34 3 -22H13Z" fill="#bfe9ff" opacity=".8" />
      <rect x="12" y="-8" width="50" height="3" fill="#1f1a15" />
      <circle cx="3" cy="-8" r="3.2" fill="#fff4c0" />
      {[[10, 0, 5.6], [54, 0, 6.2]].map(([cx, cy, r]) => (
        <g key={cx}>
          <circle cx={cx} cy={cy - r} r={r} fill="#15110e" />
          <circle cx={cx} cy={cy - r} r={r * 0.45} fill="#a29a90" />
        </g>
      ))}
    </g>
  );
}

/** A pani-puri cart: glass case of puris on a wheeled frame with a matka of pani, a bulb on top. ~64 wide, wheels on y = 0. */
function PaniCart({ uid }) {
  return (
    <g>
      <ellipse cx="32" cy="1" rx="36" ry="2.6" fill="#05020a" opacity=".5" />
      <rect x="6" y="-30" width="50" height="22" rx="2" fill="#2aa6a0" />
      <rect x="6" y="-30" width="50" height="4" fill="#fff" opacity=".25" />
      <rect x="10" y="-46" width="42" height="17" rx="2" fill="#cfeff0" opacity=".35" stroke="#e8f8f8" strokeWidth="1" />
      {[16, 24, 32, 40, 47].map((x, i) => (
        <circle key={x} cx={x} cy={i % 2 ? -34 : -37} r="4.6" fill="#e0a043" />
      ))}
      <path d="M58 -30Q58 -42 66 -42Q74 -42 74 -30Z" fill="#b6552a" />
      <rect x="62" y="-46" width="8" height="4" rx="1.5" fill="#8a3a1a" />
      <path d="M4 -8 0 -30M56 -8 60 -30" stroke="#1b110c" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="-52" r="3.6" fill="#fff1b8" />
      <circle cx="32" cy="-52" r="13" fill={`url(#${uid}glow)`} />
      <circle cx="14" cy="-5" r="5.4" fill="#15110e" />
      <circle cx="14" cy="-5" r="2.2" fill="#a29a90" />
      <circle cx="50" cy="-5" r="5.4" fill="#15110e" />
      <circle cx="50" cy="-5" r="2.2" fill="#a29a90" />
    </g>
  );
}

function CoverDefs({ uid }) {
  return (
    <defs>
      <linearGradient id={uid + 'sky'} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={HZ}>
        <stop offset="0" stopColor="#2a1630" />
        <stop offset=".3" stopColor="#7a2f3a" />
        <stop offset=".62" stopColor="#d9602a" />
        <stop offset=".86" stopColor="#ff9d3f" />
        <stop offset="1" stopColor="#ffd085" />
      </linearGradient>
      <radialGradient id={uid + 'sun'} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#fff0b8" stopOpacity=".95" />
        <stop offset=".25" stopColor="#ffc15a" stopOpacity=".7" />
        <stop offset="1" stopColor="#ff8a1f" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={uid + 'glow'} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#ffe9a0" stopOpacity=".85" />
        <stop offset=".4" stopColor="#ffc15a" stopOpacity=".28" />
        <stop offset="1" stopColor="#ff9d3f" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={uid + 'roof'} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity=".32" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={uid + 'wall'} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4a2a1b" />
        <stop offset="1" stopColor="#2a170e" />
      </linearGradient>
      <radialGradient id={uid + 'warm'} cx=".5" cy=".35" r=".7">
        <stop offset="0" stopColor="#ffc15a" stopOpacity=".42" />
        <stop offset="1" stopColor="#ffc15a" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={uid + 'steel'} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ead7b4" />
        <stop offset="1" stopColor="#7e6c5a" />
      </linearGradient>
      <linearGradient id={uid + 'pot'} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#f3e4c6" />
        <stop offset=".35" stopColor="#c9c0b1" />
        <stop offset="1" stopColor="#6d6559" />
      </linearGradient>
      <linearGradient id={uid + 'brass'} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffd77a" />
        <stop offset=".55" stopColor="#d8962b" />
        <stop offset="1" stopColor="#8a5410" />
      </linearGradient>
      <radialGradient id={uid + 'dosa'} cx=".42" cy=".4" r=".62">
        <stop offset="0" stopColor="#ffd98a" />
        <stop offset=".6" stopColor="#e9a846" />
        <stop offset="1" stopColor="#b8691b" />
      </radialGradient>
      <linearGradient id={uid + 'street'} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4a2816" />
        <stop offset="1" stopColor="#140a06" />
      </linearGradient>
    </defs>
  );
}

/** A brick row for a stove: (x, y) top-left, `n` bricks of width w, offset for running bond. */
function Bricks({ x, y, w = 24, h = 9, n = 4, off = 0 }) {
  return (
    <g>
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={f(x + off + i * w)} y={y} width={w - 1.4} height={h - 1.4} rx="1" fill={i % 2 ? '#a8472b' : '#b9542f'} />
      ))}
    </g>
  );
}

function TiffinCoverBase({ className, title, animated = true }) {
  const u = useUid();
  const far = skyline(rng(7), { x0: -10, x1: 820, base: HZ, hmin: 18, hmax: 74, wmin: 18, wmax: 40, lit: 0.04, spire: 0.12 });
  const near = skyline(rng(23), { x0: -10, x1: 820, base: HZ, hmin: 14, hmax: 50, wmin: 22, wmax: 46, lit: 0.2, gap: [2, 7] });
  const left = strand([0, 84], [120, 158], [256, 182], 5);
  const right = strand([744, 182], [776, 176], [800, 132], 2);
  const N = 10;
  const stripe = (i) => (i % 2 ? TEAL : SAFFRON);
  const ban = { x: 330, y: 122, w: 340, h: 56 };
  return (
    <CoverSvg className={className} title={title} css={animated ? COVER_CSS : COVER_CSS.replace(/animation:[^;}]+/g, 'animation:none')}>
      <CoverDefs uid={u} />
      {/* sky, the low sun behind the Charminar, hazy city */}
      <rect width="800" height="450" fill={`url(#${u}sky)`} />
      <circle cx="132" cy="318" r="250" fill={`url(#${u}sun)`} />
      <path d={far.body} fill="#8a3a32" opacity=".8" />
      <Charminar x={132} y={HZ} s={1.5} c="#4a1d1a" />
      <path d={near.body} fill="#3a1812" />
      <path d={near.w1} fill="#ffc15a" opacity=".85" />
      <path d={near.w2} fill="#ff9d4d" opacity=".55" />
      {/* electric pole and tangled wires */}
      <g stroke="#1b110c" fill="none" strokeLinecap="round">
        <path d="M782 30Q420 84 0 38" strokeWidth="1.3" />
        <path d="M782 40Q430 12 0 70" strokeWidth="1.2" />
        <path d="M782 50Q300 96 0 104" strokeWidth="1.2" />
        <path d="M782 60Q520 40 250 110" strokeWidth="1.1" />
        <path d="M782 36Q600 70 330 24" strokeWidth="1" />
        <path d="M782 46Q690 56 640 90" strokeWidth="1" />
      </g>
      <rect x="777" y="20" width="9" height={HZ - 16} fill="#2b1a12" />
      <rect x="760" y="28" width="44" height="4" fill="#2b1a12" />
      <rect x="764" y="52" width="36" height="3" fill="#2b1a12" />
      {[762, 773, 790, 802].map((x) => (
        <rect key={x} x={x - 1.4} y="22" width="2.8" height="6" rx="1" fill="#8a9aa0" />
      ))}
      <rect x="781" y="86" width="14" height="22" rx="2" fill="#3a2a22" />
      {/* the street: wet road with puddle reflections */}
      <rect y={HZ} width="800" height={450 - HZ} fill={`url(#${u}street)`} />
      <rect y={HZ} width="800" height="2.4" fill="#ffae4d" opacity=".4" />
      <ellipse cx="500" cy="414" rx="300" ry="26" fill={`url(#${u}warm)`} />
      <g fill="#ffb25a">
        <ellipse cx="150" cy="436" rx="56" ry="4.6" opacity=".2" />
        <ellipse cx="470" cy="440" rx="70" ry="4" opacity=".16" />
        <ellipse cx="690" cy="434" rx="44" ry="3.6" opacity=".18" />
        <path d="M300 424v24M308 428v20M644 424v22" stroke="#ffb25a" strokeWidth="2" opacity=".14" />
      </g>
      {/* down the road: a pani-puri cart and an auto passing, with a little motion trail */}
      <g transform="translate(14 410) scale(.9)">
        <PaniCart uid={u} />
      </g>
      <g transform="translate(106 408) scale(.95)">
        <path d="M70 -22H110M76 -14H120M72 -6H104" stroke="#ffd085" strokeWidth="1.6" strokeLinecap="round" opacity=".35" />
        <MiniAuto />
      </g>
      {/* LPG cylinder beside the stall */}
      <g>
        <rect x="205" y="350" width="28" height="48" rx="12" fill="#c8372d" />
        <rect x="205" y="350" width="9" height="48" rx="4" fill="#fff" opacity=".18" />
        <rect x="213" y="342" width="12" height="9" rx="2" fill="#8c1f19" />
        <rect x="211" y="338" width="16" height="5" rx="2" fill="#2a1a12" />
        <rect x="205" y="368" width="28" height="3" fill="#8c1f19" opacity=".6" />
      </g>
      {/* the stall: bamboo poles, back wall */}
      <rect x="264" y="150" width="472" height="190" fill={`url(#${u}wall)`} />
      <rect x="264" y="150" width="472" height="190" fill={`url(#${u}warm)`} />
      {/* hand-painted menu board with prices */}
      <g>
        <rect x="290" y="196" width="94" height="66" rx="3" fill="#6b4a2a" />
        <rect x="295" y="201" width="84" height="56" rx="2" fill="#1d2b27" />
        {[212, 226, 240].map((y, i) => (
          <g key={y}>
            <path d={`M302 ${y}h${[30, 24, 36][i]}`} stroke={CREAM} strokeWidth="2.4" strokeLinecap="round" opacity=".8" />
            <path d={`M343 ${y}h${[4, 4, 4][i]}`} stroke={CREAM} strokeWidth="1.6" strokeLinecap="round" opacity=".5" />
            <path d={RUPEE} transform={`translate(360 ${y}) scale(.7)`} fill="none" stroke={TURMERIC} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d={`M368 ${y}h${[8, 8, 8][i]}`} stroke={TURMERIC} strokeWidth="2.2" strokeLinecap="round" />
          </g>
        ))}
      </g>
      {/* kirana jars on a plank, hanging ladles */}
      <rect x="424" y="236" width="300" height="5" rx="1.5" fill="#6b4328" />
      {[['#c44a2b', 436], ['#e9b527', 462], ['#d88a2b', 488], ['#4f8a3a', 514], ['#c44a2b', 540], ['#f0e3c0', 566]].map(([c, x]) => (
        <g key={x}>
          <rect x={x} y="214" width="18" height="22" rx="3" fill={c} />
          <rect x={x + 2} y="210" width="14" height="5" rx="1.5" fill="#3a2216" />
          <rect x={x + 3} y="217" width="3" height="14" rx="1.5" fill="#fff" opacity=".28" />
        </g>
      ))}
      <path d="M612 204H724" stroke="#9a8a78" strokeWidth="2.4" strokeLinecap="round" />
      {[626, 652, 678, 704].map((x, i) => (
        <g key={x} stroke="#cfc7b8" strokeWidth="2" strokeLinecap="round" fill="none">
          <path d={`M${x} 204v${[20, 26, 18, 24][i]}`} />
          <circle cx={x} cy={204 + [24, 30, 22, 28][i]} r="4.6" fill="#b9b0a0" stroke="none" />
        </g>
      ))}
      {/* bamboo poles with nodes */}
      {[250, 738].map((x) => (
        <g key={x}>
          <rect x={x} y="104" width="11" height="294" fill="#b98a4a" />
          <rect x={x} y="104" width="4" height="294" fill="#e0b873" opacity=".7" />
          {[150, 205, 262, 330, 380].map((y) => (
            <rect key={y} x={x - 1} y={y} width="13" height="3.4" fill="#7c5624" />
          ))}
        </g>
      ))}
      {/* tarpaulin roof: striped, sagging front edge, stitched hem, rope ties */}
      <g>
        {Array.from({ length: N }, (_, i) => {
          const a = 232 + i * 54, b = a + 54;
          const ta = 286 + i * 42, tb = ta + 42;
          return <path key={i} d={`M${ta} 98H${tb}L${b} 152Q${f((a + b) / 2)} ${i % 3 === 1 ? 160 : 157} ${a} 152Z`} fill={stripe(i)} />;
        })}
        <path d="M286 98H706L768 152H232Z" fill={`url(#${u}roof)`} />
        <path d="M232 146Q500 154 768 146" fill="none" stroke="#fff4dc" strokeWidth="1.2" strokeDasharray="5 4" opacity=".55" />
        <path d="M286 98H706" stroke="#fff" strokeWidth="2" opacity=".25" />
        <path d="M232 152Q240 168 252 182M768 152Q760 168 744 182" fill="none" stroke="#d9c9a0" strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* flex banner, tied at the corners */}
      <path d={`M${ban.x} ${ban.y}H${ban.x + ban.w}V${ban.y + ban.h - 4}Q${ban.x + ban.w * 0.75} ${ban.y + ban.h + 4} ${ban.x + ban.w / 2} ${ban.y + ban.h - 2}T${ban.x} ${ban.y + ban.h - 4}Z`} fill="#0d6a69" />
      <rect x={ban.x + 5} y={ban.y + 5} width={ban.w - 10} height={ban.h - 14} rx="4" fill="none" stroke={CREAM} strokeWidth="2" opacity=".9" />
      <rect x={ban.x + 10} y={ban.y + 10} width={ban.w - 20} height={ban.h - 24} rx="3" fill="none" stroke={TURMERIC} strokeWidth="1.1" opacity=".65" />
      <text x="500" y="145" textAnchor="middle" fontFamily={SIGN_FONT} fontSize="14" fontWeight="700" fill={TURMERIC} textLength="124" lengthAdjust="spacingAndGlyphs">
        టిఫిన్ సెంటర్
      </text>
      <text x="500" y="168" textAnchor="middle" fontFamily={SIGN_FONT} fontSize="23" fontWeight="800" fill={CREAM} textLength="262" lengthAdjust="spacingAndGlyphs">
        TIFFIN CENTRE
      </text>
      {[[ban.x + 8, ban.y + 6], [ban.x + ban.w - 8, ban.y + 6], [ban.x + 8, ban.y + ban.h - 8], [ban.x + ban.w - 8, ban.y + ban.h - 8]].map(([x, y]) => (
        <circle key={x + '-' + y} cx={x} cy={y} r="2.2" fill="#c9d1d6" stroke="#5a4a3c" strokeWidth=".8" />
      ))}
      <path d={`M${ban.x + 8} ${ban.y + 6}L${ban.x - 6} 140M${ban.x + ban.w - 8} ${ban.y + 6}L${ban.x + ban.w + 6} 140`} stroke="#d9c9a0" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      {/* hanging tube-light, bare bulbs and the wire out to the pole */}
      <path d="M404 152V190M526 152V190" stroke="#1b110c" strokeWidth="1.2" />
      <ellipse cx="465" cy="194" rx="86" ry="14" fill={`url(#${u}glow)`} />
      <rect x="396" y="189" width="138" height="6" rx="3" fill="#f6fbff" />
      <rect x="396" y="189" width="138" height="2" rx="1" fill="#fff" />
      <path d="M0 84Q120 158 256 182M744 182Q776 176 800 132" fill="none" stroke="#1b110c" strokeWidth="1.4" />
      {left.slice(1, -1).map(([x, y]) => <Bulb key={x} x={x} y={f(y + 5)} uid={u} />)}
      {right.slice(0, -1).map(([x, y]) => <Bulb key={x} x={x} y={f(y + 5)} uid={u} />)}
      {[270, 298, 702, 726].map((x) => <Bulb key={x} x={x} y={188} uid={u} />)}
      {/* counter: steel top, wooden thela front */}
      <rect x="240" y="326" width="520" height="14" rx="3" fill="#f0dfbf" />
      <rect x="240" y="326" width="520" height="3" fill="#fff" opacity=".5" />
      <rect x="246" y="340" width="508" height="58" fill={`url(#${u}steel)`} />
      {[246, 376, 506, 636].map((x) => (
        <rect key={x} x={x + 8} y="348" width="114" height="42" rx="4" fill="none" stroke="#5a4a3c" strokeWidth="1.4" opacity=".55" />
      ))}
      <rect x="246" y="340" width="508" height="4" fill="#fff4dc" opacity=".4" />
      <rect x="246" y="396" width="508" height="3" fill="#2a1a10" opacity=".5" />

      {/* props, standing on the counter (surface y = 326) */}
      {/* brick stove, soot-dark tawa and the dosa */}
      <g>
        <Bricks x={294} y={306} w={27} h={10.5} n={3} off={0} />
        <Bricks x={281} y={316} w={27} h={10.5} n={4} off={0} />
        <g transform="translate(0 -9)">
        <path d="M284 315 262 308" stroke="#0e0a08" strokeWidth="6" strokeLinecap="round" />
        <ellipse cx="332" cy="313" rx="50" ry="11" fill="#0c0807" />
        <ellipse cx="332" cy="313" rx="50" ry="11" fill="none" stroke="#4a3b32" strokeWidth="2" />
        <ellipse cx="318" cy="310" rx="20" ry="3.4" fill="#fff" opacity=".07" />
        <ellipse cx="331" cy="311" rx="39" ry="8" fill={`url(#${u}dosa)`} />
        <ellipse cx="331" cy="311" rx="39" ry="8" fill="none" stroke="#8a4a12" strokeWidth="1.2" opacity=".55" />
        {[[316, 310, 3.4], [330, 313, 3], [346, 309, 3.6], [352, 313, 2.4], [322, 314, 2.2], [338, 308, 2.4]].map(([x, y, r]) => (
          <ellipse key={x} cx={x} cy={y} rx={r} ry={r * 0.4} fill="#a85a14" opacity=".6" />
        ))}
        <rect x="342" y="302" width="12" height="9" rx="2" fill="#fff2b0" />
        <rect x="342" y="302" width="12" height="3" rx="1.5" fill="#fffbe0" />
        <g className="hub-bob">
          <Steam x={332} y={294} h={40} n={3} />
        </g>
        </g>
      </g>
      {/* steel plates, stacked */}
      <g>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <ellipse cx="398" cy={f(324 - i * 3.4)} rx="17" ry="4.2" fill={i % 2 ? '#aab3b8' : '#cfd6da'} />
          </g>
        ))}
        <ellipse cx="398" cy="307" rx="17" ry="4.2" fill="#eef2f4" />
        <ellipse cx="393" cy="306.4" rx="6" ry="1.4" fill="#fff" opacity=".7" />
      </g>
      {/* steel idly cooker */}
      <g>
        <path d="M424 326V292Q424 288 428 288H472Q476 288 476 292V326Z" fill={`url(#${u}pot)`} />
        <rect x="424" y="300" width="52" height="3" fill="#4d463c" opacity=".55" />
        <rect x="424" y="311" width="52" height="3" fill="#4d463c" opacity=".55" />
        <path d="M420 288Q420 268 450 266Q480 268 480 288Z" fill={`url(#${u}pot)`} />
        <circle cx="450" cy="263" r="4.4" fill="#4d463c" />
        <rect x="414" y="296" width="10" height="5" rx="2.5" fill="#4d463c" />
        <rect x="476" y="296" width="10" height="5" rx="2.5" fill="#4d463c" />
        <path d="M432 292V324" stroke="#fff" strokeWidth="2" opacity=".35" strokeLinecap="round" />
        <g className="hub-bob2">
          <Steam x={450} y={258} h={44} n={3} o={0.62} />
        </g>
      </g>
      {/* brass kadai on a brick stove, flames licking */}
      <g>
        <Bricks x={536} y={316} w={25} h={10.5} n={3} />
        <rect x="534" y="312" width="72" height="4" fill="#d9a15c" opacity=".5" />
        <path d="M528 296Q528 322 570 322Q612 322 612 296Z" fill={`url(#${u}brass)`} />
        <ellipse cx="570" cy="296" rx="42" ry="6.4" fill="#d8962b" />
        <ellipse cx="570" cy="297" rx="38" ry="4.6" fill="#4b2c10" />
        <ellipse cx="570" cy="297" rx="34" ry="3.4" fill="#e9a530" opacity=".55" />
        {[[556, 295, 7], [572, 293, 7.6], [588, 296, 6.6]].map(([x, y, r]) => (
          <g key={x}>
            <circle cx={x} cy={y} r={r} fill="#d9892b" />
            <circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.4} fill="#ffd27a" opacity=".85" />
          </g>
        ))}
        <circle cx="524" cy="297" r="4.2" fill="none" stroke="#b9791d" strokeWidth="2.4" />
        <circle cx="616" cy="297" r="4.2" fill="none" stroke="#b9791d" strokeWidth="2.4" />
        <path d="M538 304Q546 316 560 318" fill="none" stroke="#fff3c4" strokeWidth="2" strokeLinecap="round" opacity=".6" />
        <g className="hub-bob">
          <Steam x={570} y={284} h={30} n={2} o={0.4} />
        </g>
      </g>
      {/* irani chai glasses on a steel tray */}
      <g>
        <ellipse cx="690" cy="325" rx="34" ry="4.6" fill="#b9b0a0" />
        {[672, 690, 708].map((x, i) => (
          <g key={x}>
            <path d={`M${x - 7.5} ${302 - (i === 1 ? 2 : 0)}H${x + 7.5}L${x + 6} 324H${x - 6}Z`} fill={CREAM} opacity=".28" />
            <path d={`M${x - 7} ${309 - (i === 1 ? 2 : 0)}H${x + 7}L${x + 6} 324H${x - 6}Z`} fill="#c8651b" />
            <path d={`M${x - 7} ${309 - (i === 1 ? 2 : 0)}H${x + 7}`} stroke="#ffd0a0" strokeWidth="1.6" opacity=".7" />
            <path d={`M${x - 5} ${305 - (i === 1 ? 2 : 0)}v15`} stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".5" />
          </g>
        ))}
        <g className="hub-bob2">
          <Steam x={690} y={298} h={26} n={2} o={0.5} w={2.4} />
        </g>
      </g>

      {/* big steel drums beside the thela, plastic stools in front */}
      <g>
        <rect x="762" y="352" width="30" height="46" rx="3" fill={`url(#${u}pot)`} />
        <rect x="762" y="364" width="30" height="3" fill="#4d463c" opacity=".5" />
        <rect x="762" y="380" width="30" height="3" fill="#4d463c" opacity=".5" />
        <rect x="760" y="349" width="34" height="6" rx="3" fill="#a9a194" />
        <rect x="768" y="356" width="4" height="40" fill="#fff" opacity=".3" />
      </g>
      <Stool x={318} y={416} c="#d63a2e" />
      <Stool x={566} y={420} c="#2f6fd0" />

      {/* customers eating standing at the counter, patience rings (the last one holds the money out) */}
      <Customer x={398} hy={370} kind="student" ring={0.82} plate />
      <Customer x={507} hy={356} kind="uncle" ring={0.46} plate />
      <Customer x={635} hy={364} kind="office" ring={0.26} note />
      <Sparkle x={332} y={280} s={5} c="#fff1b8" />
      <Sparkle x={570} y={274} s={4} c="#fff1b8" />
      <Sparkle x={706} y={120} s={5} c="#fff6d0" />
    </CoverSvg>
  );
}
export const TiffinCover = memo(TiffinCoverBase);

function TiffinIconBase({ size = 64, title, className, rounded }) {
  const u = useUid();
  const stripes = Array.from({ length: 8 }, (_, i) => i);
  return (
    <IconSvg size={size} title={title} className={className} rounded={rounded} uid={u}>
      <defs>
        <linearGradient id={u + 'bg'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb04a" />
          <stop offset=".55" stopColor="#ff8a1f" />
          <stop offset="1" stopColor="#d9480f" />
        </linearGradient>
        <radialGradient id={u + 'dosa'} cx=".42" cy=".38" r=".66">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset=".6" stopColor="#f0b24c" />
          <stop offset="1" stopColor="#bf7220" />
        </radialGradient>
        <radialGradient id={u + 'fire'} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff0a0" stopOpacity=".95" />
          <stop offset="1" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="128" height="128" fill={`url(#${u}bg)`} />
      {/* striped tarpaulin with a sagging, stitched hem */}
      {stripes.map((i) => (
        <path key={i} d={`M${i * 16} 0H${i * 16 + 16}V24Q${i * 16 + 8} ${i % 3 === 1 ? 31 : 28} ${i * 16} 24Z`} fill={i % 2 ? TEAL : CREAM} />
      ))}
      <rect y="0" width="128" height="4" fill="#fff" opacity=".22" />
      <path d="M0 18Q64 24 128 18" fill="none" stroke="#fff" strokeWidth="1.4" strokeDasharray="4 3" opacity=".5" />
      <path d="M0 30Q64 40 128 30V40Q64 50 0 40Z" fill="#8a2a08" opacity=".2" />
      {/* brick stove */}
      <g>
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={i * 34 - 4} y="106" width="32" height="10" rx="1.6" fill={i % 2 ? '#a8472b' : '#b9542f'} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={i * 34 - 21} y="117" width="32" height="11" rx="1.6" fill={i % 2 ? '#b9542f' : '#a8472b'} />
        ))}
        <ellipse cx="62" cy="106" rx="46" ry="7" fill={`url(#${u}fire)`} />
      </g>
      {/* soot-dark tawa + dosa */}
      <path d="M104 90 124 82" stroke="#1a110d" strokeWidth="8" strokeLinecap="round" />
      <ellipse cx="62" cy="92" rx="52" ry="21" fill="#3a2d26" />
      <ellipse cx="62" cy="89" rx="52" ry="21" fill="#17100d" />
      <ellipse cx="62" cy="89" rx="52" ry="21" fill="none" stroke="#5d4a3e" strokeWidth="2.6" />
      <ellipse cx="61" cy="86" rx="41" ry="15.5" fill={`url(#${u}dosa)`} />
      <ellipse cx="61" cy="86" rx="41" ry="15.5" fill="none" stroke="#9a5412" strokeWidth="1.6" opacity=".6" />
      {[[38, 86, 4.4], [50, 92, 3.6], [66, 94, 4], [82, 88, 4.6], [90, 82, 3], [46, 78, 3], [74, 78, 3.4]].map(([x, y, r]) => (
        <ellipse key={x} cx={x} cy={y} rx={r} ry={r * 0.45} fill="#a85a14" opacity=".55" />
      ))}
      <ellipse cx="61" cy="84" rx="14" ry="5.2" fill="#ffd23f" opacity=".9" />
      <rect x="55" y="74" width="17" height="11" rx="2.6" fill="#fff3b8" />
      <rect x="55" y="74" width="17" height="4" rx="2" fill="#fffde8" />
      {/* steam */}
      <g fill="none" stroke={CREAM} strokeWidth="5" strokeLinecap="round" opacity=".92">
        <path d="M40 68q-7 -7 0 -13t0 -11" />
        <path d="M62 64q-7 -7 0 -13t0 -11" />
        <path d="M84 68q-7 -7 0 -13t0 -11" />
      </g>
    </IconSvg>
  );
}
export const TiffinIcon = memo(TiffinIconBase);
