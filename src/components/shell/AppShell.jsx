import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { BRAND } from '@/platform/brand.js';
import { HubBackdrop } from '@/platform/game/hubArt.jsx';
import { NoticeSlot } from '@/components/online/InviteBanner.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import InstallPrompt from './InstallPrompt.jsx';
import RouteSkeleton from './RouteSkeleton.jsx';
import TabBar, { TopNav } from './TabBar.jsx';
import TopBar from './nav/TopBar.jsx';
import { useGlobalClickSfx } from './hooks.js';
import '@/styles/x-shell.css';

/** Static titles for hub tabs; game pages (/games/...) set their own with useDocTitle. */
const TITLES = [
  ['/friends', 'Friends'],
  ['/leaderboard', 'Rank'],
  ['/profile', 'Profile'],
  ['/shop', 'Shop'],
  ['/join', 'Join a table'],
  ['/login', 'Sign in'],
  ['/f', 'Add a friend'],
];

function useBaseTitle(pathname) {
  useEffect(() => {
    if (pathname.startsWith('/games/')) return;
    const hit = TITLES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
    if (hit) document.title = `${hit[1]} · ${BRAND.name}`;
    else if (pathname === '/') document.title = `${BRAND.name} · ${BRAND.tagline}`;
  }, [pathname]);
}

/**
 * Hub chrome (a layout route): soft backdrop, top bar (logo, "Have a code?", coins, profile chip), bottom
 * tab bar on phones, left rail from 900 px, the PWA install card. Game screens (/play/**) and the lobby
 * (/lobby/:code, full screen with its own header) are rendered outside it.
 */
export default function AppShell() {
  const { pathname } = useLocation();
  useGlobalClickSfx();
  useBaseTitle(pathname);

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

      <div className="hub-body">
        <TopNav />
        <main id="main" className="hub-main" tabIndex={-1}>
          <div className="hub-container">
            <NoticeSlot />
            <ErrorBoundary key={pathname}>
              <Suspense fallback={<RouteSkeleton pathname={pathname} />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <TabBar />
      <InstallPrompt />
    </div>
  );
}
