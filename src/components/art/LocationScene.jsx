import { memo, useId } from 'react';
import { GROUPS, TILES } from '@shared/board.js';
import '@/styles/locationScene.css';

// Each precinct gets a physical setting and its own foreground business. Heritage stays scenery.
export const LOCATION_ART = Object.freeze({
  1: { setting: 'market', detail: 'fabric', roof: 'awning', sign: 'SAREES', color: '#d0789c' },
  3: { setting: 'market', detail: 'produce', roof: 'tin', sign: 'FRESH MARKET', color: '#77aa59' },
  4: { setting: 'market', detail: 'spice', roof: 'warehouse', sign: 'KIRANA', color: '#ca8652' },
  6: { setting: 'heritage', detail: 'bangles', roof: 'arch', sign: 'LAC & GLASS', color: '#cb598c' },
  7: { setting: 'charminar', detail: 'chai', roof: 'cafe', sign: 'IRANI CAFE', color: '#e18c63' },
  8: { setting: 'palace', detail: 'fountain', roof: 'arch', sign: 'COURTYARD CAFE', color: '#cba167' },
  10: { setting: 'neighbourhood', detail: 'tiffin', roof: 'cafe', sign: 'TIFFINS', color: '#e4b456' },
  11: { setting: 'bus', detail: 'tiffin', roof: 'awning', sign: 'QUICK PLATE', color: '#ec9861' },
  13: { setting: 'nightfood', detail: 'grill', roof: 'awning', sign: 'LATE NIGHT', color: '#ca6275' },
  15: { setting: 'garden', detail: 'books', roof: 'kiosk', sign: 'COLONY CORNER', color: '#5fa388' },
  16: { setting: 'shopping', detail: 'gadgets', roof: 'glass', sign: 'ELECTRONICS', color: '#57aeb5' },
  17: { setting: 'circle', detail: 'biryani', roof: 'cafe', sign: 'BIRYANI STOP', color: '#d69853' },
  19: { setting: 'park', detail: 'snack', roof: 'kiosk', sign: 'LAKE SNACKS', color: '#7bb698' },
  20: { setting: 'lake', detail: 'boat', roof: 'cafe', sign: 'BOATHOUSE', color: '#63adcd' },
  22: { setting: 'promenade', detail: 'cycle', roof: 'awning', sign: 'LAKEFRONT', color: '#65baa7' },
  24: { setting: 'studio', detail: 'camera', roof: 'warehouse', sign: 'STUDIO 24', color: '#ac82c8' },
  25: { setting: 'hills', detail: 'party', roof: 'glass', sign: 'THE VENUE', color: '#bd82b7' },
  26: { setting: 'terrace', detail: 'coffee', roof: 'glass', sign: 'HILLTOP LOUNGE', color: '#a587cc' },
  28: { setting: 'startup', detail: 'code', roof: 'office', sign: 'STARTUP SPACE', color: '#7092cd' },
  29: { setting: 'business', detail: 'meeting', roof: 'office', sign: 'BUSINESS CENTRE', color: '#6689c5' },
  31: { setting: 'cyber', detail: 'bridge', roof: 'glass', sign: 'TECH CAMPUS', color: '#5eafcc' },
  33: { setting: 'stadium', detail: 'code', roof: 'office', sign: 'CO WORK', color: '#60b2a0' },
  34: { setting: 'construction', detail: 'crane', roof: 'glass', sign: 'NEW HORIZONS', color: '#68aeb5' },
  35: { setting: 'skyline', detail: 'plaza', roof: 'glass', sign: 'SKYLINE CAMPUS', color: '#64afa8' },
});

const INK = '#24394a';
const stroke = { stroke: INK, strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round' };
const special = {
  start: { setting: 'charminar', detail: 'flag', roof: 'arch', sign: 'NAMMA HYDERABAD', color: '#67b89a' },
  auto: { setting: 'bus', detail: 'auto', roof: 'kiosk', sign: 'AUTO STAND', color: '#e8b64d' },
  metro: { setting: 'metro', detail: 'train', roof: 'glass', sign: 'METRO', color: '#5eafcf' },
  mmts: { setting: 'rail', detail: 'train', roof: 'warehouse', sign: 'MMTS EXPRESS', color: '#8e91c1' },
  traffic: { setting: 'bus', detail: 'traffic', roof: 'kiosk', sign: 'TRAFFIC JAM', color: '#e48a75' },
  chai: { setting: 'garden', detail: 'chai', roof: 'cafe', sign: 'CHAI ADDA', color: '#ddae6b' },
  municipal: { setting: 'civic', detail: 'papers', roof: 'arch', sign: 'MUNICIPAL OFFICE', color: '#a49ac2' },
  auction: { setting: 'market', detail: 'auction', roof: 'awning', sign: 'BAZAAR AUCTION', color: '#dfaa65' },
  luck: { setting: 'charminar', detail: 'luck', roof: 'arch', sign: 'NAWABI LUCK', color: '#61ab8e' },
  drama: { setting: 'nightfood', detail: 'drama', roof: 'arch', sign: 'CITY DRAMA', color: '#aa82c6' },
};

function Tree({ x, y, size = 1 }) {
  return <g transform={`translate(${x} ${y}) scale(${size})`}><ellipse cy="5" rx="15" ry="5" fill="#163e42" opacity=".2" /><path d="M0 1v-35" stroke="#7c5e4f" strokeWidth="5" /><path d="M0-15l-10-9M0-23l9-8" stroke="#7c5e4f" strokeWidth="3" /><path d="M-17-28a12 12 0 0 1 3-20 15 15 0 0 1 28 2 13 13 0 0 1 2 23c-7 5-26 3-33-5" fill="#4a927b" {...stroke} /><path d="M-10-43q9-9 18 0" stroke="#8bc19b" strokeWidth="4" fill="none" /></g>;
}

function Lamp({ x, y }) {
  return <g transform={`translate(${x} ${y})`}><path d="M0 0v-47h13" fill="none" stroke="#42546a" strokeWidth="3" /><path d="M8-48h13l-3 6h-7z" fill="#f7d994" {...stroke} /><ellipse className="ls-light" cx="15" cy="-39" rx="13" ry="10" fill="#ffe4a6" opacity=".22" /><path d="M-5 0h10" stroke="#42546a" strokeWidth="4" /></g>;
}

function Charminar({ palace = false, x = 244, y = 140, scale = 1 }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M-64 0v-57h128V0z" fill="#e5bc88" {...stroke} />
    <path d="M-43 0v-26a13 13 0 0 1 26 0V0M17 0v-26a13 13 0 0 1 26 0V0" fill="#49606a" {...stroke} />
    <path d="M-9 0v-39a9 9 0 0 1 18 0V0" fill="#a17258" {...stroke} />
    <path d="M-62-57h124v8H-62z" fill="#fbe0af" {...stroke} />
    {[-59, -28, 28, 59].map((dx, i) => <g key={dx} transform={`translate(${dx} 0)`}>
      <path d={`M-6 0v-${palace ? 71 : 88}h12V0`} fill={i % 2 ? '#eac993' : '#f4d9a4'} {...stroke} />
      <path d={`M-8-${palace ? 71 : 88}h16v7H-8z`} fill="#fff0c7" {...stroke} />
      <path d={`M-6-${palace ? 72 : 89}q-1-11 6-17 7 6 6 17z`} fill="#e9bd75" {...stroke} />
      <path d={`M0-${palace ? 89 : 106}v-6`} stroke={INK} strokeWidth="1.5" />
      <path d={`M-3-${palace ? 56 : 70}v10M3-${palace ? 56 : 70}v10`} stroke="#a27852" strokeWidth="1.3" />
    </g>)}
    {[-43, -15, 14, 42].map(dx => <path key={dx} d={`M${dx - 5}-43v-6a5 5 0 0 1 10 0v6z`} fill="#fff1c9" {...stroke} />)}
    {palace && <path d="M-21-58q0-30 21-37 21 7 21 37z" fill="#efca93" {...stroke} />}
  </g>;
}

function Tower({ x, y, h = 80, w = 34, c = '#75aac5', variant = 0 }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M0 0v-${h}l${w}-8 12 10V0z`} fill={c} {...stroke} />
    <path d={`M${w} -${h + 8}V0h12V-${h - 6}z`} fill="#427d99" opacity=".7" />
    <path d={`M0-${h}l${w}-8 12 10-${w} 8z`} fill="#b7d9df" {...stroke} />
    {Array.from({ length: Math.floor(h / 13) }, (_, j) => <g key={j} className={j === variant % 3 ? 'ls-light' : undefined}>
      {[6, 17, 28].filter(v => v < w - 3).map((dx, k) => <path key={dx} d={`M${dx} -${12 + j * 13}v-6`} stroke={(j + k + variant) % 3 === 0 ? '#ffe2a0' : '#c3e3e7'} strokeWidth="5" />)}
    </g>)}
    <path d={`M5-${h - 4}v${h - 10}`} stroke="#e7fcff" strokeWidth="3" opacity=".5" />
  </g>;
}

function Vehicle({ kind = 'auto', x = 290, y = 177, direction = 1 }) {
  const train = kind === 'train';
  return <g transform={`translate(${x} ${y}) scale(${direction} 1)`}>
    <g className="ls-vehicle">
      <ellipse cy="4" rx={train ? 53 : 24} ry="5" fill="#112e40" opacity=".25" />
      {train ? <><path d="M-51 0v-23q0-6 7-6h80q14 0 18 15V0z" fill="#dce6ea" {...stroke} /><path d="M-50-5H51" stroke="#9c6bc7" strokeWidth="5" />{[-39, -23, -7, 9, 25].map(a => <rect key={a} x={a} y="-23" width="12" height="11" rx="2" fill="#51849b" {...stroke} />)}<path d="M43-24l8 12h-13v-12z" fill="#a8dce4" {...stroke} /></> : <><path d="M-24 0v-18l8-18H5l16 17v19z" fill={kind === 'bus' ? '#ce7267' : '#dfb344'} {...stroke} /><path d="M-20-18l7-14H3l10 14z" fill="#224758" {...stroke} /><path d="M-23-17H20v11H-23z" fill={kind === 'bus' ? '#f2dcc1' : '#479281'} {...stroke} /><path d="M-5-32v27M6-16v11" stroke={INK} strokeWidth="2" /><path d="M-20-5h7M14-5h6" stroke="#fff1b4" strokeWidth="3" /></>}
      {(train ? [-35, 35] : [-15, 13]).map(a => <g key={a}><circle cx={a} r="6" fill="#263646" /><circle cx={a} r="2.5" fill="#b8c9ca" /></g>)}
    </g>
  </g>;
}

function Setting({ art, id }) {
  const s = art.setting;
  if (['charminar', 'heritage', 'palace', 'civic'].includes(s)) return <>
    <path d="M17 145V98h30v47M47 145V83h37v62M315 145V91h29v54M346 145v-40h38v40" fill="#527376" opacity=".4" />
    <Charminar palace={s === 'palace' || s === 'civic'} x={s === 'heritage' ? 288 : 255} y={142} scale={s === 'heritage' ? .72 : .92} />
    {s === 'palace' && <><path d="M28 139V92h118v47" fill="#ddbd8f" {...stroke} />{[40, 66, 92, 118].map(x => <path key={x} d={`M${x} 138v-22a8 8 0 0 1 16 0v22`} fill="#527078" {...stroke} />)}</>}
  </>;
  if (['lake', 'park', 'promenade'].includes(s)) return <>
    <path d="M0 94q99-12 199 1t201-3v67H0z" fill="#527e84" opacity=".5" />
    <path d="M0 110q119-14 241 1t159-4v65H0z" fill="#70b8c4" />
    <g className="ls-water" stroke="#c6e4d9" strokeWidth="2" opacity=".7"><path d="M193 121h32m19 8h49m30-12h37M175 145h24m87-1h51M25 125h46m18 9h25" /></g>
    {s === 'park' ? <g transform="translate(279 99)"><path d="M-22 10h44M0 9v-43M-9-24h18M-7-29q7-18 14 0M-9-24l-5 24M9-24l5 24" stroke="#d7d3b6" strokeWidth="5" fill="none" /><circle cy="-42" r="5" fill="#d7d3b6" /></g> : <g transform="translate(285 127)"><g className="ls-boat"><path d="M-31 0h62l-9 12h-39z" fill="#f3d5a5" {...stroke} /><path d="M-15-1v-16h29V0" fill="#d38669" {...stroke} /><path d="M-19-17h37" stroke={INK} strokeWidth="3" /></g></g>}
    <path d="M0 155q142-21 244 1t156-2v15H0z" fill="#ebcfaa" {...stroke} />
    <path d="M8 154q186-21 380 6" fill="none" stroke="#667a76" strokeWidth="2" />
    {[210, 247, 284, 321, 358].map(x => <path key={x} d={`M${x} 159v-13`} stroke="#667a76" strokeWidth="2" />)}
    <Tree x={355} y={153} size={.7} />
  </>;
  if (['startup', 'business', 'cyber', 'construction', 'skyline', 'stadium'].includes(s)) return <>
    {s === 'stadium' ? <g transform="translate(274 126)"><ellipse rx="81" ry="23" fill="#d7e6dc" {...stroke} /><ellipse cy="-4" rx="70" ry="18" fill="#4f8272" {...stroke} /><ellipse cy="-5" rx="46" ry="11" fill="#86aa73" /><path d="M-72-17v-36m144 36v-36M-79-53h16m130 0h14" stroke="#c7d0ca" strokeWidth="3" /></g> : <>
      <Tower x={218} y={141} h={s === 'skyline' ? 114 : 91} w={38} variant={id} />
      <Tower x={281} y={143} h={s === 'startup' ? 51 : 127} w={33} variant={id + 1} c="#85b1b5" />
      <Tower x={335} y={147} h={s === 'skyline' ? 95 : 72} w={31} variant={id + 2} c="#999fb4" />
      {s === 'cyber' && <><path d="M240 82h66v12h-66z" fill="#d4d8e5" {...stroke} /><path d="M227 135v-29q0-22 26-22t27 22v29z" fill="#69a8b9" {...stroke} /><path d="M228 113h50M228 125h50" stroke="#c6e4df" strokeWidth="2" /></>}
      {s === 'construction' && <g stroke="#e9b562" strokeWidth="3" fill="none"><path d="M237 138V34h117M237 34l18-14 51 14M261 34v28M253 62h15M232 48h10m-10 16h10m-10 16h10m-10 16h10" /></g>}
    </>}
    <path d="M205 148h179l-13 11H200z" fill="#b7ccc5" /><Tree x={354} y={156} size={.55} />
  </>;
  if (['metro', 'rail'].includes(s)) return <>
    <path d="M0 116h400v15H0z" fill="#b5c3c1" {...stroke} /><path d="M32 131v31m112-31v26m112-26v29m112-29v33" stroke="#788d92" strokeWidth="12" />
    <g transform="translate(245 113)"><Vehicle kind="train" x={0} y={0} /></g><path d="M171 80h139l-13-13H184z" fill="#6a95a0" {...stroke} />
  </>;
  if (['hills', 'terrace', 'garden', 'neighbourhood'].includes(s)) return <>
    <path d="M0 145Q72 55 156 110T320 88q45-22 80 20v58H0z" fill="#658c7c" opacity=".7" />
    <path d="M0 151Q97 83 178 126T400 123v42H0z" fill="#83a68a" />
    {s === 'hills' || s === 'terrace' ? <g><path d="M230 135v-48h88v53z" fill="#f4d8b3" {...stroke} /><path d="M221 87h108v9H221z" fill="#e5c59e" {...stroke} /><path d="M244 98h58v26h-58z" fill="#7dabb1" {...stroke} /><path d="M262 97v27M284 97v27" stroke="#e6e4d2" strokeWidth="3" /><path d="M238 135v-7h87v7" stroke="#3a6671" fill="none" {...stroke} /></g> : <><path d="M222 139V94h45v45m8 0V84h54v55" fill="#d9bd9a" {...stroke} />{[235, 252, 286, 309].map(x => <rect key={x} x={x} y="104" width="9" height="15" fill="#547b7d" />)}</>}
    <Tree x={354} y={152} size={1.1} /><Tree x={207} y={142} size={.65} />
  </>;
  return <>
    <path d="M0 147V96h43V79h43v68M291 147V91h46V73h51v74" fill="#70928d" opacity=".5" />
    <path d="M222 142V91h52v51m6 0V80h54v62m7 0v-40h43v40" fill={s === 'nightfood' ? '#806787' : '#cead91'} {...stroke} />
    {[234, 252, 291, 309, 352, 370].map(x => <rect key={x} x={x} y={x % 3 ? 110 : 97} width="10" height="15" rx="2" fill={s === 'nightfood' ? '#ffce8c' : '#597a80'} className={s === 'nightfood' ? 'ls-light' : undefined} />)}
    {s === 'circle' && <g transform="translate(300 123)"><ellipse cy="11" rx="43" ry="10" fill="#69988a" {...stroke} /><path d="M0 9v-45M-7-36h14M-13-42h26" stroke="#eed4a3" strokeWidth="6" /><circle cy="-42" r="7" fill="#ead5ac" {...stroke} /></g>}
    {s === 'studio' && <g transform="translate(289 110)"><path d="M0 31V-14m-20 45L0 5l20 26" stroke={INK} strokeWidth="3" /><rect x="-15" y="-27" width="33" height="23" rx="4" fill="#746c91" {...stroke} /><path d="M18-23l15-7V-2L18-9z" fill="#424e69" {...stroke} /><circle cx="-7" cy="-34" r="11" fill="#9b94b1" {...stroke} /><circle cx="12" cy="-35" r="12" fill="#9b94b1" {...stroke} /><circle cx="-7" cy="-34" r="3" fill={INK} /><circle cx="12" cy="-35" r="3" fill={INK} /></g>}
    {s === 'bus' && <Vehicle kind="bus" x={300} y={143} />}
    {s === 'market' && <><path d="M220 138v-18h135v18" fill="#e5ba82" {...stroke} /><path d="M216 119l12-19h120l12 19z" fill="#d47c6d" {...stroke} />{[232, 257, 282, 307, 332].map(x => <path key={x} d={`M${x} 101l-5 17h12l2-17`} fill="#f5ddac" />)}</>}
    <Tree x={365} y={154} size={.7} />
  </>;
}

function Details({ art }) {
  const d = art.detail;
  if (['fabric', 'bangles', 'produce', 'spice', 'books', 'gadgets'].includes(d)) return <g>
    <path d="M82 164h91v16H82z" fill="#b9815a" {...stroke} />
    {d === 'fabric' ? [0, 1, 2, 3, 4].map(i => <g key={i} transform={`translate(${88 + i * 16} 138)`}><path d="M0 0h12v24H0z" fill={['#cc6296', '#e3c16f', '#67aaaf', '#a98ac1', '#e59074'][i]} {...stroke} /><path d="M3 2v19m6-19v19" stroke="#ffe1ba" strokeWidth="1" /></g>) : d === 'bangles' ? [0, 1, 2, 3].map(i => <g key={i} transform={`translate(${91 + i * 22} 149)`}><path d="M0 15V-7" stroke={INK} strokeWidth="3" />{[-5, 1, 7].map(y => <ellipse key={y} cy={y} rx="8" ry="3" stroke={i % 2 ? '#f4c576' : '#e886b1'} strokeWidth="3" fill="none" />)}</g>) : d === 'produce' ? [0, 1, 2, 3].map(i => <g key={i}><path d={`M${86 + i * 22} 163v-13h18v13`} fill="#d4a36e" {...stroke} />{[0, 1, 2].map(j => <circle key={j} cx={91 + i * 22 + j * 4} cy={149 - j % 2 * 3} r="4" fill={['#d97558', '#8bb36a', '#dfb95b', '#9b85b4'][i]} stroke={INK} strokeWidth=".7" />)}</g>) : d === 'spice' ? [0, 1, 2].map(i => <g key={i}><path d={`M${87 + i * 27} 162l-1-17q11-14 22 0l-1 17z`} fill="#cdb183" {...stroke} /><ellipse cx={97 + i * 27} cy="144" rx="9" ry="4" fill={['#c46e46', '#d8aa45', '#987344'][i]} {...stroke} /></g>) : [0, 1, 2, 3].map(i => <g key={i}><rect x={88 + i * 20} y={144 - i % 2 * 5} width="14" height="19" rx="2" fill={d === 'gadgets' ? '#4c6b87' : ['#b66e77', '#e4b976', '#7eafb1', '#9f85b5'][i]} {...stroke} /><path d={`M${91 + i * 20} ${148 - i % 2 * 5}h8`} stroke="#d9ebdf" strokeWidth="2" /></g>)}
  </g>;
  if (['chai', 'tiffin', 'biryani', 'snack', 'grill', 'coffee'].includes(d)) return <g>
    <path d="M97 171v-19h61v19" fill="#c69b71" {...stroke} /><path d="M92 151h73v6H92z" fill="#ebcfa0" {...stroke} />
    {d === 'biryani' || d === 'grill' ? <><path d="M108 146q0-22 22-22t22 22z" fill="#c79765" {...stroke} /><path d="M105 146h50M125 123h10" stroke={INK} strokeWidth="3" /></> : d === 'tiffin' ? <><ellipse cx="126" cy="145" rx="25" ry="6" fill="#aab9bd" {...stroke} />{[113, 127, 141].map(x => <ellipse key={x} cx={x} cy="141" rx="7" ry="4" fill="#fff2ce" {...stroke} />)}</> : <><path d="M113 129h25v13q-12 8-25 0z" fill="#f5e0bd" {...stroke} /><path d="M138 132h8q6 9-8 10" fill="none" {...stroke} /><ellipse cx="126" cy="148" rx="22" ry="4" fill="#dbbb8b" {...stroke} /></>}
    <g className="ls-steam" stroke="#fff3d9" strokeWidth="2" opacity=".7" fill="none"><path d="M119 119q-7-7 0-13" /><path d="M132 119q7-7 0-13" /><path d="M144 120q-6-7 0-11" /></g>
  </g>;
  if (['code', 'meeting', 'bridge', 'crane', 'plaza'].includes(d)) return <g>
    <path d="M99 159h63v5H99zM109 164v15m43-15v15" stroke={INK} strokeWidth="3" fill="#cda97d" />
    <path d="M116 157v-22h31v22z" fill="#4f7892" {...stroke} /><path d="M113 158h37" stroke="#bdcdd0" strokeWidth="3" /><path d="M126 142l-4 4 4 4m11-8l4 4-4 4" stroke="#afe0ce" strokeWidth="2" fill="none" />
    <path d="M164 143h11v15h-11z" fill="#f2d9ad" {...stroke} /><g className="ls-steam" stroke="#f4e8d2" fill="none"><path d="M169 140q-5-6 0-11" /></g>
  </g>;
  if (d === 'fountain') return <g transform="translate(140 171)"><ellipse rx="27" ry="9" fill="#d6bd97" {...stroke} /><ellipse cy="-3" rx="21" ry="6" fill="#7fbfc4" /><path className="ls-water" d="M0-5v-25m0 0q-17 0-18 18m18-18q17 0 18 18" fill="none" stroke="#b9e3db" strokeWidth="3" /><path d="M-5-1v-9h10v9" fill="#e8c99e" {...stroke} /></g>;
  if (d === 'cycle') return <g transform="translate(151 169)"><g className="ls-cycle"><circle cx="-20" r="12" fill="none" {...stroke} /><circle cx="22" r="12" fill="none" {...stroke} /><path d="M-20 0l12-22L7 0h-27l13-15h22l7 15M-8-22h-7m28 7-4-10h9" stroke="#d38567" strokeWidth="3" fill="none" /></g></g>;
  if (d === 'auto' || d === 'traffic') return <><Vehicle x={133} y={171} /><g transform="translate(192 166)"><path d="M0 0v-50" stroke={INK} strokeWidth="4" /><rect x="-8" y="-60" width="16" height="34" rx="6" fill="#344859" {...stroke} /><circle cy="-51" r="4" fill="#ec856c" /><circle cy="-42" r="4" fill="#d7b15d" /><circle cy="-33" r="4" fill="#66ac8c" className="ls-light" /></g></>;
  if (d === 'train') return <Vehicle kind="train" x={132} y={169} />;
  if (d === 'camera') return <g transform="translate(145 150)"><path d="M-13-5h30v20h-30zM17-2l14-7v28l-14-7z" fill="#7a7898" {...stroke} /><circle cx="-6" cy="-14" r="10" fill="#b3a6c4" {...stroke} /><circle cx="12" cy="-14" r="10" fill="#b3a6c4" {...stroke} /><path d="M2 15v15m0-10-14 11m14-11 15 11" stroke={INK} strokeWidth="3" /></g>;
  if (d === 'party') return <g transform="translate(139 151)"><path d="M-30 15h60v6h-60zM-23 21v12m46-12v12" fill="#b4a1b7" {...stroke} /><path d="M-17 13v-14h34v14z" fill="#f5dcc1" {...stroke} /><path d="M-12-2v-9h24v9z" fill="#d6a4b0" {...stroke} />{[-8, 0, 8].map(x => <path key={x} d={`M${x}-12v-7`} stroke="#ecc568" strokeWidth="2" />)}</g>;
  if (d === 'flag') return <g transform="translate(146 169)"><path d="M0 0v-53" stroke={INK} strokeWidth="3" /><path className="ls-banner" d="M1-52q12-8 28 0v20q-16-8-28 0z" fill="#f2c16e" {...stroke} /></g>;
  if (d === 'auction') return <g transform="translate(137 144)"><path d="M-19 25h40v7h-40zM-2 18l19-27" stroke={INK} strokeWidth="5" fill="#e3b47b" /><g className="ls-hammer"><path d="M7-17l20 13-9 12L-2-5z" fill="#c18d64" {...stroke} /><path d="M2-9l19 13" stroke="#edc993" strokeWidth="2" /></g></g>;
  if (['papers', 'luck', 'drama'].includes(d)) return <g transform="translate(140 147)"><path d="M-24-23h39l8 9v42h-47z" fill="#f2e2c2" {...stroke} /><path d="M15-23v10h9M-15-9H7M-15-1h29M-15 7h20" fill="none" stroke="#9b8b78" strokeWidth="2" /><circle cx="8" cy="17" r="8" fill={d === 'drama' ? '#ae87b7' : '#64a58a'} /><path d="M4 17l3 3 6-7" stroke="#fff0cb" strokeWidth="2" fill="none" /></g>;
  return <g transform="translate(136 163)"><path d="M-30 0h60v7h-60zM-22 7v14m44-14v14" fill="#dbb583" {...stroke} /><circle cy="-12" r="13" fill="#e0b575" {...stroke} /><path d="M-9-12H9" stroke="#fff0cb" strokeWidth="2" /></g>;
}

function Shop({ art, level }) {
  const glass = art.roof === 'glass' || art.roof === 'office';
  const arch = art.roof === 'arch';
  const roof = art.roof;
  return <g className="ls-business">
    <ellipse cx="127" cy="184" rx="97" ry="10" fill="#143a43" opacity=".18" />
    <path d="M50 176V99l137-8 20 15v70z" fill={glass ? '#b3d1d1' : '#f2d5a6'} {...stroke} />
    <path d="M187 91l20 15v70h-20z" fill={glass ? '#6a9aab' : '#cca67e'} {...stroke} />
    {level > 0 && <g className="ls-expansion"><path d="M50 99V67l137-8 20 15v32l-20-15z" fill={glass ? '#9abfc8' : '#e9c79b'} {...stroke} />{[63, 88, 113, 138, 163].map(x => <path key={x} d={`M${x} 78v12h15V77z`} fill={glass ? '#46728a' : '#627f83'} {...stroke} />)}</g>}
    {level > 1 && <g className="ls-expansion"><path d="M50 67V39l137-8 20 15v28l-20-15z" fill={glass ? '#bad6d5' : '#f3ddb4'} {...stroke} />{[63, 88, 113, 138, 163].map(x => <path key={x} d={`M${x} 48v11h15V47z`} fill="#638b9a" {...stroke} />)}<path d="M111 31v-13h16v13" fill={art.color} {...stroke} /></g>}
    <path d={`M43 ${96 - level * 30}l10-10 137-8 24 17-17 5H43z`} fill={art.color} {...stroke} />
    <path d="M64 114h46v56H64z" fill="#446675" {...stroke} /><path d="M68 117h38v50H68z" fill="#7dadae" />
    <path d="M111 116h64v48h-64z" fill="#628c99" {...stroke} /><path d="M115 119h25v41h-25zM145 119h26v41h-26z" fill="#9bc0c3" /><path d="M117 122l17 0-17 28M149 121h16l-16 29" fill="#d9eddf" opacity=".4" />
    {arch && <path d="M65 144v-14a22 22 0 0 1 44 0v14M113 141v-13a30 30 0 0 1 60 0v13" fill="none" stroke="#f7e4bf" strokeWidth="5" />}
    {roof === 'awning' || roof === 'kiosk' || roof === 'cafe' ? <g className="ls-awning"><path d="M52 111l10-17h114l15 17v8H52z" fill={art.color} {...stroke} />{[68, 96, 124, 152].map(x => <path key={x} d={`M${x} 95l-4 16v7h14v-7l-1-16z`} fill="#f8e1b8" />)}<path d="M52 111h139" stroke={INK} strokeWidth="1.5" /></g> : <path d="M54 104h134v9H54z" fill={art.color} {...stroke} />}
    <rect x="65" y={roof === 'awning' || roof === 'cafe' || roof === 'kiosk' ? 78 : 88} width="112" height="17" rx="3" fill="#244c59" stroke="#ead1a0" strokeWidth="1" />
    <text x="121" y={roof === 'awning' || roof === 'cafe' || roof === 'kiosk' ? 89 : 99} textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="7.3" fontWeight="800" letterSpacing=".8" fill="#ffe9bd">{art.sign}</text>
    <path d="M44 176h165v6H44z" fill="#d9bc90" {...stroke} />
    <path d="M49 182h155" stroke="#fff1ce" strokeWidth="2" />
  </g>;
}

function LocationSceneBase({ tile: value, level = 0, className = '', animated = true, compact = false, title }) {
  const uid = `loc${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const tile = value && typeof value === 'object' ? value : TILES.find(t => t.id === Number(value));
  const art = LOCATION_ART[tile?.id] || special[tile?.art] || { ...special.start, sign: 'CITY CORNER', setting: 'garden', detail: 'chai' };
  const accent = GROUPS[tile?.group]?.color || art.color;
  const lv = Math.max(0, Math.min(2, Number(level) || 0));
  const label = title === true ? tile?.name || 'Hyderabad city scene' : title || undefined;
  return <svg viewBox="0 0 400 220" className={`location-scene${animated ? ' is-animated' : ''}${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`} data-location={tile?.id ?? 'unknown'} data-setting={art.setting} data-level={lv} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
    {label ? <title>{label}</title> : null}
    <defs>
      <linearGradient id={`${uid}sky`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={['nightfood', 'studio', 'skyline'].includes(art.setting) ? '#293d60' : '#79aaad'} /><stop offset="1" stopColor="#e8cfac" /></linearGradient>
      <linearGradient id={`${uid}ground`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e8cfaa" /><stop offset="1" stopColor="#c6ad8b" /></linearGradient>
      <clipPath id={`${uid}clip`}><rect width="400" height="220" rx="16" /></clipPath>
    </defs>
    <g clipPath={`url(#${uid}clip)`}>
      <rect width="400" height="220" fill={`url(#${uid}sky)`} />
      <circle cx="327" cy="41" r="21" fill="#ffe4b4" opacity=".75" />
      <g fill="#edf0d8" opacity=".35"><path d="M38 39q8-15 22-7 13-20 27-1 19-4 21 8z" /><path d="M209 27q8-10 17-5 11-15 23 0 15-3 17 5z" /></g>
      <Setting art={art} id={tile?.id || 0} />
      <path d="M0 160q112-20 210-3t190-6v69H0z" fill={`url(#${uid}ground)`} />
      <path d="M0 185q110-13 205-1t195-6v42H0z" fill="#7a8e8c" />
      <path d="M0 193q200-14 400-4" stroke="#d2d6c1" strokeWidth="2" fill="none" strokeDasharray="16 14" />
      <path d="M18 176l181-7 15 8-195 10z" fill="#b5a98b" />
      <Shop art={art} level={tile?.type === 'property' ? lv : 0} />
      <Details art={art} />
      {art.setting === 'promenade' ? null : <Lamp x={335} y={183} />}
      {['bus', 'metro', 'rail'].includes(art.setting) || art.detail === 'auto' ? null : <Tree x={27} y={169} size={.7} />}
      {!compact && <><path d="M240 176h35v8h-35zM245 184v8m25-8v8" stroke={INK} strokeWidth="2" fill="#a68d71" /><path d="M237 174h41" stroke="#d6b991" strokeWidth="3" />
        <g transform="translate(304 171)"><circle cy="-19" r="5" fill="#9c6652" /><path d="M-5-11h10l2 15H-7z" fill={accent} {...stroke} /><path d="M-3 4v10m6-10v10" stroke={INK} strokeWidth="2.5" /></g>
        <path d="M356 183v-12h18v12" fill="#c9a476" {...stroke} /><path d="M363 170v-13m0 9-7-4m7 1 7-5" stroke="#5e9075" strokeWidth="4" />
      </>}
      <path d="M0 217h400" stroke={accent} strokeWidth="6" />
    </g>
  </svg>;
}

export const LocationScene = memo(LocationSceneBase);
export default LocationScene;
