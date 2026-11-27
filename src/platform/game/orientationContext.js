// The "paused" signal of a game wrapped in <OrientationGate>. A game screen reads it with `useGamePaused()` and stops what it owns:
//
//   const paused = useGamePaused();            // true while the device is upright and the "turn your phone" screen covers the game
//   useEffect(() => { if (paused) engine.stop(); else engine.start(); }, [paused]);   // its rAF loop
//   ... and suspend its audio (AudioContext.suspend(), ambience, speech) while `paused`.
//
// Outside a gate (desktop, a game without `orientation: 'landscape'`) the value is always false, so the hook is free to call unconditionally.
// This file imports only React, so a game's lazy chunk can use it without pulling in the gate's markup or styles.
import { createContext, useContext } from 'react';

export const OrientationContext = createContext(Object.freeze({ paused: false, gated: false, policy: 'any' }));

/** { paused, gated, policy } of the nearest OrientationGate (all false / 'any' when there is none). */
export const useOrientationState = () => useContext(OrientationContext);

/** True while the game must not draw, simulate or make sound because the device is in the wrong orientation. */
export const useGamePaused = () => useContext(OrientationContext).paused;
