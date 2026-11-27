// The Tiffin Centre play screen, as the rest of the app sees it: a SMALL shell that loads the real thing (TiffinGameImpl.jsx: the 3D scene, three.js,
// the models, the HUD, the audio) on demand. The solo home, the briefing and the lobby therefore load only the shell; the heavy chunks are fetched
// in the background while the player reads the home screen (an idle-time prefetch started the first time this module is imported), or on the
// way into a shift, whichever comes first. Same props as before: { session, onExit, onInvite, onRetry, onNext }.
//
// A device that cannot create a WebGL 2 context is told so AT ONCE (a throw-away canvas, a few ms, no three.js): the heavy chunks are neither prefetched nor imported for
// it. Before this the card appeared only after 5 to 9 s of downloads and parsing on a weak phone. In the Android app the wording has no browser advice (see StatusScreen).
import { lazy, Suspense, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusScreen } from './ui/menus/index.js'; // already on the page (the solo home uses the menus): no extra download
import { probeWebgl2 } from './scene/capabilities.js'; // pure: no three.js
import { clearSavedShift } from './session/index.js'; // (the solo home and the room page import it already)
import { paths } from '@/platform/paths.js';
import { GAME_ID } from '@shared/tiffin-centre/catalog.js';
import './tiffin.css';

const loadImpl = () => import('./TiffinGameImpl.jsx');
const Impl = lazy(loadImpl);

let prefetched = false;
/** Starts downloading the 3D chunks (idempotent). Skipped on data-saver connections, when the browser says it is offline, and on a device that cannot do WebGL 2. */
export function prefetchTiffinGame() {
  if (prefetched || typeof window === 'undefined') return;
  const conn = typeof navigator !== 'undefined' ? navigator.connection : null;
  if (conn?.saveData || /(^|-)2g$/.test(String(conn?.effectiveType || '')) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  prefetched = true;
  const go = () => {
    if (!probeWebgl2().ok) return; // nothing to fetch for a device that cannot draw it
    loadImpl().catch(() => { prefetched = false; });
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 5000 });
  else setTimeout(go, 1500); // Safari has no requestIdleCallback
}
prefetchTiffinGame();

// shown while the 3D chunk downloads (the loading screen with the progress bar takes over inside the impl)
function Fallback() {
  return (
    <div className="tc">
      <StatusScreen kind="loading" />
    </div>
  );
}

/** The no-WebGL card, shown without loading the 3D code. A local shift is held (it starts ticking when the session is made) and never offered for resume: it was never on screen. */
function NoWebgl({ session }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (session && session.mode !== 'online' && session.status === 'playing') session.pause?.();
  }, [session]);
  return (
    <div className="tc">
      <StatusScreen
        kind="webgl"
        onRetry={() => window.location.reload()}
        onExit={() => {
          session?.quit?.();
          if (session && session.mode !== 'online') clearSavedShift();
          navigate(paths.game(GAME_ID));
        }}
      />
    </div>
  );
}

export default function TiffinGame(props) {
  if (!probeWebgl2().ok) return <NoWebgl session={props.session} />;
  return (
    <Suspense fallback={<Fallback />}>
      <Impl {...props} />
    </Suspense>
  );
}
