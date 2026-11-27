// Autowala's side of the hub's orientation gate (src/platform/game/OrientationGate.jsx, manifest `orientation: 'landscape'`).
// While a phone or tablet is held upright a "turn your phone" screen covers the game and `useGamePaused()` is true: stop the rAF loop (no
// simulation, no drawing, the GPU idles) and the sound, and bring both back at once when the device is landscape again. Nothing is torn
// down: the world, the vehicle and the UI keep their state. Desktop and games outside a gate never see `paused`.
import { useEffect, useRef } from 'react';
import { useGamePaused } from '@/platform/game/orientationContext.js';
import { getAudio, isMuted, setMuted } from '../audio/ctx.js';

const swallow = (p) => {
  if (p && typeof p.catch === 'function') p.catch(() => {});
};

/**
 * Holds the shared sound while the gate is up: the master gain goes to 0 (robust: a tab coming back from the background resumes the context,
 * the mute still stands) and a running AudioContext is suspended (its oscillators stop costing CPU). `release()` restores exactly what
 * `hold()` changed: the player's own mute choice, and a context that was not running stays as it was (no autoplay warning). Both are idempotent.
 */
export function createAudioHold(audio = { getAudio, isMuted, setMuted }) {
  let held = null; // { ac, wasMuted, wasRunning } while holding
  return {
    get holding() {
      return !!held;
    },
    hold() {
      if (held) return;
      const a = audio.getAudio();
      if (!a) return;
      held = { ac: a.ac, wasMuted: audio.isMuted(), wasRunning: a.ac.state === 'running' };
      audio.setMuted(true);
      if (held.wasRunning) swallow(a.ac.suspend && a.ac.suspend());
    },
    release() {
      if (!held) return;
      const { ac, wasMuted, wasRunning } = held;
      held = null;
      audio.setMuted(wasMuted);
      if (wasRunning) swallow(ac.resume && ac.resume());
    },
  };
}

/** `game` is the object from createGameAsync (null while loading). Call once in the game screen. */
export default function useOrientationHold(game) {
  const upright = useGamePaused();
  const sound = useRef(null);
  if (!sound.current) sound.current = createAudioHold();
  useEffect(() => {
    if (!game) return;
    if (upright) {
      game.stop(); // cancels the rAF loop; the loop's own `start()` is idempotent and resets its clock, so no dt jump on return
      sound.current.hold();
      try {
        window.speechSynthesis?.cancel(); // a spoken line (the browser's own voice) is not routed through the game's gain
      } catch {
        /* no speech synthesis */
      }
    } else {
      game.start();
      sound.current.release();
    }
    // no cleanup on purpose: on unmount the screen's own cleanup disposes the game, and a restart here would resurrect it
  }, [game, upright]);
}
