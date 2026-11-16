// The power-card moments (docs/POWER_CARDS.md 3.3), drawn from `session.power` (the presenter commits one at a time and clears it
// after its ANIM_MS wait, so nothing here runs a timer of its own and nothing replays on resume).
//
//   draw     a card lifts out of the card tile (mine: face up with its name; a rival's: a card back) and flies to its pod, with a soft
//            gold sparkle and a "+1"
//   play     the card slams into the middle of the board with a `power` ribbon "<Player> played <Card>" + its one-line effect and a
//            ripple; a swap also pulses the two tiles (the pawns teleport through the engine's move events)
//   shield   a blue ring flashes on the pod + "BLOCKED / Saved <amount>"
//   double   a gold coin burst + "x2 RENT / +<amount>"
//   expire   a small toast "A power card expired" with a puff of dust
//
// One-shot, transform / opacity only, pointer-events none, one polite status line for screen readers. Reduced motion: short
// opacity fades, no particles, no pulses. data-perf='low': no particles either. Mounted once in GameView.
import { useEffect, useMemo, useState } from 'react';
import * as Art from '@/components/art/index.js';
import { usePerfLevel } from '@/lib/perfMode.js';
import { useReducedMotion } from '../ui/helpers.js';
import MomentBanner from '../moments/MomentBanner.jsx';
import Confetti from '../moments/Confetti.jsx';
import { GOLD_PALETTE } from '../moments/particles.js';
import { findEndpoint, tileBox } from '../fx/fxDom.js';
import { pulseTile } from '../fx/pulse.js';
import PowerCardArt from './PowerCardArt.jsx';
import { flightVars, momentView, originFrac, particleBudget, rectCenter } from './powerMomentModel.js';
import '@/styles/power-moments.css';

const part = (name) => {
  try {
    return Art[name] || null;
  } catch {
    return null; // a strict test mock throws on unknown exports
  }
};

const viewport = () => (typeof window === 'undefined' ? { w: 390, h: 760 } : { w: window.innerWidth || 390, h: window.innerHeight || 760 });
const ringPx = (el) => (el ? Math.round(Math.max(56, Math.min(132, Math.max(el.width || 0, el.height || 0) * 1.5))) : 88);

/** Where on screen a moment happens: the pod of `player` (a point + its box), measured once when the moment starts. */
function usePodPoint(player, enabled, key) {
  const [pod, setPod] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    const hit = findEndpoint(player);
    setPod(hit ? { pt: rectCenter(hit.rect), size: ringPx(hit.rect) } : { pt: null, size: 88 });
  }, [player, enabled, key]);
  return pod;
}

function CardFace({ meta }) {
  return (
    <span className="pm-card__frame">
      <b className="pm-card__name">{meta.name}</b>
      <span className="pm-card__art"><PowerCardArt id={meta.id} size={120} /></span>
      <span className="pm-card__fx">{meta.short}</span>
    </span>
  );
}

function Draw({ v, perfLow, reduced }) {
  const [geo, setGeo] = useState(null);
  useEffect(() => {
    const { w, h } = viewport();
    const t = v.from !== null ? tileBox(v.from) : null;
    const pod = findEndpoint(v.player);
    setGeo(flightVars(t ? rectCenter(t.box) : null, pod ? rectCenter(pod.rect) : null, w, h));
  }, [v.id, v.from, v.player]);
  const { w, h } = viewport();
  const n = particleBudget('draw', { reduced, perfLow });
  const Back = part('CardBack');
  const style = { '--pm-ms': `${v.ms || 900}ms`, ...(v.card ? { '--pm-c': v.card.color } : null), ...(geo ? { '--pm-x0': `${geo.x0}px`, '--pm-y0': `${geo.y0}px`, '--pm-x1': `${geo.x1}px`, '--pm-y1': `${geo.y1}px` } : null) };
  return (
    <div className="pm-draw" data-face={v.faceUp ? 'up' : 'down'} style={style}>
      <span className={`pm-draw__fly${geo ? ' is-ready' : ''}`}>
        <span className="pm-draw__card">
          {v.faceUp ? <CardFace meta={v.card} /> : Back ? <Back deck="drama" size={46} /> : <i className="pm-back" />}
        </span>
        {v.faceUp ? <b className="pm-draw__label">{v.label}</b> : null}
      </span>
      {geo ? <i className="pm-plus" style={{ left: geo.tx, top: geo.ty }} aria-hidden="true">+1</i> : null}
      {geo && n > 0 ? <Confetti kind="sparkle" count={n} origin={originFrac({ x: geo.tx, y: geo.ty }, w, h)} colors={GOLD_PALETTE} delay={Math.round((v.ms || 900) * 0.5)} burstKey={v.id} /> : null}
    </div>
  );
}

function Play({ v, perfLow, reduced }) {
  // a swap: ring both tiles (the pawns follow through the engine's teleport moves); nothing for a reduced / slow screen
  useEffect(() => {
    if (reduced || perfLow || !v.tiles.length) return;
    v.tiles.forEach((t) => pulseTile(t));
  }, [v.id, v.tiles, reduced, perfLow]);
  const life = Math.max(900, v.ms || 1500);
  return (
    <div className="pm-play" data-tone={v.card ? v.card.tone : 'gold'} style={{ '--pm-ms': `${life}ms`, '--pm-c': v.card ? v.card.color : '#ffc857' }}>
      <span className="pm-ripple" aria-hidden="true" />
      <span className="pm-ripple pm-ripple--2" aria-hidden="true" />
      {v.card ? <div className="pm-card"><CardFace meta={v.card} /></div> : null}
      <MomentBanner tone="power" kicker={v.banner.kicker} title={v.banner.title} sub={v.banner.sub} life={life} top="48%" />
    </div>
  );
}

function Trigger({ v, perfLow, reduced }) {
  const pod = usePodPoint(v.player, true, v.id);
  const { w, h } = viewport();
  const n = v.kind === 'double' ? particleBudget('double', { reduced, perfLow }) : 0;
  const pt = pod && pod.pt;
  const life = Math.max(900, v.ms || 1400);
  return (
    <div className={`pm-trig is-${v.kind}`} style={{ '--pm-ms': `${life}ms` }}>
      {v.kind === 'shield' && pod ? (
        <>
          <span className="pm-ring" aria-hidden="true" style={{ left: pt ? pt.x : '50%', top: pt ? pt.y : '12%', '--pm-ring': `${pod.size}px` }} />
          <span className="pm-ring pm-ring--2" aria-hidden="true" style={{ left: pt ? pt.x : '50%', top: pt ? pt.y : '12%', '--pm-ring': `${pod.size}px` }} />
        </>
      ) : null}
      {n > 0 && pod ? <Confetti kind="burst" count={n} origin={originFrac(pt, w, h)} colors={GOLD_PALETTE} burstKey={v.id} speed={1.1} /> : null}
      <MomentBanner tone="power" kicker={v.banner.kicker} title={v.banner.title} sub={v.banner.sub} life={life} top="34%" />
    </div>
  );
}

function Expire({ v }) {
  return (
    <div className="pm-toast" style={{ '--pm-ms': `${v.ms || 700}ms` }}>
      <span className="pm-toast__dust" aria-hidden="true"><i /><i /><i /></span>
      <span className="pm-toast__text">{v.text}</span>
    </div>
  );
}

export default function PowerMoments({ session }) {
  const m = session?.power ?? null;
  const reduced = useReducedMotion();
  const perf = usePerfLevel();
  const me = session?.me;
  const players = session?.display?.players || session?.view?.players || null;
  const v = useMemo(() => momentView(m, { players: players || [], me }), [m, players, me]);
  const perfLow = perf === 'low';
  return (
    <div className="pm-root" data-rm={reduced ? '' : undefined} data-kind={v ? v.kind : undefined}>
      <p className="sr-only pm-status" role="status" aria-live="polite" aria-atomic="true">{v ? v.sr : ''}</p>
      {v && v.kind === 'draw' ? <Draw key={v.id} v={v} perfLow={perfLow} reduced={reduced} /> : null}
      {v && v.kind === 'play' ? <Play key={v.id} v={v} perfLow={perfLow} reduced={reduced} /> : null}
      {v && (v.kind === 'shield' || v.kind === 'double') ? <Trigger key={v.id} v={v} perfLow={perfLow} reduced={reduced} /> : null}
      {v && v.kind === 'expire' ? <Expire key={v.id} v={v} /> : null}
    </div>
  );
}
