import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import autowala from './manifest.js';
import { GAMES, getGame, liveGames, relatedGames } from '@/games/registry.js';
import { paths } from '@/platform/paths.js';
import { SoloPanel } from '@/platform/game/ActionPanel.jsx';
import { sectionList, detailRows, playersLabel } from '@/platform/game/detailModel.js';
import { orientationLabel } from '@/platform/game/orientationPolicy.js';
import { liveList, rankedList } from '@/platform/home/catalog.js';
import { inviteGames } from '@/components/online/games.js';
import { DEFAULTS, activeChips, applyFilters, matchesPlayers } from '@/platform/browse/filters.js';
import { GAME_ADAPTERS } from '../../../worker/games/index.js';

describe('Autowala manifest', () => {
  it('is a live, solo game in the registry, after Nawabi Raj and before the teasers', () => {
    expect(getGame('autowala')).toBe(autowala);
    expect(autowala.status).toBe('live');
    expect(autowala.solo).toBe(true);
    const ids = GAMES.map((g) => g.id);
    expect(ids.slice(0, 2)).toEqual(['hyderabad-tycoon', 'autowala']);
    const live = liveGames().map((g) => g.id);
    expect(live.slice(0, 2)).toEqual(['hyderabad-tycoon', 'autowala']); // other live games may follow
    expect(ids.indexOf('autowala')).toBeLessThan(ids.findIndex((id) => getGame(id).status === 'coming_soon')); // before the teasers
  });

  it('has a one-player range, art, and nothing room-based', () => {
    expect(autowala.players).toEqual({ min: 1, max: 1 });
    expect(playersLabel(autowala.players)).toBe('1 player');
    expect(autowala.tagline.length).toBeLessThanOrEqual(48);
    expect(autowala.category).toBe('arcade');
    for (const k of ['cover', 'icon']) expect(['function', 'object']).toContain(typeof autowala.art[k]);
    expect(autowala.loaders.onlineGame).toBeUndefined(); // no online screen
    expect(typeof autowala.loaders.soloGame).toBe('function'); // its own full-screen game
    expect(autowala.settings).toBeUndefined(); // no host settings
    expect(autowala.modes).toEqual({ friends: false, open: false });
  });

  it('makes no claim the game cannot back up (no ratings, counts, release date or age rating)', () => {
    for (const k of ['rating', 'ratings', 'installs', 'released', 'ageRating']) expect(autowala).not.toHaveProperty(k);
    expect(autowala.howToPlay.length).toBeGreaterThanOrEqual(3);
    expect(autowala.howToPlay.length).toBeLessThanOrEqual(4);
  });

  it('is a landscape game: the hub gates upright phones and tablets, and the game page says so', () => {
    expect(autowala.orientation).toBe('landscape');
    expect(orientationLabel(autowala)).toBe('Best played in landscape');
    expect(Object.fromEntries(detailRows(autowala).map((r) => [r.label, r.value])).Orientation).toBe('Landscape on phones and tablets');
  });

  it('has no server adapter: the Worker never learns about a solo game', () => {
    expect(Object.keys(GAME_ADAPTERS)).not.toContain('autowala');
  });
});

describe('solo games across the hub', () => {
  it('links to its own static page, escaping nothing it should not', () => {
    expect(paths.solo('autowala')).toBe('/play/autowala');
    expect(paths.solo('hyderabad-tycoon')).toBe('/play/nawabi-raj'); // same slug rule as every public link
  });

  it('the detail nav has no open-tables section, but has a leaderboard because the game saves scores', () => {
    const ids = sectionList(autowala, { live: true }).map((s) => s.id);
    expect(ids).toEqual(['gd-about', 'gd-how', 'gd-gallery', 'gd-board', 'gd-details']);
    expect(ids).not.toContain('gd-live');
    // a solo game that does NOT save scores would have neither
    const quiet = sectionList({ ...autowala, stats: undefined }, { live: true }).map((s) => s.id);
    expect(quiet).not.toContain('gd-board');
    expect(quiet).not.toContain('gd-live');
  });

  it('the details table says Live and 1 player', () => {
    const rows = Object.fromEntries(detailRows(autowala).map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({ Publisher: 'Jalebi Games', Status: 'Live', Players: '1 player', Category: 'Arcade' });
    expect(rows).not.toHaveProperty('Released');
    expect(rows).not.toHaveProperty('Age rating');
  });

  it('is ranked (leaderboard tab, profile stats, badges) because it saves scores; a solo game without stats would not be', () => {
    expect(liveList().map((g) => g.id)).toContain('autowala');
    const ranked = rankedList().map((g) => g.id);
    expect(ranked).toContain('hyderabad-tycoon');
    expect(ranked).toContain('autowala');
    expect(autowala.stats.map((s) => s.key)).toEqual(['bestScore', 'games', 'wins']);
    for (const b of autowala.badges) expect(['games', 'wins', 'bestScore', 'rating']).toContain(b.stat);
  });

  it('cannot be offered as a table to invite friends to', () => {
    const ids = inviteGames().map((g) => g.id);
    expect(ids).toContain('hyderabad-tycoon');
    expect(ids).not.toContain('autowala');
  });

  it('shows up in "more like this" for Nawabi Raj and for a teaser', () => {
    expect(relatedGames(getGame('hyderabad-tycoon'), 6).map((g) => g.id)).toContain('autowala');
    expect(relatedGames(getGame('carrom-club'), 6).map((g) => g.id)).toContain('autowala');
  });
});

describe('browse filters', () => {
  it('a 1-player game is found by the Players: 1 filter and by no other number', () => {
    expect(matchesPlayers(autowala, '1')).toBe(true);
    for (const n of ['2', '3', '4', '5-6', '7plus']) expect(matchesPlayers(autowala, n), n).toBe(false);
    expect(matchesPlayers(getGame('hyderabad-tycoon'), '1')).toBe(false);
    expect(applyFilters(GAMES, { ...DEFAULTS, players: '1' }).map((g) => g.id)).toEqual(['autowala']);
  });

  it('names the active chip in the singular', () => {
    expect(activeChips({ ...DEFAULTS, players: '1' }, []).map((c) => c.label)).toEqual(['1 player']);
    expect(activeChips({ ...DEFAULTS, players: '4' }, []).map((c) => c.label)).toEqual(['4 players']);
  });
});

describe('SoloPanel', () => {
  const html = renderToStaticMarkup(createElement(SoloPanel, { game: autowala }));

  it('is a plain link to the game page: no table, code or sign-in', () => {
    expect(html).toContain('href="/play/autowala"');
    expect(html).toContain('Play now');
    expect(html).toMatch(/<a [^>]*href="\/play\/autowala"/);
    expect(html).not.toMatch(/Create table|Join with a code|Sign in/);
    expect(html).toContain('1 player');
  });
});
