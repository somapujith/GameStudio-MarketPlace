import { describe, expect, it } from 'vitest';
import { isGameRoute, resolveTheme, routeKind } from './theme.js';
import { skeletonKind } from './RouteSkeleton.jsx';
import { engineAllowsViewTransition } from './transitions.js';
import { canAddToHomeScreenIos, isIos, isIosSafari, MIN_VISITS, shouldOfferInstall } from './install.js';

describe('resolveTheme', () => {
  it('explicit choices win on hub routes', () => {
    expect(resolveTheme('light', { prefersLight: false, pathname: '/' })).toBe('light');
    expect(resolveTheme('dark', { prefersLight: true, pathname: '/profile' })).toBe('dark');
  });
  it('system (and unknown values) follow the OS preference', () => {
    expect(resolveTheme('system', { prefersLight: true, pathname: '/friends' })).toBe('light');
    expect(resolveTheme('system', { prefersLight: false, pathname: '/friends' })).toBe('dark');
    expect(resolveTheme(undefined, { prefersLight: true })).toBe('light');
    expect(resolveTheme('sepia')).toBe('dark');
  });
  it('game screens are always dark; the lobby follows the hub theme', () => {
    expect(resolveTheme('light', { pathname: '/play/hyderabad-tycoon/online/ABC123' })).toBe('dark');
    expect(resolveTheme('system', { prefersLight: true, pathname: '/game/online/ABC123' })).toBe('dark');
    expect(resolveTheme('light', { pathname: '/lobby/ABC123' })).toBe('light');
    expect(isGameRoute('/play/x/online/Y')).toBe(true);
    expect(isGameRoute('/player')).toBe(false);
    expect(isGameRoute('/games/hyderabad-tycoon')).toBe(false);
  });
});

describe('routeKind', () => {
  it('tags full-screen routes for overlay placement', () => {
    expect(routeKind('/play/hyderabad-tycoon/online/ABC123')).toBe('game');
    expect(routeKind('/lobby/ABC123')).toBe('lobby');
    expect(routeKind('/join/ABC123')).toBe('hub');
    expect(routeKind('/')).toBe('hub');
  });
});

describe('skeletonKind', () => {
  it('maps hub routes to a skeleton shape', () => {
    expect(skeletonKind('/')).toBe('home');
    expect(skeletonKind('/friends')).toBe('list');
    expect(skeletonKind('/leaderboard')).toBe('list');
    expect(skeletonKind('/profile')).toBe('profile');
    expect(skeletonKind('/shop')).toBe('shop');
    expect(skeletonKind('/games/hyderabad-tycoon')).toBe('game');
    expect(skeletonKind('/join')).toBe('page');
  });
});

describe('install prompt gate', () => {
  const now = Date.UTC(2026, 10, 15);
  it('waits for the 2nd visit and needs a way to install', () => {
    expect(shouldOfferInstall({ visits: 1, platform: 'prompt', now })).toBe(false);
    expect(shouldOfferInstall({ visits: MIN_VISITS, platform: 'prompt', now })).toBe(true);
    expect(shouldOfferInstall({ visits: 5, platform: null, now })).toBe(false);
    expect(shouldOfferInstall({ visits: 5, platform: 'ios', standalone: true, now })).toBe(false);
  });
  it('a dismissal snoozes it for weeks', () => {
    expect(shouldOfferInstall({ visits: 5, platform: 'ios', dismissedAt: now - 86400000, now })).toBe(false);
    expect(shouldOfferInstall({ visits: 5, platform: 'ios', dismissedAt: now - 40 * 86400000, now })).toBe(true);
  });
  it('detects iOS Safari only', () => {
    const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const chromeIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
    const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
    expect(isIosSafari(safari, 5)).toBe(true);
    expect(isIosSafari(chromeIos, 5)).toBe(false);
    expect(isIosSafari(android, 5)).toBe(false);
  });
});

describe('iOS Add to Home Screen support', () => {
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const chromeIos = (os) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1`;
  const inApp = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0';
  const ipadOs = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
  it('Safari always can, other iOS browsers from iOS 16.4', () => {
    expect(canAddToHomeScreenIos(safari, 5)).toBe(true);
    expect(canAddToHomeScreenIos(chromeIos('17_2'), 5)).toBe(true);
    expect(canAddToHomeScreenIos(chromeIos('16_4'), 5)).toBe(true);
    expect(canAddToHomeScreenIos(chromeIos('16_3'), 5)).toBe(false);
    expect(canAddToHomeScreenIos(chromeIos('15_7'), 5)).toBe(false);
  });
  it('in-app browsers, desktop and Android cannot', () => {
    expect(canAddToHomeScreenIos(inApp, 5)).toBe(false);
    expect(canAddToHomeScreenIos(android, 5)).toBe(false);
    expect(canAddToHomeScreenIos(ipadOs, 0)).toBe(false);
  });
  it('iPadOS (Mac UA with touch points) counts as iOS', () => {
    expect(isIos(ipadOs, 5)).toBe(true);
    expect(isIos(ipadOs, 0)).toBe(false);
    expect(canAddToHomeScreenIos(ipadOs, 5)).toBe(true);
  });
});

describe('route view transitions engine gate', () => {
  it('iOS / iPadOS stay on plain navigation, everything else may animate', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
    const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
    expect(engineAllowsViewTransition(iphone, 5)).toBe(false);
    expect(engineAllowsViewTransition(ipad, 5)).toBe(false);
    expect(engineAllowsViewTransition(android, 5)).toBe(true);
    expect(engineAllowsViewTransition(desktop, 0)).toBe(true);
  });
});
