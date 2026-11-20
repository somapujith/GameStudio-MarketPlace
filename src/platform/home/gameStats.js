// Per-game numbers for the profile and leaderboard: the server's `user.gameStats[gameId]` when present,
// otherwise (the default game only) the legacy account totals from `user.stats`.
import { compactINR } from '@shared/format.js';
import { BRAND } from '@/platform/brand.js';

const n = (v) => Math.max(0, Math.round(Number(v) || 0));

/** `{ games, wins, bestScore, rating, source: 'server'|'account' }` or `null` when there is no data. */
export function resolveGameStats({ user, gameId }) {
  const server = user?.gameStats?.[gameId];
  if (server && typeof server === 'object') {
    return { games: n(server.games), wins: n(server.wins), bestScore: n(server.bestScore), rating: n(server.rating), source: 'server' };
  }
  if (gameId !== BRAND.defaultGameId) return null;
  const acct = user?.stats;
  if (acct && (acct.games || acct.wins || acct.bestWorth)) {
    return { games: n(acct.games), wins: n(acct.wins), bestScore: n(acct.bestWorth), rating: 0, source: 'account' };
  }
  return null;
}

/** Columns to show for a game: its manifest `stats`, or a sensible default. */
export function statDefs(game, max = 3) {
  const list = Array.isArray(game?.stats) && game.stats.length ? game.stats : [{ key: 'wins', label: 'Wins' }, { key: 'games', label: 'Games' }, { key: 'rating', label: 'Rating' }];
  return list.slice(0, max);
}

/** A stat value from a leaderboard row or a stats object (`bestScore` falls back to the legacy `bestWorth`). */
export function statValue(source, key) {
  if (!source) return null;
  const v = source[key] ?? (key === 'bestScore' ? source.bestWorth : undefined);
  return v === undefined || v === null ? null : Number(v);
}

const NF = new Intl.NumberFormat('en-IN');

/** Display text for one stat; `def.format === 'inr'` -> rupees, otherwise Indian digit grouping. Missing -> an em dash. */
export function fmtStat(value, def) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return def?.format === 'inr' ? compactINR(value) : NF.format(Math.round(Number(value)));
}

/**
 * Stat columns for a game with `rating` guaranteed in second place (the first column is the ranking stat, the
 * second the one phones still show), then the manifest's other stats up to `max`.
 */
export function statDefsWithRating(game, max = 3) {
  const all = Array.isArray(game?.stats) && game.stats.length ? game.stats : statDefs(null, 3);
  const rating = all.find((d) => d.key === 'rating') || { key: 'rating', label: 'Rating' };
  const rest = all.filter((d) => d.key !== 'rating');
  return (rest.length ? [rest[0], rating, ...rest.slice(1)] : [rating]).slice(0, Math.max(1, max));
}

const ORD = ['th', 'st', 'nd', 'rd'];
/** 1 -> '1st', 2 -> '2nd', 11 -> '11th', 23 -> '23rd'. */
export function ordinal(n) {
  const v = Math.abs(Math.round(Number(n) || 0));
  const m = v % 100;
  return `${v}${(m >= 11 && m <= 13) || !ORD[v % 10] ? 'th' : ORD[v % 10]}`;
}

/**
 * Result chip for a finished match: `{ text, tone: 'win'|'podium'|'loss' }`.
 * Won -> 'Won'; otherwise '2nd of 4' (or just '2nd' when the player count is unknown).
 */
export function matchResult(m) {
  const rank = Math.round(Number(m?.rank) || 0);
  const count = Math.round(Number(m?.playerCount) || (Array.isArray(m?.players) ? m.players.length : 0));
  if (m?.won || rank === 1) return { text: 'Won', tone: 'win' };
  if (!rank) return { text: 'Finished', tone: 'loss' };
  const text = count > 1 ? `${ordinal(rank)} of ${count}` : ordinal(rank);
  return { text, tone: rank <= 3 && count > 3 ? 'podium' : 'loss' };
}

const RTF = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;
const DF = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

/** '5 min ago', 'yesterday', '3 days ago', then a short date ('12 Nov'). Unknown / invalid -> ''. */
export function relTime(when, now = Date.now()) {
  const t = typeof when === 'number' ? when : Date.parse(when);
  if (!Number.isFinite(t)) return '';
  const s = Math.round((t - now) / 1000);
  const a = Math.abs(s);
  if (a < 45) return 'just now';
  if (!RTF) return DF.format(new Date(t));
  if (a < 3600) return RTF.format(Math.round(s / 60), 'minute');
  if (a < 86400) return RTF.format(Math.round(s / 3600), 'hour');
  if (a < 7 * 86400) return RTF.format(Math.round(s / 86400), 'day');
  return DF.format(new Date(t));
}
