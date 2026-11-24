// Games that have a tutorial the player must finish before they may open a table (the adapter's `canHost`, worker/games/index.js).
// Finishing it is reported with POST /api/games/:gameId/tutorial/complete (worker/routes/tutorial.js), which stores
// `user_game_stats.extra.tutorial = true`; `GET /api/me` then shows `gameStats[id].tutorialDone`.
export const TUTORIAL_GAMES = new Set(['tiffin-centre']);

/** True only for a registered tutorial game id (a non-string, a prototype key or an unknown id is never one). */
export const hasTutorial = (id) => typeof id === 'string' && TUTORIAL_GAMES.has(id);
