// The Andhra guide: a Kondapalli-style toy elephant in the same slot as the Hyderabad auto mascot (same classes, same
// moods, so characterMotion.css animates it: arrive, blink, wave, props). Flat shapes only, no gradients.
import { memo } from 'react';
import { K } from './kit.jsx';

const MOODS = ['welcome', 'waiting', 'roll', 'buy', 'earn', 'traffic', 'win'];
const INK = '#243442';

function AndhraMascotBase({ mood = 'welcome', className = '', size = 120, animated = true, title }) {
  const state = MOODS.includes(mood) ? mood : 'welcome';
  const happy = ['welcome', 'earn', 'win', 'buy'].includes(state);
  return (
    <svg className={`auto-mascot ${animated ? 'is-animated' : ''} ${className}`.trim()} data-mood={state} data-map="andhra" width={size} height={size * 0.75} viewBox="0 0 240 180" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      {title && <title>{title}</title>}
      <ellipse className="am-shadow" cx="119" cy="160" rx="72" ry="8" fill="#111d30" opacity=".2" />
      <g className="am-arrive">
        <g className="am-body" stroke={INK} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
          <rect x="72" y="128" width="28" height="26" rx="9" fill={K.turm} />
          <rect x="140" y="128" width="28" height="26" rx="9" fill={K.turm} />
          <ellipse cx="120" cy="124" rx="64" ry="34" fill={K.turm} />
          <path d="M66 110Q120 92 174 110L180 134Q120 152 60 134Z" fill={K.terra} />
          <path d="M70 124Q120 108 170 124" fill="none" stroke={K.cream} strokeWidth="3" strokeDasharray="2 7" />
          <path d="M64 132Q120 148 176 132" fill="none" stroke={K.indigo} strokeWidth="4" />
          <ellipse cx="68" cy="82" rx="26" ry="30" fill="#f6d27a" />
          <ellipse cx="68" cy="84" rx="14" ry="19" fill={K.rose} stroke="none" opacity=".8" />
          <ellipse cx="172" cy="82" rx="26" ry="30" fill="#f6d27a" />
          <ellipse cx="172" cy="84" rx="14" ry="19" fill={K.rose} stroke="none" opacity=".8" />
          <circle cx="120" cy="80" r="40" fill={K.turm} />
          <path d="M84 62Q120 28 156 62Q120 52 84 62Z" fill={K.terra} />
          <circle cx="120" cy="52" r="5" fill={K.indigo} />
          {[96, 108, 132, 144].map((x) => <circle key={x} cx={x} cy={x % 12 === 0 ? 61 : 58} r="2.6" fill={K.cream} stroke="none" />)}
          <path d="M104 100q-6 12 2 16M136 100q6 12-2 16" fill="none" stroke={K.white} strokeWidth="5" />
          <g className="am-eyes" fill="#203a40" stroke="none">
            <ellipse cx="104" cy="78" rx="5.4" ry={state === 'traffic' ? 3 : 7} /><ellipse cx="136" cy="78" rx="5.4" ry={state === 'traffic' ? 3 : 7} />
            <circle cx="105.5" cy="76" r="1.8" fill="#fff" /><circle cx="137.5" cy="76" r="1.8" fill="#fff" />
          </g>
          <g className="am-cheeks" fill="#e9876c" stroke="none" opacity=".7"><ellipse cx="92" cy="92" rx="6" ry="3.4" /><ellipse cx="148" cy="92" rx="6" ry="3.4" /></g>
          <g className="am-hand">
            <path d={happy ? 'M120 94Q108 124 146 114Q182 102 176 70' : 'M120 94Q110 128 132 138Q150 142 152 124'} fill="none" stroke={INK} strokeWidth="19" />
            <path d={happy ? 'M120 94Q108 124 146 114Q182 102 176 70' : 'M120 94Q110 128 132 138Q150 142 152 124'} fill="none" stroke={K.turm} strokeWidth="13" />
            <path d={happy ? 'M118 104Q112 116 126 117M140 112q10-2 18-8' : 'M118 108q-1 10 6 18M128 132q8 6 16 2'} fill="none" stroke={K.turmD} strokeWidth="2" />
          </g>
        </g>
        {state === 'buy' && <g className="am-prop am-key" fill="#ffd572" stroke="#7c6133" strokeWidth="2"><circle cx="208" cy="60" r="9" /><circle cx="208" cy="60" r="3" fill="#fff2d3" /><path d="M208 69v19h7v-5h-7" /></g>}
        {state === 'roll' && <g className="am-prop am-die"><rect x="196" y="44" width="29" height="29" rx="6" fill="#fff5dc" stroke="#bca986" strokeWidth="2" />{[[203, 51], [217, 51], [210, 58], [203, 66], [217, 66]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="2" fill={K.indigo} />)}</g>}
        {state === 'waiting' && <g className="am-prop am-clock" stroke="#345355" strokeWidth="2"><circle cx="208" cy="62" r="15" fill="#fff0cc" /><path d="M208 52v11l7 4" fill="none" strokeLinecap="round" /></g>}
        {state === 'traffic' && <g className="am-prop am-traffic" stroke="#34434a" strokeWidth="2"><path d="M214 89v51" /><rect x="203" y="35" width="22" height="55" rx="7" fill="#34434a" /><circle cx="214" cy="47" r="6" fill="#f07768" /><circle cx="214" cy="63" r="6" fill="#907947" /><circle cx="214" cy="79" r="6" fill="#436b5c" /></g>}
        {state === 'earn' && <g className="am-prop am-coins" fill="#ffd16c" stroke="#b58436" strokeWidth="2">{[0, 1, 2].map((n) => <g key={n}><ellipse cx={206 - n * 7} cy={72 - n * 16} rx="10" ry="11" /><path d={`M${203 - n * 7} ${66 - n * 16}h6m-6 4h6m-6-4v12`} /></g>)}</g>}
        {state === 'win' && <g className="am-crown" fill="#ffd16c" stroke="#a67532" strokeWidth="2"><path d="m91 25-5-18 18 10 15-15 15 15 18-10-5 18Z" /><path d="M92 25h54v7H92Z" /><circle cx="120" cy="24" r="3" fill="#e9816b" /></g>}
      </g>
      {(state === 'win' || state === 'earn') && <g className="am-sparks" stroke="#eab753" strokeWidth="2" strokeLinecap="round"><path d="M32 48v12m-6-6h12M192 18v10m-5-5h10M25 112v8m-4-4h8" /></g>}
    </svg>
  );
}

export const AndhraMascot = memo(AndhraMascotBase);
export default AndhraMascot;
