// Joining, the lobby table and connection states: the pure models and the first render of the new pieces.
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { formatElapsed, linkCopy, linkState } from './connection.js';
import { LEAVE_MS, mergeRoster, pruneRoster } from './roster.js';
import { rejectedChars } from './codes.js';
import { resolveOnlineRoute } from './gameRoute.js';
import { fatalView, startReason } from './lobbyModel.js';
import { paths } from '@/platform/paths.js';

vi.mock('@/components/art/index.js', () => ({
  Avatar: ({ preset }) => h('span', { 'data-avatar': preset }),
  AVATAR_PRESETS: [],
  Logo: () => h('span'),
  Scene: () => h('span'),
}));

const { default: ConnectionChip } = await import('./ConnectionChip.jsx');
const { default: RoomPreview, previewFacts, RoomPreviewSkeleton } = await import('./RoomPreview.jsx');
const { default: GameLoadScreen } = await import('./GameLoadScreen.jsx');
const { default: TableHeader } = await import('./TableHeader.jsx');
const { EmptySeat } = await import('./Seat.jsx');
const { default: StatusPanel } = await import('./StatusPanel.jsx');

describe('connection model', () => {
  it('one state from the socket, the browser and the room', () => {
    expect(linkState({ connection: 'connecting' })).toBe('connecting');
    expect(linkState({ connection: 'connecting', everOpen: true })).toBe('reconnecting');
    expect(linkState({ connection: 'open', everOpen: true })).toBe('open');
    expect(linkState({ connection: 'open', offline: true })).toBe('offline');
    expect(linkState({ connection: 'open', fatal: { kind: 'kicked' } })).toBe('closed');
    expect(linkState({ connection: 'closed' })).toBe('closed');
  });
  it('words for each state, with a retry only where it can help', () => {
    expect(linkCopy('open').label).toBe('Connected');
    expect(linkCopy('open').retry).toBe(false);
    const re = linkCopy('reconnecting', { attempt: 3, elapsedMs: 65000 });
    expect(re.hint).toContain('attempt 3');
    expect(re.hint).toContain('1m 05s');
    expect(re.tone).toBe('warn');
    expect(re.retry).toBe(true);
    expect(linkCopy('offline').label).toBe('You are offline');
    expect(linkCopy('connecting', { attempt: 1 }).retry).toBe(false);
    expect(linkCopy('connecting', { attempt: 4 }).hint).toContain('attempt 4');
    expect(linkCopy('nonsense').label).toBe('Connecting');
  });
  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(12999)).toBe('12s');
    expect(formatElapsed(125000)).toBe('2m 05s');
    expect(formatElapsed(-5)).toBe('0s');
    expect(formatElapsed(undefined)).toBe('0s');
  });
});

describe('ConnectionChip', () => {
  it('shows the state, a hint while reconnecting and a live region', () => {
    const html = renderToString(h(ConnectionChip, { connection: 'connecting', link: { attempt: 2, since: null, everOpen: true }, onRetry() {} }));
    expect(html).toContain('Reconnecting');
    expect(html).toContain('data-state="reconnecting"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Try now');
    const ok = renderToString(h(ConnectionChip, { connection: 'open', link: { everOpen: true } }));
    expect(ok).toContain('Connected');
    expect(ok).not.toContain('Try now');
  });
});

describe('roster with a leaving phase', () => {
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  const c = { id: 'c', name: 'C' };
  it('starts live, keeps someone who left in their seat as leaving, and prunes them', () => {
    const first = mergeRoster([], [a, b, c]);
    expect(first.map((e) => [e.key, e.leaving])).toEqual([['a', false], ['b', false], ['c', false]]);
    const next = mergeRoster(first, [a, c]);
    expect(next.map((e) => [e.key, e.leaving])).toEqual([['a', false], ['b', true], ['c', false]]);
    expect(pruneRoster(next).map((e) => e.key)).toEqual(['a', 'c']);
    expect(LEAVE_MS).toBeGreaterThan(100);
  });
  it('a newcomer is live, and someone who comes straight back is not leaving', () => {
    const first = mergeRoster([], [a, b]);
    const gone = mergeRoster(first, [a]);
    expect(mergeRoster(gone, [a, b]).find((e) => e.key === 'b').leaving).toBe(false);
    expect(mergeRoster(first, [a, b, c]).map((e) => e.key)).toEqual(['a', 'b', 'c']);
    expect(mergeRoster(null, null)).toEqual([]);
  });
});

describe('code input hints', () => {
  it('names the look-alike characters that were dropped', () => {
    expect(rejectedChars('ABO1I2')).toEqual(['O', '1', 'I']);
    expect(rejectedChars('abc234')).toEqual([]);
    expect(rejectedChars('https://x.dev/join/ABC234')).toEqual([]);
    expect(rejectedChars('')).toEqual([]);
    expect(rejectedChars('0o0')).toEqual(['0', 'O']);
  });
});

describe('online route: not seated', () => {
  const room = (extra) => ({ gameId: 'hyderabad-tycoon', ...extra });
  it('a non-member of a finished or running match has nothing to join; members and unknown membership go through', () => {
    const go = (r) => resolveOnlineRoute({ gameId: 'hyderabad-tycoon', code: 'ABC234', room: r });
    expect(go(room({ status: 'finished', isMember: false }))).toEqual({ kind: 'ended', gameId: 'hyderabad-tycoon' });
    expect(go(room({ status: 'playing', isMember: false }))).toEqual({ kind: 'started', gameId: 'hyderabad-tycoon' });
    expect(go(room({ status: 'finished', isMember: true }))).toEqual({ kind: 'ok' });
    expect(go(room({ status: 'finished' }))).toEqual({ kind: 'ok' });
    expect(go(room({ status: 'lobby', isMember: false }))).toEqual({ kind: 'ok' });
  });
});

describe('lobby: why Start is off, and the dead-end screens', () => {
  it('says why, never leaves a disabled button unexplained', () => {
    expect(startReason({ enough: false, players: 1, minToStart: 2 })).toBe('Need at least 2 players to start. One more to go.');
    expect(startReason({ enough: false, players: 1, minToStart: 4 })).toContain('3 more to go');
    expect(startReason({ enough: true, open: false })).toContain('Reconnecting');
    expect(startReason({ enough: true, open: true })).toBe('');
    expect(startReason({ enough: false, starting: true })).toBe('');
  });
  it('maps each fatal outcome to a screen', () => {
    const v = (fatal) => fatalView(fatal, { paths, gameId: 'g' });
    expect(v({ kind: 'kicked' }).title).toBe('You were removed from the room');
    expect(v({ kind: 'closed', reason: 'replaced', message: 'x' }).title).toBe('You are in this room somewhere else');
    expect(v({ kind: 'closed', reason: 'replaced', message: 'x' }).actions[0].act).toBe('reload');
    expect(v({ kind: 'closed', message: 'This room has expired.' }).title).toBe('This room has expired');
    expect(v({ kind: 'closed', message: 'This room has expired.' }).actions[0].to).toBe('/games/g');
    expect(v({ kind: 'closed', message: 'The connection to the room was closed.' }).title).toBe('Lost the connection');
    expect(v({ kind: 'join', message: 'This game has already started.' }).title).toBe('This game has already started');
    expect(v({ kind: 'join', message: 'This room is full.' }).title).toBe('This table is full');
    expect(v({ kind: 'join', message: 'That room does not exist.' }).title).toBe('Room not found');
    expect(v({ kind: 'join', message: 'Anything else' }).title).toBe("Can't join this room");
    expect(v({ kind: 'auth', message: '' })).toBeNull();
    expect(v({ kind: 'left', message: '' })).toBeNull();
    expect(v(null)).toBeNull();
  });
});

describe('join preview', () => {
  const info = { code: 'ABC234', exists: true, status: 'lobby', players: 2, maxPlayers: 4, hostName: 'Ravi', gameId: 'hyderabad-tycoon', settings: {} };
  it('facts come only from the lookup', () => {
    const f = previewFacts(info);
    expect(f.host).toBe('Ravi');
    expect(f.seats).toBe('2 of 4 seats taken');
    expect(f.name).toBe('Hyderabad Tycoon');
    expect(previewFacts({ ...info, maxPlayers: undefined }).seats).toBe('2 players here');
    expect(previewFacts({ gameId: 'nope', players: 1 }).name).toBe('nope');
  });
  it('renders the host, seats and the manifest settings line; skeleton has no text', () => {
    const html = renderToString(h(RoomPreview, { info }));
    expect(html).toContain('Hosted by Ravi');
    expect(html).toContain('2 of 4 seats taken');
    expect(html).toContain('Hyderabad Tycoon');
    expect(renderToString(h(RoomPreviewSkeleton))).toContain('st-skel');
  });
});

describe('table header, empty seats, status and load screens', () => {
  it('the table header shows the code in signage and a way to copy it', () => {
    const html = renderToString(h(TableHeader, { game: null, gName: 'Lobby', code: 'ABC234', hostName: 'Ravi', chip: h('i', null, 'chip') }));
    expect(html).toContain('ABC 234');
    expect(html).toContain('Tap to copy');
    expect(html).toContain("Ravi&#x27;s table");
    expect(html).toContain('chip');
  });
  it('an empty seat is an invitation when it can be tapped', () => {
    expect(renderToString(h(EmptySeat, { onInvite() {} }))).toContain('Invite someone');
    expect(renderToString(h(EmptySeat))).not.toContain('<button');
  });
  it('status panel carries an eyebrow', () => {
    expect(renderToString(h(MemoryRouter, null, h(StatusPanel, { eyebrow: 'Room ABC234', title: 'Gone', tone: 'bad' })))).toContain('Room ABC234');
  });
  it('the loading screen names the steps, the room and a way out', () => {
    const html = renderToString(h(MemoryRouter, null, h(GameLoadScreen, { game: null, code: 'ABC234', title: 'Joining the match...', roomChecked: true })));
    expect(html).toContain('Joining the match');
    expect(html).toContain('ABC 234');
    expect(html).toContain('Finding the table');
    expect(html).toContain('Taking your seat');
    expect(html).toContain('Leave');
    expect(html).toContain('st-skel');
  });
});
