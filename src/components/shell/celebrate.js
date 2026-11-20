// One global celebration overlay (level-ups, badges, coins, purchases).
//
//   import { celebrate } from '@/components/shell/celebrate.js';
//   celebrate({ kind: 'level' | 'badge' | 'coins' | 'purchase', title, text, icon? });   // -> id | null
//
// Queued and shown one at a time by <CelebrationHost/> (mounted once in App.jsx): auto-dismiss after ~2.5 s,
// tap / Esc / Enter to close, a short gold coin shower for 'coins' and 'level', buzz('win') + sound for a level-up,
// announced through an aria-live="polite" region. Reduced motion = a simple fade, no coins.
// `icon` is a shell Icon name (see icons.jsx / HubIcon), e.g. 'trophy', 'star', 'gift'. Identical calls within
// 1.5 s are ignored, so firing from an effect twice (StrictMode) is harmless.
//
// Level-ups are detected globally (CelebrationHost): when `user.level` rises above the last level stored for that
// user on this device, a 'level' celebration plays (deferred while a game screen /play/** is open).
import { appCelebrations } from './celebrationQueue.js';

export { CELEBRATION_KINDS, CELEBRATION_MS, checkLevelUp, createCelebrationQueue, normalizeCelebration } from './celebrationQueue.js';

/** The app-wide queue (exported for the host and for tests). */
export const celebrations = appCelebrations;

/** Queue a celebration; returns its id, or null when it was invalid or a duplicate. Never throws. */
export function celebrate(input) {
  try {
    return celebrations.push(input);
  } catch {
    return null;
  }
}

/** Close the visible celebration (all of them with `{ all: true }`). */
export function dismissCelebration(opts) {
  if (opts?.all) celebrations.clear();
  else celebrations.dismiss();
}

export { default as CelebrationHost } from './CelebrationHost.jsx';

export default celebrate;
