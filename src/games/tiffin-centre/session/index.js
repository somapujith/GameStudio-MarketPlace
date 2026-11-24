// Tiffin Centre sessions: one interface (docs/TIFFIN_CENTRE_PLAN.md section 4) for the solo runner and the room.
import { STATE_VERSION } from '@shared/tiffin-centre/index.js';
import { clearShift, describeSavedShift, hasSavedShift as hasSavedShiftIn, loadShift } from './autosave.js';
import { defaultStorage } from './progress.js';

export { createLocalSession, randomSeed, LOCAL_PLAYER_ID, MAX_CATCHUP_TICKS, SAVE_EVERY_TICKS, SAVE_DEBOUNCE_MS } from './localSession.js';
export { useRoomSession } from './roomSession.js';
export { createRoomSessionCore, createActionLimiter, roomStatus, sessionConnection, playersOf } from './roomCore.js';
export { useSession, sessionSnapshot, PULSE_HZ } from './useSession.js';
export {
  getProgress, saveShiftResult, unlockedLevel, normalizeProgress, isTutorialDoneLocal, markTutorialDone, isTutorialPending,
  clearTutorialPending, reportTutorialDone, syncPendingTutorial, defaultStorage, memoryStorage, TUTORIAL_COMPLETE_PATH, TUTORIAL_PENDING_KEY,
  getPrefs, setPrefs, exportAll, importAll, resetAll, DATA_KEYS, PROGRESS_VERSION,
} from './progress.js';
export {
  saveShift, loadShift, clearShift, describeSavedShift, createAutosave, createRoomCache, validateSnapshot, validateJournal,
  SHIFT_KEY, PREFS_KEY, SAVE_VERSION, MAX_SAVE_BYTES,
} from './autosave.js';

// The names the menus use. They default to the device's storage and to the real engine's state version, so a save written by an
// older engine is refused (and removed) instead of resumed.
/** The saved shift (a snapshot for `createLocalSession({ resume })`) or null. Bad saves are removed. */
export const loadSavedShift = (storage = defaultStorage()) => loadShift(storage, { stateVersion: STATE_VERSION });
export const hasSavedShift = (storage = defaultStorage()) => hasSavedShiftIn(storage, { stateVersion: STATE_VERSION });
export const clearSavedShift = (storage = defaultStorage()) => clearShift(storage);
