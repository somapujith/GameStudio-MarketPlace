// The Autowala screen: a full-screen canvas + the React UI on top. The game itself (game/Game.js) never touches React;
// it publishes a snapshot ~10x a second (and events on game.on) and React renders from that. Each UI piece below is owned
// by a different part of the codebase (see ARCHITECTURE.md): Hud, Minimap, Workshop, Toasts, TouchControls, Menus.
import { useEffect, useRef, useState } from 'react';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/noto-sans-telugu';
import { useAuth } from '@/lib/auth.jsx';
import { createGameAsync, TOTAL_STEPS } from './game/Game.js';
import { CITY_SEED } from './game/config.js';
import Hud from './ui/Hud.jsx';
import FareChoice from './ui/fares/FareChoice.jsx';
import Minimap from './ui/Minimap.jsx';
import Workshop from './ui/Workshop.jsx';
import Toasts from './ui/Toasts.jsx';
import TouchControls from './ui/TouchControls.jsx';
import Menus from './ui/Menus.jsx';
import Subtitles from './ui/Subtitles.jsx';
import QuestLog from './ui/QuestLog.jsx';
import Hisaab from './ui/Hisaab.jsx';
import Radio from './ui/Radio.jsx';
import { FailureScreen, GpuLostScreen, LoadingScreen } from './ui/menus/BootScreens.jsx';
import { applyUiScale } from './ui/scale.js';
import useOrientationHold from './ui/useOrientationHold.js';
import './ui/autowala.css';
import './ui/hud/land.css'; // the landscape HUD layout: last, so it wins over the shared looks

// What the loading bar says while each stage of the build runs.
const STAGE_TEXT = {
  start: 'Starting the engine',
  layout: 'Surveying Hyderabad',
  roads: 'Laying the roads',
  terrain: 'Filling Hussain Sagar',
  buildings: 'Raising the Old City',
  shops: 'Opening the shops',
  props: 'Planting palms and lamps',
  landmarks: 'Building Charminar',
  metro: 'Running the Metro',
  'systems:customization': 'Visiting Mama’s Garage',
  'systems:fares': 'Calling the customers',
  'systems:routeGuide': 'Drawing the map',
  'systems:workshop': 'Opening the workshop',
  'systems:voices': 'Warming up the voices',
  'systems:traffic': 'Starting the traffic',
  'systems:roadRage': 'Calming the drivers',
  'systems:weather': 'Checking the sky',
  'systems:career': 'Counting the rent',
  'systems:rules': 'Posting the signals',
  'systems:quests': 'Pinning up the job board',
  'systems:sound': 'Tuning the radio',
  compile: 'Polishing the paint (compiling shaders)',
};

async function loadFonts() {
  if (!document.fonts?.load) return;
  const wanted = ['800 40px "Bricolage Grotesque Variable"', '700 24px "Bricolage Grotesque Variable"', '800 30px "Noto Sans Telugu Variable"'];
  await Promise.race([Promise.all(wanted.map((f) => document.fonts.load(f, 'AaBbఆట'))).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
}

export default function AutowalaGame() {
  const { user } = useAuth() || {};
  const userId = user?.id ?? null;
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [snap, setSnap] = useState(null);
  const [game, setGame] = useState(null);
  const [failure, setFailure] = useState(null); // 'webgl' | 'error' when the game could not start
  const [gpuLost, setGpuLost] = useState(false);
  const [loading, setLoading] = useState({ text: STAGE_TEXT.start, pct: 0 });
  useOrientationHold(game); // a phone held upright (the hub's orientation gate covers the screen): no loop, no sound, back at once in landscape

  // the HUD scale follows the viewport HEIGHT (--aw-ui-scale on the root); it also covers the loading and failure screens
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const apply = () => {
      const r = el.getBoundingClientRect();
      applyUiScale(el, r.width, r.height);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let g = null;
    let ro = null;
    let dead = false;
    (async () => {
      await loadFonts();
      if (dead || !canvas.current) return;
      const t0 = performance.now();
      try {
        g = await createGameAsync(
          { canvas: canvas.current, seed: CITY_SEED, hooks: { onSnapshot: setSnap, userId, onContext: (st) => setGpuLost(st === 'lost') } },
          (stage, n) => !dead && setLoading({ text: STAGE_TEXT[stage] || 'Loading', pct: Math.min(99, Math.round((n / TOTAL_STEPS) * 100)) }),
        );
        if (dead) {
          g.dispose(); // the player left while it was loading
          return;
        }
      } catch (err) {
        console.error('[autowala] could not start', err);
        if (!dead) setFailure(err?.name === 'WebglUnsupported' ? 'webgl' : 'error');
        return;
      }
      window.__autowalaBoot = { ms: Math.round(performance.now() - t0), caps: g.gfx.caps, quality: g.gfx.quality };
      const fit = () => {
        const r = wrap.current.getBoundingClientRect();
        g.resize(r.width, r.height);
      };
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(wrap.current);
      g.start();
      window.__autowala = g; // handy in the console; also used by the screenshot tooling
      setGame(g);
    })();
    return () => {
      dead = true;
      ro?.disconnect();
      g?.dispose();
      if (window.__autowala === g) delete window.__autowala;
    };
  }, [userId]);

  return (
    <div className="aw" ref={wrap}>
      <canvas ref={canvas} className="aw-canvas" />
      {!game && !failure && <LoadingScreen text={loading.text} pct={loading.pct} />}
      {failure && <FailureScreen kind={failure} />}
      {gpuLost && <GpuLostScreen />}
      {game && snap && (
        <>
          <Hud game={game} snap={snap} />
          <FareChoice game={game} snap={snap} />
          <Minimap game={game} snap={snap} />
          <Toasts game={game} />
          <Subtitles game={game} />
          <QuestLog game={game} snap={snap} />
          <Hisaab game={game} snap={snap} />
          <Radio game={game} snap={snap} />
          <TouchControls game={game} />
          <Workshop game={game} snap={snap} />
          <Menus game={game} snap={snap} />
        </>
      )}
    </div>
  );
}
