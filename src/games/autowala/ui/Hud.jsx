// OWNER: HUD agent. The Vice City-style heads-up display. Props: { game, snap }.
// Layout: wallet / rating / rides top-left, clock + pause button top-right, trip panel (or the "find a customer" hint) top-centre,
// interaction prompt bottom-centre, speedometer + CNG + drift charge bottom-RIGHT with the ROAD RAGE meter and the rules strip (signal,
// camera, police check) above it and the speed-limit sign on its corner (the minimap owns bottom-LEFT), the job chip (demand, today,
// rent, dents, tiredness + chai) under the wallet and the rain chip in the clock. Effects sit behind it all.
// Every snapshot key beyond the core ones (trip, route, waitingCount, rage...) is optional: nothing here may crash without it.
import { useCallback, useEffect, useRef, useState } from 'react';
import Speedometer from './hud/Speedometer.jsx';
import TripPanel from './hud/TripPanel.jsx';
import RageMeter from './hud/RageMeter.jsx';
import RulesStrip from './hud/RulesStrip.jsx';
import JobChip from './hud/JobChip.jsx';
import { WalletBlock, ClockBlock } from './hud/StatBlocks.jsx';
import { DriftFlair, Effects, Prompt } from './hud/HudExtras.jsx';
import { AlertsLane, MoreSheet, Strip } from './hud/Compact.jsx';
import { careerView, formatCountdown, rageView, rulesView, weatherView } from './hud/hudLogic.js';
import { alertCap, alertList, moreBadge, tripSlot } from './hud/layoutLogic.js';
import { useHudLayout, useRootAttrs } from './hud/useHudLayout.js';
import { useReducedMotion } from './hud/useGameMenu.js';
import { useTouchMode } from './hud/touchMode.js';
import { useMedia } from './workshop/hooks.js';
import './hud.css';
import './hud/rules.css';
import './hud/phone.css';

export default function Hud({ game, snap }) {
  const touch = useTouchMode();
  const reduced = useReducedMotion();
  const phone = useMedia('(max-width: 700px)');
  const layout = useHudLayout();
  const root = useRef(null);
  const [sheet, setSheet] = useState(false);
  const pause = useCallback(() => game?.input?.setTouch('pause', true), [game]);
  const tapPrompt = useCallback((action) => game?.input?.setTouch(action, true), [game]);
  const toggleSheet = useCallback(() => setSheet((o) => !o), []);
  const shortcut = useCallback(
    (id) => {
      setSheet(false);
      if (id === 'controls') window.dispatchEvent(new CustomEvent('aw-touch-settings'));
      else game?.input?.setTouch(id, true);
    },
    [game],
  );
  const closeSheet = useCallback(() => setSheet(false), []);
  const menu = snap?.menu || '';
  const rules = rulesView(snap?.rules, snap?.kmh);
  const rage = rageView(snap?.rage);
  const quest = snap?.quest?.active || null;
  const missionTime = quest && quest.timeLeft != null ? formatCountdown(quest.timeLeft) : '';
  const alerts = layout.compact ? alertList(rules, rage, quest ? quest.title || 'Mission' : '', alertCap(layout)) : [];
  const alertKinds = alerts.map((a) => a.kind);
  // the layout attributes on the .aw root: the phone stylesheets (hud/phone.css, minimap.css, subtitles.css, toasts.css) key on them
  useRootAttrs(root, layout, {
    trip: layout.compact ? tripSlot(!!snap?.trip) : '',
    alerts: alerts.length,
    fare: !!snap?.fareChoice,
    sheet: layout.compact && sheet,
  });
  // Esc closes the open More sheet (and only that: it must not also open the pause menu) and hands the focus back to the More button
  useEffect(() => {
    if (!sheet) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setSheet(false);
      root.current?.querySelector('.aw-more-btn')?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sheet]);
  // a menu (pause, workshop...) closes the sheet; so does leaving the compact layout
  useEffect(() => {
    if (menu || !layout.compact) setSheet(false);
  }, [menu, layout.compact]);
  if (!snap) return null;
  const careerV = careerView(snap.career);
  const weather = weatherView(snap.weather);

  if (layout.compact) {
    return (
      <div ref={root} className={`aw-hud aw-hud--compact ${reduced ? 'aw-hud--calm' : ''}`} data-menu={menu}>
        <Effects game={game} snap={snap} />
        <Strip
          snap={snap}
          trip={snap.trip}
          route={snap.route}
          reduced={reduced}
          weather={weather}
          onPause={pause}
          onMore={toggleSheet}
          moreOpen={sheet}
          badge={moreBadge({ career: careerV, quest: snap.quest, rules })}
        />
        <AlertsLane rules={rules} kinds={alertKinds} rage={snap.rage} mission={quest ? quest.title || 'Mission' : ''} missionTime={missionTime} />
        <Prompt prompt={snap.prompt} touch={touch} onTap={tapPrompt} />
        <DriftFlair drifting={snap.drifting} charge={snap.driftCharge} />
        <div className="aw-corner">
          <Speedometer snap={snap} compact pod={layout.land} sign={rules?.sign} />
        </div>
        <MoreSheet open={sheet && !menu} onClose={closeSheet} game={game} snap={snap} careerV={careerV} rulesV={rules} weather={weather} onShortcut={shortcut} />
      </div>
    );
  }

  // the job chip rides in the top-left column; on phones it sits under the trip panel instead (the panel spans the width there)
  const chip = <JobChip game={game} view={careerV} hidden={!!menu} />;
  return (
    <div ref={root} className={`aw-hud ${touch ? 'aw-hud--touch' : ''} ${reduced ? 'aw-hud--calm' : ''}`} data-menu={menu}>
      <Effects game={game} snap={snap} />
      <WalletBlock wallet={snap.wallet} rating={snap.rating} rides={snap.rides} reduced={reduced}>
        {!phone && chip}
      </WalletBlock>
      <ClockBlock hour={snap.hour} day={snap.day} onPause={pause} weather={weather} />
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
