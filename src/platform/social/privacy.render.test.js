import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';

const auth = vi.hoisted(() => ({ user: null }));
const apiMock = vi.hoisted(() => ({ getBlocks: vi.fn(), blockUser: vi.fn(), unblockUser: vi.fn(), getMyRooms: vi.fn(async () => ({ rooms: [] })) }));
vi.mock('@/lib/auth.jsx', () => ({
  useAuth: () => ({ user: auth.user, updateProfile: vi.fn(), subscribe: () => () => {} }),
  useUserEvents: () => {},
}));
vi.mock('@/lib/api.js', () => ({ ...apiMock, errorMessage: (e, f) => (e && e.message) || f, api: { get: vi.fn() } }));

import PrivacyCard from './PrivacyCard.jsx';
import FriendActionsSheet from './FriendActionsSheet.jsx';
import { loadBlocks, resetBlockStore } from './blockStore.js';

const member = (over = {}) => ({ id: 'me', isGuest: false, friendCode: 'HYD-AAAA', friendRequests: 'everyone', ...over });

beforeEach(() => {
  apiMock.getBlocks.mockReset();
  resetBlockStore();
});

describe('PrivacyCard', () => {
  it('renders nothing for signed-out visitors and guests', () => {
    auth.user = null;
    expect(renderToString(h(PrivacyCard, {}))).toBe('');
    auth.user = member({ isGuest: true });
    expect(renderToString(h(PrivacyCard, {}))).toBe('');
  });

  it('shows the request switch ON for everyone, labelled, and a loading state before the list arrives', () => {
    auth.user = member();
    const html = renderToString(h(PrivacyCard, {}));
    expect(html).toContain('Privacy');
    expect(html).toContain('Let anyone send me friend requests');
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
    expect(html).toContain('aria-labelledby="bl-req-label"');
    expect(html).toContain('Blocked players');
    expect(html).toContain('Loading...');
  });

  it("shows the switch OFF when friendRequests is 'nobody'", () => {
    auth.user = member({ friendRequests: 'nobody' });
    const html = renderToString(h(PrivacyCard, {}));
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain('aria-checked="true"');
    expect(html).toContain('Turned off');
  });

  it('empty list explains what blocking does', async () => {
    auth.user = member();
    apiMock.getBlocks.mockResolvedValue({ blocked: [] });
    await loadBlocks();
    const html = renderToString(h(PrivacyCard, {}));
    expect(html).toContain('No one is blocked');
    expect(html).not.toContain('Unblock');
  });

  it('lists blocked players with an accessible Unblock button and a count', async () => {
    auth.user = member();
    apiMock.getBlocks.mockResolvedValue({ blocked: [{ id: 'b1', name: 'Bo', avatar: 2 }, { id: 'b2', name: 'Cy', avatar: 1 }] });
    await loadBlocks();
    const html = renderToString(h(PrivacyCard, {}));
    expect(html).toContain('>Bo<');
    expect(html).toContain('>Cy<');
    expect(html).toContain('aria-label="Unblock Bo"');
    expect(html).toContain('aria-label="Unblock Cy"');
    expect(html).toContain('>2<');
    expect(html).not.toContain('No one is blocked');
  });

  it('a failed load offers a retry', async () => {
    auth.user = member();
    apiMock.getBlocks.mockRejectedValue(new Error('offline'));
    await loadBlocks();
    const html = renderToString(h(PrivacyCard, {}));
    expect(html).toContain('Could not load your blocked players');
    expect(html).toContain('Try again');
  });
});

describe('FriendActionsSheet Block action', () => {
  const friend = { id: 'f1', name: 'Fay', level: 3, online: false, friendCode: 'HYD-FAYY', avatar: 1, equipped: {} };
  const props = { friend, room: 'ABCDEF', inviteState: () => undefined, onInvite() {}, onNewTable() {}, onRemove() {}, onNotify() {}, onClose() {} };

  it('shows Block next to Remove only when the page handles it', () => {
    const without = renderToString(h(FriendActionsSheet, props));
    expect(without).toContain('Remove friend');
    expect(without).not.toContain('>Block<');
    const withBlock = renderToString(h(FriendActionsSheet, { ...props, onBlock() {} }));
    expect(withBlock).toContain('Remove friend');
    expect(withBlock).toContain('>Block<');
    expect(withBlock.indexOf('Remove friend')).toBeLessThan(withBlock.indexOf('>Block<'));
  });
});
