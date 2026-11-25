// Registry of SOLO games (docs/ADDING_A_GAME.md section 9): single-player games that have no room and no adapter.
// They are deliberately NOT in GAME_ADAPTERS (worker/games/index.js), so a solo game can never be created as a room.
// A solo game only reports finished runs through POST /api/solo/:gameId/finish (worker/routes/solo.js); the limits
// below are the plausibility bounds every reported run is checked against. Scores are client-reported: these
// bounds make cheating clumsy, not impossible.
//
//   minSeconds / maxSeconds  accepted run length
//   maxEarnPerSecond         earned <= seconds * maxEarnPerSecond + earnGrace
//   winEarned                a run with earned >= winEarned counts as a "win" in user_game_stats
//   maxDistancePerSecond     distance <= seconds * maxDistancePerSecond
//   maxQuests                quests <= maxQuests
export const SOLO_GAMES = Object.freeze({
  autowala: Object.freeze({
    id: 'autowala',
    name: 'Autowala',
    minSeconds: 30,
    maxSeconds: 7200,
    maxEarnPerSecond: 25,
    earnGrace: 1500,
    winEarned: 3000,
    maxDistancePerSecond: 60,
    maxQuests: 200,
  }),
});

/** The solo game for an id, or null for anything unknown (including non-strings and prototype keys). */
export function getSoloGame(id) {
  return typeof id === 'string' && Object.hasOwn(SOLO_GAMES, id) ? SOLO_GAMES[id] : null;
}
