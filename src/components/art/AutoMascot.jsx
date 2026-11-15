import { memo, useId } from 'react';
import '@/styles/characterMotion.css';

export const MASCOT_MOODS = ['welcome', 'waiting', 'roll', 'buy', 'earn', 'traffic', 'win'];

/** A little city guide. Every moving part has its own pivot; scenes play once on entry. */
function AutoMascotBase({ mood = 'welcome', className = '', size = 120, animated = true, title }) {
  const id = `auto${useId().replace(/[^a-z0-9]/gi, '')}`;
  const state = MASCOT_MOODS.includes(mood) ? mood : 'welcome';
  const happy = ['welcome', 'earn', 'win', 'buy'].includes(state);
  return (
    <svg className={`auto-mascot ${animated ? 'is-animated' : ''} ${className}`.trim()} data-mood={state} width={size} height={size * .75} viewBox="0 0 240 180" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`${id}body`} x2=".2" y2="1"><stop stopColor="#ffe593"/><stop offset="1" stopColor="#efa844"/></linearGradient>
        <linearGradient id={`${id}glass`} x2="1" y2="1"><stop stopColor="#d5f4ec"/><stop offset="1" stopColor="#74b8b7"/></linearGradient>
      </defs>
      <ellipse className="am-shadow" cx="119" cy="159" rx="77" ry="9" fill="#111d30" opacity=".18"/>
      <g className="am-arrive">
        <g className="am-body" stroke="#243442" strokeWidth="3" strokeLinejoin="round">
          <path d="M64 91 70 48Q73 32 90 32H156Q175 32 179 53L185 101Z" fill="#234b4b"/>
          <path d="M75 48Q77 39 91 39H155Q166 39 170 49" stroke="#65877a" fill="none" strokeLinecap="round"/>
          <path d="m76 57-8 44h109l-7-44Z" fill={`url(#${id}glass)`}/>
          <path d="m84 59-7 32m16-32-3 13" stroke="#fffbed" strokeWidth="4" strokeLinecap="round" opacity=".65"/>
          <path d="M66 96Q59 98 55 111L48 140Q48 150 60 150H179Q190 150 189 139l-7-29q-4-14-14-14Z" fill={`url(#${id}body)`}/>
          <path d="M52 126H187V143H50Z" fill="#328473"/>
          <path d="M82 150V139M159 150V139" stroke="#1c5c55"/>
          <path d="M58 114H78M161 114H178" stroke="#fff2bc" strokeWidth="8" strokeLinecap="round"/>
          <path d="M91 107h57" stroke="#b77c35" strokeWidth="2"/>
          <rect x="105" y="134" width="31" height="11" rx="3" fill="#fff2c6" strokeWidth="1.5"/>
          <path d="M111 139h19" strokeWidth="1.5"/>
          <path d="m63 87-12-8m126 8 12-8" fill="none" strokeLinecap="round"/>
          <ellipse cx="48" cy="77" rx="7" ry="10" fill="#328473"/>
          <ellipse cx="192" cy="77" rx="7" ry="10" fill="#328473"/>
          <g className="am-eyes" fill="#203a40" stroke="none">
            <ellipse cx="101" cy="79" rx="5.4" ry={state === 'traffic' ? 3 : 7}/><ellipse cx="142" cy="79" rx="5.4" ry={state === 'traffic' ? 3 : 7}/>
            <circle cx="102.5" cy="77" r="1.8" fill="#fff"/><circle cx="143.5" cy="77" r="1.8" fill="#fff"/>
          </g>
          {state === 'traffic' ? <path d="m109 91 18-1" fill="none" strokeWidth="2.5" strokeLinecap="round"/> : <path d={happy ? 'M110 89Q121 101 132 89' : 'M115 91Q121 95 127 91'} fill={happy ? '#734d42' : 'none'} strokeWidth="2" strokeLinecap="round"/>}
          <g className="am-cheeks" fill="#e9876c" stroke="none" opacity=".65"><ellipse cx="87" cy="90" rx="6" ry="3"/><ellipse cx="156" cy="90" rx="6" ry="3"/></g>
          <g className="am-wheel"><circle cx="70" cy="151" r="14" fill="#253744"/><circle cx="70" cy="151" r="7" fill="#adc4bd"/><path d="m65 146 10 10m0-10-10 10" strokeWidth="2"/></g>
          <g className="am-wheel"><circle cx="167" cy="151" r="14" fill="#253744"/><circle cx="167" cy="151" r="7" fill="#adc4bd"/><path d="m162 146 10 10m0-10-10 10" strokeWidth="2"/></g>
          <g className="am-hand"><path d="m180 112 20-12 2-17" fill="none" stroke="#328473" strokeWidth="7" strokeLinecap="round"/><path d="M199 85v-9m5 9 3-7m-8 7-5-5" stroke="#ffda88" strokeWidth="4" strokeLinecap="round"/></g>
        </g>
        {state === 'buy' && <g className="am-prop am-key" fill="#ffd572" stroke="#7c6133" strokeWidth="2"><circle cx="204" cy="60" r="9"/><circle cx="204" cy="60" r="3" fill="#fff2d3"/><path d="M204 69v19h7v-5h-7"/></g>}
        {state === 'roll' && <g className="am-prop am-die"><rect x="193" y="44" width="29" height="29" rx="6" fill="#fff5dc" stroke="#bca986" strokeWidth="2"/>{[[200,51],[214,51],[207,58],[200,66],[214,66]].map(([x,y])=><circle key={`${x}${y}`} cx={x} cy={y} r="2" fill="#244943"/>)}</g>}
        {state === 'waiting' && <g className="am-prop am-clock" stroke="#345355" strokeWidth="2"><circle cx="207" cy="62" r="15" fill="#fff0cc"/><path d="M207 52v11l7 4" fill="none" strokeLinecap="round"/></g>}
        {state === 'traffic' && <g className="am-prop am-traffic" stroke="#34434a" strokeWidth="2"><path d="M213 89v51"/><rect x="202" y="35" width="22" height="55" rx="7" fill="#34434a"/><circle cx="213" cy="47" r="6" fill="#f07768"/><circle cx="213" cy="63" r="6" fill="#907947"/><circle cx="213" cy="79" r="6" fill="#436b5c"/></g>}
        {state === 'earn' && <g className="am-prop am-coins" fill="#ffd16c" stroke="#b58436" strokeWidth="2">{[0,1,2].map(n=><g key={n}><ellipse cx={205-n*7} cy={72-n*16} rx="10" ry="11"/><path d={`M${202-n*7} ${66-n*16}h6m-6 4h6m-6-4v12`}/></g>)}</g>}
        {state === 'win' && <g className="am-crown" fill="#ffd16c" stroke="#a67532" strokeWidth="2"><path d="m91 25-5-18 18 10 15-15 15 15 18-10-5 18Z"/><path d="M92 25h54v7H92Z"/><circle cx="120" cy="24" r="3" fill="#e9816b"/></g>}
      </g>
      {(state === 'win' || state === 'earn') && <g className="am-sparks" stroke="#eab753" strokeWidth="2" strokeLinecap="round"><path d="M32 48v12m-6-6h12M192 18v10m-5-5h10M25 112v8m-4-4h8"/></g>}
    </svg>
  );
}

export const AutoMascot = memo(AutoMascotBase);
export default AutoMascot;
