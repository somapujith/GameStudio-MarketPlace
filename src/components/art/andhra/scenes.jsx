// Andhra Aatalu location postcards (400x220), keyed by TILE ID so they survive any renaming. Same layering as the
// Hyderabad scenes: sky, far backdrop, ground, near props, then the business in the foreground (levels 0 / 1 / 2).
// Every scene is one small SVG (well under 3 KB of markup): shared shapes from kit.jsx, no gradients, no ids, no filters.
import { memo } from 'react';
import { GROUPS, TILES } from '@shared/board.js';
import { K, ACCENTS, Palm, Cloud, Waves, Tree, Bull, Elephant, Figure, Kite, Chilli, Fort, Hill, Crane, Ship, Boat, Tower, Gopuram, Diya, Border } from './kit.jsx';
import { collectionOf } from './collections.js';

/* ---------------- business props (sit on a counter at 0,0; about 100 wide) ---------------- */

const CLOTH = [K.terra, K.turm, K.indigoL, K.rose, K.green];

export function Prop({ kind, x, y, s = 1 }) {
  const at = (n) => -40 + n * 20; // five slots across the counter
  const body = (() => {
    switch (kind) {
      case 'cloth':
        return <>{CLOTH.map((c, i) => <rect key={i} x={at(i) - 7} y="-26" width="14" height="26" rx="2" fill={c} />)}<path d="M-43-18h6M-23-12h6M-3-18h6M17-12h6M37-18h6" stroke={K.cream} strokeWidth="1.4" fill="none" /></>;
      case 'sacks':
        return <>{[-36, -12, 12, 36].map((a, i) => <path key={a} d={`M${a - 10} 0Q${a - 13}-14 ${a - 6}-22h12Q${a + 13}-14 ${a + 10} 0Z`} fill={i % 2 ? K.creamD : K.cream} />)}<path d="M-43-15h14M-19-15h14M5-15h14M29-15h14" stroke={K.terra} strokeWidth="3" fill="none" /></>;
      case 'chilli':
        return <>{[-32, 0, 32].map((a) => <g key={a}><path d={`M${a - 15} 0L${a - 12}-10H${a + 12}L${a + 15} 0Z`} fill={K.wood} /><path d={`M${a - 13}-10Q${a}-30 ${a + 13}-10Z`} fill={K.chilli} /></g>)}</>;
      case 'crates':
        return <><path d="M-44 0V-12H-4V0ZM2 0V-12H42V0ZM-30-12V-24H10V-12Z" fill={K.wood} /><path d="M-36-6q5-5 10 0-5 5-10 0zM10-6q5-5 10 0-5 5-10 0zM-18-18q5-5 10 0-5 5-10 0z" fill={K.sea} strokeWidth=".8" /></>;
      case 'toys':
        return <>{[[-34, K.turm], [0, K.rose], [34, K.green]].map(([a, c]) => <path key={a} transform={`translate(${a} 0)`} d="M-13 0V-8Q-13-18-3-18H4Q12-18 13-10L18-5Q19-1 15-1 12-1 12-4L10-6V0H6V-5H-4V0Z" fill={c} />)}</>;
      case 'coconuts':
        return <>{[[-20, 0], [0, 0], [20, 0], [-10, -17], [10, -17], [0, -34]].map(([a, b], i) => <circle key={i} cx={a} cy={b - 9} r="10" fill={i % 2 ? K.leaf : K.greenD} />)}</>;
      case 'cups':
        return <>{[-36, -12, 12, 36].map((a) => <path key={a} d={`M${a - 8}-14h16l-3 14h-10Z`} fill={K.cream} />)}<path d="M-40-12h8M-16-12h8M8-12h8M32-12h8" stroke="#6a3b24" strokeWidth="3" fill="none" /></>;
      case 'slabs':
        return <><path d="M-44 0V-8H4V0ZM-38-8V-15H8V-8Z" fill={K.stone} /><path d="M-30-15V-22H0V-15Z" fill={K.stoneD} /><path d="M14 0L20-30 40-28 36 0Z" fill="#c0a48e" /></>;
      case 'nuts':
        return <>{[-32, 0, 32].map((a) => <g key={a}><path d={`M${a - 15} 0L${a - 12}-10H${a + 12}L${a + 15} 0Z`} fill={K.wood} /><path d={`M${a - 13}-10Q${a}-28 ${a + 13}-10Z`} fill="#c9a06a" /></g>)}</>;
      case 'veena':
        return <>{[-30, 0, 30].map((a, i) => <g key={a} transform={`translate(${a} 0) rotate(-24)`}><path d="M0 0V-34" stroke={K.wood} strokeWidth="4" fill="none" /><ellipse cy="-6" rx="7" ry="9" fill={[K.turm, K.terra, K.indigoL][i]} /></g>)}</>;
      case 'lamps':
        return <><path d="M-47-2q7 9 14 0zM-27-2q7 9 14 0zM-7-2q7 9 14 0zM13-2q7 9 14 0zM33-2q7 9 14 0z" fill={K.terra} /><path d="M-40-3q-4-7 0-13 4 6 0 13zM-20-3q-4-7 0-13 4 6 0 13zM0-3q-4-7 0-13 4 6 0 13zM20-3q-4-7 0-13 4 6 0 13zM40-3q-4-7 0-13 4 6 0 13z" fill={K.turm} strokeWidth=".8" /></>;
      case 'laddu':
        return <><path d="M-30 0H30V-4H-30Z" fill={K.turmD} />{[[-18, 0], [0, 0], [18, 0], [-9, -14], [9, -14], [0, -28]].map(([a, b], i) => <circle key={i} cx={a} cy={b - 12} r="9" fill={K.turm} />)}</>;
      case 'tech':
        return <>{[-34, 0, 34].map((a, i) => <g key={a}><rect x={a - 13} y="-24" width="26" height="17" rx="2" fill={K.night} /><rect x={a - 10} y="-21" width="20" height="11" fill={['#6fd0e6', '#9bd36c', '#f2b11d'][i]} stroke="none" /></g>)}<path d="M-49 0H-19L-22-7H-46ZM-15 0H15L12-7H-12ZM19 0H49L46-7H22Z" fill={K.creamD} /></>;
      default:
        return null;
    }
  })();
  return <g transform={`translate(${x} ${y}) scale(${s})`}>{body}</g>;
}

/* ---------------- the business in the foreground ---------------- */

const Sign = ({ x, y, w, text, text7 = true, fill = K.indigo }) => (
  <g>
    <rect x={x} y={y} width={w} height="15" rx="3" fill={fill} />
    {text7 && text ? <text x={x + w / 2} y={y + 10.5} textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="7.4" fontWeight="800" letterSpacing=".7" fill={K.cream} stroke="none">{text}</text> : null}
  </g>
);

const stripes = (c) => <><path d="M58 96H198V118H58Z" fill={K.cream} /><path d="M58 96h28v22H58zM114 96h28v22h-28zM170 96h28v22h-28z" fill={c} /></>;
const scallop = (c) => <path d={`M58 118${Array.from({ length: 10 }, () => 'q7 8 14 0').join('')}Z`} fill={c} />;

/** Level 0 stall, level 1 shop, level 2 complex. `text` false drops the lettering (tiny building art). */
export function Shop({ prop = 'cloth', sign = 'BAZAAR', color = K.terra, level = 0, text = true }) {
  if (level === 0) {
    return (
      <g className="ls-business">
        <path d="M64 176V110M186 176V110" stroke={K.wood} strokeWidth="4" fill="none" />
        <path d="M58 152H192V176H58Z" fill={K.wood} />
        <path d="M58 152H192v7H58Z" fill={color} />
        <Prop kind={prop} x={125} y={152} />
        {stripes(color)}
        {scallop(color)}
        <Sign x={86} y={76} w={78} text={sign} text7={text} fill={text ? K.indigo : color} />
        <path d="M100 91V96M150 91V96" stroke={K.ink} fill="none" />
      </g>
    );
  }
  const two = level > 1;
  return (
    <g className="ls-business">
      <path d="M52 176V112H200V176Z" fill={K.cream} />
      {two && (
        <g className="ls-expansion">
          <path d="M52 112V68H200V112Z" fill={K.creamD} />
          {[66, 106, 146].map((a) => <path key={a} d={`M${a} 110V90a12 12 0 0 1 24 0V110Z`} fill="#7cc3d6" />)}
          <path d="M60 106H192" stroke={color} strokeWidth="4" fill="none" />
          <path d="M120 50V30M120 33h14l-4 5 4 5h-14" fill={text ? K.turm : color} />
        </g>
      )}
      <g className={two ? 'ls-expansion' : undefined}>
        <path d={`M44 ${two ? 68 : 112}L62 ${two ? 46 : 86}H190L208 ${two ? 68 : 112}Z`} fill={K.terra} />
        <path d={`M62 ${two ? 54 : 94}H190M57 ${two ? 61 : 102}H195`} stroke={K.terraD} strokeWidth="1.2" fill="none" />
      </g>
      <Sign x={72} y={116} w={86} text={sign} text7={text} fill={text ? K.indigo : color} />
      <path d="M60 164H162V176H60Z" fill={K.wood} />
      <Prop kind={prop} x={110} y={164} s={0.82} />
      <path d="M170 176V140a14 14 0 0 1 28 0V176Z" fill={K.indigo} />
      <path d="M52 176h148" stroke={color} strokeWidth="4" fill="none" />
    </g>
  );
}

/* ---------------- backdrops: [far (before the ground), near (after the ground)] ---------------- */

const Field = ({ c = '#8cc271', rows = true }) => (
  <>
    <Hill d="M0 140Q100 128 200 136T400 132" c={c} />
    {rows && <path d="M200 146H400M200 152H400M230 140L190 160M300 138L270 160M370 136L350 160" stroke="#5fa857" strokeWidth="1.4" fill="none" />}
  </>
);

const Sea = ({ y = 102, c = K.sea }) => (
  <>
    <rect y={y} width="400" height={160 - y} fill={c} stroke="none" />
    <Waves y={y + 14} n={3} />
  </>
);

const Bush = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cy="-8" rx="15" ry="11" fill={K.greenD} />
    <path d="M-7-9h.1M3-13h.1M7-6h.1M-2-4h.1" stroke={K.chilli} strokeWidth="3.4" fill="none" />
  </g>
);

const Sun = ({ x, y, r = 18, c = K.turm }) => <circle cx={x} cy={y} r={r} fill={c} stroke="none" opacity=".9" />;

const Muggu = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse rx="52" ry="10" fill={K.cream} stroke="none" opacity=".85" />
    <path d="M-40 0L-20-6 0 0 20-6 40 0 20 6 0 0-20 6Z" fill="none" stroke={K.rose} strokeWidth="2" />
    <path d="M-30 0H30" stroke={K.turmD} strokeWidth="2" />
    {[-46, -34, -22, -10, 10, 22, 34, 46].map((a) => <circle key={a} cx={a} cy={a % 20 ? 3 : -3} r="1.6" fill={K.indigo} stroke="none" />)}
  </g>
);

export const BG = {
  // ---- Towns & Markets
  1: [<><Sea /><Boat x={300} y={112} s={0.9} c={K.turm} /></>, <><Palm x={354} y={168} s={1.2} /><Palm x={382} y={172} s={0.85} /></>],
  3: [<><Field /><path d="M300 134l8-12 8 12z" fill={K.turmD} /></>, <Bull x={316} y={174} s={1.5} />],
  4: [<><Hill d="M0 136Q100 128 200 134T400 132" c="#8cc271" /><path d="M210 140h52l8 14h-72zM282 140h56l10 14h-72zM356 140h44v14h-56z" fill={K.sea} /><path d="M232 146h8M308 147h8M372 147h8" stroke={K.white} strokeWidth="2" fill="none" /></>, <g><path d="M318 172q4-14 16-16l6-22" fill="none" stroke={K.white} strokeWidth="5" /><path d="M330 168q-12-4-14 4 12 6 22 0z" fill={K.white} /><circle cx="340" cy="132" r="5" fill={K.white} /><path d="M344 131l10 2-10 2" fill={K.turm} /><path d="M326 172v6M332 172v6" stroke={K.turmD} strokeWidth="1.6" fill="none" /></g>],
  // ---- Andhra Crafts
  6: [<><Hill d="M150 150Q220 70 290 94T400 118" c="#b7855c" /><Fort x={236} y={96} w={52} h={18} /></>, <Elephant x={326} y={174} s={1.35} />],
  7: [<><rect y="112" width="400" height="48" fill="#5db4d6" stroke="none" /><path d="M206 52H386M206 52V112M386 52V112" stroke={K.wood} strokeWidth="2.4" fill="none" />{[[214, K.terra], [262, K.indigoL], [310, K.turm]].map(([a, c]) => <g key={a}><rect x={a} y="54" width="40" height="52" fill={c} /><circle cx={a + 20} cy="80" r="9" fill={K.cream} stroke="none" /><circle cx={a + 20} cy="80" r="4" fill={K.rose} stroke="none" /></g>)}</>, <Boat x={352} y={160} s={0.8} c={K.indigoL} />],
  8: [<><Hill d="M150 150Q200 96 260 112T400 96" c="#c19468" /><Gopuram x={300} y={114} s={0.6} /></>, <g><path d="M274 174h56v-8H274zM278 166h48v-8H278zM284 158h38v-8H284z" fill={K.rose} /><path d="M274 170h56M278 162h48M284 154h38" stroke={K.turm} strokeWidth="2" fill="none" /></g>],
  // ---- Godavari Gold
  10: [<><Hill d="M150 142Q260 126 400 138" c="#7bc58a" /><Palm x={226} y={146} s={0.6} /><Palm x={276} y={146} s={0.7} /><path d="M200 158Q280 142 400 150V162H200Z" fill={K.sea} stroke="none" /></>, <><Palm x={352} y={170} s={1.25} /><Boat x={290} y={162} s={0.8} c={K.turm} /></>],
  11: [<><Sea y={98} /><path d="M330 100L336 62h14l6 38Z" fill={K.white} /><path d="M334 78h18M335 88h20" stroke={K.terra} strokeWidth="5" fill="none" /><path d="M336 62h14l-7-8z" fill={K.terra} /></>, <><Boat x={236} y={162} s={0.9} /><Boat x={290} y={158} s={0.7} c={K.indigoL} /></>],
  13: [<><Sun x={354} y={84} r={16} c="#f7a35a" /><Sea y={118} c="#6fb6c9" /><path d="M176 116H400M176 120H400" stroke={K.ink} strokeWidth="3" fill="none" /><path d="M190 116Q232 66 274 116M274 116Q316 66 358 116" fill="none" strokeWidth="3" /><path d="M206 116V96M226 116V84M250 116V96M296 116V96M320 116V84M340 116V96" stroke={K.stoneD} strokeWidth="1.2" fill="none" /><path d="M176 120V150M274 120V150M370 120V150" stroke={K.stoneD} strokeWidth="5" fill="none" /></>, <Palm x={372} y={170} s={1} />],
  // ---- Uttarandhra
  15: [<><Sun x={316} y={104} r={30} /><path d="M316 60V48M316 148V160M272 104H260M360 104H372M285 73l-9-9M347 73l9-9" stroke={K.turm} strokeWidth="3" fill="none" /><Hill d="M0 142Q120 124 230 138T400 130" c="#8cc271" /></>, <><path d="M330 174q-4-40 6-60 6 22 4 60M352 174q-4-34 4-50 5 20 2 50" fill="#2f7d4f" strokeWidth="1" /><Figure x={300} y={176} c={K.turm} /></>],
  16: [<><Fort x={218} y={146} w={120} h={46} /><path d="M278 100V74M278 76h16l-4 5 4 5h-16" fill={K.terra} /></>, <g transform="rotate(-38 330 166)"><path d="M300 166H384" stroke={K.wood} strokeWidth="7" fill="none" /><ellipse cx="300" cy="166" rx="22" ry="17" fill={K.turm} /><circle cx="388" cy="166" r="10" fill={K.terra} /><path d="M310 164H384M310 168H384" stroke={K.cream} strokeWidth="1" fill="none" /><circle cx="300" cy="166" r="6" fill={K.terraD} /></g>],
  17: [<><Sea y={104} /><Hill d="M300 148Q340 92 400 108" c="#4f9d6d" /><Ship x={252} y={126} s={0.8} /></>, <><path d="M200 164H400V176H200Z" fill={K.stoneD} /><Crane x={310} y={166} s={0.75} /></>],
  // ---- Nature & Heritage
  19: [<><Hill d="M120 150Q190 70 250 112T330 86 400 116" c="#7f93d6" /><Hill d="M160 152Q250 96 320 124T400 108" c="#4f9d78" /><path d="M120 126H400" stroke={K.white} strokeWidth="10" opacity=".45" fill="none" /></>, <><Bush x={256} y={172} /><Bush x={300} y={170} /><Bush x={344} y={172} /></>],
  20: [<><Sun x={350} y={70} r={20} c="#f08a52" />{[[236, 148, 30], [270, 152, 22], [312, 150, 34]].map(([a, b, r]) => <ellipse key={a} cx={a} cy={b - r / 2} rx={r} ry={r * 0.7} fill={K.stone} />)}</>, <Bull x={338} y={176} s={1.8} c="#b3a08c" dark={K.stoneD} />],
  22: [<><path d="M236 40H330L340 66 330 96 348 120 340 160H236Z" fill="#c0653f" /><path d="M244 70H330M244 98H334M240 126H342" stroke="#8f3a2b" strokeWidth="1.6" fill="none" /><path d="M150 76L190 70 206 100 196 160H150Z" fill="#b25a38" /><Fort x={244} y={44} w={60} h={12} towers={false} /></>, <path d="M200 160Q230 146 270 150T360 146 400 152V166H200Z" fill={K.seaD} stroke="none" />],
  // ---- Rayalaseema
  24: [<><Hill d="M160 150V110H230V96H330V118H400V150" c="#b86a45" /><path d="M170 126H400M170 138H400" stroke="#8f3a2b" strokeWidth="1.2" fill="none" /></>, <g><path d="M250 176L262 128 290 130 284 176Z" fill="#c0a48e" /><path d="M296 176L304 138 334 140 326 176Z" fill={K.stone} /><path d="M336 176L350 150 372 154 362 176Z" fill={K.stoneD} /></g>],
  25: [<><Hill d="M120 150Q220 122 300 138T400 126" c="#d9b86a" />{[236, 290, 346].map((a, i) => <g key={a} transform={`translate(${a} ${142 - i * 4})`}><path d="M0 0V-54" stroke={K.white} strokeWidth="4" fill="none" /><path d="M0-54L-14-40M0-54L14-46M0-54V-76" stroke={K.white} strokeWidth="3" fill="none" /><circle cy="-54" r="3.5" fill={K.indigo} /></g>)}</>, <>{[216, 256, 296, 336].map((a) => <path key={a} d={`M${a} 174l8-14h30l-8 14z`} fill={K.blue} />)}</>],
  26: [<><Fort x={214} y={150} w={110} h={34} /><rect x="324" y="66" width="46" height="84" fill={K.stone} /><path d={`M320 66h54v-6h-6v-8h-8v8h-8v-8h-8v8h-8v-8h-8v8h-8v-8h-8v8z`} fill={K.stone} /><path d="M338 150v-18a9 9 0 0 1 18 0v18Z" fill={K.ink} /></>, <Tree x={382} y={172} s={0.95} />],
  // ---- Spiritual Andhra
  28: [<><Hill d="M150 150Q230 100 300 120T400 112" c="#85b88a" /><Gopuram x={300} y={150} s={1.25} /><path d="M150 152Q260 140 400 150V162H150Z" fill={K.seaD} stroke="none" /></>, <>{[0, 1, 2].map((i) => <path key={i} d={`M${240 + i * 12} ${178 - i * 4}h${60 - i * 12}`} stroke={K.stoneD} strokeWidth="4" fill="none" />)}{[250, 276, 302].map((a) => <Diya key={a} x={a} y={166} />)}</>],
  29: [<><Hill d="M130 150L190 96 250 130 300 90 360 124 400 98" c="#2f7d4f" /><path d="M190 100H346V108H190Z" fill={K.sea} /><path d="M196 108H340L354 154H182Z" fill="#cdbfae" />{[206, 232, 258, 284, 310].map((a) => <path key={a} d={`M${a} 114h18v22q-9-8-18 0z`} fill={K.stoneD} />)}<path d="M215 138v14M241 138v14M267 138v14M293 138v14M319 138v14" stroke={K.white} strokeWidth="3" fill="none" /></>, <><Tree x={372} y={172} s={1.1} c={K.greenD} /><Tree x={226} y={172} s={0.8} c={K.greenD} /></>],
  31: [<><Hill d="M150 150Q170 106 196 140Q214 90 242 132Q262 82 292 128Q312 78 344 124Q366 92 400 120" c="#6fa889" /><Hill d="M180 152Q230 122 290 144T400 136" c="#4f9d6d" /><Gopuram x={292} y={86} s={0.4} /></>, <><path d="M200 176L330 150M210 176L340 154M220 176L350 158" stroke={K.cream} strokeWidth="3" fill="none" /><Figure x={282} y={164} c={K.indigoL} s={0.8} /><Figure x={300} y={160} c={K.rose} s={0.7} /></>],
  // ---- Capital & Commerce
  33: [<><rect x="226" y="86" width="98" height="52" fill={K.cream} /><path d="M218 86L275 58 332 86Z" fill={K.terra} /><rect x="258" y="106" width="34" height="32" fill={K.indigo} /></>, <><path d="M196 158H400V184H176Z" fill={K.chilli} /><path d="M206 166H392M200 174H396" stroke="#ff8a6a" strokeWidth="2" strokeDasharray="3 6" fill="none" /><Chilli x={340} y={172} s={1.3} r={-8} /><Chilli x={356} y={174} s={1.1} r={12} /><path d="M300 176q-4-14 2-20h16q4 6 0 20z" fill={K.cream} /></>],
  34: [<><Hill d="M170 150Q210 88 250 100T300 150" c="#6aa56f" /><path d="M222 100v-12h10v12" fill={K.cream} /><path d="M176 108H400" stroke={K.ink} strokeWidth="9" fill="none" /><path d="M176 114H400V150H176Z" fill={K.seaD} stroke="none" /><path d={Array.from({ length: 9 }, (_, i) => `M${184 + i * 26} 112V146`).join('')} stroke={K.stoneD} strokeWidth="5" fill="none" /><path d={Array.from({ length: 8 }, (_, i) => `M${189 + i * 26} 146q10-22 21 0`).join('')} fill="#a4dbef" stroke="none" opacity=".85" /></>, <><Boat x={348} y={170} s={0.8} c={K.turm} /></>],
  35: [<><Sun x={350} y={84} r={24} c="#f6c27c" /><Tower x={222} y={152} h={80} w={18} /><Tower x={246} y={152} h={98} w={20} c={K.indigoL} /><path d="M296 152V112q22-34 44 0V152Z" fill={K.cream} /><path d="M318 80V68" stroke={K.turm} strokeWidth="3" fill="none" /><Tower x={352} y={152} h={76} w={18} c={K.indigoL} /></>, <g>{[[310, 175], [350, 178]].map(([a, b], i) => <g key={a}><ellipse cx={a} cy={b} rx="18" ry="5" fill={K.leaf} /><path d={`M${a - 8} ${b - 2}q8-14 16 0-8 4-16 0z`} fill={i === 1 ? K.rose : '#f7a3bf'} /></g>)}</g>],
  // ---- hubs
  5: [<><Sea y={96} /><Ship x={150} y={126} s={1} /><Crane x={290} y={152} s={0.9} /><Crane x={350} y={152} s={0.9} c={K.terra} /></>, <><path d="M0 164H400V178H0Z" fill={K.stoneD} />{[[40, K.terra], [74, K.turm], [108, K.green], [57, K.indigoL], [91, K.rose]].map(([a, c], i) => <rect key={i} x={a} y={i > 2 ? 142 : 154} width="32" height="12" fill={c} />)}</>],
  14: [<><Hill d="M0 140L60 126 120 140 200 118 280 142 360 124 400 136" c="#9fb0cf" /><path d="M0 112H400V120H0Z" fill={K.indigo} /><path d="M40 120V150M120 120V150M200 120V150M280 120V150M360 120V150" stroke={K.indigoL} strokeWidth="6" fill="none" /></>, <g><path d="M0 164H400V178H0Z" fill={K.stoneD} /><path d="M40 160V134q0-8 8-8h196q30 0 36 24V160Z" fill={K.indigoL} /><path d="M40 146H280" stroke={K.turm} strokeWidth="6" fill="none" />{[58, 90, 122, 154, 186, 218].map((a) => <rect key={a} x={a} y="134" width="20" height="14" fill="#a4dbef" />)}<path d="M262 136l18 0 14 14H262z" fill="#a4dbef" /><circle cx="70" cy="162" r="6" fill={K.ink} /><circle cx="250" cy="162" r="6" fill={K.ink} /><path d="M330 164V110M322 114h16" stroke={K.ink} strokeWidth="3" fill="none" /><circle cx="330" cy="104" r="5" fill={K.chilli} /></g>],
  23: [<><Hill d="M140 150Q180 112 230 140Q270 100 320 138T400 120" c="#7fa88a" /><path d="M300 112V80h20v-8h-30v8h6v32Z" fill={K.cream} /><rect x="296" y="72" width="28" height="8" fill="#7cc3d6" /></>, <g><path d="M0 168H400V184H0Z" fill="#6f6a7d" /><path d="M20 176H60M100 176H140M180 176H220M260 176H300M340 176H380" stroke={K.white} strokeWidth="3" fill="none" /><g transform="translate(120 150)"><path d="M-70 0Q-80-8-60-12H64Q84-10 90 4Q80 12 60 12H-62Q-70 12-70 0Z" fill={K.white} /><path d="M-70-2L-84-30H-68L-52-10Z" fill={K.turm} /><path d="M-10 0L-30 24H-6L14 0ZM-8-8L-30-30H-6L18-8Z" fill="#dfe6ee" />{[-36, -22, -8, 6, 20, 34, 48].map((a) => <circle key={a} cx={a} cy="-2" r="2.4" fill="#4a58b0" stroke="none" />)}</g></g>],
  // ---- corners
  0: [<><Sun x={200} y={96} r={44} c="#f7a35a" /><path d="M0 150H400V160H0Z" fill="#b99a6a" stroke="none" /></>, <g><path d="M92 176V84M308 176V84" stroke={K.terra} strokeWidth="16" fill="none" /><path d="M76 84Q200 6 324 84Z" fill={K.cream} /><path d="M92 84Q200 26 308 84" fill="none" stroke={K.indigo} strokeWidth="6" /><path d={`M92 100${Array.from({ length: 13 }, () => 'q8 18 16 0').join('')}`} fill="none" stroke={K.turm} strokeWidth="5" /><path d={`M92 112${Array.from({ length: 13 }, () => 'q8 14 16 0').join('')}`} fill="none" stroke={K.green} strokeWidth="3" /><path d="M196 36V22h16l-4 6 4 6h-16" fill={K.terra} /></g>],
  9: [<><path d="M0 110H60V70H100V110H140V84H180V110H400V160H0Z" fill="#8896bf" stroke="none" /><path d="M330 120V74" stroke={K.ink} strokeWidth="5" fill="none" /><rect x="320" y="52" width="20" height="40" rx="6" fill={K.night} /><circle cx="330" cy="62" r="5" fill={K.chilli} stroke="none" /><circle cx="330" cy="82" r="5" fill="#3b4a2a" stroke="none" /></>, <g><path d="M30 174V132H132V174Z" fill={K.terra} /><path d="M132 174V144H166V174Z" fill={K.turm} /><path d="M40 140H124" stroke={K.cream} strokeWidth="3" strokeDasharray="4 5" fill="none" /><circle cx="54" cy="176" r="9" fill={K.ink} /><circle cx="112" cy="176" r="9" fill={K.ink} /><circle cx="150" cy="176" r="8" fill={K.ink} /><path d="M188 176V148L204 132H238L252 148V176Z" fill={K.turm} /><path d="M196 146H244" stroke={K.green} strokeWidth="8" fill="none" /><circle cx="204" cy="178" r="7" fill={K.ink} /><circle cx="240" cy="178" r="7" fill={K.ink} /><path d="M270 176V138H340V176Z" fill={K.indigoL} /><rect x="278" y="146" width="48" height="12" fill="#a4dbef" /><circle cx="290" cy="178" r="7" fill={K.ink} /><circle cx="324" cy="178" r="7" fill={K.ink} /></g>],
  18: [<><Sun x={80} y={52} r={22} />{[[150, 40, K.rose, -12], [210, 70, K.turm, 10], [270, 36, K.green, -8], [330, 66, K.indigoL, 14], [190, 112, K.terra, 6], [300, 108, K.rose, -10]].map(([a, b, c, r], i) => <Kite key={a} x={a} y={b} c={c} c2={K.cream} r={r} s={0.9 + (i % 3) * 0.12} />)}</>, <g><Muggu x={150} y={172} /><path d="M276 176q-6-4-4-18h46q2 14-4 18Z" fill={K.terra} /><ellipse cx="295" cy="158" rx="23" ry="6" fill={K.cream} /><path d="M270 156V104M340 160V92M358 160V100" stroke="#6b8e23" strokeWidth="5" fill="none" /><path d="M252 156Q262 140 276 150" fill="none" stroke={K.green} strokeWidth="3" /></g>],
  27: [<><Hill d="M0 140Q100 120 200 136T400 124" c="#b3c98f" /><path d="M0 150H400" stroke={K.stoneD} strokeWidth="2" fill="none" /></>, <g><path d="M0 164H400V180H0Z" fill="#6f6a7d" /><path d="M20 172H80M120 172H180M220 172H280M320 172H380" stroke={K.white} strokeWidth="3" fill="none" /><path d="M214 164V112H286V164Z" fill={K.cream} /><path d="M202 112H298V100H202Z" fill={K.terra} /><rect x="226" y="124" width="46" height="22" fill="#7cc3d6" /><path d="M298 130H376" stroke={K.chilli} strokeWidth="6" fill="none" /><path d="M312 130V118M340 130V118M368 130V118" stroke={K.white} strokeWidth="5" fill="none" /><path d="M298 164V126" stroke={K.ink} strokeWidth="4" fill="none" /><path d="M40 164V126H130V164Z" fill={K.indigo} /><path d="M130 164V140H164V164Z" fill={K.turm} /><circle cx="60" cy="166" r="8" fill={K.ink} /><circle cx="112" cy="166" r="8" fill={K.ink} /></g>],
  32: [<><path d="M30 30H370" stroke={K.ink} strokeWidth="1.4" fill="none" />{Array.from({ length: 8 }, (_, i) => <path key={i} d={`M${40 + i * 44} 30l12 24 12-24z`} fill={CLOTH[i % 5]} />)}</>, <g><path d="M92 176V120H196V176Z" fill={K.terra} /><path d="M84 120H204V108H84Z" fill={K.turm} /><rect x="120" y="134" width="48" height="10" fill={K.cream} /><g transform="rotate(-24 150 108)"><rect x="128" y="92" width="38" height="14" rx="3" fill={K.wood} /><path d="M148 106V130" stroke={K.wood} strokeWidth="5" fill="none" /></g><path d="M236 176q-4-18 4-26h26q8 8 4 26z" fill={K.cream} /><path d="M290 176q-4-18 4-26h26q8 8 4 26z" fill={K.creamD} /><path d="M244 160h16M298 160h16" stroke={K.terra} strokeWidth="3" fill="none" /><Chilli x={346} y={174} s={1.2} r={10} /></g>],
  luck: [<><Sun x={200} y={96} r={60} c="#f6c27c" />{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <path key={i} d="M200 96V20" stroke={K.turm} strokeWidth="5" fill="none" transform={`rotate(${i * 45} 200 96)`} />)}</>, <g><circle cx="200" cy="108" r="40" fill={K.turm} /><circle cx="200" cy="108" r="30" fill="none" stroke={K.turmD} strokeWidth="3" /><path d="M200 86V130M188 96h24M186 112h28" stroke={K.terraD} strokeWidth="4" fill="none" /><path d="M120 176Q160 140 200 176" fill={K.leaf} /><path d="M280 176Q240 140 200 176" fill={K.green} /><Diya x={140} y={170} s={1.5} /><Diya x={260} y={170} s={1.5} /><path d="M186 160q14-16 28 0-14 10-28 0z" fill={K.turm} /></g>],
  drama: [<><Hill d="M0 140Q100 128 200 138T400 134" c="#9ccf86" /><Tree x={200} y={154} s={2.2} c={K.greenD} /><path d="M196 154V118" stroke={K.wood} strokeWidth="8" fill="none" /></>, <g><path d="M120 176V160H280V176M130 160V150H270V160" fill={K.wood} /><Figure x={150} y={150} c={K.rose} s={1.1} /><Figure x={190} y={150} c={K.indigoL} s={1.1} /><Figure x={236} y={150} c={K.terra} s={1.1} /><path d="M134 96h40q6 0 6 6v10q0 6-6 6h-26l-8 8v-8h-6q-6 0-6-6v-10q0-6 6-6z" fill={K.white} /><path d="M150 106h22M150 112h14" stroke={K.stone} strokeWidth="2" fill="none" /><path d="M230 90h38q6 0 6 6v10q0 6-6 6h-8v8l-10-8h-20q-6 0-6-6V96q0-6 6-6z" fill={K.cream} /><path d="M240 99h24M240 105h14" stroke={K.stone} strokeWidth="2" fill="none" /><path d="M310 176q-3-12 3-16h14q6 4 3 16z" fill={K.cream} /><path d="M332 164q8 0 0 8" fill="none" /></g>],
};

/** Per-tile scene setup: sky colours, sun, ground colour, background key and the business (properties). */
const WARM = ['#fbd9a0', '#fff0cf'];
const DAY = ['#8cd1ee', '#e9f6f3'];
const DUSK = ['#f4a56e', '#fbd9a0'];
const NIGHT = ['#3a3f93', '#d89a8a'];
const GRASS = '#cfe0a0';
const SAND = '#efd9a3';
const EARTH = '#d9a977';
const SLATE = '#a8adbd';

const prop = (kind, sign) => ({ kind, sign });
export const SCENES = {
  1: { sky: DAY, sun: [330, 40], g: SAND, shop: prop('cloth', 'HANDLOOMS') },
  3: { sky: WARM, sun: [336, 40], g: GRASS, shop: prop('sacks', 'CATTLE FEED') },
  4: { sky: DAY, sun: [340, 40], g: GRASS, shop: prop('crates', 'RICE & PRAWN') },
  6: { sky: WARM, sun: [350, 36], g: EARTH, shop: prop('toys', 'BOMMALU') },
  7: { sky: DAY, sun: [60, 40], g: SAND, shop: prop('cloth', 'KALAMKARI') },
  8: { sky: WARM, sun: [350, 40], g: EARTH, shop: prop('cloth', 'SAREES') },
  10: { sky: DAY, sun: [60, 40], g: GRASS, shop: prop('coconuts', 'COCONUT') },
  11: { sky: DAY, sun: [80, 44], g: SAND, shop: prop('crates', 'EXPORTS') },
  13: { sky: DUSK, sun: null, g: GRASS, shop: prop('sacks', 'RICE MILL') },
  15: { sky: WARM, sun: null, g: GRASS, shop: prop('sacks', 'CASHEW') },
  16: { sky: WARM, sun: [90, 40], g: EARTH, shop: prop('veena', 'VEENA SHOP') },
  17: { sky: DAY, sun: [70, 36], g: SLATE, shop: prop('crates', 'PORT TRADE') },
  19: { sky: ['#a9c2ec', '#f3f0dc'], sun: [76, 40], g: GRASS, shop: prop('cups', 'COFFEE') },
  20: { sky: DUSK, sun: null, g: EARTH, shop: prop('toys', 'HANDICRAFTS') },
  22: { sky: WARM, sun: [90, 40], g: EARTH, shop: prop('cups', 'HOMESTAY') },
  24: { sky: WARM, sun: [340, 40], g: EARTH, shop: prop('slabs', 'STONE') },
  25: { sky: DAY, sun: [60, 40], g: '#dcc58b', shop: prop('nuts', 'OIL MILL') },
  26: { sky: WARM, sun: [90, 40], g: EARTH, shop: prop('sacks', 'AGRO PARK') },
  28: { sky: DUSK, sun: [80, 52], g: GRASS, shop: prop('lamps', 'POOJA SHOP') },
  29: { sky: DAY, sun: [76, 40], g: GRASS, shop: prop('cups', 'GUESTHOUSE') },
  31: { sky: WARM, sun: [90, 38], g: GRASS, shop: prop('laddu', 'SWEETS') },
  33: { sky: WARM, sun: [90, 40], g: EARTH, shop: prop('chilli', 'MIRCHI') },
  34: { sky: DUSK, sun: [84, 48], g: SAND, shop: prop('tech', 'BUSINESS') },
  35: { sky: NIGHT, sun: null, g: '#b6c7a0', shop: prop('tech', 'CAPITAL') },
  5: { sky: DAY, sun: [70, 36], g: SLATE, acc: K.indigo },
  14: { sky: WARM, sun: [340, 36], g: SLATE, acc: K.indigo },
  23: { sky: DAY, sun: [70, 36], g: '#9fb89a', acc: K.sea },
  0: { sky: DUSK, sun: null, g: SAND, acc: K.terra },
  9: { sky: WARM, sun: [340, 40], g: SLATE, acc: K.terra },
  18: { sky: DAY, sun: null, g: SAND, acc: K.rose },
  27: { sky: DAY, sun: [70, 40], g: SLATE, acc: K.indigo },
  32: { sky: WARM, sun: null, g: SAND, acc: K.turmD },
  luck: { sky: NIGHT, sun: null, g: SAND, acc: K.turm },
  drama: { sky: WARM, sun: [340, 40], g: GRASS, acc: K.rose },
};

const GENERIC = { sky: DAY, sun: [330, 40], g: SAND, acc: K.indigo };
const GENERIC_BG = [<Sea />, <><Palm x={352} y={168} s={1.1} /><Palm x={380} y={172} s={0.8} /></>];
export const SCENE_IDS = Object.freeze(Object.keys(SCENES));

/** The scene key for a tile: its id, or the deck for card squares. */
export function sceneKey(tile) {
  if (!tile) return null;
  if (tile.type === 'card') return tile.deck === 'drama' ? 'drama' : 'luck';
  return SCENES[tile.id] ? tile.id : null;
}

function AndhraSceneBase({ tile: value, level = 0, className = '', animated = true, compact = false, title }) {
  const tile = value && typeof value === 'object' ? value : TILES.find((t) => t.id === Number(value));
  const key = sceneKey(tile);
  const def = (key != null && SCENES[key]) || GENERIC;
  const [far, near] = (key != null && BG[key]) || GENERIC_BG;
  const lv = Math.max(0, Math.min(2, Number(level) || 0));
  const accent = GROUPS[tile?.group]?.color || def.acc || ACCENTS[collectionOf(tile?.id)] || K.terra;
  const isProp = tile?.type === 'property' && def.shop;
  const label = title === true ? tile?.name || 'Andhra scene' : title || undefined;
  const [sky0, sky1] = def.sky;
  return (
    <svg viewBox="0 0 400 220" className={`location-scene ls-andhra${animated ? ' is-animated' : ''}${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`} data-map="andhra" data-location={tile?.id ?? 'unknown'} data-setting={key ?? 'generic'} data-level={lv} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      {label ? <title>{label}</title> : null}
      <g stroke={K.ink} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round">
        <rect width="400" height="220" fill={sky0} stroke="none" />
        <rect y="86" width="400" height="74" fill={sky1} opacity=".6" stroke="none" />
        {def.sun ? <circle cx={def.sun[0]} cy={def.sun[1]} r="17" fill={K.turm} stroke="none" opacity=".9" /> : null}
        <Cloud x={150} y={30} s={1} />
        {far}
        <path d="M0 158Q100 150 200 156T400 152V220H0Z" fill={def.g} />
        <path d="M0 186Q200 178 400 184V220H0Z" fill={K.stoneD} opacity=".55" stroke="none" />
        {near}
        {isProp ? <Shop prop={def.shop.kind} sign={def.shop.sign} color={accent} level={lv} /> : null}
        {isProp && !compact ? <Figure x={236} y={186} c={accent} /> : null}
        <Border c={accent} />
      </g>
    </svg>
  );
}

export const AndhraScene = memo(AndhraSceneBase);
export default AndhraScene;
