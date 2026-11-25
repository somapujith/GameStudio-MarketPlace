// OWNER: HUD agent. Start screen, pause menu, clock-out summary (+ score saving). Props: { game, snap }.
// Menus are opened with ctx.openMenu(name): 'start' (on mount), 'pause' (Esc / P / the HUD button / gamepad Start), 'summary'
// (CLOCK OUT). While one is open the auto is held and the world keeps rendering behind it. The pieces live in ui/menus/.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { createRunClient } from '../gameplay/runApi.js';
import { createSitting } from './menus/sitting.js';
import { createSessionLog } from './menus/sessionLog.js';
import { applyAudio, applyLanguage } from './menus/settings.js';
import { setMuted } from '../audio/ctx.js';
import StartScreen from './menus/StartScreen.jsx';
import PauseMenu from './menus/PauseMenu.jsx';
import SummaryScreen from './menus/SummaryScreen.jsx';
import './menus/menus.css';

export default function Menus({ game, snap }) {
  const navigate = useNavigate();
  const { user } = useAuth() || {};
  const signedIn = !!user;
  const [kit, setKit] = useState(null);

  // the run client, this shift's counters and the visit log live as long as the game object
  useEffect(() => {
    const runs = createRunClient();
    const sitting = createSitting(game, runs);
    const sl = createSessionLog(game);
    setKit({ runs, sitting, log: sl.log });
    const s = game.ctx.profile.data.settings || {};
    setMuted(s.sound === false);
    applyLanguage(game);
    if (!game.state.menu) game.ctx.openMenu('start');
    return () => {
      sitting.dispose();
      sl.dispose();
    };
  }, [game]);

  // Esc / P / the pause button / gamepad Start (they all arrive as input 'pause'); other menus own their own keys
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = game.ctx;
      if (!c.state.menu && c.input.pressed('pause')) c.openMenu('pause');
    };
    raf = requestAnimationFrame(tick);
    const off = game.on((e) => {
      if (e.type === 'menu' && e.name === null) game.input.clearTaps(); // keys pressed on a menu must not leak into the game
    });
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, [game]);

  if (!kit) return null;
  const { runs, sitting, log } = kit;
  const close = () => game.ctx.closeMenu();
  const toHub = () => {
    game.ctx.profile.flush();
    navigate(paths.game('autowala'));
  };
  const start = () => {
    applyAudio(game); // a user gesture: the audio context may start now
    if (!sitting.started) sitting.begin({ signedIn });
    close();
  };
  const keepDriving = () => {
    if (!runs.hasToken) sitting.begin({ signedIn }); // the last run was saved (or its token died): a fresh shift
    close();
  };

  switch (snap.menu) {
    case 'start':
      return <StartScreen game={game} snap={snap} onStart={start} onHub={toHub} />;
    case 'pause':
      return <PauseMenu game={game} snap={snap} sitting={sitting} log={log} onResume={close} onClockOut={() => game.ctx.openMenu('summary')} onQuit={toHub} />;
    case 'summary':
      return <SummaryScreen game={game} sitting={sitting} runs={runs} onKeepDriving={keepDriving} onHub={toHub} onSignIn={() => navigate(paths.login(paths.solo('autowala')))} />;
    default:
      return null;
  }
}
