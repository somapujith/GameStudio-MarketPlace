import LocationScene from '@/components/art/LocationScene.jsx';
import AutoMascot from '@/components/art/AutoMascot.jsx';
import { sceneOf } from './sceneModel.js';
import '@/styles/sceneStage.css';

function Train({ mode }) {
  return <svg className="story-train" viewBox="0 0 320 150" aria-hidden="true">
    <path d="M8 127h304M8 135h304" stroke="#7899a0" strokeWidth="3" />
    <g className="story-train__body">
      <path d="M32 45h218q30 0 38 28l8 37H28V54q0-9 4-9Z" fill={mode === 'mmts' ? '#efd9a7' : '#a5e4ee'} stroke="#183b4b" strokeWidth="4" />
      <path d="M29 90h261v14H29z" fill={mode === 'mmts' ? '#a8665f' : '#4289d3'} />
      {[45, 86, 127, 168, 209].map((x) => <rect key={x} x={x} y="57" width="29" height="24" rx="4" fill="#214859" stroke="#f2f9ec" strokeWidth="2" />)}
      <path d="m257 57 12 1 12 23h-24z" fill="#214859" />
      {[60, 99, 224, 263].map((x) => <g key={x}><circle cx={x} cy="115" r="10" fill="#18313d" /><circle cx={x} cy="115" r="4" fill="#bcd3cc" /></g>)}
      <path d="M60 40h150" stroke="#ffc857" strokeWidth="4" strokeLinecap="round" />
    </g>
  </svg>;
}

export default function SceneStage({ session }) {
  const scene = sceneOf(session);
  if (!scene) return null;
  const character = ['welcome', 'cash', 'traffic', 'roll', 'travel'].includes(scene.kind);
  return (
    <div className={`city-story city-story--${scene.kind}`} data-event={scene.event} key={scene.key} style={{ '--story-accent': scene.color }} aria-hidden="true">
      <div className="city-story__picture">
        {character ? (
          <><div className="city-story__street"><i /><i /><i /><i /><i /></div>
            {scene.kind === 'travel' && ['metro', 'mmts'].includes(scene.transport)
              ? <Train mode={scene.transport} />
              : <AutoMascot mood={scene.mood} size={180} className="city-story__mascot" />}
          </>
        ) : <LocationScene tile={scene.tile} level={scene.level} compact className="city-story__location" />}
        {scene.kind === 'purchase' ? <span className="city-story__stamp">OPEN</span> : null}
        {scene.kind === 'build' ? <span className="city-story__build"><i /><i /><i /></span> : null}
        {scene.kind === 'cash' ? <div className="city-story__coins">{[0, 1, 2].map((n) => <i key={n}>₹</i>)}</div> : null}
        {scene.kind === 'chai' ? <div className="city-story__steam"><i /><i /><i /></div> : null}
        {scene.event === 'monsoon' ? <div className="city-story__rain">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ left: `${i * 10 + 3}%`, animationDelay: `${i * 55}ms` }} />)}</div> : null}
        {['wedding_season', 'festival'].includes(scene.event) ? <div className="city-story__garland">{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div> : null}
      </div>
      <div className="city-story__caption"><span>{scene.label}</span>{scene.detail ? <b data-positive={scene.positive}>{scene.detail}</b> : null}</div>
    </div>
  );
}
