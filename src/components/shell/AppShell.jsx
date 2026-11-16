import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { BRAND } from '@/platform/brand.js';
import { getGame } from '@/games/registry.js';
import { HubBackdrop } from '@/platform/game/hubArt.jsx';
import { NoticeSlot } from '@/components/online/InviteBanner.jsx';
import { useSocialCounts, withSocialBadge } from '@/platform/social/useSocialCounts.js';
import ErrorBoundary from './ErrorBoundary.jsx';
import Footer from './Footer.jsx';
import InstallPrompt from './InstallPrompt.jsx';
import OfflineBanner from './OfflineBanner.jsx';
import RouteSkeleton from './RouteSkeleton.jsx';
import TabBar, { TopNav } from './TabBar.jsx';
import TopBar from './nav/TopBar.jsx';
import { pushRecent } from './nav/recent.js';
import { useNavBadges } from './nav/useNavBadges.js';
import { useGlobalClickSfx } from './hooks.js';
import '@/styles/x-shell.css';

/** Static titles for hub screens; game pages (/games/:id) set their own with useDocTitle. */
export const TITLES = [
  ['/games', 'Browse games'],
  ['/search', 'Search'],
  ['/friends', 'Friends'],
  ['/leaderboard', 'Rank'],
  ['/profile', 'Profile'],
  ['/shop', 'Shop'],
  ['/about', 'About'],
  ['/help', 'Help and support'],
  ['/privacy', 'Privacy policy'],
  ['/terms', 'Terms of service'],
  ['/join', 'Join a table'],
  ['/login', 'Sign in'],
  ['/f', 'Add a friend'],
];

/** Document title for a hub path, or null (game pages and unknown paths set their own). */
export function baseTitleFor(pathname) {
  if (pathname === '/') return `${BRAND.name} · ${BRAND.tagline}`;
  if (pathname.startsWith('/games/')) return null;
  const hit = TITLES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  return hit ? `${hit[1]} · ${BRAND.name}` : null;
}

/**
 * Per-route document titles. Child effects run before this one, so a page that sets its own title (a game, a search
 * with a query) must win: the title seen while rendering is the previous route's; if it changed by the time this
 * effect runs, a page took it and we leave it alone.
 */
function useBaseTitle(pathname) {
  const seen = useRef({ path: pathname, title: typeof document !== 'undefined' ? document.title : '' });
  if (seen.current.path !== pathname) seen.current = { path: pathname, title: typeof document !== 'undefined' ? document.title : '' };
  useEffect(() => {
    if (document.title !== seen.current.title) return;
    const t = baseTitleFor(pathname);
    if (t) document.title = t;
  }, [pathname]);
}

/** Remembers game pages you open (for the command palette's "Recent games"). */
function useRecentGame(pathname) {
  useEffect(() => {
    const m = /^\/games\/([^/]+)\/?$/.exec(pathname);
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    if (getGame(id)) pushRecent(id);
  }, [pathname]);
}

/**
 * After a route change (not the first load) move focus to <main> so keyboard and screen-reader users start at
 * the new page, and announce the new title in a polite live region. Search-only changes do nothing.
 */
function useRouteFocus(pathname, mainRef) {
  const prev = useRef(pathname);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (prev.current === pathname) return undefined; // first load (or a StrictMode re-run): leave focus alone
    prev.current = pathname;
    const main = mainRef.current;
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
    // wait a beat so the page (and its own document.title) has settled
    const t = setTimeout(() => setAnnounce(document.title.split(' · ')[0] || ''), 250);
    return () => clearTimeout(t);
  }, [pathname, mainRef]);
  return announce;
}

/**
 * Hub chrome (a layout route): soft backdrop, top bar (logo, search, "Have a code?", coins, profile), bottom tab bar
 * on phones, left rail from 900 px, offline pill, the PWA install card. Game screens (/play/**) and the lobby
 * (/lobby/:code, full screen with its own header) are rendered outside it.
 */
export default function AppShell() {
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  const navBadges = useNavBadges();
  const social = useSocialCounts();
  const badges = useMemo(() => withSocialBadge(navBadges, social), [navBadges, social]);
  useGlobalClickSfx();
  useBaseTitle(pathname);
  useRecentGame(pathname);
  const announce = useRouteFocus(pathname, mainRef);

  return (
    <div className="hub-app">
      <a className="hh-skip" href="#main">
        Skip to content
      </a>
      <div className="hub-backdrop" aria-hidden="true">
        <HubBackdrop />
        <div className="hub-backdrop__shade" />
      </div>

      <TopBar />
      <OfflineBanner />

      <div className="hub-body">
        <TopNav badges={badges} />
        <main id="main" ref={mainRef} className="hub-main" tabIndex={-1}>
          <div className="hub-container">
            <NoticeSlot />
            <ErrorBoundary key={pathname} variant="route">
              <Suspense fallback={<RouteSkeleton pathname={pathname} />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <div className="hub-footslot">
        <Footer />
      </div>

      <TabBar badges={badges} />
      <InstallPrompt />
      <p className="hub-sr" role="status" aria-live="polite">
        {announce ? `${announce}, page loaded` : ''}
      </p>
    </div>
  );
}
