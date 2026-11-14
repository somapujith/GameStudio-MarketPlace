// Hyderabad Hustle businesses: five themes x three levels (0-2), drawn with the iso toolkit in the same
// 160x160 diorama frame as the classic BuildingArt (origin = slab centre, footprint about -32..32).
// `c` is the accent (usually the group colour); every theme also has its own material palette.
import { PAL, tone, lighten, darken } from './palette.js';
import { Box, Pad, Cyl, Cone, Dome, Face, Gable, Disc, Shade, Tree, Bush, Palm, Windows, archPath, pt } from './iso.jsx';

export const THEMES = ['bazaar', 'food', 'transit', 'venue', 'tech'];
export const THEME_LEVEL_NAMES = {
  bazaar: ['Stall', 'Shop', 'Trading Hub'],
  food: ['Irani Cafe', 'Biryani House', 'Food Franchise'],
  transit: ['Kiosk', 'Showroom', 'Transit Mall'],
  venue: ['Snack Kiosk', 'Boathouse Cafe', 'Resort'],
  tech: ['Startup Office', 'Business Centre', 'Tech Campus'],
};
export const THEME_ACCENT = { bazaar: '#c98b4a', food: '#e2725b', transit: '#3fb68b', venue: '#3aa7e0', tech: '#4f7cff' };

const SAND = '#ecd3a4';
const SAND_T = { top: '#f7e6c4', left: '#ecd3a4', right: '#c79f66' };
const CREAM_T = { top: '#fffaf0', left: '#fff0d2', right: '#dcc39a' };
const WOOD = '#a8673a';
const GLASS_T = { top: '#d9f4fd', left: '#79d3ea', right: '#3f8fc4' };
const INK = '#2e2475';

/** Striped awning hanging off a Face L / R plane (local coords, y up). */
function Awning({ u, v, w, h = 5, c, n }) {
  const k = n || Math.max(3, Math.round(w / 4));
  const sw = w / k;
  const stripes = [];
  for (let i = 0; i < k; i++) stripes.push(<rect key={i} x={u + i * sw} y={v} width={sw} height={h} fill={i % 2 ? '#fff7e6' : c} />);
  let scallop = `M${u} ${v}`;
  for (let i = 0; i < k; i++) scallop += `A${sw / 2} ${sw / 2.4} 0 0 1 ${u + (i + 1) * sw} ${v}`;
  return (
    <g>
      {stripes}
      <path d={scallop + 'Z'} fill={darken(c, 0.15)} />
      <rect x={u} y={v + h - 1} width={w} height={1} fill={darken(c, 0.25)} />
    </g>
  );
}

function Crate({ x, y, z = 0, s = 6, c = '#d39a5a' }) {
  return <Box x={x} y={y} z={z} w={s} d={s} h={s * 0.8} c={c} />;
}

function Heap({ x, y, z, cols }) {
  const [cx, cy] = pt(x, y, z);
  return (
    <g>
      {cols.map((col, i) => (
        <circle key={i} cx={cx - 4 + (i % 3) * 4} cy={cy - 1.6 - Math.floor(i / 3) * 2.6} r="2" fill={col} stroke={darken(col, 0.3)} strokeWidth=".5" />
      ))}
    </g>
  );
}

function Bunting({ a, b, sag = 4, cols = [PAL.rose, PAL.gold, PAL.teal, PAL.saffron] }) {
  const [x1, y1] = a, [x2, y2] = b;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + sag;
  const flags = [];
  const n = 6;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * mx + t * t * x2;
    const y = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * my + t * t * y2;
    flags.push(<path key={i} d={`M${x - 1.6} ${y}H${x + 1.6}L${x} ${y + 3.4}Z`} fill={cols[i % cols.length]} />);
  }
  return (
    <g>
      <path d={`M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}`} fill="none" stroke="#5a4a8a" strokeWidth=".6" />
      {flags}
    </g>
  );
}

function StringLights({ a, b, sag = 4 }) {
  const [x1, y1] = a, [x2, y2] = b;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + sag;
  const dots = [];
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    const x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * mx + t * t * x2;
    const y = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * my + t * t * y2;
    dots.push(<circle key={i} cx={x} cy={y + 0.6} r="1.1" fill={i % 2 ? '#ffd36e' : '#ffb86a'} />);
  }
  return (
    <g>
      <path d={`M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}`} fill="none" stroke="#4a3f8f" strokeWidth=".5" />
      {dots}
    </g>
  );
}

function Post({ x, y, z = 0, h, c = WOOD }) {
  return <Box x={x - 0.8} y={y - 0.8} z={z} w={1.6} d={1.6} h={h} c={c} />;
}

function Umbrella({ x, y, z = 0, c, h = 13, r = 7 }) {
  return (
    <g>
      <Shade x={x} y={y} z={z} rx={9} o={0.14} />
      <Cyl x={x} y={y} z={z} r={2.6} h={0.8} c="#fff7e6" />
      <Cyl x={x} y={y} z={z} r={0.5} h={h} c="#e8e0ff" />
      <Cone x={x} y={y} z={z + h - 2} r={r} h={5} c={c} />
    </g>
  );
}

function Stool({ x, y, c = '#e8e0ff' }) {
  return <Cyl x={x} y={y} r={1.6} h={3.4} c={c} />;
}

function Water({ x, y, w, d, z = 0 }) {
  return (
    <g>
      <Pad x={x} y={y} z={z} w={w} d={d} c="#2a98c2" r={3} />
      <Pad x={x + 1} y={y + 1} z={z} w={w - 2} d={d - 2} c="#45c3e6" r={3} />
      <Face p="T" at={z}>
        <path d={`M${x + 4} ${y + d * 0.4}h6M${x + w * 0.5} ${y + d * 0.7}h5M${x + w * 0.3} ${y + d * 0.2}h4`} stroke="#c8f3ff" strokeWidth="1" strokeLinecap="round" opacity=".8" />
      </Face>
    </g>
  );
}

export function Car({ x, y, c = PAL.rose }) {
  return (
    <g>
      <Box x={x} y={y} w={10} d={5} h={3.4} c={c} />
      <Box x={x + 2} y={y + 0.4} z={3.4} w={5.6} d={4.2} h={2.6} c="#ffe1e6" />
      <Cyl x={x + 2.4} y={y + 5} r={1.4} h={1.2} c="#2b2260" />
      <Cyl x={x + 7.6} y={y + 5} r={1.4} h={1.2} c="#2b2260" />
    </g>
  );
}

/** Tiny auto-rickshaw seen from the iso camera, nose toward +x. */
export function MiniAuto({ x, y, c = "#ffd23f" }) {
  return (
    <g>
      <Shade x={x + 5} y={y + 2.5} rx={9} o={0.16} />
      <Box x={x} y={y} z={1} w={10} d={5} h={3.6} c={c} />
      <Box x={x + 1} y={y} z={4.6} w={6} d={5} h={3.6} c="#2b2260" t={{ top: '#3d3480', left: '#4a3f8f', right: '#2b2260' }} />
      <Box x={x + 0.6} y={y - 0.2} z={8.2} w={7.4} d={5.4} h={1} c="#2b2260" />
      <Cyl x={x + 2} y={y + 5} r={1.3} h={1} c="#1b1340" />
      <Cyl x={x + 9} y={y + 2.5} r={1.3} h={1} c="#1b1340" />
    </g>
  );
}

/* ============================== BAZAAR ============================== */
function Stall({ c }) {
  return (
    <g>
      <Shade x={2} y={4} rx={34} o={0.14} />
      <Pad x={-26} y={-22} w={52} d={46} c="#d9bd8a" r={4} />
      <Crate x={-22} y={10} />
      <Crate x={-22} y={10} z={4.8} s={5} c="#c08548" />
      {/* posts */}
      <Post x={-12} y={-10} h={22} />
      <Post x={12} y={-10} h={22} />
      {/* counter */}
      <Box x={-14} y={-6} w={28} d={14} h={9} c={WOOD} t={{ top: '#d39a5a', left: '#b8733a', right: '#8a4f26' }} />
      <Face p="L" at={8}>
        <rect x={-12} y={2} width={24} height={4.6} rx="1" fill={lighten(c, 0.15)} />
        <path d="M-10 4.3h20" stroke="#fff7e6" strokeWidth=".8" strokeDasharray="2 2" />
      </Face>
      <Heap x={-6} y={-1} z={9} cols={['#ff8a3d', '#ffb100', '#ff5d73', '#ff8a3d', '#8de05a']} />
      <Heap x={6} y={-1} z={9} cols={['#8de05a', '#6fcf7a', '#ffd34e', '#3fa862', '#ffd34e']} />
      <Post x={-12} y={7} h={22} />
      <Post x={12} y={7} h={22} />
      {/* canopy: striped gable */}
      <Gable x={-16} y={-13} z={22} w={32} d={24} h={6} c={c} axis="x" />
      <Face p="L" at={11}>
        <Awning u={-16} v={18.4} w={32} h={3.6} c={c} n={8} />
      </Face>
      {/* sack + pot */}
      <Cyl x={20} y={6} r={4} h={6} c="#e8d3a0" />
      <Dome x={20} y={6} z={6} r={4} h={2.4} c="#e8d3a0" />
      <Cyl x={16} y={16} r={3} h={4} c="#c0603a" />
      <Bush x={-26} y={-12} s={0.8} />
    </g>
  );
}

function Shop({ c }) {
  return (
    <g>
      <Shade x={2} y={4} rx={44} o={0.16} />
      <Pad x={-30} y={-30} w={60} d={60} c="#d9bd8a" r={5} />
      <Pad x={-28} y={14} w={56} d={14} c="#e8d3a6" r={2} />
      <Box x={-20} y={-20} w={40} d={32} h={26} t={SAND_T} />
      {/* parapet */}
      <Box x={-21} y={-21} z={26} w={42} d={34} h={2} c={darken(SAND, 0.12)} />
      <Box x={-18} y={-18} z={28} w={10} d={10} h={4} t={SAND_T} />
      <Face p="L" at={12}>
        {/* open shutter with shelves */}
        <rect x={-16} y={0} width={20} height={14} fill="#5a3a2a" />
        {[3, 7, 11].map((v) => <rect key={v} x={-15} y={v} width={18} height={1.2} fill="#c08548" />)}
        {[-14, -10, -6, -2, 1].map((u, i) => <rect key={u} x={u} y={3.8} width={2.4} height={2.6} fill={[PAL.rose, PAL.gold, PAL.teal, PAL.saffron, PAL.lime][i]} />)}
        {[-13, -8, -3].map((u, i) => <rect key={u} x={u} y={7.8} width={3.6} height={2.6} fill={[PAL.sky, PAL.gold, PAL.rose][i]} />)}
        <rect x={-16} y={14} width={20} height={1.4} fill="#8d93c4" />
        <path d={archPath(8, 0, 8, 13)} fill={darken(c, 0.25)} />
        <rect x={-18} y={20.4} width={36} height={4.4} rx=".8" fill={c} />
        <path d="M-15 22.6h10M2 22.6h12" stroke="#fff7e6" strokeWidth="1.1" strokeLinecap="round" />
      </Face>
      <Face p="L" at={12}>
        <Awning u={-18} v={15} w={24} h={4.6} c={c} n={6} />
      </Face>
      <Face p="R" at={20}>
        <Windows u={-14} v={10} cols={3} rows={1} du={9} w={5} h={7} c="#79d3ea" />
      </Face>
      {/* front goods */}
      <Crate x={-14} y={16} s={6} c="#d39a5a" />
      <Heap x={-11} y={19} z={4.8} cols={['#ff8a3d', '#ffb100', '#ff5d73', '#ff8a3d']} />
      <Cyl x={2} y={20} r={3} h={5} c="#e8d3a0" />
      <Cyl x={8} y={20} r={3} h={4} c="#d7b98a" />
      <Tree x={24} y={22} s={0.9} />
    </g>
  );
}

function TradingHub({ c }) {
  const jharokha = (u, v) => (
    <g>
      <rect x={u - 0.8} y={v - 1} width={7.6} height={1.4} fill={darken(SAND, 0.2)} />
      <path d={archPath(u, v, 6, 8)} fill={INK} />
      <path d={archPath(u + 1, v, 4, 6)} fill="#ffd36e" opacity=".85" />
    </g>
  );
  return (
    <g>
      <Shade x={2} y={4} rx={54} o={0.16} />
      <Pad x={-34} y={-34} w={68} d={68} c="#d9bd8a" r={5} />
      {/* back wing */}
      <Box x={-30} y={-30} w={26} d={26} h={40} t={SAND_T} />
      <Face p="L" at={-4}>{[-27, -19, -11].map((u) => <g key={u}>{jharokha(u, 14)}{jharokha(u, 28)}</g>)}</Face>
      <Box x={-31} y={-31} z={40} w={28} d={28} h={2} c={darken(SAND, 0.14)} />
      <Box x={-22} y={-22} z={42} w={10} d={10} h={4} t={SAND_T} />
      <Dome x={-17} y={-17} z={46} r={5} h={7} c="#fff7e6" />
      <Cone x={-17} y={-17} z={52.6} r={0.6} h={4} c={PAL.gold} />
      {/* main hall */}
      <Box x={-24} y={-4} w={48} d={22} h={28} t={SAND_T} />
      <Face p="L" at={18}>
        {[-22, -10, 2, 14].map((u, i) => (
          <g key={u}>
            <rect x={u} y={0} width={8} height={11} fill="#5a3a2a" />
            {[3, 7].map((v) => <rect key={v} x={u + 0.6} y={v} width={6.8} height={1} fill="#c08548" />)}
            <rect x={u + 1} y={4} width={2} height={2.4} fill={[PAL.rose, PAL.gold, PAL.teal, PAL.saffron][i]} />
            <rect x={u + 4.4} y={4} width={2.4} height={2.4} fill={[PAL.sky, PAL.rose, PAL.gold, PAL.lime][i]} />
          </g>
        ))}
        {[-20, -8, 4, 16].map((u) => <g key={u}>{jharokha(u - 0.4, 16)}</g>)}
        <rect x={-24} y={25} width={48} height={1.6} fill={darken(c, 0.1)} />
      </Face>
      <Face p="L" at={18}>
        <Awning u={-23} v={11.6} w={11} h={4.2} c={c} n={3} />
        <Awning u={-11} v={11.6} w={11} h={4.2} c={PAL.teal} n={3} />
        <Awning u={1} v={11.6} w={11} h={4.2} c={PAL.rose} n={3} />
        <Awning u={13} v={11.6} w={10} h={4.2} c={c} n={3} />
      </Face>
      <Face p="R" at={24}>
        <path d={archPath(-1, 0, 10, 15)} fill={INK} />
        <path d={archPath(1, 0, 6, 12)} fill={lighten(c, 0.2)} />
        {jharokha(-3, 18)}{jharokha(9, 18)}
      </Face>
      <Box x={-25} y={-5} z={28} w={50} d={24} h={2} c={darken(SAND, 0.12)} />
      {/* rooftop sign */}
      <Box x={-12} y={6} z={30} w={24} d={2} h={8} c={c} />
      <Face p="L" at={8}>
        <path d="M-9 34.4h7M1 34.4h8" stroke="#fff7e6" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx={-0.5} cy={34.4} r="1.6" fill={PAL.gold} />
      </Face>
      <Bunting a={pt(24, -4, 30)} b={pt(24, 18, 22)} sag={3} />
      {/* crates, sacks */}
      <Crate x={-26} y={22} />
      <Crate x={-20} y={24} s={5} c="#c08548" />
      <Crate x={-26} y={22} z={4.8} s={5} c="#e0a868" />
      <Cyl x={14} y={26} r={3} h={5} c="#e8d3a0" />
      <Cyl x={20} y={24} r={3} h={4.6} c="#d7b98a" />
      <MiniAuto x={0} y={24} c={c} />
      <Tree x={28} y={-22} s={0.9} />
    </g>
  );
}

/* ============================== FOOD ============================== */
function IraniCafe({ c }) {
  return (
    <g>
      <Shade x={2} y={4} rx={40} o={0.16} />
      <Pad x={-28} y={-28} w={56} d={56} c="#d6cdf0" r={5} />
      <Pad x={-26} y={10} w={52} d={16} c="#efe6ff" r={2} />
      <Box x={-18} y={-18} w={34} d={28} h={20} t={CREAM_T} />
      <Box x={-19} y={-19} z={20} w={36} d={30} h={3} c={c} />
      <Face p="L" at={10}>
        {/* arched glass windows + door, Irani-cafe style tinted panes */}
        {[-16, -8].map((u) => (
          <g key={u}>
            <path d={archPath(u, 3, 6, 11)} fill="#2e7f8f" />
            <path d={archPath(u + 0.8, 3.6, 4.4, 9.4)} fill="#8fe3e0" opacity=".85" />
            <rect x={u + 2.6} y={3.6} width=".8" height="8" fill="#fff7e6" opacity=".6" />
          </g>
        ))}
        <path d={archPath(2, 0, 7, 14)} fill={darken(c, 0.3)} />
        <rect x={10.5} y={3} width={4} height={10} rx="1" fill="#8fe3e0" />
        <rect x={-17} y={15.6} width={33} height={2} fill="#2e7f8f" />
      </Face>
      <Face p="R" at={16}>
        <path d={archPath(-12, 3, 6, 11)} fill="#2e7f8f" />
        <path d={archPath(-3, 3, 6, 11)} fill="#2e7f8f" />
      </Face>
      {/* round sign with a chai glass */}
      <Cyl x={16} y={4} z={12} r={0.6} h={4} c="#8d93c4" />
      <Face p="L" at={6}>
        <circle cx={18} cy={19} r="4.4" fill="#fff7e6" stroke={c} strokeWidth="1.2" />
        <path d="M16.2 21.4H19.8L19.4 16.8H16.6Z" fill="#c97a35" />
      </Face>
      {/* tables + stools */}
      <Cyl x={-12} y={18} r={3.6} h={5} c="#fff" t={{ top: '#ffffff', left: '#e8e0ff', right: '#b9b0e0' }} />
      <Stool x={-17} y={18} /><Stool x={-12} y={23} />
      <Cyl x={4} y={18} r={3.6} h={5} c="#fff" t={{ top: '#ffffff', left: '#e8e0ff', right: '#b9b0e0' }} />
      <Stool x={9} y={18} /><Stool x={4} y={23} />
      <Tree x={22} y={-14} s={0.9} />
    </g>
  );
}

function BiryaniHouse({ c }) {
  const copper = '#c8783e';
  return (
    <g>
      <Shade x={2} y={4} rx={46} o={0.16} />
      <Pad x={-30} y={-30} w={60} d={60} c="#d6cdf0" r={5} />
      <Box x={-20} y={-20} w={40} d={34} h={22} c={c} t={tone(lighten(c, 0.15))} />
      <Box x={-21} y={-21} z={22} w={42} d={36} h={2} c="#fff0d2" />
      <Box x={-18} y={-18} z={24} w={36} d={30} h={16} t={CREAM_T} />
      <Box x={-19} y={-19} z={40} w={38} d={32} h={2} c={darken(c, 0.12)} />
      <Face p="L" at={14}>
        {[-17, -7, 3].map((u) => (
          <g key={u}>
            <path d={archPath(u, 2, 7, 13)} fill={INK} />
            <path d={archPath(u + 1.2, 2, 4.6, 10.6)} fill="#ffd36e" opacity=".9" />
          </g>
        ))}
        <rect x={12} y={0} width={6} height={14} fill={darken(c, 0.35)} />
        {[-14, -4, 6].map((u) => <path key={u} d={archPath(u - 1, 27, 6, 9)} fill="#79d3ea" />)}
        <Awning u={-19} v={16} w={38} h={4} c={'#fff0d2'} n={9} />
      </Face>
      <Face p="R" at={20}>
        {[-14, -4, 6].map((u) => <path key={u} d={archPath(u, 27, 6, 9)} fill="#79d3ea" />)}
        <Windows u={-14} v={4} cols={3} rows={1} du={10} w={6} h={8} c={INK} lit="#ffd36e" litEvery={1} />
      </Face>
      {/* big handi on the roof */}
      <Cyl x={0} y={-2} z={42} r={9} h={6} c={copper} />
      <Dome x={0} y={-2} z={48} r={9} h={5} c={lighten(copper, 0.2)} />
      <Disc x={0} y={-2} z={48} r={9.4} c="none" stroke="#fff1cf" sw={1.2} />
      <Cyl x={0} y={-2} z={52} r={1.2} h={2} c={PAL.gold} />
      {(() => {
        const [cx, cy] = pt(0, -2, 56);
        return (
          <g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".85">
            <path d={`M${cx - 4} ${cy}c-3 -4 3 -6 0 -10`} />
            <path d={`M${cx + 4} ${cy}c-3 -4 3 -6 0 -10`} />
          </g>
        );
      })()}
      <Umbrella x={-14} y={22} c={c} />
      <Stool x={-19} y={22} /><Stool x={-9} y={24} />
      <Bush x={14} y={22} />
      <Tree x={26} y={6} s={0.9} />
    </g>
  );
}

function FoodCourt({ c }) {
  const stalls = [[-30, -30, PAL.rose], [-10, -30, PAL.gold], [10, -30, PAL.teal]];
  return (
    <g>
      <Shade x={2} y={4} rx={56} o={0.16} />
      <Pad x={-34} y={-34} w={68} d={68} c="#d6cdf0" r={5} />
      {/* back row of stall counters */}
      {stalls.map(([x, y, col]) => (
        <g key={x}>
          <Box x={x} y={y} w={18} d={14} h={14} t={CREAM_T} />
          <Face p="L" at={y + 14}>
            <rect x={x + 2} y={3} width={14} height={7} fill={INK} />
            <rect x={x + 3} y={4} width={12} height={5} fill="#ffd36e" opacity=".75" />
          </Face>
          <Box x={x - 1} y={y - 1} z={14} w={20} d={16} h={3} c={col} />
          <Face p="L" at={y + 15}><Awning u={x - 1} v={10} w={20} h={4} c={col} n={5} /></Face>
        </g>
      ))}
      {/* franchise tower with logo */}
      <Box x={14} y={-14} w={18} d={22} h={38} c={c} t={tone(c)} />
      <Face p="L" at={8}>
        <Windows u={16} v={6} cols={2} rows={3} du={7} dv={9} w={5} h={6} c="#79d3ea" lit="#ffd36e" litEvery={2} />
      </Face>
      <Face p="R" at={32}>
        <Windows u={-12} v={6} cols={3} rows={3} du={7} dv={9} w={4.6} h={6} c="#3f8fc4" lit="#ffd36e" litEvery={3} />
      </Face>
      <Box x={13} y={-15} z={38} w={20} d={24} h={2} c="#fff0d2" />
      {(() => {
        const [cx, cy] = pt(23, -3, 48);
        return (
          <g>
            <rect x={cx - 1} y={cy + 2} width="2" height="6" fill="#8d93c4" />
            <circle cx={cx} cy={cy} r="8" fill="#fff7e6" stroke={darken(c, 0.2)} strokeWidth="1.4" />
            <path d={`M${cx - 5} ${cy - 1}Q${cx} ${cy + 7} ${cx + 5} ${cy - 1}Z`} fill="#c8783e" />
            <path d={`M${cx - 5.6} ${cy - 1.2}H${cx + 5.6}`} stroke="#e0a64a" strokeWidth="1.4" strokeLinecap="round" />
            <path d={`M${cx - 2} ${cy - 3}c-1.6 -2 1.6 -3 0 -5M${cx + 2} ${cy - 3}c-1.6 -2 1.6 -3 0 -5`} fill="none" stroke={darken(c, 0.2)} strokeWidth="1" strokeLinecap="round" />
          </g>
        );
      })()}
      {/* seating plaza */}
      <Umbrella x={-20} y={6} c={PAL.rose} />
      <Umbrella x={-4} y={12} c={PAL.gold} />
      <Umbrella x={-22} y={24} c={c} />
      <Umbrella x={-4} y={28} c={PAL.teal} />
      <StringLights a={pt(-32, -15, 18)} b={pt(14, -15, 30)} sag={3} />
      <Car x={14} y={22} c={PAL.sky} />
      <Bush x={30} y={14} />
    </g>
  );
}

/* ============================== TRANSIT ============================== */
function Kiosk({ c }) {
  return (
    <g>
      <Shade x={2} y={4} rx={36} o={0.14} />
      <Pad x={-26} y={-26} w={52} d={52} c="#c9c3e0" r={4} />
      {/* road strip with zebra */}
      <Pad x={-26} y={14} w={52} d={12} c="#5c5a7a" r={2} />
      <Face p="T" at={0}>{[-20, -12, -4, 4, 12].map((x) => <rect key={x} x={x} y={18.5} width={4} height={3} fill="#fff7e6" opacity=".85" />)}</Face>
      {/* booth */}
      <Box x={-18} y={-14} w={16} d={14} h={18} t={CREAM_T} />
      <Face p="L" at={0}>
        <rect x={-16} y={7} width={12} height={7} fill="#79d3ea" />
        <rect x={-16} y={6} width={12} height={1.6} fill={c} />
        <rect x={-17} y={4} width={14} height={2} fill="#8d93c4" />
      </Face>
      <Box x={-20} y={-16} z={18} w={20} d={18} h={2.4} c={c} />
      {/* bus-stop shelter */}
      <Post x={4} y={-8} h={16} c="#8d93c4" />
      <Post x={18} y={-8} h={16} c="#8d93c4" />
      <Box x={4} y={-10} w={14} d={1.4} h={12} c="#bfe9f5" t={{ top: '#e6f8ff', left: '#bfe9f5', right: '#8fcde3' }} />
      <Box x={6} y={-6} w={10} d={3} h={3} c="#e8e0ff" />
      <Post x={4} y={6} h={16} c="#8d93c4" />
      <Post x={18} y={6} h={16} c="#8d93c4" />
      <Box x={2} y={-10} z={16} w={18} d={18} h={1.6} c={c} />
      {/* signpost */}
      <Post x={-22} y={8} h={16} c="#8d93c4" />
      {(() => {
        const [cx, cy] = pt(-22, 8, 16);
        return <g><circle cx={cx} cy={cy - 3} r="4" fill={c} stroke="#fff" strokeWidth="1" /><path d={`M${cx - 2} ${cy - 3}h4`} stroke="#fff" strokeWidth="1.2" /></g>;
      })()}
      <MiniAuto x={2} y={16} c={PAL.gold} />
    </g>
  );
}

function Showroom({ c }) {
  return (
    <g>
      <Shade x={2} y={4} rx={46} o={0.16} />
      <Pad x={-30} y={-30} w={60} d={60} c="#c9c3e0" r={5} />
      <Box x={-24} y={-22} w={44} d={34} h={6} t={CREAM_T} />
      <Box x={-24} y={-22} z={6} w={44} d={34} h={16} c="#79d3ea" t={GLASS_T} />
      <Face p="L" at={12}>
        {[-18, -8, 2, 12].map((u) => <rect key={u} x={u} y={6} width=".9" height={16} fill="#2e6d9a" opacity=".6" />)}
        <polygon points="-22,22 -14,22 -22,10" fill="#fff" opacity=".35" />
      </Face>
      <Face p="R" at={20}>
        {[-14, -4, 6].map((u) => <rect key={u} x={u} y={6} width=".9" height={16} fill="#1f4f8c" opacity=".5" />)}
      </Face>
      <Box x={-26} y={-24} z={22} w={48} d={38} h={3} c={c} />
      {/* big sign */}
      <Box x={-14} y={8} z={25} w={26} d={2} h={8} c="#fff7e6" />
      <Face p="L" at={10}>
        <rect x={-12} y={27} width={8} height={4} rx="1" fill={c} />
        <path d="M-2 29h12" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      </Face>
      {/* the display auto + a car out front */}
      <MiniAuto x={-12} y={16} c={c} />
      <Car x={4} y={18} c={PAL.rose} />
      {/* flag poles */}
      <Post x={24} y={18} h={22} c="#c8c0e6" />
      {(() => { const [x, y] = pt(24, 18, 22); return <path d={`M${x} ${y}h7l-2 2.4 2 2.4h-7z`} fill={c} />; })()}
      <Post x={26} y={-14} h={22} c="#c8c0e6" />
      {(() => { const [x, y] = pt(26, -14, 22); return <path d={`M${x} ${y}h7l-2 2.4 2 2.4h-7z`} fill={PAL.gold} />; })()}
      <Bush x={-28} y={18} />
    </g>
  );
}

function TransitMall({ c }) {
  const pillars = [-30, -10, 10, 30];
  return (
    <g>
      <Shade x={2} y={4} rx={56} o={0.16} />
      <Pad x={-34} y={-34} w={68} d={68} c="#c9c3e0" r={5} />
      {/* mall block */}
      <Box x={-28} y={-28} w={40} d={30} h={30} t={CREAM_T} />
      <Box x={-28} y={-28} z={30} w={40} d={30} h={2} c={c} />
      <Face p="L" at={2}>
        <rect x={-26} y={0} width={36} height={12} fill="#79d3ea" />
        {[-20, -12, -4, 4].map((u) => <rect key={u} x={u} y={0} width=".9" height={12} fill="#2e6d9a" opacity=".6" />)}
        <rect x={-27} y={12} width={38} height={2.4} fill={c} />
        <Windows u={-24} v={17} cols={5} rows={2} du={7} dv={6} w={4.4} h={3.6} c="#3f8fc4" lit="#ffd36e" litEvery={3} />
      </Face>
      <Face p="R" at={12}>
        <Windows u={-24} v={4} cols={4} rows={4} du={7} dv={6} w={4.4} h={3.6} c="#3f8fc4" lit="#ffd36e" litEvery={4} />
      </Face>
      <Box x={-20} y={-20} z={32} w={16} d={14} h={6} t={GLASS_T} />
      {/* elevated metro viaduct along x, in front of the mall */}
      {pillars.map((x) => <Box key={x} x={x - 2} y={10} w={4} d={4} h={18} c="#e8e0ff" />)}
      <Box x={-34} y={8} z={18} w={68} d={8} h={3} c="#d6cdf0" t={{ top: '#efeaff', left: '#d6cdf0', right: '#a99fd6' }} />
      <Box x={-34} y={8} z={21} w={68} d={0.8} h={1.4} c="#8d93c4" />
      {/* train */}
      <Box x={-18} y={9.4} z={21} w={30} d={5.2} h={6} c="#ffffff" t={{ top: '#ffffff', left: '#f4f0ff', right: '#cfc7ea' }} />
      <Face p="L" at={14.6}>
        <rect x={-18} y={22.4} width={30} height={1.2} fill={c} />
        <Windows u={-16} v={24} cols={6} rows={1} du={4.6} w={3} h={2.2} c="#3a2f8c" />
      </Face>
      <Box x={12} y={9.4} z={21} w={4} d={5.2} h={5} c="#ffffff" t={{ top: '#ffffff', left: '#f4f0ff', right: '#cfc7ea' }} />
      <Box x={-34} y={15.2} z={21} w={68} d={0.8} h={1.4} c="#8d93c4" />
      {/* street level */}
      <MiniAuto x={-20} y={22} c={PAL.gold} />
      <Car x={6} y={24} c={PAL.rose} />
      <Tree x={28} y={-20} s={0.9} />
      <Bush x={26} y={-4} />
    </g>
  );
}

/* ============================== VENUE (lake + luxury) ============================== */
function SnackKiosk({ c }) {
  return (
    <g>
      <Shade x={2} y={4} rx={36} o={0.14} />
      <Pad x={-26} y={-26} w={52} d={52} c="#9fd9a8" r={5} />
      <Water x={2} y={2} w={24} d={24} />
      <Palm x={-22} y={-22} s={0.8} />
      {/* kiosk */}
      <Cyl x={-10} y={-8} r={9} h={13} c="#fff0d2" t={{ top: '#fffaf0', left: '#fff0d2', right: '#dcc39a' }} />
      <Face p="L" at={1}>
        <rect x={-16} y={5} width={10} height={5} rx="1" fill="#79d3ea" />
      </Face>
      <Cyl x={-10} y={-8} z={13} r={10.4} h={1.6} c={c} />
      <Cone x={-10} y={-8} z={14.6} r={10} h={9} c={c} />
      <Cyl x={-10} y={-8} z={23} r={0.6} h={4} c={PAL.gold} />
      {/* umbrella + stools */}
      <Umbrella x={-14} y={14} c={PAL.rose} h={12} r={6} />
      <Stool x={-19} y={16} /><Stool x={-10} y={18} />
      {/* little swan boat on the water */}
      {(() => {
        const [x, y] = pt(14, 16, 0);
        return (
          <g>
            <path d={`M${x - 6} ${y}Q${x} ${y + 4} ${x + 6} ${y}L${x + 5} ${y - 3}H${x - 5}Z`} fill="#fff" stroke="#c9c3e6" strokeWidth=".6" />
            <path d={`M${x + 4} ${y - 3}Q${x + 7} ${y - 9} ${x + 4} ${y - 10}`} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d={`M${x - 4} ${y - 3}h7`} stroke={c} strokeWidth="1.4" />
          </g>
        );
      })()}
    </g>
  );
}

function Boathouse({ c }) {
  return (
    <g>
      <Shade x={2} y={4} rx={46} o={0.14} />
      <Pad x={-30} y={-30} w={60} d={60} c="#9fd9a8" r={5} />
      <Water x={-30} y={4} w={60} d={26} />
      <Tree x={-27} y={-27} s={0.9} />
      {/* deck on stilts */}
      {[-22, -2, 18].map((x) => <Box key={x} x={x} y={18} w={2} d={2} h={4} c={WOOD} />)}
      <Box x={-24} y={-20} z={4} w={46} d={40} h={2} c="#c08548" t={{ top: '#e0a868', left: '#c08548', right: '#8a4f26' }} />
      <Box x={-18} y={-16} z={6} w={32} d={22} h={16} t={CREAM_T} />
      <Face p="L" at={6}>
        {[-16, -8, 0].map((u) => <rect key={u} x={u} y={10} width={6} height={9} rx="1" fill="#79d3ea" />)}
        <rect x={7} y={6} width={5} height={10} fill={darken(c, 0.3)} />
      </Face>
      <Face p="R" at={14}>
        <Windows u={-14} v={10} cols={3} rows={1} du={7} w={5} h={8} c="#3f8fc4" lit="#ffd36e" litEvery={2} />
      </Face>
      <Gable x={-21} y={-19} z={22} w={38} d={28} h={10} c={c} axis="x" />
      <StringLights a={pt(-22, 18, 14)} b={pt(20, 18, 14)} sag={4} />
      {/* railings */}
      <Face p="L" at={20}>
        <path d="M-24 9H22M-24 6V9M-14 6V9M-4 6V9M6 6V9M16 6V9" stroke="#fff7e6" strokeWidth=".8" />
      </Face>
      {/* boat */}
      {(() => {
        const [x, y] = pt(18, 26, 0);
        return (
          <g>
            <path d={`M${x - 9} ${y - 2}L${x + 9} ${y - 2}L${x + 6} ${y + 2}H${x - 6}Z`} fill={c} stroke={darken(c, 0.3)} strokeWidth=".6" />
            <path d={`M${x} ${y - 2}V${y - 14}L${x + 7} ${y - 4}Z`} fill="#fff7e6" />
          </g>
        );
      })()}
      <Palm x={24} y={-22} s={0.8} />
    </g>
  );
}

function Resort({ c }) {
  return (
    <g>
      <Shade x={2} y={4} rx={56} o={0.16} />
      <Pad x={-34} y={-34} w={68} d={68} c="#9fd9a8" r={5} />
      <Water x={-34} y={14} w={68} d={20} />
      {/* curved premium tower (cylinder) */}
      <Cyl x={-12} y={-14} r={13} h={44} c={c} t={{ top: lighten(c, 0.5), left: lighten(c, 0.1), right: darken(c, 0.25) }} />
      {(() => {
        const [cx, cb] = pt(-12, -14, 0);
        const rows = [];
        for (let z = 6; z < 42; z += 6) {
          rows.push(<path key={z} d={`M${cx - 18} ${cb - z}A18.4 9.2 0 0 0 ${cx + 18} ${cb - z}`} fill="none" stroke="#fff7e6" strokeWidth="1.4" opacity=".7" />);
        }
        return <g>{rows}</g>;
      })()}
      <Cyl x={-12} y={-14} z={44} r={14} h={2} c="#fff7e6" />
      <Cyl x={-12} y={-14} z={46} r={10} h={3} c={lighten(c, 0.3)} />
      <Dome x={-12} y={-14} z={49} r={10} h={10} c={lighten(c, 0.45)} />
      <Cone x={-12} y={-14} z={58} r={0.8} h={6} c={PAL.gold} />
      {/* low wing with rooftop pool */}
      <Box x={2} y={-18} w={28} d={28} h={16} t={CREAM_T} />
      <Face p="L" at={10}>
        <Windows u={4} v={3} cols={3} rows={2} du={8} dv={6.4} w={5} h={4} c="#79d3ea" lit="#ffd36e" litEvery={2} />
      </Face>
      <Face p="R" at={30}>
        <Windows u={-16} v={3} cols={3} rows={2} du={8} dv={6.4} w={5} h={4} c="#3f8fc4" lit="#ffd36e" litEvery={3} />
      </Face>
      <Pad x={5} y={-15} z={16} w={22} d={22} c="#2a98c2" r={2} />
      <Pad x={6} y={-14} z={16} w={20} d={20} c="#5fd8ee" r={2} />
      <Umbrella x={10} y={-12} z={16} c={PAL.rose} h={8} r={4} />
      {/* deck + palms + boat */}
      <Box x={-30} y={6} w={60} d={6} h={1.6} c="#e0a868" />
      <Palm x={-28} y={8} s={0.9} />
      <Palm x={24} y={8} s={0.85} />
      {(() => {
        const [x, y] = pt(2, 26, 0);
        return <path d={`M${x - 8} ${y - 2}L${x + 8} ${y - 2}L${x + 5} ${y + 2}H${x - 5}Z`} fill="#fff" stroke={c} strokeWidth=".8" />;
      })()}
    </g>
  );
}

/* ============================== TECH ============================== */
function StartupOffice({ c }) {
  return (
    <g>
      <Shade x={2} y={4} rx={38} o={0.14} />
      <Pad x={-28} y={-28} w={56} d={56} c="#c9d3f0" r={5} />
      <Box x={-18} y={-18} w={32} d={26} h={20} c="#f4f6ff" t={{ top: '#ffffff', left: '#eef1ff', right: '#b9c2e6' }} />
      <Face p="L" at={8}>
        <rect x={-16} y={3} width={22} height={14} fill="#79d3ea" />
        <path d="M-9 3V17M-2 3V17M-16 10H6" stroke="#2e6d9a" strokeWidth=".8" opacity=".6" />
        <polygon points="-16,17 -10,17 -16,9" fill="#fff" opacity=".45" />
        <rect x={8} y={0} width={4} height={10} fill={darken(c, 0.2)} />
      </Face>
      <Face p="R" at={14}>
        <rect x={-15} y={6} width={20} height={10} fill="#3f8fc4" />
        <path d="M-8 6V16M-1 6V16" stroke="#1f4f8c" strokeWidth=".8" opacity=".6" />
      </Face>
      <Box x={-19} y={-19} z={20} w={34} d={28} h={1.6} c={c} />
      {/* rooftop solar panels */}
      {[-14, -4].map((x) => (
        <g key={x}>
          <Box x={x} y={-14} z={21.6} w={8} d={14} h={1} c="#2e3a8c" t={{ top: '#3d58c4', left: '#2e3a8c', right: '#222b6a' }} />
        </g>
      ))}
      <Cyl x={8} y={-10} z={21.6} r={0.5} h={8} c="#c8c0e6" />
      {(() => { const [x, y] = pt(8, -10, 29.6); return <circle cx={x} cy={y} r="1.6" fill={c} />; })()}
      {/* sign board */}
      <Box x={16} y={10} w={2} d={2} h={8} c="#8d93c4" />
      <Box x={14} y={8} z={8} w={6} d={6} h={6} c={c} />
      {/* bicycle-ish scooter + bench */}
      <Box x={-12} y={14} w={10} d={3} h={2.4} c="#e8e0ff" />
      <Tree x={-24} y={14} s={0.85} />
      <Bush x={4} y={20} />
    </g>
  );
}

function BusinessCentre({ c }) {
  const TH = 52;
  return (
    <g>
      <Shade x={2} y={4} rx={46} o={0.16} />
      <Pad x={-30} y={-30} w={60} d={60} c="#c9d3f0" r={5} />
      <Box x={-24} y={-24} w={44} d={40} h={8} c="#eef1ff" t={{ top: '#ffffff', left: '#eef1ff', right: '#b9c2e6' }} />
      <Pad x={-22} y={-22} z={8} w={40} d={36} c="#d6dcf6" />
      <Box x={-14} y={-14} z={8} w={24} d={22} h={TH} t={GLASS_T} />
      <Face p="L" at={8}>
        {Array.from({ length: 8 }, (_, i) => <rect key={i} x={-14} y={14 + i * 6} width={24} height=".8" fill="#1f4f8c" opacity=".4" />)}
        <polygon points={`-12,${8 + TH} -6,${8 + TH} -12,${8 + TH - 20}`} fill="#fff" opacity=".35" />
      </Face>
      <Face p="R" at={10}>
        {Array.from({ length: 8 }, (_, i) => <rect key={i} x={-14} y={14 + i * 6} width={22} height=".8" fill="#1f4f8c" opacity=".4" />)}
      </Face>
      {/* vertical fins in accent */}
      <Box x={9} y={7} z={8} w={2} d={2} h={TH + 6} c={c} />
      <Box x={-15} y={7} z={8} w={2} d={2} h={TH + 6} c={c} />
      <Box x={-16} y={-16} z={8 + TH} w={28} d={26} h={3} c={c} />
      <Cyl x={-2} y={-3} z={11 + TH} r={4} h={2} c="#e8e0ff" />
      {/* entrance canopy */}
      <Box x={-10} y={8} z={6} w={14} d={8} h={1.4} c={c} />
      <Tree x={-24} y={22} s={0.9} />
      <Tree x={24} y={-20} s={0.85} c={PAL.grass} />
      <Car x={8} y={20} c={PAL.gold} />
    </g>
  );
}

function TechCampus({ c }) {
  const glass = (x, y, w, d, h, k) => (
    <g key={k}>
      <Box x={x} y={y} w={w} d={d} h={h} t={GLASS_T} />
      <Face p="L" at={y + d}>
        {Array.from({ length: Math.floor(h / 6) }, (_, i) => <rect key={i} x={x} y={6 + i * 6} width={w} height=".7" fill="#1f4f8c" opacity=".4" />)}
        <polygon points={`${x + 1.6},${h} ${x + 6},${h} ${x + 1.6},${h - 18}`} fill="#fff" opacity=".35" />
      </Face>
      <Face p="R" at={x + w}>
        {Array.from({ length: Math.floor(h / 6) }, (_, i) => <rect key={i} x={y} y={6 + i * 6} width={d} height=".7" fill="#1f4f8c" opacity=".4" />)}
      </Face>
      <Box x={x - 0.6} y={y - 0.6} z={h} w={w + 1.2} d={d + 1.2} h={2} c={c} />
    </g>
  );
  return (
    <g>
      <Shade x={2} y={4} rx={58} o={0.16} />
      <Pad x={-34} y={-34} w={68} d={68} c="#c9d3f0" r={5} />
      <Pad x={-30} y={-30} w={60} d={60} c="#dde3f8" r={4} />
      {glass(-30, -30, 18, 18, 74, 'a')}
      {glass(4, -30, 16, 16, 56, 'b')}
      {/* sky bridge */}
      <Box x={-12} y={-26} z={40} w={16} d={8} h={5} c="#e8e0ff" t={{ top: '#ffffff', left: '#e8e0ff', right: '#b9b0e0' }} />
      <Face p="L" at={-18}><rect x={-12} y={41.4} width={16} height={2.2} fill="#79d3ea" /></Face>
      {/* round glass dome building, Cyberabad style */}
      <Cyl x={-12} y={10} r={13} h={18} c="#79d3ea" t={{ top: '#d9f4fd', left: '#79d3ea', right: '#3f8fc4' }} />
      {(() => {
        const [cx, cb] = pt(-12, 10, 0);
        return <g>{[5, 10, 15].map((z) => <path key={z} d={`M${cx - 18.4} ${cb - z}A18.4 9.2 0 0 0 ${cx + 18.4} ${cb - z}`} fill="none" stroke="#1f4f8c" strokeWidth=".7" opacity=".45" />)}</g>;
      })()}
      <Cyl x={-12} y={10} z={18} r={13.6} h={1.6} c={c} />
      <Dome x={-12} y={10} z={19.6} r={10} h={8} c="#d9f4fd" />
      {glass(14, 0, 14, 14, 34, 'c')}
      <Cyl x={-21} y={-21} z={76} r={0.8} h={12} c="#c8c0e6" />
      {(() => { const [x, y] = pt(-21, -21, 88); return <g><circle cx={x} cy={y} r="2" fill="#ff5d73" /><circle cx={x} cy={y} r="4.2" fill="#ff5d73" opacity=".25" /></g>; })()}
      <Tree x={10} y={26} s={0.85} />
      <Tree x={26} y={20} s={0.8} c={PAL.grass} />
      <Bush x={-30} y={26} />
    </g>
  );
}

const MODELS = {
  bazaar: [Stall, Shop, TradingHub],
  food: [IraniCafe, BiryaniHouse, FoodCourt],
  transit: [Kiosk, Showroom, TransitMall],
  venue: [SnackKiosk, Boathouse, Resort],
  tech: [StartupOffice, BusinessCentre, TechCampus],
};

/** Scale that keeps the tallest models inside the 160 box. */
export const THEME_SCALE = {
  bazaar: [1, 1, 0.94],
  food: [1, 0.96, 0.92],
  transit: [1, 0.98, 0.92],
  venue: [1, 0.98, 0.92],
  tech: [1, 0.94, 0.8],
};

export function ThemeModel({ theme, level, color }) {
  const M = (MODELS[theme] || MODELS.bazaar)[level] || Stall;
  return <M c={color} />;
}
