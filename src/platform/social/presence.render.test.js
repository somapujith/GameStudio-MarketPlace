// Rich presence in the UI: status line + Join button on the Friends page rows and the lobby invite rows.
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
vi.mock('@/games/registry.js', () => ({
  getGame: (id) => (id === 'hyderabad-tycoon' ? { id, name: 'Kingpin' } : null),
  liveGames: () => [],
}));

const { FriendsList } = await import('./Rows.jsx');
const { StatusText, JoinButton, statusText, canJoin } = await import('./PresenceBits.jsx');
const { FriendRow, INVITE_LABEL } = await import('@/components/online/InviteFriends.jsx');
const { normalizeFriends } = await import('@/components/online/friendsModel.js');

const render = (el) => renderToString(h(MemoryRouter, null, el));
const friends = normalizeFriends({
  friends: [
    { id: 'a', name: 'Lobby Lia', avatar: 1, online: true, status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon', level: 3 },
    { id: 'b', name: 'Playing Pat', avatar: 2, online: true, status: 'playing', gameId: 'hyderabad-tycoon', level: 3 },
    { id: 'c', name: 'Idle Ian', avatar: 3, online: true, level: 3 },
    { id: 'd', name: 'Gone Gus', avatar: 4, online: false, level: 3 },
  ],
}).friends;
const byName = (name) => friends.find((f) => f.name === name);
const lia = byName('Lobby Lia');
const pat = byName('Playing Pat');
const ian = byName('Idle Ian');
const gus = byName('Gone Gus');
const shown = friends.map((item) => ({ key: item.id, item, leaving: false }));
const listProps = { shown, room: '', roomState: () => undefined, busy: {}, onOpen() {}, onInvite() {}, onInviteRoom() {}, onRemove() {} };
const joinCount = (html) => (html.match(/aria-label="Join [^"]*table"/g) || []).length;

describe('status text', () => {
  it('words and join eligibility', () => {
    expect(statusText(lia)).toBe('In a lobby');
    expect(statusText(pat)).toBe('Playing Kingpin');
    expect(statusText(ian)).toBe('Online');
    expect(statusText(gus)).toBe('Offline');
    expect([lia, pat, ian, gus].map(canJoin)).toEqual([true, false, false, false]);
  });
  it('StatusText carries a tone class', () => {
    expect(render(h(StatusText, { friend: lia }))).toContain('pr-status--lobby');
    expect(render(h(StatusText, { friend: pat }))).toContain('Playing Kingpin');
  });
  it('JoinButton renders only for an open lobby', () => {
    expect(joinCount(render(h(JoinButton, { friend: lia })))).toBe(1);
    for (const f of [pat, ian, gus]) expect(render(h(JoinButton, { friend: f }))).toBe('');
  });
});

describe('Friends page rows', () => {
  it('show each status and a Join button only for the lobby friend', () => {
    const html = render(h(FriendsList, listProps));
    expect(html).toContain('In a lobby');
    expect(html).toContain('Playing Kingpin');
    expect(html).toContain('Gone Gus, offline');
    expect(html).toContain('Idle Ian, online');
    expect(joinCount(html)).toBe(1);
    expect(html).toContain('Join Lobby Lia');
    expect(html).toContain('Invite Idle Ian to a game');
  });
  it('no Join while picking people for a room you are in; joined / declined show on the button', () => {
    const roomState = (f) => (f.id === 'b' ? 'joined' : f.id === 'c' ? 'declined' : undefined);
    const html = render(h(FriendsList, { ...listProps, room: 'WXYZ23', roomState }));
    expect(joinCount(html)).toBe(0);
    expect(html).toContain('>Joined<');
    expect(html).toContain('>Declined<');
  });
});

describe('lobby invite rows', () => {
  const row = (friend, state) => render(h('ul', null, h(FriendRow, { friend, state, onInvite() {}, index: 0 })));
  it('status line and Join for a friend in a lobby', () => {
    const html = row(lia);
    expect(html).toContain('In a lobby');
    expect(joinCount(html)).toBe(1);
    expect(row(pat)).toContain('Playing Kingpin');
    expect(joinCount(row(pat))).toBe(0);
    expect(row(gus)).toContain('Offline · sees it later');
  });
  it('shows the answer to my invite: Joined (no Join button) or Declined (invite again)', () => {
    const joined = row(lia, 'joined');
    expect(joined).toContain('Joined your table');
    expect(joinCount(joined)).toBe(0);
    expect(joined).toContain('disabled');
    const declined = row(ian, 'declined');
    expect(declined).toContain('Declined your invite');
    expect(declined).toContain(INVITE_LABEL.declined);
    expect(declined).not.toContain('disabled');
  });
});
