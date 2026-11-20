// Andhra Aatalu tile icons (64x64 box): one small flat glyph per destination, hub and corner, keyed by tile id.
// Same rules as the scenes: inline SVG, shared shapes, no filters. `accent` tints the soft plate behind the glyph.
import { K, Palm, Bull, Elephant, Chilli, Kite, Crane, Boat, Tower, Gopuram, Diya } from './kit.jsx';

const Plate = ({ c }) => <circle cx="32" cy="32" r="29" fill={c} opacity=".24" stroke="none" />;
const T = ({ x, y, s, children }) => <g transform={`translate(${x} ${y}) scale(${s})`}>{children}</g>;

export const ICONS = {
  // ---- Towns & Markets
  1: () => <><rect x="12" y="38" width="40" height="10" rx="3" fill={K.terra} /><rect x="14" y="29" width="36" height="9" rx="3" fill={K.turm} /><rect x="17" y="20" width="30" height="9" rx="3" fill={K.indigoL} /><path d="M16 43h32M18 34h28M21 25h22" stroke={K.cream} strokeWidth="1.4" strokeDasharray="3 2" fill="none" /></>,
  3: () => <T x={30} y={44} s={0.9}><Bull x={0} y={0} s={1} /></T>,
  4: () => <><path d="M12 32Q24 18 40 28L52 20V44L40 36Q24 46 12 32Z" fill={K.sea} /><circle cx="22" cy="30" r="2.2" fill={K.ink} stroke="none" /><path d="M30 26Q33 32 30 38" fill="none" stroke={K.seaD} strokeWidth="1.6" /></>,
  // ---- Crafts
  6: () => <T x={28} y={50} s={1.15}><Elephant /></T>,
  7: () => <><path d="M32 54V34" stroke={K.green} strokeWidth="3" fill="none" />{[0, 60, 120, 180, 240, 300].map((r) => <ellipse key={r} cx="32" cy="20" rx="5" ry="9" fill={r % 120 ? K.rose : K.terra} transform={`rotate(${r} 32 30)`} />)}<circle cx="32" cy="30" r="5" fill={K.turm} /><path d="M32 46q-10-2-12-8 8 0 12 8ZM32 46q10-2 12-8-8 0-12 8Z" fill={K.leaf} /></>,
  8: () => <><path d="M14 14V52M50 14V52" stroke={K.wood} strokeWidth="4" fill="none" /><path d="M14 18H50M14 48H50" stroke={K.wood} strokeWidth="4" fill="none" />{[20, 26, 32, 38, 44].map((a, i) => <path key={a} d={`M${a} 20V46`} stroke={[K.terra, K.turm, K.indigoL, K.rose, K.green][i]} strokeWidth="3.4" fill="none" />)}<rect x="17" y="30" width="30" height="5" rx="2" fill={K.cream} /></>,
  // ---- Godavari Gold
  10: () => <T x={32} y={56} s={0.88}><Palm x={0} y={0} s={1.15} /></T>,
  11: () => <><path d="M8 44q8-4 16 0t16 0 16 0" fill="none" stroke={K.sea} strokeWidth="3" /><T x={32} y={40} s={1.5}><Boat x={0} y={0} /></T></>,
  13: () => <><path d="M6 40H58" stroke={K.ink} strokeWidth="3" fill="none" /><path d="M10 40Q24 16 32 40M32 40Q40 16 54 40" fill="none" strokeWidth="2.6" /><path d="M18 28V40M26 33V40M38 33V40M46 28V40" stroke={K.stoneD} strokeWidth="1.4" fill="none" /><path d="M6 46q6-3 13 0t13 0 13 0 13 0" fill="none" stroke={K.sea} strokeWidth="3" /></>,
  // ---- Uttarandhra
  15: () => <><circle cx="32" cy="34" r="12" fill={K.turm} />{[0, 45, 90, 135, 180, 225, 270, 315].map((r) => <path key={r} d="M32 14V8" stroke={K.turmD} strokeWidth="2.6" fill="none" transform={`rotate(${r} 32 34)`} />)}<path d="M6 46Q20 38 32 44T58 42V56H6Z" fill={K.green} /></>,
  16: () => <g transform="rotate(-42 32 34)"><path d="M14 34H54" stroke={K.wood} strokeWidth="5" fill="none" /><ellipse cx="18" cy="34" rx="14" ry="10" fill={K.turm} /><circle cx="54" cy="34" r="6" fill={K.terra} /><circle cx="18" cy="34" r="4" fill={K.terraD} /><path d="M24 33H52" stroke={K.cream} strokeWidth="1" fill="none" /></g>,
  17: () => <><path d="M6 46q6-3 13 0t13 0 13 0 13 0" fill="none" stroke={K.sea} strokeWidth="3" /><T x={14} y={46} s={0.62}><Crane x={0} y={0} /></T><path d="M32 42L36 36H56L52 42Z" fill={K.indigo} /><rect x="38" y="30" width="6" height="6" fill={K.terra} /><rect x="45" y="30" width="6" height="6" fill={K.turm} /></>,
  // ---- Nature & Heritage
  19: () => <><path d="M14 30h28v10q-14 12-28 0Z" fill={K.cream} /><path d="M42 33q10 0 8 7t-8 4" fill="none" strokeWidth="2.4" /><path d="M16 30h24" stroke="#6a3b24" strokeWidth="4" /><path d="M22 24q-4-5 0-9M30 24q-4-5 0-9" fill="none" stroke={K.indigoL} strokeWidth="2" /><path d="M10 50h36" stroke={K.ink} strokeWidth="2" fill="none" /></>,
  20: () => <T x={30} y={46} s={0.9}><Bull x={0} y={0} c="#b3a08c" dark={K.stoneD} /></T>,
  22: () => <><path d="M8 52V20L22 14 26 28 20 36 26 52Z" fill="#c0653f" /><path d="M56 52V22L44 18 40 32 46 40 38 52Z" fill="#b25a38" /><path d="M26 52Q32 42 38 52Z" fill={K.sea} /><path d="M10 28H20M10 40H22M44 28H54M42 44H54" stroke="#8f3a2b" strokeWidth="1.4" fill="none" /></>,
  // ---- Rayalaseema
  24: () => <><path d="M10 50V42H46V50Z" fill={K.stone} /><path d="M14 42V35H42V42Z" fill="#b8a38d" /><path d="M20 35V29H36V35Z" fill={K.stoneD} /><path d="M46 50L50 20 58 22 56 50Z" fill="#c0a48e" /></>,
  25: () => <><path d="M32 56V26" stroke={K.white} strokeWidth="5" fill="none" /><path d="M32 26L14 36M32 26L50 36M32 26V6" stroke={K.white} strokeWidth="4" fill="none" /><circle cx="32" cy="26" r="4" fill={K.indigo} /></>,
  26: () => <><path d="M12 54V30H52V54Z" fill={K.stone} /><path d="M10 30H54V24H48V18H42V24H36V18H30V24H24V18H18V24H10Z" fill={K.stone} /><path d="M26 54V42a6 6 0 0 1 12 0V54Z" fill={K.ink} /></>,
  // ---- Spiritual
  28: () => <><T x={32} y={48} s={1.5}><Diya x={0} y={0} /></T><path d="M16 52H48" stroke={K.stoneD} strokeWidth="3" fill="none" /></>,
  29: () => <><path d="M4 50L22 22 34 38 44 16 60 50Z" fill={K.greenD} /><path d="M10 50V40M52 50V38" stroke={K.wood} strokeWidth="3" fill="none" /><path d="M24 50l6-14 6 14Z" fill={K.leaf} /></>,
  31: () => <><path d="M4 50Q10 28 18 44Q24 20 32 42Q40 16 46 40Q52 26 60 50Z" fill="#6fa889" /><T x={40} y={24} s={0.34}><Gopuram x={0} y={0} /></T></>,
  // ---- Capital & Commerce
  33: () => <><Chilli x={16} y={14} s={2} r={-14} /><Chilli x={36} y={16} s={1.7} r={14} /></>,
  34: () => <><path d="M6 24H58" stroke={K.ink} strokeWidth="5" fill="none" /><path d="M6 28H58V50H6Z" fill={K.seaD} /><path d="M12 26V48M24 26V48M36 26V48M48 26V48" stroke={K.stoneD} strokeWidth="4" fill="none" /><path d="M13 48q5-12 10 0M25 48q5-12 10 0M37 48q5-12 10 0" fill="#a4dbef" stroke="none" /></>,
  35: () => <><Tower x={8} y={52} h={30} w={10} /><Tower x={20} y={52} h={44} w={12} c={K.indigoL} /><path d="M34 52V32q10-16 20 0V52Z" fill={K.cream} /><path d="M44 18V12" stroke={K.turm} strokeWidth="2.4" fill="none" /><Tower x={52} y={52} h={26} w={8} /></>,
  // ---- hubs
  5: () => <><path d="M6 50q6-3 13 0t13 0 13 0 13 0" fill="none" stroke={K.sea} strokeWidth="3" /><T x={14} y={44} s={0.7}><Crane x={0} y={0} /></T><path d="M30 44L34 36H56L52 44Z" fill={K.indigo} /><rect x="36" y="28" width="7" height="8" fill={K.terra} /><rect x="44" y="28" width="7" height="8" fill={K.turm} /></>,
  14: () => <><path d="M10 48V22Q10 14 18 14H46Q54 14 54 22V48Z" fill={K.indigoL} /><rect x="16" y="20" width="32" height="14" rx="3" fill="#a4dbef" /><path d="M10 38H54" stroke={K.turm} strokeWidth="4" fill="none" /><circle cx="20" cy="43" r="3" fill={K.turm} /><circle cx="44" cy="43" r="3" fill={K.turm} /><path d="M8 52H56" stroke={K.ink} strokeWidth="3" fill="none" /></>,
  23: () => <g transform="rotate(-30 32 32)"><path d="M6 32Q6 27 12 27H50Q60 27 60 32Q60 37 50 37H12Q6 37 6 32Z" fill={K.white} /><path d="M24 31L38 4H46L38 31ZM24 33L38 60H46L38 33Z" fill="#dfe6ee" /><path d="M8 29L3 18H11L16 27Z" fill={K.turm} /></g>,
  // ---- corners and specials
  0: () => <><path d="M12 52V22M52 52V22" stroke={K.terra} strokeWidth="6" fill="none" /><path d="M8 24Q32-2 56 24Z" fill={K.cream} /><path d="M12 30q4 8 8 0t8 0 8 0 8 0 8 0" fill="none" stroke={K.turm} strokeWidth="3" /></>,
  9: () => <><rect x="24" y="8" width="16" height="36" rx="6" fill={K.night} /><circle cx="32" cy="17" r="4.4" fill={K.chilli} /><circle cx="32" cy="26" r="4.4" fill={K.turm} /><circle cx="32" cy="35" r="4.4" fill="#3b7a3a" /><path d="M32 44V56M22 56H42" stroke={K.ink} strokeWidth="3" fill="none" /></>,
  18: () => <><Kite x={26} y={24} c={K.rose} c2={K.cream} r={-10} s={1.5} /><Kite x={46} y={20} c={K.turm} c2={K.cream} r={14} s={0.9} /></>,
  27: () => <><path d="M12 52V22H20V52Z" fill={K.cream} /><path d="M20 28H54" stroke={K.chilli} strokeWidth="7" fill="none" /><path d="M28 28V24M36 28V24M44 28V24M52 28V24" stroke={K.white} strokeWidth="3" fill="none" /><path d="M8 52H56" stroke={K.ink} strokeWidth="3" fill="none" /></>,
  32: () => <><g transform="rotate(-30 30 22)"><rect x="12" y="14" width="34" height="14" rx="3" fill={K.wood} /><path d="M29 28V50" stroke={K.wood} strokeWidth="5" fill="none" /></g><path d="M16 54H50" stroke={K.ink} strokeWidth="4" fill="none" /></>,
  luck: () => <><circle cx="32" cy="30" r="20" fill={K.turm} /><circle cx="32" cy="30" r="14" fill="none" stroke={K.turmD} strokeWidth="2" /><path d="M32 18V42M25 24h14M24 34h16" stroke={K.terraD} strokeWidth="2.6" fill="none" /><T x={32} y={56} s={1.4}><Diya x={0} y={0} /></T></>,
  drama: () => <><path d="M20 22h24l-3 28H23Z" fill={K.cream} /><path d="M22 24h20" stroke="#6a3b24" strokeWidth="5" /><path d="M44 28q8 0 6 8t-6 6" fill="none" strokeWidth="2.4" /><path d="M10 6h22q4 0 4 4v6q0 4-4 4h-8l-6 6v-6h-8q-4 0-4-4v-6q0-4 4-4Z" fill={K.white} /></>,
};

export const ICON_KEYS = Object.freeze(Object.keys(ICONS));

/** Icon key for a tile object (or id): its tile id for properties / hubs / corners, the deck for card squares. */
const ALIAS = { start: 0, traffic: 9, chai: 18, municipal: 27, auction: 32, auto: 5, metro: 14, mmts: 23, luck: 'luck', drama: 'drama' };

export function andhraIconKey(tile) {
  if (typeof tile === 'string') return ALIAS[tile] != null ? ALIAS[tile] : ICONS[tile] ? tile : null;
  if (typeof tile === 'number') return ICONS[tile] ? tile : null;
  if (!tile || typeof tile !== 'object') return null;
  if (tile.type === 'card' || tile.deck) return tile.deck === 'drama' ? 'drama' : 'luck';
  if (ICONS[tile.id]) return tile.id;
  return ALIAS[tile.art] != null ? ALIAS[tile.art] : null;
}

/** The glyph (without the outer <svg>), or null so the caller falls back to the default icon. */
export function AndhraIconGlyph({ tile, accent = K.turm }) {
  const key = andhraIconKey(tile);
  if (key == null) return null;
  const G = ICONS[key];
  return (
    <g stroke={K.ink} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" data-andhra-icon={key}>
      <Plate c={accent} />
      <G />
    </g>
  );
}
