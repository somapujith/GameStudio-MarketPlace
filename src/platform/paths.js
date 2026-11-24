// Every URL in the app is built here, so screens never hard-code a path and a game never needs to
// know how the hub is laid out.

import { gameSlug } from './game/identity.js';

const enc = encodeURIComponent;

export const paths = {
  hub: () => '/',
  /** Browse every game (filters, sort). */
  games: () => '/games',
  /** Search the catalogue; `q` pre-fills the query. */
  search: (q) => (q ? `/search?q=${enc(q)}` : '/search'),
  about: () => '/about',
  help: () => '/help',
  privacy: () => '/privacy',
  terms: () => '/terms',
  /** Game detail page. */
  game: (gameId) => `/games/${enc(gameSlug(gameId))}`,
  /** Full-screen online game for a room code. */
  online: (gameId, code) => `/play/${enc(gameSlug(gameId))}/online/${enc(code)}`,
  /** A SOLO game (manifest `solo: true`): its own full-screen screen, rendered by pages/SoloGame.jsx. */
  solo: (gameId) => `/play/${enc(gameSlug(gameId))}`,
  lobby: (code) => `/lobby/${enc(code)}`,
  join: (code) => (code ? `/join/${enc(code)}` : '/join'),
  friends: () => '/friends',
  /** Opens "add this friend?" for a friend code (`HYD-XXXX`). */
  friendLink: (friendCode) => `/f/${enc(friendCode)}`,
  leaderboard: (gameId) => (gameId ? `/leaderboard?game=${enc(gameSlug(gameId))}` : '/leaderboard'),
  profile: () => '/profile',
  /** Cosmetics shop (spend coins). */
  shop: () => '/shop',
  login: (next) => (next ? `/login?next=${enc(next)}` : '/login'),
  /**
   * Admin console (staff only): `admin()` is the dashboard, `admin('users')`, `admin('users/<id>')`, `admin('rooms')`,
   * `admin('matches')`, `admin('grants')`, `admin('announcements')`, `admin('audit')`. Each segment is escaped.
   */
  admin: (section) => {
    const parts = String(section ?? '')
      .split('/')
      .filter(Boolean)
      .map((p) => enc(p));
    return parts.length ? `/admin/${parts.join('/')}` : '/admin';
  },
};

/**
 * Old URLs that must keep working (bookmarks, shared links, installed PWA). The offline / campaign / story
 * screens are gone, so their links land on the game page, where a table is created.
 */
export const LEGACY_REDIRECTS = [
  ['/play', '/games/nawabi-raj'],
  ['/campaign', '/games/nawabi-raj'],
  ['/story', '/games/nawabi-raj'],
  ['/settings', '/profile'],
];

export default paths;
