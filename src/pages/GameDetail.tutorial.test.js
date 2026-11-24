// A hybrid game (solo screen + rooms, manifest `tutorial.requiredForRooms`): the game page locks Create table behind the tutorial.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/games/registry.js', async (orig) => {
  const m = await orig();
  const base = m.getGame('hyderabad-tycoon');
  const hybrid = { ...base, id: 'cook-off', name: 'Cook Off', solo: true, tutorial: { requiredForRooms: true }, loaders: { ...base.loaders, soloGame: () => Promise.resolve({ default: () => null }) } };
  const open = { ...hybrid, id: 'cook-open', name: 'Cook Open', tutorial: undefined };
  return { ...m, getGame: (id) => (id === 'cook-off' ? hybrid : id === 'cook-open' ? open : m.getGame(id)) };
});

const { default: GameDetail } = await import('./GameDetail.jsx');
const { AuthContext } = await import('@/lib/auth.jsx');

const page = (id, user = null) =>
  renderToStaticMarkup(
    h(
      AuthContext.Provider,
      { value: { user, loading: false, reachable: true } },
      h(MemoryRouter, { initialEntries: [`/games/${id}`] }, h(Routes, null, h(Route, { path: '/games/:gameId', element: h(GameDetail) }))),
    ),
  ).replaceAll('<!-- -->', '');

describe('GameDetail for a game with a required tutorial', () => {
  it('locked: Play tutorial (a plain link to the solo route) instead of Create table, with the lock note', () => {
    const out = page('cook-off', { id: 'u1', name: 'Asha', gameStats: {} });
    expect(out).toContain('Play tutorial');
    expect(out).toMatch(/<a href="\/play\/cook-off"[^>]*>/);
    expect(out).toContain('Finish the tutorial to open a table with friends');
    expect(out).not.toContain('Create table');
    expect(out).not.toContain('Join with a code');
    expect(out).not.toContain('Invite friends');
    expect(out).not.toContain('Table setup');
    expect(out).not.toContain('id="gd-live"');
    expect(out).not.toContain('class="gd-bar');
  });

  it('unlocked by the server flag: Create table is primary and a solo / practice link is offered', () => {
    const out = page('cook-off', { id: 'u1', name: 'Asha', gameStats: { 'cook-off': { tutorialDone: true } } });
    expect(out).toContain('Create table');
    expect(out).toContain('Play solo / practice');
    expect(out).toMatch(/<a href="\/play\/cook-off"[^>]*>/);
    expect(out).toContain('Join with a code');
    expect(out).toContain('Table setup');
    expect(out).toContain('id="gd-live"');
    expect(out).not.toContain('Play tutorial');
    expect(out).not.toContain('Finish the tutorial');
  });

  it('a hybrid without a required tutorial shows Create table and the practice link', () => {
    const out = page('cook-open', { id: 'u1', name: 'Asha' });
    expect(out).toContain('Create table');
    expect(out).toContain('Play solo / practice');
    expect(out).not.toContain('Play tutorial');
  });

  it('a normal room game is untouched', () => {
    const out = page('hyderabad-tycoon', { id: 'u1', name: 'Asha' });
    expect(out).toContain('Create table');
    expect(out).not.toContain('Play solo');
    expect(out).not.toContain('Play tutorial');
  });
});
