// OWNER: HUD agent. The Vice City-style heads-up display. Props: { game, snap? }.
// Layout: wallet / rating / rides top-left, clock + pause button top-right, trip panel (or the "find a customer" hint) top-centre,
// interaction prompt bottom-centre, speedometer + CNG + drift charge bottom-RIGHT with the ROAD RAGE meter and the rules strip (signal,
// camera, police check) above it and the speed-limit sign on its corner (the minimap owns bottom-LEFT), the job chip (demand, today,
// rent, dents, tiredness + chai) under the wallet and the rain chip in the clock. Effects sit behind it all.
// Every snapshot key beyond the core ones (trip, route, waitingCount, rage...) is optional: nothing here may crash without it.
//
// The snapshot is NOT a prop that re-renders this tree: it lives in an external store (hud/snapStore.js, fed by AutowalaGame) and every piece below reads its own
// VIEW of it (hud/views.js), re-rendering only when what it prints changed. This shell re-renders when the layout attributes it writes on the root change
// (a trip starts or ends, a fare question opens, the alert count changes, the More badge flips), not 10 times a second. `snap` is only for a caller that has no
// store (a unit test, a story): it seeds a private one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Speedometer from './hud/Speedometer.jsx';
import TripPanel from './hud/TripPanel.jsx';
import RageMeter from './hud/RageMeter.jsx';
import RulesStrip from './hud/RulesStrip.jsx';
import JobChip from './hud/JobChip.jsx';
import { WalletBlock, ClockBlock } from './hud/StatBlocks.jsx';
import { DriftSlot, Effects, PromptSlot } from './hud/HudExtras.jsx';
import { AlertsLaneSlot, MoreSheetSlot, Strip } from './hud/Compact.jsx';
import { alertCap, tripSlot } from './hud/layoutLogic.js';
import { useHudLayout, useRootAttrs } from './hud/useHudLayout.js';
import { useReducedMotion } from './hud/useGameMenu.js';
import { useTouchMode } from './hud/touchMode.js';
import { SnapStoreProvider, createSnapStore, shallowEqual, useSnapStore, useView } from './hud/snapStore.js';
import { alertCountSelector, selBadge, selCareer, selClock, selRage, selRules, selShell, selTrip, selWallet, selWaiting, selWeather } from './hud/views.js';
import { useMedia } from './workshop/hooks.js';
import './hud.css';
import './hud/rules.css';
import './hud/phone.css';

// ---- the desktop HUD's pieces, each fed from the store ----------------------------------------------------------------------------------------------
function WalletSlot({ reduced, children }) {
  const w = useView(selWallet, shallowEqual);
  return w ? <WalletBlock wallet={w.wallet} rating={w.rating} rides={w.rides} reduced={reduced}>{children}</WalletBlock> : null;
}
function ClockSlot({ onPause }) {
  const c = useView(selClock, shallowEqual);
  const weather = useView(selWeather);
  return c ? <ClockBlock hour={c.hour} day={c.day} onPause={onPause} weather={weather} /> : null;
}
function TripSlot({ reduced, children }) {
  const t = useView(selTrip);
  const waiting = useView(selWaiting, Object.is);
  return <TripPanel t={t} waitingCount={waiting} reduced={reduced}>{children}</TripPanel>;
}
function RageSlot() {
  const rage = useView(selRage);
  return <RageMeter rage={rage} />;
}
function RulesSlot() {
  const rules = useView(selRules);
  return <RulesStrip view={rules} />;
}
function JobSlot({ game, hidden }) {
  const career = useView(selCareer);
  return <JobChip game={game} view={career} hidden={hidden} />;
}

export default function Hud({ game, snap }) {
  const outer = useSnapStore();
  const own = useMemo(() => (outer ? null : createSnapStore(snap ?? null)), [outer, snap]);
  const body = <HudBody game={game} />;
  return outer ? body : <SnapStoreProvider value={own}>{body}</SnapStoreProvider>;
}

function HudBody({ game }) {
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
  // the shell's own facts: the open menu, whether there is a trip / a fare question, how many alert chips, the More dot
  const shell = useView(selShell, shallowEqual);
  const cap = layout.compact ? alertCap(layout) : 0;
  const countSelector = useMemo(() => alertCountSelector(cap), [cap]);
  const alertCount = useView(countSelector, Object.is) ?? 0;
  const badge = useView(selBadge, Object.is);
  // the layout attributes on the .aw root: the phone stylesheets (hud/phone.css, minimap.css, subtitles.css, toasts.css) key on them
  useRootAttrs(root, layout, {
    trip: layout.compact ? tripSlot(!!shell?.tripOn) : '',
    alerts: alertCount,
    fare: !!shell?.fareOn,
    sheet: layout.compact && sheet,
  });
  const menu = shell ? shell.menu || '' : '';
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
  if (!shell) return null;

  if (layout.compact) {
    return (
      <div ref={root} className={`aw-hud aw-hud--compact ${reduced ? 'aw-hud--calm' : ''}`} data-menu={menu}>
        <Effects game={game} />
        <Strip reduced={reduced} onPause={pause} onMore={toggleSheet} moreOpen={sheet} badge={badge} />
        <AlertsLaneSlot cap={cap} />
        <PromptSlot touch={touch} onTap={tapPrompt} />
        <DriftSlot />
        <div className="aw-corner">
          <Speedometer compact pod={layout.land} />
        </div>
        <MoreSheetSlot open={sheet && !menu} onClose={closeSheet} game={game} onShortcut={shortcut} />
      </div>
    );
  }

  // the job chip rides in the top-left column; on phones it sits under the trip panel instead (the panel spans the width there)
  const chip = <JobSlot game={game} hidden={!!menu} />;
  return (
    <div ref={root} className={`aw-hud ${touch ? 'aw-hud--touch' : ''} ${reduced ? 'aw-hud--calm' : ''}`} data-menu={menu}>
      <Effects game={game} />
      <WalletSlot reduced={reduced}>{!phone && chip}</WalletSlot>
      <ClockSlot onPause={pause} />
      <TripSlot reduced={reduced}>{phone && chip}</TripSlot>
      <PromptSlot touch={touch} onTap={tapPrompt} />
      <DriftSlot />
      <div className="aw-corner">
        <RageSlot />
        <RulesSlot />
        <Speedometer compact={touch} />
      </div>
    </div>
  );
}
