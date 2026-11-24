// Tiffin Centre cover (16:9) + app icon, drawn for the hub. The cover is FIRST PERSON: you are the cook, standing behind the
// steel counter of a Hyderabad roadside tiffin stall at golden hour. In the foreground, slightly soft, the counter edge, the
// soot-black tawa with a golden dosa and your two forearms working a steel ladle (a red gamchha over the shoulder); on the
// counter an idly cooker, a brass kadai and irani chai glasses; across the counter four regulars with real faces (a hurried
// office-goer checking his watch, a grinning student, an uncle in a topi, a child on tiptoe); behind them the street, an auto,
// bulbs on a wire, the tin roof edge, a flex banner and the Charminar in the haze. Depth of field: the street is blurred, the
// customers and the dosa are sharp, the counter lip and the forearms are a touch soft. The left third is kept calm for card text.
// Pure inline SVG, no assets; the only text is the banner (system fonts, pinned width). Motion is the shared hub-bob steam.
import { memo } from 'react';
import { CoverSvg, IconSvg, Sparkle, COVER_CSS, f, rng, skyline, useUid } from './kit.jsx';

const TEAL = '#12908e';
const CREAM = '#fff4dc';
const TURMERIC = '#ffc83d';
const HZ = 214; // horizon = the cook's eye line (adult customers' eyes sit on it, the child's below it)
const EDGE = 322; // far edge of the counter, where the customers' bodies are cut off
const LIP = 436; // the cook's own edge of the counter
const SIGN_FONT = "'Bricolage Grotesque','Noto Sans Telugu','Nirmala UI','Segoe UI',system-ui,sans-serif";
const SUN = [572, 216];

/** Points along a quadratic curve, for the string of bulbs. */
function strand([x0, y0], [x1, y1], [x2, y2], n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    out.push([f(a * x0 + b * x1 + c * x2), f(a * y0 + b * y1 + c * y2)]);
  }
  return out;
}

/** A tapered limb (forearm, sleeve) as a polygon path from (x0, y0) of width w0 to (x1, y1) of width w1. */
function limb(x0, y0, x1, y1, w0, w1) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const p = (x, y, w, s) => `${f(x + (nx * w * s) / 2)} ${f(y + (ny * w * s) / 2)}`;
  return `M${p(x0, y0, w0, 1)}L${p(x1, y1, w1, 1)}L${p(x1, y1, w1, -1)}L${p(x0, y0, w0, -1)}Z`;
}

/** A glowing bare bulb hanging from the wire at (x, y). Needs the `glow` gradient of <CoverDefs>. */
function Bulb({ x, y, uid, r = 5.4 }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r * 3.6} fill={`url(#${uid}glow)`} />
      <path d={`M${x} ${f(y - r - 12)}V${f(y - r - 2)}`} stroke="#120a07" strokeWidth="1.2" />
      <rect x={f(x - 1.8)} y={f(y - r - 3.4)} width="3.6" height="4" rx="1" fill="#1b110c" />
      <circle cx={x} cy={y} r={r} fill="#fff1b8" />
      <circle cx={f(x - r * 0.3)} cy={f(y - r * 0.3)} r={f(r * 0.4)} fill="#fff" opacity=".92" />
    </g>
  );
}

/** The Charminar, front on: four minarets, the arched base, the parapet with its small domes. Base on y = 0, ~100 wide, ~92 tall. */
function Charminar({ x, y, s = 1, c }) {
  return (
    <g transform={`translate(${f(x)} ${f(y)}) scale(${s})`} fill={c}>
      <rect x="-38" y="-52" width="76" height="52" />
      <path d="M-11 0V-24Q0 -38 11 -24V0Z" fill="#1b0d08" opacity=".5" />
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

/** A small auto-rickshaw seen side-on, facing left, ~64 wide, wheels on y = 0 (it is passing down the road behind the stall). */
function MiniAuto() {
  return (
    <g>
      <ellipse cx="32" cy="1" rx="36" ry="2.8" fill="#05020a" opacity=".5" />
      <path d="M62 -26Q62 -36 50 -37H20Q14 -37 14 -30L12 -22H62Z" fill="#1f1a15" />
      <rect x="12" y="-22" width="50" height="16" fill="#ffc928" />
      <rect x="20" y="-20" width="28" height="11" rx="2" fill="#35211a" />
      <path d="M12 -22 2 -14Q-1 -11 -1 -6V-3Q-1 0 3 0H12Z" fill="#ffd54a" />
      <path d="M12 -34 3 -22H13Z" fill="#bfe9ff" opacity=".8" />
      <rect x="12" y="-8" width="50" height="3" fill="#1f1a15" />
      <circle cx="3" cy="-8" r="3.2" fill="#fff4c0" />
      <circle cx="3" cy="-8" r="11" fill="#ffe9a0" opacity=".25" />
      {[[10, 0, 5.6], [54, 0, 6.2]].map(([cx, cy, r]) => (
        <g key={cx}>
          <circle cx={cx} cy={cy - r} r={r} fill="#15110e" />
          <circle cx={cx} cy={cy - r} r={r * 0.45} fill="#a29a90" />
        </g>
      ))}
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

/* ---------- faces ---------- */

/** One eye: white, iris, pupil, catch-light, upper lid. `look` = [-1..1, -1..1]; `happy` = a smiling closed arc. */
function Eye({ x, y, w = 5.2, h = 3.4, look = [0, 0], iris = '#2b170d', happy = false, lid = '#1a0e08' }) {
  if (happy) {
    return (
      <g fill="none" stroke={lid} strokeLinecap="round">
        <path d={`M${f(x - w)} ${f(y + 1.2)}Q${x} ${f(y - h * 1.9)} ${f(x + w)} ${f(y + 1.2)}`} strokeWidth="2" />
        <path d={`M${f(x + w + 1.6)} ${f(y + 3)}l2.2 1.2M${f(x + w + 1)} ${f(y + 5)}l2.4 1.6`} strokeWidth=".9" opacity=".5" />
      </g>
    );
  }
  const ir = h * 0.84;
  const ix = x + look[0] * (w - ir) * 0.9, iy = y + look[1] * h * 0.16;
  return (
    <g>
      <ellipse cx={x} cy={y} rx={w} ry={h} fill="#fbf3e6" />
      <circle cx={f(ix)} cy={f(iy)} r={f(ir)} fill={iris} />
      <circle cx={f(ix)} cy={f(iy)} r={f(ir * 0.5)} fill="#07040a" />
      <circle cx={f(ix - ir * 0.32)} cy={f(iy - ir * 0.36)} r={f(ir * 0.28)} fill="#fff" />
      <path d={`M${f(x - w - 0.6)} ${f(y + 0.4)}Q${x} ${f(y - h * 1.7)} ${f(x + w + 0.6)} ${f(y + 0.4)}`} fill="none" stroke={lid} strokeWidth="1.5" strokeLinecap="round" />
      <path d={`M${f(x - w + 1)} ${f(y + h * 0.8)}Q${x} ${f(y + h * 1.25)} ${f(x + w - 1)} ${f(y + h * 0.8)}`} fill="none" stroke="#5a2e1a" strokeWidth=".7" opacity=".4" />
    </g>
  );
}

/** One brow centred at cx; ang > 0 slants the inner end down (cross), ang < 0 raises it (pleading, surprised). */
function Brow({ cx, y, w = 6.4, ang = 0, c = '#1a110c', th = 2.2 }) {
  const inner = cx < 0 ? 1 : -1;
  const ox = cx - inner * w, ix = cx + inner * w;
  return <path d={`M${f(ox)} ${f(y - ang)}Q${cx} ${f(y - 2.4 - Math.abs(ang) * 0.2)} ${f(ix)} ${f(y + ang)}`} fill="none" stroke={c} strokeWidth={th} strokeLinecap="round" />;
}

function Nose({ c = '#7a4226' }) {
  return (
    <g>
      <path d="M-1 -3Q-1.8 5.6 -3.8 8Q0 10.4 3.8 8" fill="none" stroke={c} strokeWidth="1.3" strokeLinecap="round" opacity=".72" />
      <ellipse cx="-2.6" cy="8.6" rx="1.2" ry=".8" fill="#3a1c0c" opacity=".6" />
      <ellipse cx="2.6" cy="8.6" rx="1.2" ry=".8" fill="#3a1c0c" opacity=".6" />
      <path d="M1.6 -4Q2.8 2 2.2 6" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity=".2" />
    </g>
  );
}

/** Ears, head and cheeks of one customer, local origin = head centre. sk = skin tone index of <CoverDefs>. */
function Head({ u, sk, rx = 22, ry = 26, cheeks = 0.3 }) {
  const fill = `url(#${u}sk${sk})`;
  return (
    <g>
      <ellipse cx={-rx + 0.6} cy="3" rx="3.8" ry="5.6" fill={fill} />
      <ellipse cx={rx - 0.6} cy="3" rx="3.8" ry="5.6" fill={fill} />
      <path d={`M${f(-rx + 1)} 1q-2.4 3 0 6M${f(rx - 1)} 1q2.4 3 0 6`} fill="none" stroke="#6e3a20" strokeWidth="1" opacity=".5" />
      <ellipse rx={rx} ry={ry} fill={fill} />
      <ellipse cx={f(-rx * 0.5)} cy={f(ry * 0.34)} rx={f(rx * 0.26)} ry={f(ry * 0.16)} fill="#e0593f" opacity={cheeks} />
      <ellipse cx={f(rx * 0.5)} cy={f(ry * 0.34)} rx={f(rx * 0.26)} ry={f(ry * 0.16)} fill="#e0593f" opacity={cheeks} />
    </g>
  );
}

/** Neck and the shadow the chin throws on it. */
function Neck({ u, sk, w = 10 }) {
  return (
    <g>
      <path d={`M${-w} 14H${w}V38Q0 44 ${-w} 38Z`} fill={`url(#${u}sk${sk})`} />
      <path d={`M${-w} 14H${w}V28Q0 34 ${-w} 28Z`} fill="#2a1208" opacity=".38" />
    </g>
  );
}

/** A hurried office-goer (head centre at the origin; the counter edge is at local y = 126): shirt, tie, glasses, watch up. */
function OfficeGoer({ u }) {
  return (
    <g>
      <Neck u={u} sk={1} />
      <path d="M-52 150L-49 54Q-46 36 -26 31L-11 27L0 42L11 27L26 31Q46 36 49 54L52 150Z" fill={`url(#${u}shirt)`} />
      <path d="M-11 27L-16 40L-1 43ZM11 27L16 40L1 43Z" fill="#f6f8fa" stroke="#bfc9d1" strokeWidth=".8" />
      <path d="M-3.4 42H3.4L5 54L0 58L-5 54ZM-4.6 54H4.6L7.4 104L0 110L-7.4 104Z" fill={TEAL} />
      <path d="M-1 56L0.6 106" stroke="#fff" strokeWidth="1.4" opacity=".25" />
      <rect x="-37" y="66" width="17" height="19" rx="2" fill="none" stroke="#9fb0bd" strokeWidth="1" />
      <path d="M-31 66V60M-27 66V62" stroke="#2a4a8a" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M49 54Q47 36 30 31" fill="none" stroke="#ffc15a" strokeWidth="2" opacity=".5" strokeLinecap="round" />
      {/* the raised arm: sleeve, cuff, wrist, watch, fist */}
      <g>
      <path d={limb(46, 140, 25, 76, 22, 16)} fill="#c9d6e1" stroke="#9fb0bd" strokeWidth=".8" />
      <path d={limb(25, 76, 21, 64, 16, 13)} fill="#eef3f6" />
      <path d={limb(21, 64, 17, 52, 11, 10)} fill={`url(#${u}sk1)`} />
      <rect x="12.4" y="55" width="14" height="9" rx="3.5" fill="#171310" />
      <circle cx="19.4" cy="59.6" r="7.4" fill="#c9d1d6" />
      <circle cx="19.4" cy="59.6" r="5.8" fill="#fbfbf6" />
      <path d="M19.4 59.6V55.4M19.4 59.6L22.6 60.6" stroke="#15110e" strokeWidth="1" strokeLinecap="round" />
      <path d="M19.4 54.4v.8M19.4 64v.8M14.2 59.6h.8M23.8 59.6h.8" stroke="#15110e" strokeWidth=".6" />
      <ellipse cx="16.6" cy="47.6" rx="8.6" ry="6.4" fill={`url(#${u}sk1)`} />
      <path d="M10 46q1.6 3 3.4 0M14 44.4q1.8 3 3.6 0M18.2 44q1.8 3 3.6 0" fill="none" stroke="#6e3a20" strokeWidth=".8" opacity=".6" />
      <ellipse cx="9.4" cy="49" rx="3.4" ry="2" transform="rotate(-30 9.4 49)" fill={`url(#${u}sk1)`} />
      </g>
      {/* head */}
      <Head u={u} sk={1} cheeks={0.2} />
      <path d="M-23 -4Q-27 -33 0 -32Q27 -33 23 -4Q22 -18 7 -21Q-10 -14 -23 -4Z" fill="#14100e" />
      <path d="M-14 -25Q-2 -30 10 -26" fill="none" stroke="#6b5a50" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
      <Brow cx={-9.6} y={-11.6} ang={2.2} />
      <Brow cx={9.6} y={-11.6} ang={2.2} />
      <Eye x={-9.6} y={-3.4} look={[0.7, 1]} />
      <Eye x={9.6} y={-3.4} look={[0.7, 1]} />
      <g fill="#cfe6f2" fillOpacity=".16" stroke="#1d1a1a" strokeWidth="1.5">
        <rect x="-17.6" y="-9.4" width="16" height="11.4" rx="4.4" />
        <rect x="1.6" y="-9.4" width="16" height="11.4" rx="4.4" />
      </g>
      <path d="M-1.6 -5.4Q0 -6.6 1.6 -5.4M-17.6 -5L-23 -6M17.6 -5L23 -6" fill="none" stroke="#1d1a1a" strokeWidth="1.3" />
      <path d="M-14 -8Q-11 -9 -8 -8.4" fill="none" stroke="#fff" strokeWidth="1" opacity=".5" />
      <Nose />
      <path d="M-6.4 12Q0 9.4 6.4 12Q0 13.8 -6.4 12Z" fill="#17100c" />
      <path d="M-6 16.4Q0 15 6 16.4" fill="none" stroke="#6a2f22" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M-8 15q-1.2 1.2 -.4 2.6M8 15q1.2 1.2 .4 2.6" fill="none" stroke="#7a4226" strokeWidth=".9" opacity=".6" />
      <path d="M22 -12Q24 -9 22.6 -6.4Q20.8 -9 22 -12Z" fill="#bfe3f4" opacity=".85" />
    </g>
  );
}

/** A grinning student: spiky hair, hoodie, backpack straps, one earbud. */
function Student({ u }) {
  return (
    <g>
      <Neck u={u} sk={2} />
      <path d="M-54 150L-51 58Q-48 38 -27 31L-12 27Q0 36 12 27L27 31Q48 38 51 58L54 150Z" fill={`url(#${u}hood)`} />
      <path d="M-22 28Q0 50 22 28Q20 42 0 48Q-20 42 -22 28Z" fill="#1c4a47" />
      <path d="M-7 44L-8 78M7 44L8 72" stroke="#e8f4ef" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="-8" cy="79" r="2" fill="#e8f4ef" />
      <circle cx="8" cy="73" r="2" fill="#e8f4ef" />
      <path d="M-33 36L-38 150M33 36L38 150" stroke="#161a24" strokeWidth="10" strokeLinecap="round" />
      <path d="M-35 36L-40 150M35 36L40 150" stroke="#3a4256" strokeWidth="1.2" opacity=".6" />
      <rect x="-42" y="92" width="9" height="7" rx="1.5" fill="#c9a24a" />
      <rect x="33" y="92" width="9" height="7" rx="1.5" fill="#c9a24a" />
      <path d="M-51 58Q-48 38 -27 31" fill="none" stroke="#ffc15a" strokeWidth="2" opacity=".4" strokeLinecap="round" />
      <path d="M22 2Q31 30 14 52" fill="none" stroke="#f1f1ec" strokeWidth="1.2" />
      <Head u={u} sk={2} rx={22} ry={25} cheeks={0.34} />
      <circle cx="23" cy="2.4" r="2.2" fill="#f4f4ef" />
      <path d="M-23 -3Q-28 -29 -6 -32Q0 -40 8 -33Q28 -32 23 -3Q21 -14 13 -16L9 -23L3 -15L-5 -24L-9 -14L-17 -18Z" fill="#17110e" />
      <path d="M-12 -27Q0 -32 12 -26" fill="none" stroke="#6b5a50" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
      <Brow cx={-9.8} y={-12.4} ang={-1.4} th={2.4} />
      <Brow cx={9.8} y={-12.4} ang={-1.4} th={2.4} />
      <Eye x={-9.8} y={-4} w={5.6} h={3.9} look={[0.1, 0.9]} />
      <Eye x={9.8} y={-4} w={5.6} h={3.9} look={[0.1, 0.9]} />
      <Nose />
      <path d="M-9 11Q0 25 9 11Z" fill="#4e1511" />
      <path d="M-7.6 11.6Q0 15.4 7.6 11.6L6.8 14Q0 17.4 -6.8 14Z" fill="#fff" />
      <ellipse cx="0" cy="19.4" rx="3.6" ry="1.7" fill="#d9576b" />
      <path d="M-10 10.4q-1.2 1.6 0 3.4M10 10.4q1.2 1.6 0 3.4" fill="none" stroke="#7a4226" strokeWidth="1" opacity=".55" />
    </g>
  );
}

/** An uncle in a white topi, grey moustache and beard, smiling with his eyes. */
function Uncle({ u }) {
  return (
    <g>
      <Neck u={u} sk={0} w={11} />
      <path d="M-58 150L-54 58Q-50 38 -29 32L-13 28Q0 36 13 28L29 32Q50 38 54 58L58 150Z" fill={`url(#${u}kurta)`} />
      <path d="M-13 28V44Q0 50 13 44V28" fill="none" stroke="#c7b690" strokeWidth="1.4" />
      {[50, 62, 74].map((y) => (
        <circle key={y} cx="0" cy={y} r="1.7" fill="#b5a47c" />
      ))}
      <path d="M0 44V100" stroke="#c7b690" strokeWidth="1" opacity=".6" />
      <rect x="20" y="70" width="22" height="24" rx="2" fill="none" stroke="#c7b690" strokeWidth="1.2" />
      <path d="M26 66V78M31 66V77" stroke="#2f5db5" strokeWidth="2" strokeLinecap="round" />
      <path d="M-54 58Q-50 38 -29 32" fill="none" stroke="#ffc15a" strokeWidth="2.2" opacity=".55" strokeLinecap="round" />
      <Head u={u} sk={0} rx={25} ry={27} cheeks={0.28} />
      {/* topi: a white knitted skull cap */}
      <path d="M-25 -7Q-26 -33 0 -36Q26 -33 25 -7Q0 -14 -25 -7Z" fill={`url(#${u}topi)`} />
      <path d="M-25 -7Q0 -14 25 -7" fill="none" stroke="#bfb6a2" strokeWidth="1.6" />
      <path d="M-17 -15Q0 -21 17 -15M-10 -21Q0 -26 10 -21M-8 -30V-10M0 -34V-12M8 -30V-10M-17 -26L-14 -12M17 -26L14 -12" fill="none" stroke="#cfc6b2" strokeWidth=".9" opacity=".8" />
      <path d="M-25 -4Q-27 4 -26 8M25 -4Q27 4 26 8" fill="none" stroke="#d8d2c6" strokeWidth="3" strokeLinecap="round" />
      <Brow cx={-10.4} y={-12} ang={-0.8} c="#e2ddd2" th={3.2} />
      <Brow cx={10.4} y={-12} ang={-0.8} c="#e2ddd2" th={3.2} />
      <Eye x={-10.4} y={-3.6} w={5.4} happy />
      <Eye x={10.4} y={-3.6} w={5.4} happy />
      <Nose />
      {/* white beard, moustache and a big warm smile */}
      <path d="M-24 6Q-27 30 0 36Q27 30 24 6Q20 22 0 24Q-20 22 -24 6Z" fill="#e8e3d8" />
      <path d="M-24 6Q-25 12 -22 18M24 6Q25 12 22 18" fill="none" stroke="#c9c2b4" strokeWidth="1" opacity=".7" />
      <path d="M-9.4 17.6Q0 28 9.4 17.6Q0 20.6 -9.4 17.6Z" fill="#4e1511" />
      <path d="M-7.6 18.2Q0 22 7.6 18.2Q0 20.4 -7.6 18.2Z" fill="#fff" />
      <path d="M-13 11.4Q-7 6.4 0 10.2Q7 6.4 13 11.4Q7 15.6 0 13.4Q-7 15.6 -13 11.4Z" fill="#dcd6ca" stroke="#b9b1a2" strokeWidth=".7" />
    </g>
  );
}

/** A small girl on tiptoe: only her head and shoulders clear the counter. Two plaits with red ribbons, a bindi, wide eyes, an "ooh". */
function Child({ u }) {
  return (
    <g>
      <Neck u={u} sk={3} w={7} />
      <path d="M-30 80L-28 36Q-25 24 -12 20L0 27L12 20Q25 24 28 36L30 80Z" fill={`url(#${u}frock)`} />
      <path d="M-12 20Q0 36 12 20Q0 25 -12 20Z" fill="#fff" />
      <path d="M-28 36Q-25 24 -12 20" fill="none" stroke="#ffc15a" strokeWidth="1.8" opacity=".45" strokeLinecap="round" />
      <path d="M-17 -5Q-34 -4 -32 12Q-31 22 -26 30M17 -5Q34 -4 32 12Q31 22 26 30" fill="none" stroke="#14100d" strokeWidth="7" strokeLinecap="round" />
      <path d="M-20 -3Q-31 -2 -30 10M20 -3Q31 -2 30 10" fill="none" stroke="#3a2e28" strokeWidth="1.2" opacity=".6" strokeLinecap="round" />
      {[[-26, 31], [26, 31]].map(([x, y]) => (
        <g key={x}>
          <path d={`M${x} ${y}l${x < 0 ? -5 : 5} -4v8ZM${x} ${y}l${x < 0 ? 5 : -5} -4v8Z`} fill="#e0392b" />
          <circle cx={x} cy={y} r="2" fill="#a8261c" />
        </g>
      ))}
      <Head u={u} sk={3} rx={17.5} ry={19.5} cheeks={0.5} />
      <path d="M-18 -3Q-20 -24 0 -23Q20 -24 18 -3Q9 -13 0 -13Q-9 -13 -18 -3Z" fill="#14100d" />
      <path d="M0 -23V-13" stroke="#6b5a50" strokeWidth="1" opacity=".6" />
      <circle cx="0" cy="-9" r="1.7" fill="#d62828" />
      <Brow cx={-7.4} y={-10.6} w={4.6} ang={-1.8} th={1.8} />
      <Brow cx={7.4} y={-10.6} w={4.6} ang={-1.8} th={1.8} />
      <Eye x={-7.4} y={-3} w={5} h={4.6} look={[-0.6, 0.9]} iris="#1f120b" />
      <Eye x={7.4} y={-3} w={5} h={4.6} look={[-0.6, 0.9]} iris="#1f120b" />
      <path d="M-.8 3.6Q-1.4 7 -2.6 8.2Q0 9.6 2.6 8.2" fill="none" stroke="#7a4226" strokeWidth="1" strokeLinecap="round" opacity=".7" />
      <ellipse cx="0" cy="13" rx="3.4" ry="4.2" fill="#4e1511" />
      <ellipse cx="0" cy="14.6" rx="2" ry="1.6" fill="#d9576b" />
    </g>
  );
}

/** Two small hands gripping the counter edge: drawn after the counter so she reads as standing on tiptoe, chin just over it. */
function ChildHands({ x, y }) {
  return (
    <g>
      {[-24, 24].map((dx) => (
        <g key={dx} transform={`translate(${x + dx} ${y})`}>
          <ellipse rx="6.6" ry="4.6" fill="#e0a97b" />
          <path d="M-5.4 1.6q1.2 4.6 2.6 0M-1.4 2.2q1.2 4.8 2.8 0M2.6 1.6q1.2 4.6 2.8 0" fill="none" stroke="#a8683f" strokeWidth=".9" />
          <ellipse cx="-1" cy="-1.6" rx="3" ry="1" fill="#fff" opacity=".35" />
        </g>
      ))}
    </g>
  );
}

/** A forearm and its hand wrapped on the ladle handle (+x of the hand is along the handle). */
function GripHand({ x, y, rot, u }) {
  return (
    <g transform={`translate(${f(x)} ${f(y)}) rotate(${rot}) scale(1.32)`}>
      <ellipse cx="2" cy="1" rx="17" ry="12" fill={`url(#${u}arm)`} />
      {[-11, -3.6, 3.8, 11].map((dx, i) => (
        <g key={dx}>
          <ellipse cx={dx} cy={-10.4 + (i === 1 || i === 2 ? -1 : 0)} rx="4.6" ry="7" fill={`url(#${u}arm)`} />
          <path d={`M${dx - 4} -5.4Q${dx} -3.4 ${dx + 4} -5.4`} fill="none" stroke="#6e3a20" strokeWidth="1" opacity=".6" />
        </g>
      ))}
      <ellipse cx="-16" cy="7" rx="11" ry="4.8" transform="rotate(-14 -16 7)" fill={`url(#${u}arm)`} />
      <path d="M-26 6Q-16 11 -6 10" fill="none" stroke="#6e3a20" strokeWidth=".9" opacity=".5" />
      <ellipse cx="-4" cy="-3" rx="11" ry="3.4" fill="#fff" opacity=".2" />
      {[-11, -3.6, 3.8, 11].map((dx) => (
        <circle key={dx} cx={dx} cy="-3.6" r="1.6" fill="#ffd9ae" opacity=".5" />
      ))}
    </g>
  );
}

function CoverDefs({ uid }) {
  const skin = [
    ['#f0c295', '#d19a6c', '#9a6038'], // uncle: light, weathered
    ['#e6b184', '#c58a5c', '#8e5430'], // office-goer
    ['#c98e60', '#a96f45', '#74421f'], // student
    ['#e9b88a', '#cf9768', '#9a6038'], // child
  ];
  return (
    <defs>
      <linearGradient id={uid + 'sky'} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={HZ + 12}>
        <stop offset="0" stopColor="#2c1730" />
        <stop offset=".32" stopColor="#8a3a3c" />
        <stop offset=".66" stopColor="#ec7f35" />
        <stop offset=".9" stopColor="#ffb866" />
        <stop offset="1" stopColor="#ffd9a0" />
      </linearGradient>
      <radialGradient id={uid + 'sun'} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#fff6c8" stopOpacity="1" />
        <stop offset=".18" stopColor="#ffd98a" stopOpacity=".85" />
        <stop offset=".55" stopColor="#ff9d3f" stopOpacity=".3" />
        <stop offset="1" stopColor="#ff8a1f" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={uid + 'glow'} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#ffe9a0" stopOpacity=".9" />
        <stop offset=".4" stopColor="#ffc15a" stopOpacity=".3" />
        <stop offset="1" stopColor="#ff9d3f" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={uid + 'rays'} gradientUnits="userSpaceOnUse" cx={SUN[0]} cy={SUN[1]} r="470">
        <stop offset="0" stopColor="#ffe2a0" stopOpacity="0" />
        <stop offset=".14" stopColor="#ffe2a0" stopOpacity=".32" />
        <stop offset="1" stopColor="#ffb25a" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={uid + 'ground'} gradientUnits="userSpaceOnUse" x1="0" y1={HZ} x2="0" y2={EDGE}>
        <stop offset="0" stopColor="#a8683a" />
        <stop offset=".35" stopColor="#6a3b20" />
        <stop offset="1" stopColor="#25120a" />
      </linearGradient>
      <linearGradient id={uid + 'haze'} gradientUnits="userSpaceOnUse" x1="0" y1={HZ - 70} x2="0" y2={HZ + 50}>
        <stop offset="0" stopColor="#ffb25a" stopOpacity="0" />
        <stop offset=".6" stopColor="#ffc880" stopOpacity=".5" />
        <stop offset="1" stopColor="#ffb25a" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={uid + 'roof'} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5d4a42" />
        <stop offset="1" stopColor="#241713" />
      </linearGradient>
      <linearGradient id={uid + 'under'} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1a0c10" stopOpacity=".62" />
        <stop offset="1" stopColor="#1a0c10" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={uid + 'steel'} gradientUnits="userSpaceOnUse" x1="0" y1={EDGE} x2="0" y2={LIP}>
        <stop offset="0" stopColor="#f6e2bc" />
        <stop offset=".3" stopColor="#d9c09a" />
        <stop offset="1" stopColor="#6b5a49" />
      </linearGradient>
      <linearGradient id={uid + 'lip'} gradientUnits="userSpaceOnUse" x1="0" y1={LIP} x2="0" y2="450">
        <stop offset="0" stopColor="#e9d7b6" />
        <stop offset=".25" stopColor="#a58f74" />
        <stop offset="1" stopColor="#4a3b30" />
      </linearGradient>
      <radialGradient id={uid + 'tawa'} cx=".4" cy=".34" r=".8">
        <stop offset="0" stopColor="#332a25" />
        <stop offset=".55" stopColor="#171211" />
        <stop offset="1" stopColor="#0b0807" />
      </radialGradient>
      <radialGradient id={uid + 'dosa'} cx=".42" cy=".4" r=".62">
        <stop offset="0" stopColor="#ffe3a0" />
        <stop offset=".55" stopColor="#efb04e" />
        <stop offset=".88" stopColor="#c47a24" />
        <stop offset="1" stopColor="#8a4a12" />
      </radialGradient>
      <radialGradient id={uid + 'fire'} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#ffb040" stopOpacity=".8" />
        <stop offset="1" stopColor="#ff6a1f" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={uid + 'pot'} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#f6e8cc" />
        <stop offset=".3" stopColor="#d3cabb" />
        <stop offset="1" stopColor="#6d6559" />
      </linearGradient>
      <linearGradient id={uid + 'brass'} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffd77a" />
        <stop offset=".55" stopColor="#d8962b" />
        <stop offset="1" stopColor="#7a470d" />
      </linearGradient>
      <linearGradient id={uid + 'ladle'} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f6f8f9" />
        <stop offset=".45" stopColor="#b9c0c5" />
        <stop offset="1" stopColor="#5f666b" />
      </linearGradient>
      {skin.map(([a, b, c], i) => (
        <radialGradient key={i} id={`${uid}sk${i}`} cx=".4" cy=".34" r=".78">
          <stop offset="0" stopColor={a} />
          <stop offset=".62" stopColor={b} />
          <stop offset="1" stopColor={c} />
        </radialGradient>
      ))}
      <linearGradient id={uid + 'arm'} gradientUnits="userSpaceOnUse" x1="0" y1="-14" x2="0" y2="14">
        <stop offset="0" stopColor="#dca679" />
        <stop offset=".6" stopColor="#bb8052" />
        <stop offset="1" stopColor="#8e5430" />
      </linearGradient>
      <linearGradient id={uid + 'fore'} gradientUnits="userSpaceOnUse" x1="0" y1="400" x2="0" y2="452">
        <stop offset="0" stopColor="#d9a274" />
        <stop offset=".55" stopColor="#b57a4c" />
        <stop offset="1" stopColor="#8a5130" />
      </linearGradient>
      <linearGradient id={uid + 'shirt'} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#b9c8d6" />
        <stop offset=".55" stopColor="#e4ecf2" />
        <stop offset="1" stopColor="#c4d2de" />
      </linearGradient>
      <linearGradient id={uid + 'hood'} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#1f5a55" />
        <stop offset=".5" stopColor="#2f8077" />
        <stop offset="1" stopColor="#235f59" />
      </linearGradient>
      <linearGradient id={uid + 'kurta'} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#d9ccaa" />
        <stop offset=".5" stopColor="#f4ead2" />
        <stop offset="1" stopColor="#d6c8a2" />
      </linearGradient>
      <radialGradient id={uid + 'topi'} cx=".4" cy=".3" r=".8">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#d9d1be" />
      </radialGradient>
      <linearGradient id={uid + 'frock'} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#c23e68" />
        <stop offset=".5" stopColor="#ee6f93" />
        <stop offset="1" stopColor="#c8446e" />
      </linearGradient>
      <pattern id={uid + 'chk'} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
        <rect width="10" height="10" fill="#f6ead2" />
        <rect width="4" height="10" fill="#c8362b" opacity=".85" />
        <rect width="10" height="4" fill="#c8362b" opacity=".85" />
      </pattern>
      <radialGradient id={uid + 'vig'} cx=".5" cy=".5" r=".75">
        <stop offset=".55" stopColor="#12080a" stopOpacity="0" />
        <stop offset="1" stopColor="#12080a" stopOpacity=".5" />
      </radialGradient>
      <linearGradient id={uid + 'left'} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="300" y2="0">
        <stop offset="0" stopColor="#1a0c10" stopOpacity=".55" />
        <stop offset="1" stopColor="#1a0c10" stopOpacity="0" />
      </linearGradient>
      <filter id={uid + 'bg'} x="-4%" y="-4%" width="108%" height="108%">
        <feGaussianBlur stdDeviation="2.3" />
      </filter>
      <filter id={uid + 'fg'} x="-4%" y="-6%" width="108%" height="112%">
        <feGaussianBlur stdDeviation="1.1" />
      </filter>
      <filter id={uid + 'brush'} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.75" numOctaves="2" seed="4" />
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 .96  0 0 0 0 .88  1.15 0 0 0 -.44" />
      </filter>
    </defs>
  );
}

function TiffinCoverBase({ className, title, animated = true }) {
  const u = useUid();
  const far = skyline(rng(7), { x0: -10, x1: 820, base: HZ + 10, hmin: 8, hmax: 44, wmin: 18, wmax: 40, lit: 0.04, spire: 0.12 });
  const near = skyline(rng(23), { x0: -10, x1: 820, base: HZ + 36, hmin: 14, hmax: 52, wmin: 24, wmax: 48, lit: 0.22, gap: [2, 7] });
  const wire = strand([0, 60], [400, 124], [800, 56], 8);
  const bokeh = [[48, 244, 9, 0.28], [110, 262, 6, 0.22], [186, 238, 7, 0.26], [262, 270, 5, 0.2], [318, 244, 4, 0.2], [452, 252, 5, 0.24], [690, 246, 6, 0.26], [760, 262, 8, 0.22], [24, 276, 6, 0.18]];
  const beams = [
    [[330, -4], [392, -4]], [[452, -4], [500, -4]], [[600, -4], [650, -4]], [[742, -4], [804, 10]],
    [[804, 120], [804, 168]], [[248, 450], [330, 450]], [[420, 450], [500, 450]],
  ];
  return (
    <CoverSvg className={className} title={title} css={animated ? COVER_CSS : COVER_CSS.replace(/animation:[^;}]+/g, 'animation:none')}>
      <CoverDefs uid={u} />

      {/* ---------- the street, out of focus ---------- */}
      <g filter={`url(#${u}bg)`}>
        <rect width="800" height={EDGE + 4} fill={`url(#${u}sky)`} />
        <circle cx={SUN[0]} cy={SUN[1]} r="190" fill={`url(#${u}sun)`} />
        <path d={far.body} fill="#a04b3a" opacity=".78" />
        <Charminar x={SUN[0]} y={HZ + 12} s={0.92} c="#5a2620" />
        <path d={near.body} fill="#4a2018" />
        <path d={near.w1} fill="#ffc15a" opacity=".85" />
        <path d={near.w2} fill="#ff9d4d" opacity=".55" />
        <rect y={HZ - 70} width="800" height="130" fill={`url(#${u}haze)`} />
        <rect y={HZ + 36} width="800" height={EDGE - HZ - 30} fill={`url(#${u}ground)`} />
        <rect y={HZ + 36} width="800" height="2.4" fill="#ffae4d" opacity=".4" />
        <path d="M572 262V320M560 270V318M586 268V322M545 280V316M600 278V318" stroke="#ffc880" strokeWidth="3" opacity=".22" />
        <ellipse cx="572" cy="300" rx="120" ry="14" fill="#ffb25a" opacity=".16" />
        {bokeh.map(([x, y, r, o]) => (
          <circle key={x} cx={x} cy={y} r={r} fill="#ffcf7a" opacity={o} />
        ))}
        {/* an auto-rickshaw passing down the road */}
        <g transform="translate(700 294) scale(1.5)">
          <path d="M62 -22H92M66 -14H98M64 -6H88" stroke="#ffd085" strokeWidth="1.6" strokeLinecap="round" opacity=".3" />
          <MiniAuto />
        </g>
      </g>

      {/* ---------- sun rays through the haze ---------- */}
      <g fill={`url(#${u}rays)`}>
        {beams.map(([[ax, ay], [bx, by]], i) => (
          <path key={i} d={`M${SUN[0] - 3} ${SUN[1]}L${ax} ${ay}L${bx} ${by}L${SUN[0] + 3} ${SUN[1]}Z`} opacity={i > 4 ? 0.55 : 0.8} />
        ))}
      </g>

      {/* ---------- tin roof edge, rafter, bulbs on a wire, flex banner ---------- */}
      <g filter={`url(#${u}fg)`}>
        <path d={`M-4 -4H804V40${Array.from({ length: 41 }, (_, i) => `Q${f(804 - i * 20 - 5)} ${i % 2 ? 36 : 47} ${804 - (i + 1) * 20} 40`).join('')}Z`} fill={`url(#${u}roof)`} />
        {Array.from({ length: 40 }, (_, i) => (
          <path key={i} d={`M${i * 20 + 3} 0V44`} stroke={i % 2 ? '#8a7466' : '#1a0f0c'} strokeWidth="2.2" opacity=".28" />
        ))}
        <g fill="#8a3a1c" opacity=".3">
          <ellipse cx="96" cy="14" rx="34" ry="5" />
          <ellipse cx="402" cy="26" rx="40" ry="5" />
          <ellipse cx="690" cy="10" rx="28" ry="4" />
        </g>
        <path d={`M-4 39H804`} stroke="#ffb25a" strokeWidth="1.6" opacity=".4" />
        <rect x="-4" y="41" width="808" height="9" fill="#3a2418" />
        <rect x="-4" y="41" width="808" height="2" fill="#b98a4a" opacity=".5" />
        <rect x="-4" y="50" width="808" height="46" fill={`url(#${u}under)`} />
      </g>
      <path d={`M0 ${wire[0][1]}Q400 124 800 ${wire[8][1]}`} fill="none" stroke="#0e0706" strokeWidth="1.6" />
      {wire.slice(2, 6).map(([x, y]) => (
        <Bulb key={x} x={x} y={f(y + 19)} uid={u} r={x === 300 ? 6.2 : 5.4} />
      ))}
      <g transform="rotate(-1.2 648 72)">
        <path d="M530 44H770V92Q712 100 650 93T530 92Z" fill="#0d6a69" />
        <path d="M530 44H770V52H530Z" fill="#fff" opacity=".12" />
        <rect x="537" y="51" width="226" height="36" rx="4" fill="none" stroke={CREAM} strokeWidth="1.8" opacity=".9" />
        <rect x="542" y="56" width="216" height="26" rx="3" fill="none" stroke={TURMERIC} strokeWidth="1" opacity=".6" />
        <text x="650" y="68" textAnchor="middle" fontFamily={SIGN_FONT} fontSize="12" fontWeight="700" fill={TURMERIC} textLength="104" lengthAdjust="spacingAndGlyphs">
          టిఫిన్ సెంటర్
        </text>
        <text x="650" y="82.4" textAnchor="middle" fontFamily={SIGN_FONT} fontSize="15" fontWeight="800" fill={CREAM} textLength="186" lengthAdjust="spacingAndGlyphs">
          TIFFIN CENTRE
        </text>
        <path d="M536 46L528 41M764 46L772 41" stroke="#d9c9a0" strokeWidth="1.6" strokeLinecap="round" />
        {[[536, 48], [764, 48], [536, 86], [764, 86]].map(([x, y]) => (
          <circle key={x + '-' + y} cx={x} cy={y} r="2" fill="#c9d1d6" stroke="#5a4a3c" strokeWidth=".7" />
        ))}
      </g>

      {/* ---------- the regulars across the counter ---------- */}
      <g transform="translate(385 196)">
        <OfficeGoer u={u} />
      </g>
      <g transform="translate(505 204)">
        <Student u={u} />
      </g>
      <g transform="translate(640 208)">
        <Uncle u={u} />
      </g>
      <g transform="translate(740 292)">
        <Child u={u} />
      </g>

      {/* ---------- the counter: brushed steel top, soft near lip ---------- */}
      <rect x="-4" y={EDGE} width="808" height={LIP - EDGE} fill={`url(#${u}steel)`} />
      <rect x="-4" y={EDGE} width="808" height={LIP - EDGE} filter={`url(#${u}brush)`} opacity=".55" />
      <rect x="-4" y={EDGE - 2} width="808" height="5" fill="#2a1a10" opacity=".55" />
      <rect x="-4" y={EDGE + 3} width="808" height="2.4" fill="#fff6dc" opacity=".6" />
      <g fill="#ffe2a0">
        {[200, 300, 410, 520].map((x, i) => (
          <ellipse key={x} cx={x} cy={f(EDGE + 38 + (i % 2) * 14)} rx="5" ry={f(32 + i * 4)} opacity=".07" />
        ))}
        <path d="M120 332L330 440M650 330L520 440" stroke="#fff6dc" strokeWidth="14" opacity=".07" />
      </g>
      <ChildHands x={740} y={EDGE + 4} />

      {/* ---------- on the counter: idly cooker (left), chai glasses, brass kadai (right) ---------- */}
      <g>
        <ellipse cx="302" cy="356" rx="48" ry="7" fill="#1b0f08" opacity=".4" />
        <path d="M264 354V312Q264 308 268 308H336Q340 308 340 312V354Z" fill={`url(#${u}pot)`} />
        <rect x="264" y="322" width="76" height="3" fill="#4d463c" opacity=".55" />
        <rect x="264" y="336" width="76" height="3" fill="#4d463c" opacity=".55" />
        <path d="M259 308Q259 284 302 282Q345 284 345 308Z" fill={`url(#${u}pot)`} />
        <ellipse cx="302" cy="355" rx="38" ry="3.4" fill="#4d463c" opacity=".45" />
        <circle cx="302" cy="278" r="5" fill="#4d463c" />
        <rect x="252" y="318" width="12" height="6" rx="3" fill="#4d463c" />
        <rect x="340" y="318" width="12" height="6" rx="3" fill="#4d463c" />
        <path d="M274 314V350" stroke="#fff" strokeWidth="3" opacity=".4" strokeLinecap="round" />
        <g className="hub-bob2">
          <Steam x={302} y={272} h={50} n={3} o={0.5} />
        </g>
      </g>
      <g>
        <ellipse cx="466" cy="346" rx="34" ry="4" fill="#1b0f08" opacity=".4" />
        <ellipse cx="466" cy="343" rx="31" ry="4.2" fill="#b9b0a0" />
        {[446, 466, 486].map((x, i) => (
          <g key={x}>
            <path d={`M${x - 8} ${316 - (i === 1 ? 3 : 0)}H${x + 8}L${x + 6.4} 342H${x - 6.4}Z`} fill={CREAM} opacity=".3" />
            <path d={`M${x - 7.6} ${324 - (i === 1 ? 3 : 0)}H${x + 7.6}L${x + 6.4} 342H${x - 6.4}Z`} fill="#c8651b" />
            <path d={`M${x - 7.6} ${324 - (i === 1 ? 3 : 0)}H${x + 7.6}`} stroke="#ffd0a0" strokeWidth="1.6" opacity=".7" />
            <path d={`M${x - 5} ${320 - (i === 1 ? 3 : 0)}v18`} stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".5" />
          </g>
        ))}
        <g className="hub-bob">
          <Steam x={466} y={312} h={26} n={2} o={0.42} w={2.4} />
        </g>
      </g>
      <g>
        <ellipse cx="706" cy="388" rx="66" ry="8" fill="#1b0f08" opacity=".45" />
        <path d="M646 366Q646 392 706 392Q766 392 766 366Z" fill={`url(#${u}brass)`} />
        <ellipse cx="706" cy="364" rx="60" ry="12" fill="#d8962b" />
        <ellipse cx="706" cy="365" rx="54" ry="9" fill="#4b2c10" />
        <ellipse cx="706" cy="366" rx="48" ry="7" fill="#e9a530" opacity=".55" />
        {[[686, 364, 7.6], [708, 361, 8.2], [730, 365, 7.2]].map(([x, y, r]) => (
          <g key={x}>
            <circle cx={x} cy={y} r={r} fill="#d9892b" />
            <circle cx={f(x - r * 0.32)} cy={f(y - r * 0.32)} r={f(r * 0.4)} fill="#ffd27a" opacity=".85" />
          </g>
        ))}
        <circle cx="640" cy="366" r="5" fill="none" stroke="#b9791d" strokeWidth="2.6" />
        <circle cx="772" cy="366" r="5" fill="none" stroke="#b9791d" strokeWidth="2.6" />
        <path d="M654 372Q662 386 682 390" fill="none" stroke="#fff3c4" strokeWidth="2.4" strokeLinecap="round" opacity=".6" />
        <path d="M760 360L790 332" stroke="#cfc7b8" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="792" cy="330" r="6" fill="none" stroke="#cfc7b8" strokeWidth="2" />
        <g className="hub-bob">
          <Steam x={706} y={346} h={34} n={2} o={0.4} />
        </g>
      </g>

      {/* ---------- the soot-black tawa, the golden dosa, the ladle ---------- */}
      <ellipse cx="480" cy="400" rx="168" ry="34" fill="#1b0f08" opacity=".42" />
      <ellipse cx="480" cy="396" rx="150" ry="24" fill={`url(#${u}fire)`} />
      <path d="M356 400L306 428" stroke="#120b08" strokeWidth="11" strokeLinecap="round" />
      <path d="M356 398L308 424" stroke="#4a3b32" strokeWidth="2.4" strokeLinecap="round" opacity=".7" />
      <ellipse cx="480" cy="390" rx="144" ry="36" fill="#080504" />
      <ellipse cx="480" cy="382" rx="144" ry="36" fill={`url(#${u}tawa)`} />
      <ellipse cx="480" cy="382" rx="144" ry="36" fill="none" stroke="#5d4a3e" strokeWidth="3" />
      <path d="M350 368Q372 350 420 346" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".18" />
      <ellipse cx="478" cy="382" rx="121" ry="28" fill={`url(#${u}dosa)`} />
      <ellipse cx="478" cy="382" rx="121" ry="28" fill="none" stroke="#8a4a12" strokeWidth="1.6" opacity=".6" />
      {/* the batter ladled out in rings, lacy crisp spots, a dollop of butter */}
      <g fill="none" stroke="#b8691b" strokeLinecap="round">
        <ellipse cx="478" cy="382" rx="100" ry="23" strokeWidth="1.6" opacity=".26" />
        <ellipse cx="478" cy="382" rx="78" ry="18" strokeWidth="1.6" opacity=".26" />
        <ellipse cx="478" cy="382" rx="56" ry="13" strokeWidth="1.6" opacity=".26" />
        <path d="M388 388Q430 410 520 406Q580 400 586 378" strokeWidth="2" opacity=".2" />
      </g>
      <ellipse cx="520" cy="376" rx="54" ry="13" fill="#fff1c9" opacity=".82" />
      <ellipse cx="520" cy="376" rx="38" ry="9" fill="none" stroke="#fffbe6" strokeWidth="2" opacity=".7" />
      <path d="M470 380Q500 396 548 388" fill="none" stroke="#fffbe6" strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
      {[[404, 380, 5], [426, 392, 4], [440, 372, 3.6], [452, 394, 4.4], [588, 384, 4.6], [572, 394, 3.4], [412, 366, 3.2], [600, 372, 3]].map(([x, y, r]) => (
        <ellipse key={x} cx={x} cy={y} rx={r} ry={f(r * 0.42)} fill="#a85a14" opacity=".6" />
      ))}
      <ellipse cx="428" cy="378" rx="13" ry="4" fill="#ffd23f" opacity=".9" />
      <ellipse cx="426" cy="376.6" rx="6" ry="1.6" fill="#fffbe0" opacity=".7" />
      <ellipse cx="420" cy="372" rx="30" ry="5" fill="#fff" opacity=".12" />
      <g className="hub-bob">
        <Steam x={430} y={346} h={64} n={3} o={0.42} w={4.4} />
        <Steam x={540} y={344} h={50} n={2} o={0.34} w={3.6} />
      </g>
      {/* the steel ladle: bowl over the dosa, handle running to your hands */}
      <path d="M531 369L655 443" stroke="#2a2420" strokeWidth="13" strokeLinecap="round" opacity=".28" transform="translate(0 4)" />
      <path d="M531 368L655 442" stroke={`url(#${u}ladle)`} strokeWidth="11" strokeLinecap="round" />
      <path d="M531 365L652 437" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".6" />
      <path d="M492 372Q492 394 518 394Q544 394 544 372Z" fill={`url(#${u}ladle)`} />
      <ellipse cx="518" cy="371" rx="27" ry="10.4" fill="#d3d9dd" />
      <ellipse cx="518" cy="372.4" rx="23" ry="8" fill="#3a4044" />
      <ellipse cx="518" cy="373.4" rx="21" ry="6.4" fill="#fff1c9" />
      <ellipse cx="512" cy="372" rx="9" ry="2.2" fill="#fff" opacity=".6" />
      <path d="M495 366Q518 359 541 366" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" opacity=".7" />
      <path d="M502 394Q496 404 500 410" fill="none" stroke="#fff1c9" strokeWidth="3" strokeLinecap="round" opacity=".85" />

      {/* ---------- the near lip of the counter, soft ---------- */}
      <g filter={`url(#${u}fg)`}>
        <rect x="-4" y={LIP} width="808" height={450 - LIP + 4} fill={`url(#${u}lip)`} />
        <rect x="-4" y={LIP} width="808" height="2.6" fill="#fff6dc" opacity=".75" />
        <rect x="-4" y={LIP + 2.6} width="808" height="3" fill="#2a1a10" opacity=".25" />
      </g>

      {/* ---------- your forearms and hands (a touch soft), the gamchha over the shoulder ---------- */}
      <g filter={`url(#${u}fg)`}>
        <path d={limb(716, 488, 628, 428, 54, 32)} fill={`url(#${u}fore)`} />
        <path d={limb(710, 482, 632, 430, 9, 6)} fill="#fff" opacity=".16" />
        <path d={limb(504, 490, 580, 406, 56, 32)} fill={`url(#${u}fore)`} />
        <path d={limb(510, 484, 578, 410, 9, 6)} fill="#fff" opacity=".16" />
        <ellipse cx="645" cy="438" rx="15.4" ry="3.6" transform="rotate(121 645 438)" fill="none" stroke="#cfd6da" strokeWidth="3.2" />
        <ellipse cx="645" cy="438" rx="15.4" ry="3.6" transform="rotate(121 645 438)" fill="none" stroke="#fff" strokeWidth="1" opacity=".6" />
        <path d="M728 400Q760 392 806 384V454H698Q724 440 730 422Q732 412 728 400Z" fill={`url(#${u}chk)`} />
        <path d="M728 400Q760 392 806 384V454H698Q724 440 730 422Q732 412 728 400Z" fill="#2a0c08" opacity=".18" />
        <path d="M734 404Q744 428 726 446M758 396Q770 424 752 450" fill="none" stroke="#2a0c08" strokeWidth="2.4" opacity=".22" />
        <path d="M728 400Q760 392 806 384" fill="none" stroke="#ffd085" strokeWidth="1.6" opacity=".5" />
      </g>
      <GripHand u={u} x={626} y={424} rot={31} />
      <GripHand u={u} x={578} y={398} rot={31} />

      {/* ---------- light, glints, grade ---------- */}
      <Sparkle x={400} y={356} s={5} c="#fff1b8" />
      <Sparkle x={560} y={352} s={4} c="#fff6d0" />
      <Sparkle x={692} y={338} s={4} c="#fff1b8" />
      <rect width="800" height="450" fill={`url(#${u}vig)`} />
      <rect width="300" height="450" fill={`url(#${u}left)`} />
    </CoverSvg>
  );
}
export const TiffinCover = memo(TiffinCoverBase);

function TiffinIconBase({ size = 64, title, className, rounded }) {
  const u = useUid();
  return (
    <IconSvg size={size} title={title} className={className} rounded={rounded} uid={u}>
      <defs>
        <linearGradient id={u + 'bg'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffbe5a" />
          <stop offset=".55" stopColor="#ff8a1f" />
          <stop offset="1" stopColor="#d9480f" />
        </linearGradient>
        <radialGradient id={u + 'dosa'} cx=".42" cy=".38" r=".66">
          <stop offset="0" stopColor="#ffeab0" />
          <stop offset=".6" stopColor="#f0b24c" />
          <stop offset="1" stopColor="#bf7220" />
        </radialGradient>
        <radialGradient id={u + 'fire'} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff0a0" stopOpacity=".95" />
          <stop offset="1" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={u + 'ladle'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".5" stopColor="#c3cbd0" />
          <stop offset="1" stopColor="#6d757a" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" fill={`url(#${u}bg)`} />
      <circle cx="64" cy="92" r="64" fill={`url(#${u}fire)`} opacity=".55" />
      {/* tawa: soot-black, dosa on it */}
      <path d="M22 96L4 110" stroke="#1a110d" strokeWidth="9" strokeLinecap="round" />
      <ellipse cx="64" cy="100" rx="56" ry="23" fill="#2b1d16" />
      <ellipse cx="64" cy="94" rx="56" ry="23" fill="#17100d" />
      <ellipse cx="64" cy="94" rx="56" ry="23" fill="none" stroke="#5d4a3e" strokeWidth="2.8" />
      <ellipse cx="63" cy="92" rx="45" ry="17.4" fill={`url(#${u}dosa)`} />
      <ellipse cx="63" cy="92" rx="45" ry="17.4" fill="none" stroke="#9a5412" strokeWidth="1.8" opacity=".6" />
      <ellipse cx="63" cy="92" rx="30" ry="11" fill="none" stroke="#b8691b" strokeWidth="1.8" opacity=".35" />
      {[[34, 94, 4.4], [46, 100, 3.6], [64, 102, 4], [82, 96, 4.6], [90, 88, 3], [44, 84, 3], [72, 84, 3.2]].map(([x, y, r]) => (
        <ellipse key={x} cx={x} cy={y} rx={r} ry={r * 0.45} fill="#a85a14" opacity=".55" />
      ))}
      <ellipse cx="46" cy="93" rx="10" ry="3.6" fill="#ffd23f" opacity=".92" />
      {/* the ladle spreading the batter */}
      <ellipse cx="82" cy="86" rx="22" ry="7.6" fill="#fff1c9" opacity=".9" />
      <path d="M96 62L124 26" stroke="#2a1a10" strokeWidth="9" strokeLinecap="round" opacity=".25" transform="translate(1.5 2)" />
      <path d="M96 62L124 26" stroke={`url(#${u}ladle)`} strokeWidth="7.4" strokeLinecap="round" />
      <path d="M95 59L122 25" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
      <path d="M66 70Q66 90 83 90Q100 90 100 70Z" fill={`url(#${u}ladle)`} />
      <ellipse cx="83" cy="69" rx="17.6" ry="7" fill="#d9dfe2" />
      <ellipse cx="83" cy="70" rx="14.4" ry="5.2" fill="#3a4044" />
      <ellipse cx="83" cy="70.8" rx="13" ry="4" fill="#fff1c9" />
      <path d="M69 66Q83 61 97 66" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".75" />
      {/* steam */}
      <g fill="none" stroke={CREAM} strokeWidth="5.4" strokeLinecap="round" opacity=".95">
        <path d="M24 60q-7 -7 0 -13t0 -11" />
        <path d="M44 56q-7 -7 0 -13t0 -11" />
        <path d="M64 52q-7 -7 0 -13t0 -11" opacity=".8" />
      </g>
      <Sparkle x={106} y={78} s={6} c="#fff6d0" />
      <Sparkle x={14} y={22} s={4} c="#fff6d0" o={0.9} />
    </IconSvg>
  );
}
export const TiffinIcon = memo(TiffinIconBase);
