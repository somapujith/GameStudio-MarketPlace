// OWNER: touch-controls agent. The on-screen driving controls for phones and tablets. Props: { game }.
//   WHEEL (thumb side, default left): a steering wheel the thumb turns by dragging around its centre; springs back on release.
//        Modes: Wheel | Tilt (the phone is the wheel) | Arrows. PEDALS (other side): a big analogue GAS and a smaller BRAKE / REVERSE.
//   ACTIONS in an arc by the pedals: boost, handbrake/drift, interact (E), horn, camera; a "..." tray holds map, radio, phone, quests, pause
//        and the settings gear. Settings (steering, hand, size, opacity, auto-throttle, vibration) live in localStorage `jalebi.autowala.touch.v1`.
// Every control owns ONE pointer (setPointerCapture), so wheel + gas + a button all work at once; everything is released on pointercancel,
// blur, the page being hidden, a menu opening and unmount. The occupied space is published on the `.aw` root as CSS variables:
//   --aw-ctl-left-w, --aw-ctl-right-w, --aw-ctl-h (px, 0 when hidden)   and   data-ctl="land" | "port" (absent when hidden).
// Files: ui/touch/* (pure logic + parts), ui/touch.css. The game side is two hooks in game/input.js: setStick (analogue steer) and
// setPedals (analogue gas / brake).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buzz } from '@/lib/haptics.js';
import { enterFullscreen, exitFullscreen, fullscreenSupported, isFullscreen, keepAwake, lockGestures, lockOrientation, unlockOrientation, useTouchDevice, useViewport } from '@/lib/mobile.js';
import { useTouchMode } from './hud/touchMode.js';
import { useGameMenu } from './hud/useGameMenu.js';
import { ArrowPad, Wheel } from './touch/Wheel.jsx';
import { Pedal } from './touch/Pedals.jsx';
import { MainActions, MinorActions } from './touch/Actions.jsx';
import SettingsSheet from './touch/SettingsSheet.jsx';
import { computeLayout, regionsFromRects, sideFor } from './touch/layout.js';
import { hudLayout } from './hud/layoutLogic.js';
import { createTouchBus } from './touch/touchBus.js';
import { DEFAULTS, forcedByUrl, loadTouchSettings, saveTouchSettings } from './touch/touchSettings.js';
import { useTilt } from './touch/useTilt.js';
import './touch.css';

export default function TouchControls({ game }) {
  const touchDevice = useTouchDevice();
  const touchMode = useTouchMode();
  const menu = useGameMenu(game);
  const vp = useViewport();
  const [settings, setSettings] = useState(loadTouchSettings);
  const [sheet, setSheet] = useState(false);
  const [full, setFull] = useState(() => isFullscreen());
  const layer = useRef(null);
  const wheelRef = useRef(null);

  const forced = settings.force || forcedByUrl();
  const shown = !!game && !menu && (touchDevice || touchMode || forced);
  const live = shown && !sheet; // the sheet covers the controls: nothing may stay pressed under it

  const bus = useMemo(() => (game?.input ? createTouchBus(game.input) : null), [game]);
  const hapticsOn = useRef(true);
  hapticsOn.current = settings.haptics;
  const fx = useCallback((kind) => {
    if (hapticsOn.current) buzz(kind);
  }, []);
  const getSpeed = useCallback(() => game?.ctx?.v?.kmh || 0, [game]);
  const getFwd = useCallback(() => game?.ctx?.v?.fwd || 0, [game]);

  const update = useCallback((patch) => {
    setSettings((s) => saveTouchSettings({ ...s, ...patch }));
  }, []);
  const reset = useCallback(() => setSettings(saveTouchSettings({ ...DEFAULTS, force: false })), []);

  // ---- tilt -------------------------------------------------------------------------------------------------------------------------
  const tilt = useTilt({
    enabled: shown && settings.steering === 'tilt', // keeps listening under the settings sheet so Calibrate works there
    settings,
    bus: bus || NOOP_BUS,
    wheelRef,
    onCalibrated: (n) => update({ tiltNeutral: n }),
  });
  const tiltLive = settings.steering === 'tilt' && tilt.status === 'live';
  const mode = settings.steering === 'arrows' ? 'arrows' : 'wheel';

  // ---- release everything whenever the controls stop being usable ---------------------------------------------------------------------
  useEffect(() => {
    if (!bus) return undefined;
    bus.setActive(live);
    return undefined;
  }, [bus, live]);
  useEffect(() => {
    if (bus) bus.setAuto(settings.autoThrottle);
  }, [bus, settings.autoThrottle]);
  useEffect(() => {
    if (!bus) return undefined;
    const drop = () => bus.releaseAll();
    const onHide = () => document.visibilityState === 'hidden' && bus.releaseAll();
    window.addEventListener('blur', drop);
    window.addEventListener('pagehide', drop);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', drop);
      window.removeEventListener('pagehide', drop);
      document.removeEventListener('visibilitychange', onHide);
      bus.setActive(false); // unmount: no stuck throttle, steering or boost
    };
  }, [bus]);

  // on a compact HUD layout (phones and tablets) the More sheet carries the map / quests / phone / controls shortcuts: no "..." tray here
  const hudCompact = useMemo(() => hudLayout(vp, true).compact, [vp]);
  const layout = useMemo(() => computeLayout({ w: vp.w || 844, h: vp.h || 390 }, { size: settings.size, tray: !hudCompact }), [vp.w, vp.h, settings.size, hudCompact]);
  // the More sheet's "Controls" shortcut
  useEffect(() => {
    const open = () => setSheet(true);
    window.addEventListener('aw-touch-settings', open);
    return () => window.removeEventListener('aw-touch-settings', open);
  }, []);
  // an orientation / size change re-flows the controls under the fingers: let go of everything
  useEffect(() => {
    if (bus) bus.releaseAll();
  }, [bus, layout.mode, settings.hand, settings.steering, settings.size]);

  // ---- the game surface: no pinch zoom, no long-press menu, no pull-to-refresh; keep the screen on ----------------------------------
  useEffect(() => {
    if (!shown || !layer.current) return undefined;
    const root = layer.current.closest('.aw') || layer.current.parentElement;
    const unlock = lockGestures(root);
    let release = null;
    let dead = false;
    keepAwake().then((r) => {
      if (dead) r();
      else release = r;
    });
    return () => {
      dead = true;
      unlock();
      if (release) release();
    };
  }, [shown]);

  useEffect(() => {
    const on = () => setFull(isFullscreen());
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      document.removeEventListener('webkitfullscreenchange', on);
    };
  }, []);

  // ---- publish the occupied regions for the HUD --------------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const root = layer.current ? layer.current.closest('.aw') : null;
    if (!root) return undefined;
    const set = (l, r, h, m) => {
      root.style.setProperty('--aw-ctl-left-w', `${l}px`);
      root.style.setProperty('--aw-ctl-right-w', `${r}px`);
      root.style.setProperty('--aw-ctl-h', `${h}px`);
      if (m) root.setAttribute('data-ctl', m);
      else root.removeAttribute('data-ctl');
    };
    if (!shown) {
      set(0, 0, 0, null);
      return undefined;
    }
    const rb = root.getBoundingClientRect();
    // the HUD is drawn inside a zoom (--aw-ui-scale), so the regions it reads are in ITS pixels
    const zs = parseFloat(getComputedStyle(root).getPropertyValue('--aw-ui-scale')) || 1;
    const items = [...layer.current.querySelectorAll('[data-ctl-zone]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { zone: el.getAttribute('data-ctl-zone'), rect: { left: r.left - rb.left, right: r.right - rb.left, top: r.top - rb.top, bottom: r.bottom - rb.top, width: r.width } };
    });
    const reg = regionsFromRects(items, rb.width, rb.height, settings.hand);
    set(reg.left / zs, reg.right / zs, reg.h / zs, layout.mode);
    return undefined;
  });
  useEffect(() => {
    // leaving the page: give the space back
    const root = layer.current ? layer.current.closest('.aw') : null;
    return () => {
      if (!root) return;
      root.style.setProperty('--aw-ctl-left-w', '0px');
      root.style.setProperty('--aw-ctl-right-w', '0px');
      root.style.setProperty('--aw-ctl-h', '0px');
      root.removeAttribute('data-ctl');
    };
  }, [shown]);

  // The shared orientation gate (src/platform/game) pins landscape for the whole game. This button is the player's own fullscreen
  // toggle (settings sheet): what IT turned on is turned off again when the game screen unmounts, so the hub never stays sideways.
  const ours = useRef({ fullscreen: false, lock: false });
  useEffect(() => {
    const mine = ours.current;
    return () => {
      if (mine.lock) unlockOrientation();
      if (mine.fullscreen) exitFullscreen();
      mine.lock = false;
      mine.fullscreen = false;
    };
  }, []);
  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen()) {
      await exitFullscreen();
      ours.current.fullscreen = false;
    } else {
      const ok = await enterFullscreen(document.documentElement);
      if (ok) {
        ours.current.fullscreen = true;
        ours.current.lock = await lockOrientation('landscape');
      }
    }
    setFull(isFullscreen());
  }, []);

  if (!shown || !bus) return null;
  const wheelSide = sideFor(settings.hand, 'wheel');
  const pedalSide = sideFor(settings.hand, 'pedal');
  const canFull = fullscreenSupported();

  return (
    <div className={`aw-ct is-${layout.mode} hand-${settings.hand} size-${settings.size}`} onContextMenu={(e) => e.preventDefault()}>
      <div className="aw-ct-layer" ref={layer} style={{ '--ct-op': settings.opacity, '--ct-btn': `${layout.btn}px` }}>
        {mode === 'arrows' ? (
          <ArrowPad bus={bus} layout={layout} side={wheelSide} fx={fx} />
        ) : (
          <Wheel bus={bus} layout={layout} side={wheelSide} fx={fx} getSpeed={getSpeed} interactive={!tiltLive} handleRef={wheelRef}>
            {settings.steering === 'tilt' && (tilt.status === 'needs-permission' || tilt.status === 'live') && (
              <button
                type="button"
                className="aw-ct-calib"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (tilt.status === 'live') {
                    tilt.calibrate();
                    fx('select');
                  } else tilt.request();
                }}
              >
                {tilt.status === 'live' ? 'Calibrate' : 'Enable tilt'}
              </button>
            )}
          </Wheel>
        )}
        <Pedal kind="brake" box={layout.brake} side={pedalSide} bus={bus} fx={fx} getFwd={getFwd} />
        <Pedal kind="gas" box={layout.gas} side={pedalSide} bus={bus} fx={fx} getFwd={getFwd} />
        <MainActions layout={layout} side={pedalSide} wheelSide={wheelSide} bus={bus} fx={fx} />
        <MinorActions layout={layout} bus={bus} fx={fx} wheelSide={wheelSide} pedalSide={pedalSide} onSettings={() => setSheet(true)} />
      </div>
      {sheet && (
        <SettingsSheet
          settings={settings}
          onChange={update}
          onReset={reset}
          onClose={() => setSheet(false)}
          tilt={tilt}
          fullscreen={{ supported: canFull, active: full, toggle: toggleFullscreen }}
        />
      )}
    </div>
  );
}

// useTilt needs a bus object even before the game exists (hooks cannot be conditional)
const NOOP_BUS = { setSteer() {}, setGas() {}, setBrake() {}, hold() {}, tap() {}, releaseAll() {}, setActive() {}, setAuto() {} };
