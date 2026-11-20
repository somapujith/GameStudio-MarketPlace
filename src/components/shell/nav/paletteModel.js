// Command palette model: pure functions (no React, no DOM) so the ranking and the code shortcut are testable.
// Items are plain objects: { id, kind: 'game'|'action'|'join'|'search'|'recent', label, hint?, icon?, to?, run?, game? }
// where `run` is a named side effect the component knows ('code') and `to` is a router path.
import { paths } from '@/platform/paths.js';
import { searchGames } from '@/platform/browse/searchGames.js';
import { normalizeCode } from './codeUtil.js';

export const MAX_GAME_RESULTS = 6;
export const MAX_RECENT = 3;

/** Quick actions, in the order they show when the query is empty. `signedIn` swaps "My profile" for "Sign in". */
export function quickActions({ signedIn = false, next = '/' } = {}) {
  return [
    { id: 'a-code', kind: 'action', label: 'Join with a code', hint: 'Enter a room code', icon: 'hash', run: 'code', keys: 'join table room code invite' },
    { id: 'a-browse', kind: 'action', label: 'Browse all games', hint: 'The full catalogue', icon: 'compass', to: paths.games(), keys: 'browse catalogue catalog store all games' },
    signedIn
      ? { id: 'a-profile', kind: 'action', label: 'My profile', hint: 'Stats, badges, settings', icon: 'user', to: paths.profile(), keys: 'profile account me settings avatar' }
      : { id: 'a-signin', kind: 'action', label: 'Sign in', hint: 'Google or guest', icon: 'login', to: paths.login(next), keys: 'sign in log in login account guest' },
    { id: 'a-rank', kind: 'action', label: 'Leaderboard', hint: 'Top players', icon: 'podium', to: paths.leaderboard(), keys: 'leaderboard rank ranking top players' },
    { id: 'a-friends', kind: 'action', label: 'Friends', hint: 'Invites and requests', icon: 'users', to: paths.friends(), keys: 'friends people invite requests' },
    { id: 'a-shop', kind: 'action', label: 'Shop', hint: 'Spend your coins', icon: 'gift', to: paths.shop(), keys: 'shop store coins cosmetics buy' },
    { id: 'a-help', kind: 'action', label: 'Help', hint: 'Answers and contact', icon: 'info', to: paths.help(), keys: 'help support faq contact question' },
  ];
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

/** True when an action matches every word of the query (label or keywords). */
export function actionMatches(action, query) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = norm(`${action.label} ${action.keys || ''}`);
  return terms.every((t) => hay.includes(t));
}

/**
 * A room code typed into the palette: 4 to 6 letters/digits that are all valid code characters (no 0/O/1/I).
 * Returns the uppercase code or ''. Only a short single "word" qualifies: a phrase is a search.
 */
export function codeFromQuery(query) {
  const raw = String(query ?? '').trim();
  if (!/^[A-Za-z0-9]{4,6}$/.test(raw)) return '';
  const code = normalizeCode(raw);
  return code.length === raw.length ? code : '';
}

const gameItem = (game, kind = 'game') => ({
  id: `${kind}-${game.id}`,
  kind,
  label: game.name,
  hint: game.tagline || '',
  to: paths.game(game.id),
  game,
});

/**
 * Sections for the palette: `[{ id, label, items }]` (empty sections dropped). The flat, keyboard-navigable list
 * is `sections.flatMap((s) => s.items)`.
 *   empty query -> Recent (up to 3) + Quick actions
 *   a query     -> Games (ranked by searchGames) + matching Quick actions + "Join table CODE" + "Search all for ..."
 * A code-shaped query puts "Join table CODE" first when no game matches it, last otherwise.
 */
export function buildSections({ query = '', games, recent = [], signedIn = false, next = '/', search = searchGames } = {}) {
  const q = String(query ?? '').trim();
  const actions = quickActions({ signedIn, next });
  const sections = [];

  if (!q) {
    const recents = recent.slice(0, MAX_RECENT).map((g) => gameItem(g, 'recent'));
    if (recents.length) sections.push({ id: 'recent', label: 'Recent games', items: recents });
    sections.push({ id: 'actions', label: 'Quick actions', items: actions });
    return sections;
  }

  const found = search(q, games)
    .filter((r) => r.score > 0)
    .slice(0, MAX_GAME_RESULTS)
    .map((r) => gameItem(r.game));
  const acts = actions.filter((a) => actionMatches(a, q));
  const code = codeFromQuery(q);
  // a plain word that already matches a game (hyder, ludo) is a search; a code that mixes in a digit is a room
  const join = code && (!found.length || /\d/.test(code)) ? { id: 'join', kind: 'join', label: `Join table ${code}`, hint: 'Go straight to this room', icon: 'door', to: paths.join(code), code } : null;

  if (join && !found.length) sections.push({ id: 'join', label: 'Room code', items: [join] });
  if (found.length) sections.push({ id: 'games', label: 'Games', items: found });
  if (acts.length) sections.push({ id: 'actions', label: 'Quick actions', items: acts });
  if (join && found.length) sections.push({ id: 'join', label: 'Room code', items: [join] });
  sections.push({
    id: 'search',
    label: found.length || acts.length || join ? '' : 'No quick match',
    items: [{ id: 'search-all', kind: 'search', label: `Search all for “${q}”`, hint: 'Open the full results', icon: 'search', to: paths.search(q) }],
  });
  return sections;
}

/** Flat list of every selectable item, in display order. */
export const flatten = (sections) => sections.flatMap((s) => s.items);

/** Next active index with wrap-around (`dir` is 1 or -1). */
export function stepIndex(index, dir, length) {
  if (!length) return -1;
  if (index < 0) return dir > 0 ? 0 : length - 1;
  return (index + dir + length) % length;
}

/** Shortcut label for the platform: "⌘K" on Apple devices, "Ctrl K" elsewhere. */
export function shortcutLabel(platform = typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent || '' : '') {
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘K' : 'Ctrl K';
}

/** Should a global keydown open the palette? Ctrl/Cmd+K anywhere; "/" only when the user is not typing. */
export function isOpenShortcut(e) {
  const key = String(e?.key || '').toLowerCase();
  if (key === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) return true;
  if (key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target;
  if (!t) return true;
  const tag = String(t.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
  if (t.isContentEditable) return false;
  if (typeof t.closest === 'function' && t.closest('[role="dialog"], [role="textbox"], [role="combobox"]')) return false;
  return true;
}
