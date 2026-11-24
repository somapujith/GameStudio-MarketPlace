import { lazy, Suspense, useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth.jsx';
import { AppShell, ErrorBoundary, ToastProvider } from '@/components/shell/index.js';
import { CelebrationHost } from '@/components/shell/celebrate.js';
import { ScrollManager } from '@/components/shell/scroll.js';
import { useSettings } from '@/components/shell/stores.js';
import { isGameRoute, ThemeSync } from '@/components/shell/theme.js';
import { ViewTransitionBridge } from '@/components/shell/transitions.js';
import { BRAND } from '@/platform/brand.js';
import { LEGACY_REDIRECTS, paths } from '@/platform/paths.js';
import { isStaff } from '@/lib/adminApi.js';
import PageLoading from '@/platform/game/PageLoading.jsx';
import RefCapture from '@/platform/engagement/RefCapture.jsx';
import '@/styles/hub.css';
import '@/styles/mobile.css';
import '@/styles/store.css';
// The cine skin (docs/CINE_UI.md) loads LAST: the shared base, then the shell chrome built on it. The street-poster
// (jalebi*.css) and publisher (publisher*.css) layers are retired from the hub.
import '@/styles/cine.css';
import '@/styles/cine/shell.css';

/**
 * Lazy page loader that tolerates default OR named exports (several pages are written by other agents;
 * `name` is the named export to fall back to).
 */
function page(loader, name) {
  return lazy(() =>
    loader().then((m) => ({
      default: m.default ?? m[name] ?? Object.values(m).find((v) => typeof v === 'function'),
    })),
  );
}

// Hub pages
const Home = page(() => import('@/pages/Home.jsx'), 'Home');
const Leaderboard = page(() => import('@/pages/Leaderboard.jsx'), 'Leaderboard');
const Profile = page(() => import('@/pages/Profile.jsx'), 'Profile');
const Shop = page(() => import('@/pages/Shop.jsx'), 'Shop');
const GameDetail = page(() => import('@/pages/GameDetail.jsx'), 'GameDetail');
const Games = page(() => import('@/pages/Games.jsx'), 'Games');
const Search = page(() => import('@/pages/Search.jsx'), 'Search');
const About = page(() => import('@/pages/About.jsx'), 'About');
const Help = page(() => import('@/pages/Help.jsx'), 'Help');
const Privacy = page(() => import('@/pages/Privacy.jsx'), 'Privacy');
const Terms = page(() => import('@/pages/Terms.jsx'), 'Terms');
const NotFound = page(() => import('@/pages/NotFound.jsx'), 'NotFound');

// Rooms, friends, accounts
const Login = page(() => import('@/pages/Login.jsx'), 'Login');
const Friends = page(() => import('@/pages/Friends.jsx'), 'Friends');
const FriendLink = page(() => import('@/pages/FriendLink.jsx'), 'FriendLink');
const Lobby = page(() => import('@/pages/Lobby.jsx'), 'Lobby');
const JoinRoom = page(() => import('@/pages/JoinRoom.jsx'), 'JoinRoom');
const OnlineGame = page(() => import('@/pages/OnlineGame.jsx'), 'OnlineGame');

// Admin console (staff only, its own chunk)
const AdminApp = page(() => import('@/pages/admin/AdminApp.jsx'), 'AdminApp');

/** Mirrors the in-app "reduced motion" setting onto <html> so CSS can honour it. */
function MotionSync() {
  const [settings] = useSettings();
  useEffect(() => {
    const el = document.documentElement;
    if (settings.reducedMotion) el.dataset.motion = 'reduced';
    else delete el.dataset.motion;
  }, [settings.reducedMotion]);
  return null;
}

/**
 * Keeps the signed-in user's numbers fresh (coins, XP, level, daily): re-reads /api/me when leaving a game
 * screen (a finished match changed them) and when the tab becomes visible again (at most once a minute).
 */
function UserRefresh() {
  const { user, refresh } = useAuth();
  const { pathname } = useLocation();
  const wasGame = useRef(isGameRoute(pathname));
  const last = useRef(0);
  const signedIn = !!user;

  useEffect(() => {
    const inGame = isGameRoute(pathname);
    if (wasGame.current && !inGame && signedIn) {
      last.current = Date.now();
      refresh?.();
    }
    wasGame.current = inGame;
  }, [pathname, signedIn, refresh]);

  useEffect(() => {
    if (!signedIn) return undefined;
    const onVis = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last.current < 60000) return;
      if (isGameRoute(window.location.pathname)) return;
      last.current = Date.now();
      refresh?.();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [signedIn, refresh]);
  return null;
}

/**
 * Redirect that keeps what an old link carried: `location.state`, the query string and the hash.
 * If `to` has its own query, it wins over the same key from the old URL.
 */
function KeepRedirect({ to }) {
  const loc = useLocation();
  const [base, own = ''] = String(to).split('?');
  const search = new URLSearchParams(loc.search);
  for (const [k, v] of new URLSearchParams(own)) search.set(k, v);
  const qs = search.toString();
  return <Navigate replace to={{ pathname: base, search: qs ? `?${qs}` : '', hash: loc.hash }} state={loc.state} />;
}

/** `/game/online/:code` (the old single-game URL) -> the default game's online screen. */
function LegacyOnline() {
  const { code } = useParams();
  return <KeepRedirect to={paths.online(BRAND.defaultGameId, code)} />;
}

/** Screens that no longer exist (offline play, open tables, story, campaign) land on their game's page. */
function ToGamePage() {
  const { gameId } = useParams();
  return <Navigate replace to={gameId ? paths.game(gameId) : paths.hub()} />;
}

/**
 * `/admin/*`: signed-out and non-staff visitors get the hub's normal 404 inside the shell (the console chunk is never
 * fetched for them); staff get the full-screen console, which double-checks the role and loads its permissions.
 */
function AdminRoute() {
  const { user, loading } = useAuth();
  const shell404 = (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
  if (!loading && !isStaff(user)) return shell404;
  return <AdminApp notFound={shell404} />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <MotionSync />
        <ThemeSync />
        <ScrollManager />
        <ViewTransitionBridge />
        <UserRefresh />
        <RefCapture />
        <ToastProvider>
          <ErrorBoundary silent>
            <CelebrationHost />
          </ErrorBoundary>
          <ErrorBoundary fullscreen>
            <Suspense fallback={<PageLoading fullscreen />}>
              <Routes>
                {/* Old single-game URLs keep working (state + query preserved) */}
                {LEGACY_REDIRECTS.map(([from, to]) => (
                  <Route key={from} path={from} element={<KeepRedirect to={to} />} />
                ))}
                <Route path="/game/online/:code" element={<LegacyOnline />} />
                <Route path="/game/offline" element={<Navigate replace to={paths.game(BRAND.defaultGameId)} />} />
                <Route path="/play/:gameId/offline" element={<ToGamePage />} />
                <Route path="/games/:gameId/play" element={<ToGamePage />} />
                <Route path="/games/:gameId/tables" element={<ToGamePage />} />
                <Route path="/games/:gameId/x/:extra" element={<ToGamePage />} />

                {/* Game screen: full screen, no hub chrome */}
                <Route path="/play/:gameId/online/:code" element={<OnlineGame />} />
                {/* Lobby: full screen (renders its own header), hub theme */}
                <Route path="/lobby/:code" element={<Lobby />} />
                {/* Admin console: full screen with its own sidebar (staff only; others get the 404) */}
                <Route path="/admin/*" element={<AdminRoute />} />

                {/* Hub screens */}
                <Route element={<AppShell />}>
                  <Route index element={<Home />} />
                  <Route path="/games" element={<Games />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/games/:gameId" element={<GameDetail />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/help" element={<Help />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/leaderboard" element={<Leaderboard />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/shop" element={<Shop />} />
                  <Route path="/friends" element={<Friends />} />
                  <Route path="/f/:code" element={<FriendLink />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/join" element={<JoinRoom />} />
                  <Route path="/join/:code" element={<JoinRoom />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </ToastProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}
