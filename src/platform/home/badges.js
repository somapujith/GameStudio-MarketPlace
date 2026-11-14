// Profile badges. Platform badges (games, wins, levels, daily streak, friends, games tried) live in `BADGES`;
// a game adds its own with `manifest.badges = [{ id, label, desc, stat, target, icon }]` (see `gameBadges`).
// A badge is earned when `value >= target`. `needs` hides a badge until the data it depends on exists:
//   'friends'   - the friends list (signed-in accounts only)
//   'multiGame' - at least two live games (an "Explorer" badge with one game would be unearnable)
//
//   { id, label, desc, art, target, value(ctx) -> number, needs? }
//
// `art` is the id handed to the hub art kit's <BadgeIcon id=... />; ids the kit has no emblem for render a plain medal.
// Nothing here may know about a specific game: game badges come from manifests only.

export const BADGES = [
  { id: 'rookie', label: 'Rookie', desc: 'Finish your first online game', art: 'rookie', target: 1, value: (c) => c.games },
  { id: 'first-win', label: 'First Win', desc: 'Win an online game', art: 'first-win', target: 1, value: (c) => c.wins },
  { id: 'ten-wins', label: 'Ten Wins', desc: 'Win 10 online games', art: 'ten-wins', target: 10, value: (c) => c.wins },
  { id: 'regular', label: 'Regular', desc: 'Play 25 online games', art: 'regular', target: 25, value: (c) => c.games },
  { id: 'level-5', label: 'Rising Star', desc: 'Reach level 5', art: 'level', target: 5, value: (c) => c.level },
  { id: 'level-10', label: 'Big Shot', desc: 'Reach level 10', art: 'level', target: 10, value: (c) => c.level },
  { id: 'streak-3', label: 'Hat-trick', desc: 'Claim the daily reward 3 days in a row', art: 'daily-streak', target: 3, value: (c) => c.streak },
  { id: 'streak-7', label: 'Week Streak', desc: 'Claim the daily reward 7 days in a row', art: 'daily-streak', target: 7, value: (c) => c.streak },
  { id: 'social-butterfly', label: 'Social Butterfly', desc: 'Make 3 friends', art: 'social-butterfly', target: 3, value: (c) => c.friends ?? 0, needs: 'friends' },
  { id: 'explorer', label: 'Explorer', desc: 'Play 2 different games', art: 'explorer', target: 2, value: (c) => c.gamesTried, needs: 'multiGame' },
];

const num = (v) => Math.max(0, Number(v) || 0);

/**
 * Totals across games plus platform numbers, in the shape the rules above read.
 * `perGame` are resolved per-game stats (see gameStats.resolveGameStats), `streak` the daily-reward streak,
 * `level` the player's level, `friends` the friend count (null = unknown), `liveGames` how many games are live.
 */
export function buildBadgeContext({ perGame = [], streak = 0, level, friends = null, liveGames = 1 } = {}) {
  const played = perGame.filter((s) => s && s.games > 0);
  return {
    games: perGame.reduce((n, s) => n + (s?.games || 0), 0),
    wins: perGame.reduce((n, s) => n + (s?.wins || 0), 0),
    gamesTried: played.length,
    streak: num(streak),
    level: Number(level) || 1,
    friends,
    liveGames: num(liveGames),
  };
}

function hidden(b, ctx) {
  if (b.needs === 'friends') return ctx.friends == null;
  if (b.needs === 'multiGame') return (ctx.liveGames || 0) < 2;
  return false;
}

function score(b, raw) {
  const target = Math.max(1, Number(b.target) || 1);
  const v = Math.min(raw, target);
  return { ...b, target, earned: raw >= target, value: v, pct: Math.round((v / target) * 100) };
}

/** Platform badges whose data exists, each with `earned`, `value` (clamped) and `pct` (0-100). */
export function evaluateBadges(ctx) {
  return BADGES.filter((b) => !hidden(b, ctx)).map((b) => score(b, num(b.value(ctx))));
}

/**
 * Badges a game declares in its manifest (`manifest.badges`), evaluated against that game's stats.
 * `stats` is the per-game stats object (`user.gameStats[gameId]`, which may carry extra keys such as `rentEarned`);
 * `extra` is a fallback source for keys the per-game object lacks (the legacy account totals of the default game).
 * Ids are namespaced `<gameId>:<id>` so two games can reuse a name. Malformed entries are skipped.
 */
export function gameBadges(game, stats, extra = null) {
  const list = Array.isArray(game?.badges) ? game.badges : [];
  return list
    .filter((b) => b && typeof b.id === 'string' && typeof b.label === 'string' && typeof b.stat === 'string' && Number(b.target) > 0)
    .map((b) => {
      const raw = num(stats?.[b.stat] ?? extra?.[b.stat]);
      return score(
        { id: `${game.id}:${b.id}`, label: b.label, desc: b.desc || '', art: b.icon || b.id, target: Number(b.target), format: b.format, gameId: game.id, gameName: game.name },
        raw,
      );
    });
}

/** Ids of badges that are earned now but were not in `seenIds` (the per-device "already celebrated" set). */
export function newlyEarned(seenIds, badges) {
  const seen = new Set(Array.isArray(seenIds) ? seenIds : []);
  return badges.filter((b) => b.earned && !seen.has(b.id)).map((b) => b.id);
}

// ---- per-device "already celebrated" set ----------------------------------------------------------------------

const SEEN_KEY = 'gh.badges.seen.v1';

/** `string[]` of celebrated badge ids for this account on this device, or `null` when nothing was stored yet. */
export function loadSeen(uid = 'local') {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    const v = all && typeof all === 'object' ? all[uid] : null;
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

export function saveSeen(uid = 'local', ids = []) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
    all[uid] = [...new Set(ids)].slice(0, 200);
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch {
    /* private mode: celebrations may repeat next visit, never an error */
  }
}
