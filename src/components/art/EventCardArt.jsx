import { memo, useId } from 'react';
import '@/styles/eventCardArt.css';

// Illustration recipes are keyed by engine IDs, never by translated card copy.
export const CARD_ART = Object.freeze({
  biryani_viral: { scene: 'food', prop: 'viral', accent: '#e99c51' },
  investor: { scene: 'office', prop: 'cheque', accent: '#54c9ae' },
  cricket_night: { scene: 'stadium', prop: 'cricket', accent: '#9ebd7b' },
  metro_hitec: { scene: 'travel', prop: 'metro', accent: '#74bed6' },
  free_chai: { scene: 'chai', prop: 'gift', accent: '#ddb17b' },
  birthday: { scene: 'celebrate', prop: 'cake', accent: '#e899af' },
  haleem_season: { scene: 'food', prop: 'haleem', accent: '#b2c777' },
  film_shoot: { scene: 'film', prop: 'shoot', accent: '#b29bdc' },
  app_deal: { scene: 'office', prop: 'app', accent: '#8daeee' },
  go_start: { scene: 'heritage', prop: 'home', accent: '#e9bf79' },
  auto_shortcut: { scene: 'travel', prop: 'shortcut', accent: '#e9bf61' },
  next_ride: { scene: 'travel', prop: 'platform', accent: '#75c3c5' },
  pearl_deal: { scene: 'market', prop: 'pearls', accent: '#cfaddd' },
  ghmc_rebate: { scene: 'paperwork', prop: 'rebate', accent: '#7ec4b2' },
  necklace_sunset: { scene: 'lake', prop: 'sunset', accent: '#efa17e' },
  gachibowli_client: { scene: 'office', prop: 'meeting', accent: '#91b2d6' },
  kirana_karma: { scene: 'market', prop: 'groceries', accent: '#c7b477' },
  mall_draw: { scene: 'celebrate', prop: 'ticket', accent: '#e9bc66' },
  shaadi_season: { scene: 'celebrate', prop: 'wedding', accent: '#dc92aa' },
  ameerpet_traffic: { scene: 'traffic', prop: 'signal', accent: '#e99b83' },
  landlord_advance: { scene: 'paperwork', prop: 'keys', accent: '#bb9ecb' },
  monsoon_leaks: { scene: 'weather', prop: 'roof', accent: '#82b4ce' },
  pothole: { scene: 'traffic', prop: 'puddle', accent: '#83b1c1' },
  challan_sms: { scene: 'phone', prop: 'challan', accent: '#e5a17e' },
  power_cut: { scene: 'weather', prop: 'power', accent: '#9897c9' },
  water_tanker: { scene: 'travel', prop: 'tanker', accent: '#8bc5d4' },
  wrong_flyover: { scene: 'travel', prop: 'flyover', accent: '#b2a1cc' },
  chai_round: { scene: 'chai', prop: 'round', accent: '#dfa678' },
  inspection: { scene: 'paperwork', prop: 'inspection', accent: '#c8b38c' },
  municipal_summons: { scene: 'heritage', prop: 'municipal', accent: '#b6b9ce' },
  matchday_jam: { scene: 'traffic', prop: 'stadium', accent: '#95b693' },
  honest_auto: { scene: 'travel', prop: 'phone', accent: '#e4bc65' },
  biryani_queue: { scene: 'food', prop: 'queue', accent: '#e2a782' },
  property_notice: { scene: 'paperwork', prop: 'tax', accent: '#d19f95' },
  catering_order: { scene: 'food', prop: 'catering', accent: '#d7ba75' },
  festival_crowd: { scene: 'market', prop: 'festival', accent: '#d99fb9' },
});

const INK = '#263d46';
const PAPER = '#fff4dc';

function Person({ x = 0, y = 0, color = '#64b7a8', pose = 'normal', flip = false }) {
  return <g transform={`translate(${x} ${y})${flip ? ' scale(-1 1)' : ''}`} stroke={INK} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m-7 25-3 26m19-26 4 26" fill="none" />
    <path d="M-13 5Q0-2 13 5l4 26h-32Z" fill={color} />
    <path d={pose === 'wave' ? 'M12 8 24 2 28-12' : 'M12 9 24 20 32 16'} fill="none" />
    <path d="m-12 9-11 16" fill="none" />
    <circle cy="-9" r="12" fill="#d99c77" />
    <path d="M-12-10q0-19 19-10l6 12-8-7-16 7" fill={INK} stroke="none" />
    <circle cx="4" cy="-9" r="1.2" fill={INK} stroke="none" />
    <path d="M2-3q4 3 7-1" fill="none" strokeWidth="1.5" />
    <path d="m-10 52-7 1m30-1 7 1" />
  </g>;
}

function Steam({ x = 0, y = 0 }) {
  return <g transform={`translate(${x} ${y})`} fill="none" stroke="#fff9e7" strokeWidth="3.5" strokeLinecap="round">
    {[0, 14, 28].map((n) => <path className="eca-steam" key={n} style={{ animationDelay: `${700 + n * 12}ms` }} d={`M${n} 0q-8-10 0-20t0-20`} />)}
  </g>;
}

function Auto({ x = 130, y = 95, color = '#e7b550' }) {
  return <g transform={`translate(${x} ${y})`} stroke={INK} strokeWidth="3" strokeLinejoin="round">
    <g className="eca-vehicle">
      <ellipse cx="53" cy="57" rx="67" ry="8" fill={INK} opacity=".12" stroke="none" />
      <path d="M-4 19 12-16h62l23 35 15 11v21H-9V27Z" fill={color} />
      <path d="M12-16h62l8 13H6Z" fill={INK} />
      <path d="M16-2h28v30H3Zm37 0h18l20 29H53Z" fill="#bce2df" />
      <path d="M48-1v51M-5 37h38m52 0h21" fill="none" />
      <rect x="-5" y="38" width="12" height="8" rx="2" fill={PAPER} />
      {[15, 88].map((cx) => <g key={cx}><circle cx={cx} cy="49" r="13" fill={INK} /><circle cx={cx} cy="49" r="6" fill="#b1bec0" /><path d={`M${cx-4} 49h8m-4-4v8`} strokeWidth="1.5" /></g>)}
      <path d="M60 14q5-11 12 0m-10 7h8" fill="none" strokeWidth="2" />
      <path d="M98 21h12" />
    </g>
  </g>;
}

function Shop({ color = '#e79e70', food = false }) {
  return <g stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
    <path d="M78 71h159v99H78Z" fill={PAPER} />
    <path d="M69 68 83 44h149l15 24Z" fill={color} />
    <g className="eca-awning">{[0,1,2,3,4,5].map((i) => <path key={i} d={`M${69+i*30} 68h30v16q-15 13-30 0Z`} fill={i%2?PAPER:color} />)}</g>
    <rect x="94" y="97" width="49" height="73" rx="2" fill="#315c62" />
    <rect x="159" y="97" width="61" height="45" rx="3" fill="#a3d4ca" />
    <path d="M187 98v42m-26-19h56" fill="none" strokeWidth="2" />
    <path d="M143 170h92" strokeWidth="5" />
    {food && <><path d="M102 60h15m-7-8v16m70-9h30" stroke={PAPER} /><path d="M176 145h47v25h-47Z" fill={color} /></>}
  </g>;
}

function Pot({ haleem = false }) {
  return <g stroke={INK} strokeWidth="2.7" strokeLinejoin="round">
    <ellipse cx="156" cy="174" rx="58" ry="8" fill={INK} opacity=".12" stroke="none" />
    <path d="M109 128q0 49 47 49t47-49Z" fill={haleem?'#a4b96d':'#d79557'} />
    <ellipse cx="156" cy="128" rx="47" ry="13" fill="#f4d994" />
    {[0,1,2,3,4,5,6].map((i) => <path key={i} d={`m${126+i*9} ${125+(i%3)*4} 7 1`} stroke={i%2?'#b9673f':'#fff0bd'} />)}
    <path d="m110 143-13-4v14l15 4m89-14 13-4v14l-15 4" fill="none" />
    <g className="eca-lid"><path d="M107 117q48-38 98 0Z" fill={haleem?'#c6d89d':'#eab37b'} /><path d="M149 91v-6h14v6" fill={INK} /></g>
    <Steam x={142} y={110} />
  </g>;
}

function FoodScene({ prop, accent }) {
  return <><Shop color={accent} food /><Person x={255} y={102} color="#78b8a7" pose="wave" /><Pot haleem={prop==='haleem'} />
    {prop==='viral' && <g className="eca-prop" transform="translate(47 85) rotate(-12)"><rect width="37" height="61" rx="6" fill={INK} /><rect x="4" y="7" width="29" height="44" rx="2" fill="#eab7ab" /><path d="m18 21-8-5q-13 6 8 22 21-16 8-22Z" fill="#dc626b" /></g>}
    {prop==='queue' && <><Person x={39} y={112} color="#c8a0bd" /><Person x={65} y={125} color="#8aa6ca" /><circle cx="264" cy="42" r="18" fill={PAPER} stroke={INK} strokeWidth="2" /><path d="M264 30v13l8 4" fill="none" stroke={INK} strokeWidth="2" /></>}
    {prop==='catering' && <g fill={PAPER} stroke={INK} strokeWidth="2">{[0,1,2].map(i=><g key={i}><ellipse cx={48} cy={151-i*7} rx="27" ry="6" /><path d={`M25 ${151-i*7}v4q24 10 46 0v-4`} /></g>)}</g>}
    {prop==='haleem' && <path d="m48 20 3 8 9 1-7 6 2 9-7-5-8 5 3-9-8-6 10-1Z" fill="#f8dfa0" />}
  </>;
}

function OfficeScene({ prop, accent }) {
  return <><g fill="#8dafb4" opacity=".5">{[0,1,2,3].map(i=><rect key={i} x={70+i*43} y={40-(i%2)*17} width="30" height={110+(i%2)*17} rx="3" />)}</g>
    <g stroke={INK} strokeWidth="2.5"><path d="M69 138h185v13H69Zm16 13v33m154-33v33" fill="#d3a27c" /><Person x={59} y={94} color={accent} pose="wave" /><Person x={263} y={94} color="#dba087" flip />
      {prop==='app' ? <g className="eca-prop"><rect x="115" y="81" width="78" height="50" rx="4" fill="#315c62" /><path d="m105 137 10-7h79l10 7Z" fill="#b6d3cf" /><path d="m136 97-9 8 9 8m35-16 9 8-9 8m-16-20-9 27" fill="none" stroke="#9de1c8" /></g> : <g className="eca-prop"><path d="M115 101h93v32h-93Z" fill={PAPER} /><path d="M128 112h33m-33 10h58" stroke="#90b9a8" strokeWidth="3" />{prop==='meeting' ? <path d="M180 87V60h28v27m-23-7V70m8 10V64m8 16V56" fill="none" stroke={accent} strokeWidth="5" /> : <circle cx="196" cy="117" r="8" fill="#e7bd64" />}</g>}
    </g></>;
}

function ChaiScene({ prop }) {
  return <><Shop color="#b3c49b" /><g stroke={INK} strokeWidth="2.8"><path d="M44 158h233v12H44Zm18 12v20m195-20v20" fill="#ca946c" />
    {(prop==='round'?[86,153,220]:[142]).map(x=><g key={x}><ellipse cx={x} cy="148" rx="30" ry="7" fill={PAPER} /><path d={`M${x-20} 115h40l-4 30q-16 13-32 0Z`} fill={PAPER} /><path d={`M${x+20} 119q22-2 13 16l-15 3`} fill="none" /><path d={`M${x-17} 120h34l-2 8h-30Z`} fill="#ac704b" /><Steam x={x-12} y={109} /></g>)}
    {prop==='gift' && <><circle cx="222" cy="142" r="18" fill="#d9aa65" /><circle cx="222" cy="142" r="13" fill="none" stroke="#b17c43" strokeDasharray="2 5" /><Person x={46} y={104} color="#d99e90" pose="wave" /></>}
  </g></>;
}

function CelebrateScene({ prop, accent }) {
  const wedding=prop==='wedding';
  return <><g stroke={INK} strokeWidth="2.5"><path d="M40 172V64q120-82 240 0v108" fill="none" stroke={accent} strokeWidth="13" /><path d="M40 49q120 53 240 0" fill="none" />{[0,1,2,3,4,5,6].map(i=><circle className="eca-light" style={{animationDelay:`${800+i*70}ms`}} key={i} cx={40+i*40} cy={49+Math.sin(i/6*Math.PI)*25} r="5" fill="#f5cd74" />)}
    <Person x={66} y={116} color="#c49bcd" pose="wave" /><Person x={254} y={116} color="#6fbba9" pose="wave" flip />
    {prop==='ticket' ? <g className="eca-prop"><path d="M112 91h96v60h-96q10-10 0-20 10-10 0-20 10-10 0-20Z" fill="#f5cf79" /><path d="M182 94v54" strokeDasharray="4 4" /><path d="m145 105 5 9 10 1-7 7 2 11-10-5-10 5 2-11-7-7 10-1Z" fill="#dc926c" /></g> : <g className="eca-prop"><ellipse cx="160" cy="167" rx="48" ry="8" fill={PAPER} /><rect x="121" y="129" width="78" height="32" rx="5" fill={wedding?'#f6dcaf':'#e7a4b1'} /><rect x="133" y="106" width="54" height="25" rx="4" fill={PAPER} /><path d="M122 136q10 17 20 0 10 17 20 0 10 17 20 0 8 14 16 0" fill="none" stroke="#fff2dd" />{wedding?<path d="m147 95 13-11 13 11-13 11Z" fill={accent} />:<><path d="M160 105V89" /><path className="eca-flame" d="M160 89q-10-9 0-18 10 9 0 18" fill="#f1bd62" /></>}</g>}
    </g><g className="eca-confetti" fill={accent}><path d="m95 37 5 10-6 3-5-10Zm128-13 7 9-5 5-7-9ZM30 102l8 4-2 6-8-4Zm258 14 8-5 4 6-8 5Z" /></g></>;
}

function PaperScene({ prop, accent }) {
  return <><g fill="#b3c7bf" opacity=".6"><path d="M28 165V77h49v88Zm220 0V61h46v104Z" /></g><Person x={74} y={110} color={accent} /><g stroke={INK} strokeWidth="2.8"><g className="eca-paper"><path d="M115 40h87l27 27v111H115Z" fill={PAPER} /><path d="M202 40v27h27" fill="#e8d8bc" /><path d="M132 89h65m-65 14h76m-76 14h47m-47 14h58" stroke="#8babab" strokeWidth="4" />
      {prop==='rebate'?<g fill="#7aac8c"><circle cx="190" cy="151" r="18" /><path d="m179 151 8 8 16-18" fill="none" stroke={PAPER} strokeWidth="4" /></g>:prop==='keys'?<g className="eca-prop" fill="#e7bd64"><circle cx="190" cy="146" r="11" /><path d="M190 157v25h9v-8h8v-8h-9" /></g>:<g className="eca-stamp"><rect x="157" y="141" width="62" height="23" rx="3" fill="none" stroke="#cb827a" strokeWidth="3" /><path d="M164 148h48m-48 8h36" stroke="#cb827a" /></g>}
    </g>{prop==='tax'&&<><path d="M242 119h54v53h-54Z" fill={accent}/><path d="m238 119 31-24 31 24" fill="#526e75"/><path d="M258 146h13v26" fill={PAPER}/></>}{prop==='inspection'&&<g className="eca-prop"><circle cx="243" cy="91" r="22" fill="#a4d8d0" fillOpacity=".7"/><path d="m259 108 18 21" strokeWidth="8"/></g>}</g></>;
}

function HeritageScene({ prop }) {
  const municipal=prop==='municipal';
  return <g stroke={INK} strokeWidth="2.5"><path d="M67 170V83h186v87" fill="#e8ca94" />
    {municipal?<><path d="m57 80 103-49 103 49Z" fill="#e2b47f" />{[90,128,166,204].map(x=><g key={x}><rect x={x} y="87" width="14" height="76" fill={PAPER}/><path d={`M${x-3} 88h20m-20 75h20`}/></g>)}<path d="M57 173h206m-211 8h216" strokeWidth="7" /></>:<>{[80,227].map(x=><g key={x}><path d={`M${x-8} 167V45h16v122`} fill={PAPER}/><path d={`m${x-13} 45 13-25 13 25Z`} fill="#e8b976"/><path d={`M${x-12} 65h24m-24 67h24`} /></g>)}<path d="M122 170v-30a38 38 0 0 1 76 0v30" fill="#335f63"/><path d="M130 84V64q30-41 60 0v20Z" fill={PAPER}/></>}
    <Person x={48} y={121} color="#8cbcab" pose="wave"/><g className="eca-prop"><path d="M257 117h38v51h-38Z" fill={PAPER}/><path d="m264 144 12-13 12 13m-12-13v28" fill="none" stroke="#68a994" strokeWidth="4"/></g></g>;
}

function TravelScene({ prop, accent }) {
  const train=prop==='metro'||prop==='platform';
  return <><path d="M0 169h320" stroke="#809c9b" strokeWidth="20" /><path d="M0 172h320" stroke={PAPER} strokeWidth="2" strokeDasharray="20 16" />
    {prop==='flyover'&&<g stroke="#b7c6c1" strokeWidth="12" fill="none"><path d="M-10 110q110-70 340-46"/><path d="M63 90v75m173-99v96"/></g>}
    {train?<g className="eca-train" stroke={INK} strokeWidth="2.5"><path d="M43 91q0-24 25-24h189q20 0 20 24v62H43Z" fill={PAPER}/><path d="M44 121h232v19H44Z" fill={accent}/>{[0,1,2,3,4].map(i=><rect key={i} x={58+i*43} y="82" width="31" height="29" rx="4" fill="#9acbc9"/>)}<path d="M127 69v82m62-82v82" fill="none"/><path d="M46 157h228" strokeWidth="6"/></g>:prop==='tanker'?<g className="eca-vehicle" stroke={INK} strokeWidth="3"><rect x="65" y="84" width="141" height="66" rx="30" fill="#99d1d8"/><path d="M207 108h44l23 26v22h-67Z" fill="#dfb774"/><path d="M217 116h27l17 19h-44Z" fill="#c1e3dc"/>{[98,177,247].map(x=><circle key={x} cx={x} cy="156" r="14" fill={INK}/>)}<path d="M102 97v39m69-39v39" fill="none" stroke="#67a0ad"/></g>:<Auto x={111} y={109} color={accent}/>}
    {prop==='phone'?<><Person x={52} y={110} color="#8fbba8" pose="wave"/><g className="eca-prop"><rect x="66" y="81" width="24" height="40" rx="4" fill={INK}/><rect x="69" y="86" width="18" height="27" fill="#9fd6cc"/></g></>:<g stroke={INK} strokeWidth="2.3"><path d="M270 30v58"/><path d="M231 30h78v30h-78Z" fill="#78ac98"/><path d={prop==='flyover'?'m281 38-13 7 13 7m-13-7h27':'M242 45h54m-9-7 10 7-10 7'} fill="none" stroke={PAPER} strokeWidth="3"/></g>}
    {prop==='shortcut'&&<path className="eca-route" d="M20 145Q39 82 100 112T232 92" fill="none" stroke="#f9d384" strokeWidth="4" strokeDasharray="5 6"/>}
  </>;
}

function TrafficScene({ prop, accent }) {
  return <><path d="M0 167h320" stroke="#93a4a6" strokeWidth="25"/><path d="M0 170h320" stroke={PAPER} strokeWidth="2" strokeDasharray="18 13"/>
    {prop==='stadium'?<g stroke={INK} strokeWidth="2"><ellipse cx="156" cy="81" rx="106" ry="47" fill="#d8dab6"/><ellipse cx="156" cy="81" rx="78" ry="25" fill="#82a77e"/><path d="M49 31v54m214-54v54"/><path d="M36 31h26m188 0h26" strokeWidth="8"/></g>:<g stroke={INK} strokeWidth="3"><path d="M265 36v95"/><rect x="252" y="25" width="27" height="72" rx="8" fill={INK}/>{[0,1,2].map(i=><circle key={i} cx="265" cy={39+i*22} r="7" fill={i===0?'#e8807f':'#65787b'}/>)}</g>}
    <Auto x={39} y={114} color={accent}/><g stroke={INK} strokeWidth="2.5" className="eca-brake"><path d="m182 123 11-25h40l15 25 17 8v25h-94v-26Z" fill="#a7bfce"/><path d="m197 104-9 19h53l-12-19Z" fill="#d5e9e0"/>{[186,249].map(x=><circle key={x} cx={x} cy="155" r="11" fill={INK}/>)}</g>
    {prop==='puddle'&&<><ellipse className="eca-ripple" cx="176" cy="171" rx="32" ry="7" fill="#6cabb8"/><path d="m168 150-10-12m24 14 7-18" stroke="#8dc5cd" strokeWidth="3"/></>}
  </>;
}

function WeatherScene({ prop, accent }) {
  const power=prop==='power';
  return <><Shop color={accent}/>{power?<><path className="eca-power" d="M96 99h44v66H96Zm67 1h52v38h-52Z" fill="#f3cc73"/><g stroke={INK} strokeWidth="2.5"><path d="M252 40v132m-20-107h40M232 44h41"/><path d="m255 46-13 26 14-1-12 27" fill="none" stroke="#f6cb69" strokeWidth="4"/><rect x="244" y="139" width="48" height="34" rx="5" fill="#a1b6b0"/><circle cx="269" cy="155" r="9" fill="#47666b"/><path d="M275 133v-13h9" fill="none"/></g></>:<><g fill="#b7ced3"><path d="M36 50q-14-21 10-29 7-27 30-16 23-8 31 15 27 9 9 30Z"/><path d="M185 43q-17-25 10-34 15-16 30-5 27-13 33 18 30 5 14 22Z"/></g><g className="eca-rain" stroke="#8bb9d0" strokeWidth="2.5" strokeLinecap="round">{[0,1,2,3,4,5,6,7,8].map(i=><path key={i} d={`m${38+i*31} ${51+(i%3)*17}-8 17`}/>)}</g><path d="M157 90q-9 15 0 20 9-5 0-20" fill="#8bb9d0" className="eca-drop"/><g stroke={INK} strokeWidth="2.5"><path d="M142 141h39l-5 34h-29Z" fill="#9ac2c2"/><path d="M142 146q19-22 39 0" fill="none"/></g></>}
    <Person x={48} y={117} color="#d6a087"/>
  </>;
}

function PhoneScene() {
  return <><Person x={65} y={113} color="#8ab6a8"/><g className="eca-phone" stroke={INK} strokeWidth="3"><rect x="128" y="30" width="88" height="150" rx="15" fill={INK}/><rect x="135" y="41" width="74" height="123" rx="8" fill={PAPER}/><path d="M159 37h25" stroke="#9bb5b5"/><rect x="144" y="75" width="56" height="57" rx="7" fill="#edc3a6"/><path d="M154 94h36m-36 10h30m-30 10h20" stroke="#b78269" strokeWidth="3"/><circle cx="172" cy="57" r="8" fill="#e69b7d"/><path d="M172 52v6m0 4v1" stroke={PAPER} strokeWidth="2"/><circle cx="172" cy="172" r="3" fill="#9bb5b5"/></g><g className="eca-prop" stroke={INK} strokeWidth="2.5"><path d="M251 81v89"/><path d="M230 59h50v28h-50Z" fill="#a4c4c1"/><circle cx="249" cy="73" r="8" fill="#557d86"/><path d="m251 106-20 18m20-18 20 18" fill="none"/></g></>;
}

function LakeScene() {
  return <><circle cx="165" cy="75" r="39" fill="#f3b887"/><path d="M0 108q84-18 166 2t154-1v83H0Z" fill="#82b7bd"/><g className="eca-ripple" fill="none" stroke="#c0ded1" strokeWidth="2.5"><path d="M112 125h90m-68 12h46m-91 12h77m30 14h63"/></g><path d="M0 167q133-40 320 4v21H0Z" fill="#dcd0ae"/><path d="M0 158q130-40 320 4" fill="none" stroke={INK} strokeWidth="3"/><g stroke={INK} strokeWidth="2"><path d="M35 154v-19m61 12v-19m61 15v-19m61 22v-19m61 29v-19"/></g><g className="eca-boat" stroke={INK} strokeWidth="2"><path d="m215 132 42-3-9 12h-25Z" fill="#eab47c"/><path d="M237 129V94l19 30h-19Z" fill={PAPER}/></g><Person x={68} y={125} color="#a58db0"/></>;
}

function MarketScene({ prop, accent }) {
  return <><Shop color={accent}/><Person x={48} y={118} color="#81b4a6"/><Person x={264} y={116} color="#d6a086" flip/><g stroke={INK} strokeWidth="2.5"><path d="M103 135h120v36H103Z" fill="#d3a476"/>
    {prop==='pearls'?<g className="eca-prop" fill={PAPER}>{[0,1,2,3,4,5,6,7,8].map(i=><circle key={i} cx={125+i*10} cy={122+Math.sin(i/8*Math.PI)*14} r="6"/>)}<path d="M144 122h36l-18-19Z" fill="#e9c776"/></g>:<>{[0,1,2,3,4].map(i=><g key={i}><path d={`M${112+i*21} 133v-25h16v25Z`} fill={i%2?'#d1bc74':'#8fb48a'}/><path d={`M${115+i*21} 113h10`} stroke={PAPER}/></g>)}</>}
    {prop==='festival'&&<><path d="M20 22q140 54 280 0" fill="none"/>{[0,1,2,3,4,5].map(i=><g className="eca-light" key={i}><path d={`M${39+i*46} ${32+Math.sin(i/5*Math.PI)*18}v15`} stroke="#d0a56a"/><ellipse cx={39+i*46} cy={54+Math.sin(i/5*Math.PI)*18} rx="11" ry="14" fill={i%2?'#e8b968':'#e49f9e'}/></g>)}</>}
  </g></>;
}

function StadiumScene() {
  return <g stroke={INK} strokeWidth="2.5"><ellipse cx="163" cy="133" rx="119" ry="46" fill="#d1d7b5"/><ellipse cx="163" cy="133" rx="91" ry="29" fill="#7fad86"/><path d="M50 44v90m225-90v90"/><path d="M36 44h29m196 0h29" strokeWidth="11"/><g fill="#f5d387" className="eca-light"><path d="m36 47 14 67 14-67Zm225 0 14 67 14-67Z" opacity=".3"/></g><path d="M150 115h23v38h-23Z" fill="#d5bd88"/><path d="M154 137v13m5-13v13m5-13v13" stroke={PAPER} strokeWidth="1.5"/><g className="eca-prop"><path d="m205 85 33-46 10 7-31 47-6 3Z" fill="#e4bb79"/><circle cx="234" cy="110" r="7" fill="#dc817e"/><path d="m232 104 4 12" stroke={PAPER} strokeWidth="1.3"/></g><Person x={73} y={112} color="#80b4ba" pose="wave"/></g>;
}

function FilmScene({ accent }) {
  return <><Shop color={accent}/><g stroke={INK} strokeWidth="2.5"><g className="eca-prop"><rect x="119" y="108" width="88" height="54" rx="4" fill={INK}/><path d="m119 110 81-22 5 16-81 22Z" fill={PAPER}/>{[0,1,2,3].map(i=><path key={i} d={`m${131+i*20} ${107-i*5} 8-9 7 7-8 9Z`} fill={INK}/>)}<path d="M134 139h48m-48 11h28" stroke={PAPER} strokeWidth="2"/></g><path d="M59 115v54m0-29-17 32m17-32 20 32" fill="none"/><rect x="35" y="83" width="48" height="31" rx="3" fill="#749b99"/><circle cx="46" cy="75" r="13" fill={INK}/><circle cx="72" cy="75" r="13" fill={INK}/><path d="m83 88 18-8v37l-18-8Z" fill={INK}/><path d="M265 56v116m0-31-18 31m18-31 18 31" fill="none"/><path d="M243 39h37v29h-37Z" fill={INK}/><path d="m245 68-42 83h103l-28-83Z" fill="#f4d78b" opacity=".4" stroke="none"/></g><Person x={229} y={109} color="#cc9d88" pose="wave"/></>;
}

const SCENES = { food: FoodScene, office: OfficeScene, chai: ChaiScene, celebrate: CelebrateScene, paperwork: PaperScene, heritage: HeritageScene, travel: TravelScene, traffic: TrafficScene, weather: WeatherScene, phone: PhoneScene, lake: LakeScene, market: MarketScene, stadium: StadiumScene, film: FilmScene };

function EventCardArtBase({ cardId, kind = 'neutral', deck = 'luck', className = '', animated = true }) {
  const id = `event-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const recipe = CARD_ART[cardId] || { scene: 'heritage', prop: 'home', accent: deck === 'drama' ? '#b1a0d0' : '#9ac5b4' };
  const Scene = SCENES[recipe.scene];
  return <svg className={`event-card-art${animated ? ' is-animated' : ''}${className ? ` ${className}` : ''}`} viewBox="0 0 320 192" fill="none" aria-hidden="true" focusable="false" data-card-art={CARD_ART[cardId] ? cardId : 'unknown'} data-kind={kind}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor={deck === 'drama' ? '#e3dae8' : '#d8ece0'} /><stop offset="1" stopColor="#fff1d3" /></linearGradient><clipPath id={`${id}-clip`}><rect width="320" height="192" rx="13" /></clipPath></defs>
    <g clipPath={`url(#${id}-clip)`}>
      <rect width="320" height="192" fill={`url(#${id})`} />
      <circle cx="274" cy="31" r="20" fill="#fff6d8" opacity=".8" />
      <path d="M0 151V96h22V82h27v69h213V87h28v14h30v91H0Z" fill="#8eafb0" opacity=".17" />
      <path d="M0 170h320v22H0Z" fill="#d8d6bb" />
      <Scene {...recipe} />
    </g>
  </svg>;
}

export const EventCardArt = memo(EventCardArtBase);
export default EventCardArt;
