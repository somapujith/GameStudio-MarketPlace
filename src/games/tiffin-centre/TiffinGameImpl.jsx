// The Tiffin Centre play screen (the heavy half: TiffinGame.jsx is the small lazy shell that loads this file). ONE component for every mode: it takes any session (local tutorial / practice, or the room
// session) implementing the interface of docs/TIFFIN_CENTRE_PLAN.md section 4 and wires the 3D scene, the audio, the HUD and the
// menus around it. It never reads game rules itself; everything comes from `session`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/noto-sans-telugu';
import { createTiffinSceneAsync } from './scene/index.js';
import { Hud } from './ui/hud/index.js';
import { CoachMark, PauseMenu, QuitConfirm, Results, StatusScreen } from './ui/menus/index.js';
import { paths } from '@/platform/paths.js';
import { lockGestures } from '@/lib/mobile.js';
import { useGamePaused } from '@/platform/game/orientationContext.js';
import { useKeepAwake } from './ui/hud/mobileUi.js';
import { GAME_ID } from '@shared/tiffin-centre/catalog.js';
import { clearSavedShift, useSession } from './session/index.js';
import './tiffin.css';

async function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const wanted = ['800 40px "Bricolage Grotesque Variable"', '700 24px "Bricolage Grotesque Variable"', '800 30px "Noto Sans Telugu Variable"'];
  await Promise.race([Promise.all(wanted.map((f) => document.fonts.load(f, 'AaBbఆట'))).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
}

/** The loading screen's progress bar: the scene reports its build steps, the label is the stall's voice. */
function LoadBar({ progress }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress.p)) * 100);
  return (
    <div className="tc-load" role="progressbar" aria-label="Loading the stall" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="tc-load__bar">
        <div className="tc-load__fill" style={{ width: pct + '%' }} />
      </div>
      <div className="tc-load__label" aria-live="polite">
        {progress.label}
      </div>
    </div>
  );
}

/** User Timing mark for the load timeline (docs/perf/tf-cpu.md, scripts/perf/tf-load.mjs). */
const mark = (name) => {
  try {
    performance.mark(name);
  } catch {
    /* no User Timing */
  }
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced');

/** What the Results screen shows when the tutorial ends (the engine's tutorial shift never really ends). */
const tutorialResult = (state) => ({ reason: 'tutorial', stars: 3, money: state?.money ?? 0, level: 0, standings: [] });

export default function TiffinGame({ session, onExit, onInvite, onRetry, onNext }) {
  // notifications only (no 10 Hz clock pulse): this component and the layers under it animate on requestAnimationFrame, not on re-renders
  const view = useSession(session, { hz: 0 });
  const { state, status, mode, tutorial } = view;
  const result = view.result ?? null;

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const [audio, setAudio] = useState(null);
  const [scene, setScene] = useState(null);
  const [gl, setGl] = useState(null); // null | 'webgl' | 'lost'
  const [muted, setMuted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // "Apply now" in the pause menu's Graphics section: bumping this rebuilds the scene (and the audio) at the picked tier while the session stays paused
  const [sceneKey, setSceneKey] = useState(0);
  const applyGraphics = useCallback(() => setSceneKey((k) => k + 1), []);
  const [progress, setProgress] = useState({ p: 0, label: 'Lighting the stove...' });
  const navigate = useNavigate();
  const online = mode === 'online';
  // The hub's orientation gate (platform/game/OrientationGate.jsx, manifest `orientation: 'landscape'`): true while a phone or tablet is held
  // upright and the "turn your phone" screen covers this one. Nothing is torn down: the scene stops drawing, the sound stops, a local shift's clock is held.
  const upright = useGamePaused();

  // The shift clock of a LOCAL session is held until the stall is on screen, and again whenever the 3D view is missing: a local
  // session starts ticking the moment it is created, so a slow first load (chunks, fonts, shaders, first frame) or a device without
  // WebGL would otherwise burn patience and hearts behind the loading / error screen. Held = paused by us, without the Chai break card.
  const held = useRef(false);
  const [gated, setGated] = useState(false);
  const hold = useCallback(() => {
    if (online || held.current) return;
    if (session.status === 'playing' && session.pause?.()) {
      held.current = true;
      setGated(true);
    }
  }, [session, online]);
  useEffect(() => {
    hold();
  }, [hold]);
  useEffect(() => {
    if (gl) hold(); // WebGL missing, or the context was lost mid-shift
  }, [gl, hold]);
  useEffect(() => {
    if (upright) hold(); // a local shift stops ticking behind the "turn your phone" screen (an online table keeps running: the server owns its clock)
  }, [upright, hold]);
  // the render loop: stopped while upright, started again the moment the device is landscape (both are idempotent; `start` resets the loop's clock)
  useEffect(() => {
    if (!scene) return;
    if (upright) scene.stop?.();
    else scene.start?.();
  }, [scene, upright]);
  useEffect(() => {
    if (!gated || !scene || gl || upright) return undefined; // upright: stay held until the device is landscape again
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        // two frames are on screen: let the shift begin (or go on)
        held.current = false;
        setGated(false);
        session.resume?.();
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [gated, scene, gl, session, upright]);

  // True only once this component is really leaving (declared before the scene effect, so its cleanup runs first on unmount but never on a rebuild): the
  // scene hands its GPU context back then. A rebuild (Apply now, a new session) reuses the same <canvas>, and a force-lost context cannot be drawn with again.
  const unmounting = useRef(false);
  useEffect(() => {
    unmounting.current = false;
    return () => {
      unmounting.current = true;
    };
  }, []);

  // The scene + audio live exactly as long as the session. Every session notification feeds both.
  useEffect(() => {
    let dead = false;
    let s = null;
    let ro = null;
    let off = null;
    let audio = null;
    setProgress({ p: 0, label: 'Lighting the stove...' });
    (async () => {
      // the audio code is its own chunk (the context itself only starts on the first gesture)
      // the web fonts load WHILE the scene builds (the painted banner and menu board repaint when they arrive); a device without WebGL 2 is told at once
      mark('tc:impl-start');
      const fontsReady = loadFonts();
      const { createTiffinAudio } = await import('./audio/index.js');
      mark('tc:audio-chunk');
      if (dead || !canvasRef.current || !wrapRef.current) return;
      audio = createTiffinAudio({ meId: session.meId });
      audioRef.current = audio;
      setAudio(audio);
      try {
        const box = wrapRef.current.getBoundingClientRect();
        s = await createTiffinSceneAsync(canvasRef.current, {
          quality: 'auto',
          reducedMotion: prefersReducedMotion(),
          // the session's first state and the real canvas size: the build settles the scene the way it will be drawn (stations, lights, env map, batched
          // scenery, every shader linked) BEFORE it is shown, so the first frame never waits for a compile. Online tables without a state yet build the old way.
          initialState: session.state ?? null,
          initialTickAt: session.tickAt,
          meId: session.meId,
          size: box.width > 0 && box.height > 0 ? { w: box.width, h: box.height } : null,
          onContextLost: () => !dead && setGl('lost'),
          onContextRestored: () => !dead && setGl(null),
          onProgress: (p, label) => !dead && setProgress({ p, label }),
          shouldAbort: () => dead,
        });
      } catch (err) {
        if (dead) return;
        // no WebGL2 (or the browser refused the context): the "cannot draw the 3D stall" screen; anything else is a real error
        if (err?.code === 'webgl' || /webgl/i.test(String(err?.message))) setGl('webgl');
        else {
          console.error('[tiffin] scene failed to start', err);
          setGl('webgl');
        }
        return;
      }
      if (!s) return; // disposed while loading
      mark('tc:scene-built');
      await fontsReady;
      if (dead) {
        s.dispose({ loseContext: unmounting.current });
        s = null;
        return;
      }
      s.setMe?.(session.meId);
      const fit = () => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) s.resize(r.width, r.height);
      };
      fit();
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(fit);
        ro.observe(wrapRef.current);
      } else {
        // very old browsers: the window's resize event is the best signal there is
        window.addEventListener('resize', fit);
        ro = { disconnect: () => window.removeEventListener('resize', fit) };
      }
      const push = ({ state: st, events, tickAt }) => {
        if (st) {
          s.setState(st, tickAt ?? performance.now());
          audio.setState(st, tickAt ?? performance.now());
        }
        if (events?.length) {
          s.handleEvents(events);
          audio.handleEvents(events, st);
        }
      };
      off = session.subscribe(push);
      if (session.state) push({ state: session.state, events: [], tickAt: session.tickAt });
      s.start();
      setScene(s);
      mark('tc:scene-started');
      // a console/screenshot handle: only in dev builds or with ?tcdebug=1 in the URL (a solo shift is client-side anyway, but there is no reason to hand it out)
      if (import.meta.env?.DEV || /[?&]tcdebug=1\b/.test(window.location.search)) {
        window.__tiffin = { session, scene: s, audio };
        // the engine's bot, for the soak / leak scripts (scripts/perf/tf-leak.mjs): the same chunk the session already loaded
        import('@shared/tiffin-centre/index.js').then((m) => {
          if (window.__tiffin?.session === session) window.__tiffin.bot = m.chooseAutoAction;
        }).catch(() => {});
      }
    })().catch((err) => {
      if (!dead) {
        console.error('[tiffin] start-up failed', err);
        setGl('webgl');
      }
    });
    return () => {
      dead = true;
      off?.();
      ro?.disconnect();
      s?.dispose({ loseContext: unmounting.current });
      audio?.dispose();
      audioRef.current = null;
      setAudio(null);
      setScene(null);
      if (window.__tiffin?.session === session) delete window.__tiffin;
    };
  }, [session, sceneKey]);

  // Touch screens: no pinch or double-tap zoom, no pull-to-refresh, no long-press menu on the play surface (the page is a game, not a document),
  // and the screen stays on while a shift is running. Menus inside the root that scroll (results, pause) keep their own scrolling.
  useEffect(() => (wrapRef.current ? lockGestures(wrapRef.current) : undefined), []);
  useKeepAwake(status === 'playing' && !gated);

  // Browsers only allow sound after a gesture.
  useEffect(() => {
    const unlock = () => audioRef.current?.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock, { passive: true }); // iOS only counts touchend (not pointerdown) as the user activation for audio
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchend', unlock);
    };
  }, []);

  useEffect(() => {
    if (status === 'playing' && !upright) audioRef.current?.startAmbience();
    else audioRef.current?.stopAmbience();
    audioRef.current?.setSpeechPaused?.(status !== 'playing' || upright);
  }, [status, scene, audio, upright]);
  // upright: silence the effects too (an online table keeps sending events); the player's own mute choice comes back with landscape
  useEffect(() => {
    audioRef.current?.setMuted(muted || upright);
  }, [muted, upright, audio]);

  const onMute = useCallback((next) => {
    setMuted(next);
    audioRef.current?.setMuted(next);
  }, []);

  // The tutorial is over once the player has pressed "Got it" on the last beat: freeze the stall and show the way to the tables.
  const tutorialFinished = mode === 'tutorial' && !!tutorial?.finished;
  useEffect(() => {
    if (tutorialFinished && status === 'playing') session.pause?.();
  }, [tutorialFinished, status, session]);

  const shiftOver = status === 'done' || status === 'closed';
  const showResults = shiftOver || tutorialFinished;
  const paused = status === 'paused' && !tutorialFinished && !gated && !!scene; // while a rebuilt picture loads (Apply now) the pause card waits

  let blocker = null;
  if (gl === 'webgl') blocker = 'webgl';
  else if (gl === 'lost') blocker = 'lost';
  else if (status === 'error') blocker = 'error';
  else if (status === 'disconnected' && online) blocker = 'disconnected';
  else if ((!state && !shiftOver) || (!scene && !shiftOver)) blocker = 'loading';

  return (
    <div className="tc" ref={wrapRef} data-mode={mode}>
      <canvas ref={canvasRef} className="tc-canvas" aria-label="Your tiffin stall" />
      {scene && state && !blocker ? <Hud session={session} scene={scene} audio={audio} muted={muted} onMute={onMute} onLeave={online ? () => setLeaving(true) : undefined} /> : null}

      {tutorial && !tutorial.finished && !tutorial.skipped && state && !showResults && !blocker ? (
        <CoachMark
          tutorial={tutorial}
          onSkip={() => {
            tutorial.skip?.();
            onExit?.();
          }}
          onNext={tutorial.ackable ? () => tutorial.ack?.() : undefined}
        />
      ) : null}

      {paused ? (
        <PauseMenu
          open
          mode={mode}
          muted={muted}
          onMute={onMute}
          audio={audio}
          tierInfo={() => scene?.getTierInfo?.()}
          onApplyGraphics={applyGraphics}
          onResume={() => session.resume?.()}
          onRestart={() => session.restart?.()}
          onQuit={() => {
            session.quit?.();
            onExit?.();
          }}
        />
      ) : null}

      {online ? (
        <QuitConfirm
          open={leaving}
          teammates={(session.players ?? []).filter((p) => p.id !== session.meId).map((p) => p.name)}
          onStay={() => setLeaving(false)}
          onQuit={() => {
            setLeaving(false);
            session.quit?.();
            onExit?.();
          }}
        />
      ) : null}

      {showResults ? (
        <Results
          result={result ?? tutorialResult(state)}
          level={state?.level ?? 0}
          pace={state?.pace ?? 'normal'}
          mode={mode}
          players={session.players ?? []}
          onRetry={onRetry ? () => onRetry(session) : undefined}
          onNext={onNext ? () => onNext(session) : undefined}
          onExit={() => {
            session.quit?.();
            onExit?.();
          }}
          onInvite={onInvite}
        />
      ) : null}

      {blocker === 'loading' ? <LoadBar progress={progress} /> : null}

      {blocker ? (
        <StatusScreen
          kind={blocker}
          onRetry={blocker === 'disconnected' ? session.retry : blocker === 'loading' ? undefined : () => window.location.reload()}
          onExit={() => {
            session.quit?.();
            if (blocker === 'webgl') {
              // nothing to resume: this shift was never on screen
              if (!online) clearSavedShift();
              navigate(paths.game(GAME_ID));
              return;
            }
            onExit?.();
          }}
        />
      ) : null}
    </div>
  );
}
