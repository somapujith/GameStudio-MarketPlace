import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToString, renderToStaticMarkup } from 'react-dom/server';

const auth = vi.hoisted(() => ({ user: null }));
vi.mock('@/lib/auth.jsx', () => ({
  useAuth: () => ({ user: auth.user, subscribe: () => () => {}, updateProfile: async () => auth.user }),
  useUserEvents: () => {},
}));

import HandleField, { HandleFieldView, handleMessage } from './HandleField.jsx';
import { handleStatus } from '@/components/online/friendsModel.js';
import { FriendAvatar } from '@/components/online/InviteFriends.jsx';
import { FriendsList, IncomingRequests } from './Rows.jsx';

const view = (props) => renderToStaticMarkup(h(HandleFieldView, { id: 'hd', value: '', onChange: () => {}, onSubmit: () => {}, ...props }));

describe('HandleFieldView states', () => {
  it('idle: rules visible, Save disabled, no dot', () => {
    const html = view({ status: 'idle', message: handleMessage('idle', '', null, '') });
    expect(html).toContain('data-status="idle"');
    expect(html).toContain('Username');
    expect(html).toContain('3-20 characters');
    expect(html).toContain('once a week');
    expect(html).toContain('Pick a username friends can find you by.');
    expect(html).not.toContain('hd-status__dot');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/);
    expect(html).toContain('aria-describedby="hd-status hd-rules"');
  });

  it('checking: pulsing dot and a polite status', () => {
    const html = view({ value: 'new_one', status: 'checking', message: handleMessage('checking', 'new_one') });
    expect(html).toContain('data-status="checking"');
    expect(html).toContain('hd-status--checking');
    expect(html).toContain('hd-status__dot');
    expect(html).toContain('Checking...');
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it('available: good message and Save enabled', () => {
    const html = view({ value: 'new_one', status: 'available', message: handleMessage('available', 'new_one'), canSave: true });
    expect(html).toContain('data-status="available"');
    expect(html).toContain('@new_one is available.');
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    expect(html).not.toContain('aria-invalid');
  });

  it('taken and invalid: marked invalid with the reason', () => {
    const taken = view({ value: 'teja', status: 'taken', message: handleMessage('taken', 'teja') });
    expect(taken).toContain('That username is taken.');
    expect(taken).toContain('aria-invalid="true"');
    const bad = view({ value: '1x', status: 'invalid', message: handleMessage('invalid', '1x', null) });
    expect(bad).toContain('aria-invalid="true"');
    expect(bad).toContain('starting with a letter');
    expect(handleMessage('invalid', 'admin', { value: 'admin', available: false, reason: 'reserved' })).toBe('That username is not available.');
  });

  it('saving disables Save; a server error replaces the line; the weekly lock disables the input', () => {
    expect(view({ status: 'available', canSave: true, saving: true })).toContain('Saving...');
    const err = view({ status: 'idle', error: 'Could not save your username' });
    expect(err).toContain('Could not save your username');
    expect(err).toContain('hd-status--invalid');
    const locked = view({ value: 'mine', status: 'idle', locked: 'You can change your username again in 3 days.' });
    expect(locked).toContain('You can change your username again in 3 days.');
    expect(locked).toMatch(/<input[^>]*disabled=""/);
  });

  it('every status handleStatus can return has a message', () => {
    for (const s of ['idle', 'checking', 'available', 'taken', 'invalid']) expect(handleMessage(s, 'x_y', null, '')).toBeTruthy();
    expect(handleStatus('abc', '', null)).toBe('checking');
  });
});

describe('HandleField (connected)', () => {
  it('renders nothing for signed-out visitors and guests', () => {
    auth.user = null;
    expect(renderToString(h(HandleField))).toBe('');
    auth.user = { id: 'me', isGuest: true, name: 'G' };
    expect(renderToString(h(HandleField))).toBe('');
  });

  it('members get the Username section, prefilled with their handle', () => {
    auth.user = { id: 'me', isGuest: false, name: 'Me', handle: 'chai_uncle', handleChangedAt: null };
    const html = renderToString(h(HandleField));
    expect(html).toContain('id="username"');
    expect(html).toContain('value="chai_uncle"');
    expect(html).toContain('This is your username');
    expect(html).not.toContain('disabled=""><');
  });

  it('a member without a handle sees the empty field; a recent change is locked', () => {
    auth.user = { id: 'me', isGuest: false, name: 'Me', handle: null };
    expect(renderToString(h(HandleField))).toContain('Pick a username friends can find you by.');
    auth.user = { id: 'me', isGuest: false, name: 'Me', handle: 'a_b', handleChangedAt: new Date().toISOString() };
    expect(renderToString(h(HandleField))).toContain('again in 7 days');
  });
});

describe('@handle on rows', () => {
  const shown = (list) => list.map((item) => ({ key: item.id, item, leaving: false }));
  const friend = (extra) => ({ id: 'f1', name: 'Fay', avatar: 1, online: false, level: 3, equipped: {}, ...extra });
  const rest = { busy: {}, roomState: () => undefined, onOpen() {}, onInviteRoom() {}, onInvite() {}, onRemove() {} };

  it('friend rows print @handle under the name only when there is one', () => {
    const withHandle = renderToStaticMarkup(h(FriendsList, { shown: shown([friend({ handle: 'fay_k' })]), ...rest }));
    expect(withHandle).toContain('hd-handle');
    expect(withHandle).toContain('@fay_k');
    const without = renderToStaticMarkup(h(FriendsList, { shown: shown([friend({ handle: null })]), ...rest }));
    expect(without).not.toContain('hd-handle');
    expect(without).not.toContain('@');
  });

  it('request rows too', () => {
    const html = renderToStaticMarkup(h(IncomingRequests, { shown: shown([friend({ handle: 'fay_k' })]), busy: {}, onAccept() {}, onDecline() {} }));
    expect(html).toContain('@fay_k');
  });

  it('FriendAvatar is untouched by handles', () => {
    expect(renderToStaticMarkup(h(FriendAvatar, { person: friend({ handle: 'x_y' }) }))).not.toContain('@');
  });
});
