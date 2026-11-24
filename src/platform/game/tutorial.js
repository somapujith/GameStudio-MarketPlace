// A solo tutorial that unlocks rooms (docs/ADDING_A_GAME.md section 10). Generic: a game opts in with the manifest field
// `tutorial: { requiredForRooms: true }`; until the player has finished its tutorial the hub shows "Play tutorial" instead of
// "Create table". Pure and defensive: no localStorage (SSR, a private window, a throwing storage) simply means "not done" locally.

/** The localStorage key a game's tutorial writes when it is finished (the local mirror of the server flag). */
export const tutorialKey = (gameId) => `jalebi.tutorial.v1.${gameId}`;

/** The game needs its tutorial before the player may open a room (manifest `tutorial.requiredForRooms`). */
export const tutorialRequired = (game) => game?.tutorial?.requiredForRooms === true;

/** The storage to read when the caller passes none: `window.localStorage`, or null when there is none or it throws. */
function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The player has finished the game's tutorial: the server says so (`user.gameStats[game.id].tutorialDone === true`, from
 * `GET /api/me`) or this browser does (`localStorage['jalebi.tutorial.v1.<id>'] === '1'`, written on completion so the unlock
 * is instant and works for a signed-out visitor). `storage` is anything with `getItem` (default: localStorage when available).
 */
export function tutorialDone(user, game, storage = defaultStorage()) {
  const id = game?.id;
  if (!id) return false;
  if (user?.gameStats?.[id]?.tutorialDone === true) return true;
  // A signed-in account is judged by the server alone: the browser's mirror may belong to somebody who used it before.
  if (user) return false;
  try {
    return !!storage && typeof storage.getItem === 'function' && storage.getItem(tutorialKey(id)) === '1';
  } catch {
    return false;
  }
}

/** Rooms of this game are locked for this player: a tutorial is required and not finished. */
export const roomsLocked = (user, game, storage) => tutorialRequired(game) && !tutorialDone(user, game, storage);
