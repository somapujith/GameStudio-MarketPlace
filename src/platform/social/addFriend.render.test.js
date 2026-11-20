import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';

const auth = vi.hoisted(() => ({ user: null }));
vi.mock('@/lib/auth.jsx', () => ({
  useAuth: () => ({ user: auth.user, subscribe: () => () => {} }),
  useUserEvents: () => {},
}));

import AddFriendButton from './AddFriendButton.jsx';
import AddFriendPanel from './AddFriendPanel.jsx';
import { publishFriends, resetFriendStore } from './friendStore.js';
import { normalizeFriends } from '@/components/online/friendsModel.js';

describe('add-friend components render', () => {
  it('render nothing for signed-out visitors and guests', () => {
    auth.user = null;
    expect(renderToString(h(AddFriendButton, { userId: 'x', name: 'X' }))).toBe('');
    expect(renderToString(h(AddFriendPanel, {}))).toBe('');
    auth.user = { id: 'me', isGuest: true };
    expect(renderToString(h(AddFriendButton, { userId: 'x', name: 'X' }))).toBe('');
    expect(renderToString(h(AddFriendPanel, {}))).toBe('');
  });

  it('button: hidden for self and friends, shown for strangers once friend data is known', () => {
    auth.user = { id: 'me', isGuest: false, friendCode: 'HYD-AAAA' };
    resetFriendStore();
    publishFriends(normalizeFriends({ friends: [{ id: 'f1', name: 'Fay' }], outgoing: [{ id: 'o1', name: 'Oz' }] }));
    expect(renderToString(h(AddFriendButton, { userId: 'me', name: 'Me' }))).toBe('');
    expect(renderToString(h(AddFriendButton, { userId: 'f1', name: 'Fay' }))).toBe('');
    const add = renderToString(h(AddFriendButton, { userId: 's1', name: 'Sam' }));
    expect(add).toContain('Add friend');
    expect(add).toContain('aria-label="Add friend, Sam"');
    const req = renderToString(h(AddFriendButton, { userId: 'o1', name: 'Oz' }));
    expect(req).toContain('Requested');
    expect(req).toContain('disabled');
    const icon = renderToString(h(AddFriendButton, { userId: 's1', name: 'Sam', compact: true }));
    expect(icon).toContain('aria-label="Add Sam as a friend"');
    expect(icon).not.toContain('>Add friend<');
  });

  it('panel: three sections for a member', () => {
    auth.user = { id: 'me', isGuest: false, friendCode: 'HYD-AAAA' };
    const html = renderToString(h(AddFriendPanel, {}));
    expect(html).toContain('Find by name');
    expect(html).toContain('Have a friend code?');
    expect(html).toContain('Type at least 2 letters');
  });
});
