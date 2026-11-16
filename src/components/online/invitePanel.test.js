// Lobby invite panel: pure helpers (default tab, friend filter, button labels) + a guest SSR render.
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/art/index.js', () => ({
  Avatar: ({ preset }) => h('span', { 'data-avatar': preset }),
  AVATAR_PRESETS: [],
  Logo: () => h('span'),
  Scene: () => h('span'),
}));

const { default: InvitePanel, pickTab } = await import('./InvitePanel.jsx');
const { filterByName, INVITE_LABEL, SEARCH_MIN } = await import('./InviteFriends.jsx');

describe('pickTab', () => {
  it('guests and empty friend lists start on Share', () => {
    expect(pickTab({ chosen: null, isGuest: true, friendCount: null })).toBe('share');
    expect(pickTab({ chosen: null, isGuest: false, friendCount: 0 })).toBe('share');
  });
  it('members start on Friends while loading or when they have friends', () => {
    expect(pickTab({ chosen: null, isGuest: false, friendCount: null })).toBe('friends');
    expect(pickTab({ chosen: null, isGuest: false, friendCount: 3 })).toBe('friends');
  });
  it("the player's own choice always wins", () => {
    expect(pickTab({ chosen: 'friends', isGuest: false, friendCount: 0 })).toBe('friends');
    expect(pickTab({ chosen: 'share', isGuest: false, friendCount: 5 })).toBe('share');
  });
});

describe('filterByName', () => {
  const list = [{ name: 'Ravi' }, { name: 'Bela' }, { name: 'Ravindra' }];
  it('is case-insensitive "contains" and leaves an empty query alone', () => {
    expect(filterByName(list, 'rav').map((f) => f.name)).toEqual(['Ravi', 'Ravindra']);
    expect(filterByName(list, '  ')).toBe(list);
    expect(filterByName(list, 'zzz')).toEqual([]);
  });
  it('only long lists get a search box', () => {
    expect(SEARCH_MIN).toBeGreaterThan(6);
  });
});

describe('invite button labels', () => {
  it('cover every state', () => {
    expect(INVITE_LABEL).toMatchObject({ idle: 'Invite', sending: 'Sending', sent: 'Invited', again: 'Invite again', error: 'Retry' });
  });
});

describe('InvitePanel (guest)', () => {
  const html = renderToString(h(MemoryRouter, null, h(InvitePanel, { code: 'ABC234', gameName: 'Kingpin', isGuest: true, openSeats: 2 })));
  it('renders one labelled aside with the id, tabs, share tools and a sign-in note', () => {
    expect(html.startsWith('<aside')).toBe(true);
    expect(html).toContain('id="sr-invite"');
    expect(html).toContain('aria-label="Fill the table"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('2 seats open');
    expect(html).toContain('ABC 234');
    expect(html).toContain('data-tour="lobby-invite"');
    expect(html).toContain('data-tour="lobby-friends"');
    expect(html).toContain('Sign in with Google');
  });
});
