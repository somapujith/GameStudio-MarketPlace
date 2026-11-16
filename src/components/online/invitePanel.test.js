// Lobby invite panel: pure helpers (friend filter, button labels), the invite ticket and the share-link sheet (SSR renders).
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

const { default: InvitePanel } = await import('./InvitePanel.jsx');
const { default: ShareSheet } = await import('./ShareSheet.jsx');
const { InviteTicket } = await import('./ShareCard.jsx');
const { filterByName, INVITE_LABEL, SEARCH_MIN } = await import('./InviteFriends.jsx');

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

describe('InviteTicket', () => {
  const html = renderToString(h(InviteTicket, { code: 'ABC234', gameName: 'Kingpin', onShare() {} }));
  it('shows the code once, large and grouped, with a spelled-out label for screen readers', () => {
    expect(html).toContain('ABC 234');
    expect((html.match(/ABC 234/g) || []).length).toBe(1);
    expect(html).toContain('Room code A B C 2 3 4');
    expect(html).toContain('data-tour="lobby-invite"');
  });
  it('has the three primary actions: Share invite, Copy code, WhatsApp', () => {
    expect(html).toContain('Share invite');
    expect(html).toContain('Copy code');
    expect(html).toContain('wa.me/?text=');
    expect(html).toContain(encodeURIComponent('Kingpin'));
  });
  it('keeps the link and the QR for the share sheet, not the ticket', () => {
    expect(html).not.toContain('<svg role="img"');
    expect(html).not.toContain('/join/ABC234');
    expect(html).not.toContain('More ways to share');
  });
  it('highlight alternates the pulse class so it can replay', () => {
    expect(renderToString(h(InviteTicket, { code: 'ABC234', highlight: 1 }))).toContain('is-lit-1');
    expect(renderToString(h(InviteTicket, { code: 'ABC234', highlight: 2 }))).toContain('is-lit-0');
    expect(html).not.toContain('is-lit');
  });
});

describe('InvitePanel (guest)', () => {
  const html = renderToString(h(MemoryRouter, null, h(InvitePanel, { code: 'ABC234', gameName: 'Kingpin', isGuest: true, openSeats: 2 })));
  it('renders one labelled aside with the id, the ticket first, the seats pill and a sign-in note (no tabs)', () => {
    expect(html.startsWith('<aside')).toBe(true);
    expect(html).toContain('id="sr-invite"');
    expect(html).toContain('aria-label="Fill the table"');
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('2 seats open');
    expect(html).toContain('ABC 234');
    expect(html).toContain('data-tour="lobby-invite"');
    expect(html).toContain('data-tour="lobby-friends"');
    expect(html).toContain('Sign in with Google');
    expect(html.indexOf('data-tour="lobby-invite"')).toBeLessThan(html.indexOf('data-tour="lobby-friends"'));
  });
  it('the code appears only once on the panel', () => {
    expect((html.match(/ABC 234/g) || []).length).toBe(1);
  });
});

describe('ShareSheet', () => {
  const props = { code: 'ABC234', gameName: 'Kingpin', hostName: 'Ravi', onClose() {} };
  it('renders nothing while closed', () => {
    expect(renderToString(h(ShareSheet, { ...props, open: false }))).toBe('');
  });
  it('open: a dialog that says who and what is being shared, with the code as a secondary line', () => {
    const html = renderToString(h(ShareSheet, { ...props, open: true }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Invite to Ravi&#x27;s table · Kingpin');
    expect(html).toContain('Room code ABC 234');
  });
  it('open: the link is exactly the join link, in a read-only field with a big Copy link button', () => {
    const html = renderToString(h(ShareSheet, { ...props, open: true }));
    expect(html).toContain('value="/join/ABC234"'); // no origin under node: joinLink(code) === '/join/ABC234'
    expect(html).toContain('readOnly=""');
    expect(html).toContain('Copy link');
    expect(html).toContain('ho-btn--lg');
  });
  it('open: WhatsApp, Copy message and a QR code to scan', () => {
    const html = renderToString(h(ShareSheet, { ...props, open: true }));
    expect(html).toContain('wa.me/?text=');
    expect(html).toContain('Copy message');
    expect(html).toContain('<svg');
    expect(html).toContain('QR code for /join/ABC234');
    expect(html).toContain('Scan to join');
  });
  it('without a host it still names the table', () => {
    expect(renderToString(h(ShareSheet, { ...props, hostName: undefined, open: true }))).toContain('Invite to your table · Kingpin');
  });
});

describe('StartBar invite button', () => {
  const base = { isHost: true, canStart: false, starting: false, full: false, open: true, reason: 'Waiting for 1 more player', help: '', need: 1, hostName: 'Ravi', onStart() {} };
  it('host: a secondary Invite button beside Start when onInvite is given, none otherwise', async () => {
    const { default: StartBar } = await import('./StartBar.jsx');
    const html = renderToString(h(StartBar, { ...base, onInvite() {} }));
    expect(html).toContain('ls-start__invite');
    expect(html).toContain('aria-label="Invite players"');
    expect(html).toContain('Start game');
    expect(html.indexOf('ls-start__invite')).toBeLessThan(html.indexOf('ls-start__btn'));
    expect(renderToString(h(StartBar, base))).not.toContain('ls-start__invite');
  });
  it('guests get the Invite button too, next to the waiting status', async () => {
    const { default: StartBar } = await import('./StartBar.jsx');
    const html = renderToString(h(StartBar, { ...base, isHost: false, onInvite() {} }));
    expect(html).toContain('ls-start__invite');
    expect(html).toContain('ls-start__wait');
    expect(html).not.toContain('Start game');
  });
});
