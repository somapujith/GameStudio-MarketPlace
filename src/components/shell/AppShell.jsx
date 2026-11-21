import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth.jsx';
import { BRAND } from '@/platform/brand.js';
import { getGame } from '@/games/registry.js';
import { HubBackdrop } from '@/platform/game/hubArt.jsx';
import { NoticeSlot } from '@/components/online/InviteBanner.jsx';
import { useSocialCounts, withSocialBadge } from '@/platform/social/useSocialCounts.js';
import { useTitleCount } from '@/platform/social/useTitleCount.js';
import AnnouncementBar from '@/platform/notifications/AnnouncementBar.jsx';
import SuspendedScreen, { SuspendedStrip } from '@/platform/notifications/SuspendedScreen.jsx';
import { NotificationsProvider } from '@/platform/notifications/useNotifications.jsx';
import { isPublicPath } from '@/platform/notifications/suspendedModel.js';
import ErrorBoundary from './ErrorBoundary.jsx';
import Footer from './Footer.jsx';
import InstallPrompt from './InstallPrompt.jsx';
import OfflineBanner from './OfflineBanner.jsx';
import RouteSkeleton from './RouteSkeleton.jsx';
import TabBar from './TabBar.jsx';
import TopBar from './nav/TopBar.jsx';
import { pushRecent } from './nav/recent.js';
import { useNavBadges } from './nav/useNavBadges.js';
import { useGlobalClickSfx } from './hooks.js';
import '@/styles/x-shell.css';

// The daily-reward popup: its own chunk (it pulls the Home card's styles), and a failed load just means no popup.
const DailyRewardPopup = lazy(() => import('@/platform/home/DailyRewardPopup.jsx').catch(() => ({ default: () => null })));
// Gifts from the team (members only): same deal, its own chunk (it pulls the shop's item art).
const GiftPopup = lazy(() => import('@/platform/notifications/GiftPopup.jsx').catch(() => ({ default: () => null })));

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
 * Hub chrome (a layout route): label masthead with horizontal navigation (logo, Arcade / The Adda / Leaderboard,
 * search, "Enter code", coins, bell, profile), a bottom tab bar on smaller screens, offline pill, the PWA install
 * card and the daily-reward popup. Nav badges (friend requests, invites, friends online) go to both the masthead
 * nav and the tab bar. Game screens (/play/**) and the lobby (/lobby/:code, full screen with its own header) are
 * rendered outside the platform chrome.
 * Admin features for players (docs/ADMIN.md): the notifications bell (TopBar), the announcement strip under the top
 * bar, the gift popup (it goes first; the daily popup is not even mounted while a gift popup is up, so the two never
 * show together) and, for a suspended account, the full-page suspended screen in place of everything except the
 * public pages (Help, Privacy, Terms, About), which keep the shell with a slim "suspended" strip.
 */
export default function AppShell() {
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  const navBadges = useNavBadges();
  const social = useSocialCounts();
  const badges = useMemo(() => withSocialBadge(navBadges, social), [navBadges, social]);
  useTitleCount(social.total); // "(2) Friends · Jalebi Games" while requests / invites wait
  useGlobalClickSfx();
  useBaseTitle(pathname);
  useRecentGame(pathname);
  const announce = useRouteFocus(pathname, mainRef);
  const { user, suspended } = useAuth();
  const member = !!user && !user.isGuest;
  const [giftUp, setGiftUp] = useState(false);

  if (suspended && !isPublicPath(pathname)) return <SuspendedScreen reason={suspended.reason} />;

  return (
    <NotificationsProvider>
      <div className={`hub-app${pathname === '/' ? ' hub-app--home' : ''}`}>
        <a className="hh-skip" href="#main">
          Skip to content
        </a>
        <div className="hub-backdrop" aria-hidden="true">
          <HubBackdrop />
          <div className="hub-backdrop__shade" />
        </div>

        <TopBar badges={badges} />
        <OfflineBanner />
        {suspended ? <SuspendedStrip /> : <AnnouncementBar />}

        <div className="hub-body">
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
        {member && (
          <Suspense fallback={null}>
            <GiftPopup onActiveChange={setGiftUp} />
          </Suspense>
        )}
        {!giftUp && (
          <Suspense fallback={null}>
            <DailyRewardPopup />
          </Suspense>
        )}
        <p className="hub-sr" role="status" aria-live="polite">
          {announce ? `${announce}, page loaded` : ''}
        </p>
      </div>
    </NotificationsProvider>
  );
}
