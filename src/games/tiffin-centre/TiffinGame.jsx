// The Tiffin Centre play screen. ONE component for every mode: it takes any session (local tutorial / practice, or the room
// session) implementing the interface of docs/TIFFIN_CENTRE_PLAN.md section 4 and wires the 3D scene, the audio, the HUD and the
// menus around it. It never reads game rules itself; everything comes from `session`.
import { useCallback, useEffect, useRef, useState } from 'react';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/noto-sans-telugu';
import { createTiffinScene } from './scene/index.js';
import { createTiffinAudio } from './audio/index.js';
import { Hud } from './ui/hud/index.js';
import { CoachMark, PauseMenu, QuitConfirm, Results, StatusScreen } from './ui/menus/index.js';
import { useSession } from './session/index.js';
import './tiffin.css';

async function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const wanted = ['800 40px "Bricolage Grotesque Variable"', '700 24px "Bricolage Grotesque Variable"', '800 30px "Noto Sans Telugu Variable"'];
  await Promise.race([Promise.all(wanted.map((f) => document.fonts.load(f, 'AaBbఆట'))).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced');

/** What the Results screen shows when the tutorial ends (the engine's tutorial shift never really ends). */
const tutorialResult = (state) => ({ reason: 'tutorial', stars: 3, money: state?.money ?? 0, level: 0, standings: [] });

export default function TiffinGame({ session, onExit, onInvite, onRetry, onNext }) {
  const view = useSession(session);
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

  // The scene + audio live exactly as long as the session. Every session notification feeds both.
  useEffect(() => {
    let dead = false;
    let s = null;
    let ro = null;
    let off = null;
    const audio = createTiffinAudio({ meId: session.meId });
    audioRef.current = audio;
    setAudio(audio);
    (async () => {
      await loadFonts();
      if (dead || !canvasRef.current || !wrapRef.current) return;
      try {
        s = createTiffinScene(canvasRef.current, {
          quality: 'auto',
          reducedMotion: prefersReducedMotion(),
          onContextLost: () => !dead && setGl('lost'),
          onContextRestored: () => !dead && setGl(null),
        });
      } catch {
        setGl('webgl');
        return;
      }
      s.setMe?.(session.meId);
      const fit = () => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) s.resize(r.width, r.height);
      };
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(wrapRef.current);
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
      window.__tiffin = { session, scene: s, audio }; // handy in the console and for the screenshot tooling
    })();
    return () => {
      dead = true;
      off?.();
      ro?.disconnect();
      s?.dispose();
      audio.dispose();
      audioRef.current = null;
      setAudio(null);
      setScene(null);
      if (window.__tiffin?.session === session) delete window.__tiffin;
    };
  }, [session]);

  // Browsers only allow sound after a gesture.
  useEffect(() => {
    const unlock = () => audioRef.current?.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (status === 'playing') audioRef.current?.startAmbience();
    else audioRef.current?.stopAmbience();
    audioRef.current?.setSpeechPaused?.(status !== 'playing');
  }, [status, scene, audio]);

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
  const paused = status === 'paused' && !tutorialFinished;
  const online = mode === 'online';

  let blocker = null;
  if (gl === 'webgl') blocker = 'webgl';
  else if (gl === 'lost') blocker = 'error';
  else if (status === 'error') blocker = 'error';
  else if (status === 'disconnected' && online) blocker = 'disconnected';
  else if (!state && !shiftOver) blocker = 'loading';

  return (
    <div className="tc" ref={wrapRef} data-mode={mode}>
      <canvas ref={canvasRef} className="tc-canvas" aria-label="Your tiffin stall" />
      {scene && state && !blocker ? <Hud session={session} scene={scene} audio={audio} muted={muted} onMute={onMute} /> : null}

      {online && state && !showResults && !blocker ? (
        <button type="button" className="tc-leave" onClick={() => setLeaving(true)} aria-label="Leave the table">
          Leave
        </button>
      ) : null}

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
          muted={muted}
          onMute={onMute}
          audio={audio}
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

      {blocker ? (
        <StatusScreen
          kind={blocker}
          onRetry={blocker === 'disconnected' ? session.retry : blocker === 'loading' ? undefined : () => window.location.reload()}
          onExit={() => {
            session.quit?.();
            onExit?.();
          }}
        />
      ) : null}
    </div>
  );
}
