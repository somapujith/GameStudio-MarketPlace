// /play/tiffin-centre (manifest loaders.soloGame, rendered by pages/SoloGame.jsx): the solo side of Tiffin Centre.
//   home      -> SoloHome: the guided tutorial first; once it is done, Invite friends (the room mode unlocks) and 12 practice shifts
//   briefing  -> the pre-shift card of a practice level
//   play      -> TiffinGame over a local session (tutorial or practice)
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { tutorialDone } from '@/platform/game/tutorial.js';
import { MAX_LEVEL, GAME_ID } from '@shared/tiffin-centre/catalog.js';
import TiffinGame from './TiffinGame.jsx';
import { SoloHome, LevelBriefing } from './ui/menus/index.js';
import {
  createLocalSession, getProgress, unlockedLevel, isTutorialDoneLocal, syncPendingTutorial,
  loadSavedShift, clearSavedShift, describeSavedShift,
} from './session/index.js';
import './tiffin.css';

export default function TiffinSolo({ game }) {
  const navigate = useNavigate();
  const { user } = useAuth() || {};
  const [stage, setStage] = useState({ name: 'home' });
  const [session, setSession] = useState(null);
  const [rev, setRev] = useState(0); // bumps when we come back home, so progress and the tutorial flag are re-read
  const live = useRef(null);
  const [snapshot, setSnapshot] = useState(() => loadSavedShift()); // an auto-saved shift to resume (or null)

  const stop = useCallback(() => {
    live.current?.quit?.();
    live.current = null;
    setSession(null);
  }, []);
  useEffect(() => () => live.current?.quit?.(), []);
  useEffect(() => {
    syncPendingTutorial?.(); // a tutorial finished offline last time: tell the server now
  }, []);

  const begin = useCallback(
    (opts) => {
      live.current?.quit?.();
      // a new start the player chose replaces an older save; resuming goes through `resume` below
      const s = createLocalSession({ playerName: user?.name || 'You', avatar: user?.avatar, replaceSave: true, ...opts });
      live.current = s;
      setSession(s);
      setStage({ name: 'play', ...opts });
    },
    [user],
  );
  const resume = useCallback(() => {
    if (!snapshot) return;
    live.current?.quit?.();
    // starts paused: the player presses Resume in the pause menu
    const s = createLocalSession({ playerName: user?.name || 'You', avatar: user?.avatar, resume: snapshot });
    live.current = s;
    setSession(s);
    setStage({ name: 'play', mode: snapshot.mode, level: snapshot.level, pace: snapshot.pace });
  }, [snapshot, user]);
  const discard = useCallback(() => {
    clearSavedShift();
    setSnapshot(null);
  }, []);
  const home = useCallback(() => {
    stop();
    setSnapshot(loadSavedShift()); // quitting a running shift saved it: offer to resume
    setRev((n) => n + 1);
    setStage({ name: 'home' });
  }, [stop]);

  const gameId = game?.id || GAME_ID;
  const toGamePage = useCallback(async () => {
    // tell the server the tutorial is done BEFORE leaving, so the game page re-reads /api/me with the table unlocked
    try {
      await Promise.race([syncPendingTutorial?.(), new Promise((r) => setTimeout(r, 2500))]);
    } catch {
      /* offline: the local mirror and the retry on the next visit cover it */
    }
    navigate(paths.game(gameId));
  }, [navigate, gameId]);

  if (stage.name === 'play' && session) {
    return (
      <TiffinGame
        session={session}
        onExit={stage.mode === 'tutorial' ? toGamePage : home}
        onInvite={toGamePage}
        onRetry={stage.mode === 'practice' ? (s) => s.restart() : undefined}
        onNext={
          stage.mode === 'practice' && stage.level < MAX_LEVEL
            ? () => {
                stop();
                setStage({ name: 'briefing', level: stage.level + 1, pace: stage.pace });
              }
            : undefined
        }
      />
    );
  }

  if (stage.name === 'briefing') {
    return (
      <div className="tc">
        <LevelBriefing level={stage.level} pace={stage.pace} onGo={() => begin({ mode: 'practice', level: stage.level, pace: stage.pace })} />
      </div>
    );
  }

  const progress = getProgress();
  const done = tutorialDone(user, game || { id: gameId }) || isTutorialDoneLocal();
  return (
    <div className="tc" key={rev}>
      <SoloHome
        progress={progress}
        saved={snapshot ? describeSavedShift(snapshot) : null}
        onResume={resume}
        onDiscard={discard}
        tutorialDone={done}
        unlockedLevel={unlockedLevel(progress)}
        onStartTutorial={() => begin({ mode: 'tutorial', level: 0, pace: 'normal' })}
        onStartLevel={(level, pace) => setStage({ name: 'briefing', level, pace })}
        onInvite={toGamePage}
      />
    </div>
  );
}
