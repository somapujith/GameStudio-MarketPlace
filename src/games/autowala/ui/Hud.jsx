// OWNER: HUD agent. The Vice City-style heads-up display. Props: { game, snap }.
// Layout: wallet / rating / rides top-left, clock + pause button top-right, trip panel (or the "find a customer" hint) top-centre,
// interaction prompt bottom-centre, speedometer + CNG + drift charge bottom-RIGHT with the ROAD RAGE meter and the rules strip (signal,
// camera, police check) above it and the speed-limit sign on its corner (the minimap owns bottom-LEFT), the job chip (demand, today,
// rent, dents, tiredness + chai) under the wallet and the rain chip in the clock. Effects sit behind it all.
// Every snapshot key beyond the core ones (trip, route, waitingCount, rage...) is optional: nothing here may crash without it.
import { useCallback } from 'react';
import Speedometer from './hud/Speedometer.jsx';
import TripPanel from './hud/TripPanel.jsx';
import RageMeter from './hud/RageMeter.jsx';
import RulesStrip from './hud/RulesStrip.jsx';
import JobChip from './hud/JobChip.jsx';
import { WalletBlock, ClockBlock } from './hud/StatBlocks.jsx';
import { DriftFlair, Effects, Prompt } from './hud/HudExtras.jsx';
import { careerView, rulesView, weatherView } from './hud/hudLogic.js';
import { useReducedMotion } from './hud/useGameMenu.js';
import { useTouchMode } from './hud/touchMode.js';
import { useMedia } from './workshop/hooks.js';
import './hud.css';
import './hud/rules.css';

export default function Hud({ game, snap }) {
  const touch = useTouchMode();
  const reduced = useReducedMotion();
  const phone = useMedia('(max-width: 700px)');
  const pause = useCallback(() => game?.input?.setTouch('pause', true), [game]);
  const tapPrompt = useCallback((action) => game?.input?.setTouch(action, true), [game]);
  if (!snap) return null;
  const menu = snap.menu || '';
  const rules = rulesView(snap.rules, snap.kmh);
  // the job chip rides in the top-left column; on phones it sits under the trip panel instead (the panel spans the width there)
  const chip = <JobChip game={game} view={careerView(snap.career)} hidden={!!menu} />;
  return (
    <div className={`aw-hud ${touch ? 'aw-hud--touch' : ''} ${reduced ? 'aw-hud--calm' : ''}`} data-menu={menu}>
      <Effects game={game} snap={snap} />
      <WalletBlock wallet={snap.wallet} rating={snap.rating} rides={snap.rides} reduced={reduced}>
        {!phone && chip}
      </WalletBlock>
      <ClockBlock hour={snap.hour} day={snap.day} onPause={pause} weather={weatherView(snap.weather)} />
      <TripPanel trip={snap.trip} route={snap.route} waitingCount={snap.waitingCount} reduced={reduced}>
        {phone && chip}
      </TripPanel>
      <Prompt prompt={snap.prompt} touch={touch} onTap={tapPrompt} />
      <DriftFlair drifting={snap.drifting} charge={snap.driftCharge} />
      <div className="aw-corner">
        <RageMeter rage={snap.rage} />
        <RulesStrip view={rules} />
        <Speedometer snap={snap} compact={touch} sign={rules?.sign} />
      </div>
    </div>
  );
}
