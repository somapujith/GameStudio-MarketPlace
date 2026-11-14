// Hub colour theme. `settings.theme` is 'system' | 'dark' | 'light'; 'system' follows
// `prefers-color-scheme: light` live. Game screens (/play/**, legacy /game/**) always stay dark.
//
//   <ThemeSync />                      mounted once inside the router (App.jsx)
//   resolveTheme(pref, { prefersLight, pathname }) -> 'light' | 'dark'   (pure, tested)
//
// Effect: `document.documentElement.dataset.theme = 'light' | 'dark'` and `<meta name="theme-color">` follows.
// main.jsx calls bootTheme() before React renders (the CSP forbids an inline <script> in index.html).
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { loadSettings } from '@/lib/storage.js';
import { BRAND } from '@/platform/brand.js';
import { useSettings } from './stores.js';

export const THEME_PREFS = ['system', 'dark', 'light'];
export const THEME_COLORS = BRAND.themeColors || { dark: '#0a0f1f', light: '#f7f1e6' };

/** Full-screen game routes, which keep their own dark theme. */
export function isGameRoute(pathname = '') {
  const p = String(pathname || '');
  return p.startsWith('/play/') || p.startsWith('/game/');
}

/** 'light' | 'dark' for a theme preference, the OS preference and the current route. */
export function resolveTheme(pref, { prefersLight = false, pathname = '/' } = {}) {
  if (isGameRoute(pathname)) return 'dark';
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return prefersLight ? 'light' : 'dark';
}

const LIGHT_QUERY = '(prefers-color-scheme: light)';

function osPrefersLight() {
  try {
    return typeof matchMedia === 'function' && matchMedia(LIGHT_QUERY).matches;
  } catch {
    return false;
  }
}

/** Live `prefers-color-scheme: light`. */
export function usePrefersLight() {
  const [light, setLight] = useState(osPrefersLight);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    let mq;
    try {
      mq = matchMedia(LIGHT_QUERY);
    } catch {
      return undefined;
    }
    const on = () => setLight(mq.matches);
    on();
    if (mq.addEventListener) mq.addEventListener('change', on);
    else mq.addListener?.(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on);
      else mq.removeListener?.(on);
    };
  }, []);
  return light;
}

/** Applies a resolved theme to <html> and the browser chrome colour. Safe without a DOM. */
export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const t = theme === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  if (root.dataset.theme !== t) root.dataset.theme = t;
  const color = THEME_COLORS[t];
  let metas = document.querySelectorAll('meta[name="theme-color"]');
  if (!metas.length) {
    const m = document.createElement('meta');
    m.setAttribute('name', 'theme-color');
    document.head.appendChild(m);
    metas = [m];
  }
  metas.forEach((m) => {
    if (m.getAttribute('content') !== color) m.setAttribute('content', color);
  });
}

/** Applies the stored theme + motion preference synchronously at boot (before the first React render). */
export function bootTheme() {
  try {
    const s = loadSettings();
    if (s.reducedMotion) document.documentElement.dataset.motion = 'reduced';
    applyTheme(resolveTheme(s.theme, { prefersLight: osPrefersLight(), pathname: window.location.pathname }));
    document.documentElement.dataset.route = routeKind(window.location.pathname);
  } catch {
    /* keep the dark default */
  }
}

/** The theme in effect right now ('light' | 'dark'), for components that need it in JS. */
export function useResolvedTheme() {
  const [settings] = useSettings();
  const prefersLight = usePrefersLight();
  const { pathname } = useLocation();
  return resolveTheme(settings.theme, { prefersLight, pathname });
}

/** 'game' (/play/**), 'lobby' (/lobby/**, full screen with its own sticky header) or 'hub' (inside AppShell). */
export function routeKind(pathname = '') {
  if (isGameRoute(pathname)) return 'game';
  if (String(pathname || '').startsWith('/lobby/')) return 'lobby';
  return 'hub';
}

/**
 * Keeps `<html data-theme>` and `<meta name="theme-color">` in sync, plus `<html data-route="hub|lobby|game">`
 * (global overlays such as toasts position themselves per route). Render once inside the router.
 */
export function ThemeSync() {
  const theme = useResolvedTheme();
  const { pathname } = useLocation();
  const route = routeKind(pathname);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.dataset.route = route;
  }, [route]);
  return null;
}

export default ThemeSync;
