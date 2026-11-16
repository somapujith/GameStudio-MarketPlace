// "You're invited" landing and the join page's first render, server-side (effects do not run: each state is shown by props / auth).
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/components/art/index.js', () => ({
  Avatar: ({ preset }) => h('span', { 'data-avatar': preset }),
  AVATAR_PRESETS: Array.from({ length: 12 }, (_, id) => ({ id, label: `Avatar ${id}` })),
  Logo: () => h('span'),
  Scene: () => h('span'),
}));

const { AuthContext } = await import('@/lib/auth.jsx');
const { default: InviteLanding, GuestForm, InviteSkeleton } = await import('./InviteLanding.jsx');
const { default: JoinRoom } = await import('@/pages/JoinRoom.jsx');
const { BRAND } = await import('@/platform/brand.js');
const { suggestGuestName } = await import('./inviteModel.js');

const auth = (over = {}) => ({
  user: null,
  loading: false,
  configured: true,
  googleClientId: 'x.apps.googleusercontent.com',
  reachable: true,
  authError: null,
  clearAuthError() {},
  signingIn: false,
  loginWithGoogle: async () => null,
  loginGuest: async () => null,
  logout: async () => {},
  refresh: async () => null,
  reloadConfig: async () => false,
  updateProfile: async () => null,
  subscribe: () => () => {},
  userSocketStatus: 'closed',
  ...over,
});
const info = { code: 'ABC234', exists: true, status: 'lobby', players: 2, maxPlayers: 4, hostName: 'Ravi', isMember: false, gameId: BRAND.defaultGameId, visibility: 'private', settings: {} };

const inRouter = (el, a = {}, path = '/join/ABC234') => renderToString(h(MemoryRouter, { initialEntries: [path] }, h(AuthContext.Provider, { value: auth(a) }, el)));
const joinPage = (path, a = {}) =>
  renderToString(
    h(
      MemoryRouter,
      { initialEntries: [path] },
      h(
        AuthContext.Provider,
        { value: auth(a) },
        h(Routes, null, h(Route, { path: '/join/:code', element: h(JoinRoom) }), h(Route, { path: '/join', element: h(JoinRoom) })),
      ),
    ),
  );

describe('InviteLanding (signed out)', () => {
  it('shows who invited you, the table and both ways in', () => {
    const html = inRouter(h(InviteLanding, { code: 'ABC234', info, onOtherCode() {} }));
    expect(html).toContain('Ravi invited you');
    expect(html).toContain('Open to join');
    expect(html).toContain('2 of 4 seats taken');
    expect(html).toContain('Sign in'); // the Google path
    expect(html).toContain('ho-gbtn'); // the Google button
    expect(html).toContain('Join as guest');
    expect(html).toContain('Already have an account?');
    expect(html).toContain('/login?next=%2Fjoin%2FABC234'); // sign-in returns to the same invite
    expect(html).toContain('Use a different code');
    expect(html).not.toContain('Cancel'); // no auto-join countdown for visitors who must choose
    expect(html).not.toContain('sr-joining');
  });
  it('prefills the guest name with a steady friendly suggestion', () => {
    const html = inRouter(h(InviteLanding, { code: 'ABC234', info }));
    expect(html).toContain(`value="${suggestGuestName('ABC234')}"`);
    expect(html).toContain('maxLength="24"');
  });
  it('Google not configured: guest is the only (primary) path, no broken Google button', () => {
    const html = inRouter(h(InviteLanding, { code: 'ABC234', info }), { configured: false, googleClientId: null });
    expect(html).not.toContain('ho-gbtn');
    expect(html).not.toContain('Already have an account?');
    expect(html).toContain('Join as guest');
    expect(html).toContain('ho-btn--primary');
  });
  it('lookup needs a session: a generic invite, still with both paths', () => {
    const html = inRouter(h(InviteLanding, { code: 'ABC234', info: null }));
    expect(html).toContain('invited');
    expect(html).toContain('Sign in or play as a guest to see this table');
    expect(html).toContain('Join as guest');
  });
  it('shows a Google error and the signing-in note', () => {
    expect(inRouter(h(InviteLanding, { code: 'ABC234', info }), { authError: 'Google sign-in failed.' })).toContain('Google sign-in failed.');
    expect(inRouter(h(InviteLanding, { code: 'ABC234', info }), { signingIn: true })).toContain('Signing you in...');
  });
});

describe('GuestForm', () => {
  const form = (props) => renderToString(h(GuestForm, { name: 'Asha', onName() {}, onSubmit() {}, ...props }));
  it('renders the name field and the join button', () => {
    const html = form({});
    expect(html).toContain('Your name at the table');
    expect(html).toContain('value="Asha"');
    expect(html).toContain('Join as guest');
    expect(html).not.toContain('role="alert"');
  });
  it('validation error: announced and tied to the field', () => {
    const html = form({ name: '', error: 'Pick a name so the table knows who you are.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('Pick a name so the table knows who you are.');
    const errId = html.match(/aria-describedby="([^"]+)"/)[1];
    expect(html).toContain(`id="${errId}"`);
  });
  it('busy: disables the field and the button, says what is happening (no double submit)', () => {
    const html = form({ busy: true });
    expect(html).toContain('Taking a seat...');
    expect(html).toContain('aria-busy="true"');
    expect((html.match(/disabled=""/g) || []).length).toBe(2);
  });
  it('names the host when it knows them', () => {
    expect(form({ hostName: 'Ravi' })).toContain('so Ravi knows who is joining');
  });
});

describe('InviteSkeleton', () => {
  it('is a polite status while the invite is checked', () => {
    const html = renderToString(h(InviteSkeleton, {}));
    expect(html).toContain('Opening your invite...');
    expect(html).toContain('role="status"');
  });
});

describe('JoinRoom first render', () => {
  it('signed out on /join/:code: the invite opens (no code boxes) while the table is checked', () => {
    const html = joinPage('/join/abc234');
    expect(html).toContain('Opening your invite');
    expect(html).not.toContain('Enter the 6-character code');
  });
  it('also opens from /join?code=ABC234', () => {
    expect(joinPage('/join?code=abc234')).toContain('Opening your invite');
  });
  it('signed-in guest on /join/:code: the code boxes show the code (preview and countdown follow the lookup)', () => {
    const html = joinPage('/join/abc234', { user: { id: 'g1', name: 'Gita', isGuest: true } });
    expect(html).toContain('Enter the 6-character code');
    expect(html).toContain('>A<');
    expect(html).toContain('>4<');
    expect(html).not.toContain('Opening your invite');
  });
  it('a typed /join stays the plain code page for a signed-out visitor, with Paste', () => {
    const html = joinPage('/join');
    expect(html).toContain('Enter the 6-character code');
    expect(html).toContain('Paste');
    expect(html).not.toContain('Opening your invite');
  });
  it('an invalid code in the link is just a partly filled code page', () => {
    const html = joinPage('/join/AB');
    expect(html).toContain('Enter the 6-character code');
    expect(html).toContain('more to go');
  });
});
