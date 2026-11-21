import { describe, expect, it } from 'vitest';
import {
  DISMISS_KEY,
  DISMISS_MAX,
  bannerRouteAllowed,
  dismissAnnouncement,
  isLive,
  linkTarget,
  msUntilEnd,
  normalizeAnnouncement,
  pickAnnouncement,
  readDismissed,
  withDismissed,
} from './announcementModel.js';

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const at = (ms) => new Date(NOW + ms).toISOString();
const ann = (id, over = {}) => ({ id, message: `Message ${id}`, tone: 'info', linkUrl: null, linkLabel: null, startsAt: at(-3600_000), endsAt: null, active: true, createdAt: at(-3600_000), ...over });

function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

describe('bannerRouteAllowed', () => {
  it('shows on hub pages, never on the leaderboard, lobby or game screens', () => {
    for (const p of ['/', '/games', '/profile', '/shop', '/games/nawabi-raj', '/help']) expect(bannerRouteAllowed(p)).toBe(true);
    for (const p of ['/leaderboard', '/leaderboard/weekly', '/lobby/ABC234', '/play/x/online/ABC']) expect(bannerRouteAllowed(p)).toBe(false);
    expect(bannerRouteAllowed('')).toBe(false);
    expect(bannerRouteAllowed(undefined)).toBe(false);
  });
});

describe('linkTarget', () => {
  it('accepts same-site paths and https URLs only', () => {
    expect(linkTarget('/shop?kind=dice')).toEqual({ kind: 'internal', to: '/shop?kind=dice' });
    expect(linkTarget('https://example.com/diwali')).toEqual({ kind: 'external', href: 'https://example.com/diwali' });
    for (const bad of ['//evil.com', '/\\evil.com', 'http://example.com', 'javascript:alert(1)', 'shop', '', null, 42, 'https://']) expect(linkTarget(bad)).toBeNull();
  });
});

describe('normalizeAnnouncement / isLive', () => {
  it('cleans tone, link and label', () => {
    const a = normalizeAnnouncement(ann('a', { tone: 'party', linkUrl: '/shop', linkLabel: '' }));
    expect(a.tone).toBe('info');
    expect(a.link).toEqual({ kind: 'internal', to: '/shop', label: 'Learn more' });
    expect(normalizeAnnouncement(ann('b', { linkUrl: 'javascript:x', linkLabel: 'Go' })).link).toBeNull();
    expect(normalizeAnnouncement(ann('c', { tone: 'event', linkUrl: 'https://x.dev', linkLabel: 'See the event' })).link).toEqual({ kind: 'external', href: 'https://x.dev/', label: 'See the event' });
    expect(normalizeAnnouncement({ id: 'x', message: '  ' })).toBeNull();
    expect(normalizeAnnouncement({ message: 'hi' })).toBeNull();
  });
  it('is live only inside its window and while active', () => {
    expect(isLive(ann('a'), NOW)).toBe(true);
    expect(isLive(ann('a', { startsAt: at(60_000) }), NOW)).toBe(false);
    expect(isLive(ann('a', { endsAt: at(-1) }), NOW)).toBe(false);
    expect(isLive(ann('a', { endsAt: at(0) }), NOW)).toBe(false);
    expect(isLive(ann('a', { endsAt: at(1000) }), NOW)).toBe(true);
    expect(isLive(ann('a', { active: false }), NOW)).toBe(false);
    expect(isLive(ann('a', { startsAt: null }), NOW)).toBe(true);
    expect(isLive(null, NOW)).toBe(false);
  });
  it('msUntilEnd', () => {
    expect(msUntilEnd(ann('a', { endsAt: at(5000) }), NOW)).toBe(5000);
    expect(msUntilEnd(ann('a', { endsAt: at(-5000) }), NOW)).toBe(0);
    expect(msUntilEnd(ann('a'), NOW)).toBeNull();
  });
});

describe('pickAnnouncement', () => {
  const list = [ann('old', { startsAt: at(-7200_000) }), ann('new', { startsAt: at(-60_000), tone: 'event' }), ann('future', { startsAt: at(60_000) })];
  it('shows the newest live one', () => {
    expect(pickAnnouncement(list, { now: NOW }).id).toBe('new');
  });
  it('skips dismissed ones and falls back to the next', () => {
    expect(pickAnnouncement(list, { now: NOW, dismissed: ['new'] }).id).toBe('old');
    expect(pickAnnouncement(list, { now: NOW, dismissed: ['new', 'old'] })).toBeNull();
    expect(pickAnnouncement(null, { now: NOW })).toBeNull();
  });
});

describe('dismissal storage', () => {
  it('round-trips ids under one key, newest last, capped', () => {
    const store = memStore();
    expect(readDismissed(store)).toEqual([]);
    dismissAnnouncement('a', store);
    dismissAnnouncement('b', store);
    dismissAnnouncement('a', store);
    expect(readDismissed(store)).toEqual(['b', 'a']);
    expect(JSON.parse(store.map.get(DISMISS_KEY))).toEqual(['b', 'a']);
    let list = [];
    for (let i = 0; i < DISMISS_MAX + 5; i += 1) list = withDismissed(list, `id${i}`);
    expect(list).toHaveLength(DISMISS_MAX);
    expect(list[list.length - 1]).toBe(`id${DISMISS_MAX + 4}`);
  });
  it('never throws on broken storage', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    expect(readDismissed(throwing)).toEqual([]);
    expect(dismissAnnouncement('a', throwing)).toEqual(['a']);
    expect(readDismissed(memStore({ [DISMISS_KEY]: '{not json' }))).toEqual([]);
    expect(readDismissed(memStore({ [DISMISS_KEY]: '{"a":1}' }))).toEqual([]);
    expect(readDismissed(null)).toEqual([]);
  });
});
