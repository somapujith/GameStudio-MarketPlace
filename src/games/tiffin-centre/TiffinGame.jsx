// The Tiffin Centre play screen, as the rest of the app sees it: a SMALL shell that loads the real thing (TiffinGameImpl.jsx: the 3D scene, three.js,
// the models, the HUD, the audio) on demand. The solo home, the briefing and the lobby therefore load only the shell; the heavy chunks are fetched
// in the background while the player reads the home screen (an idle-time prefetch started the first time this module is imported), or on the
// way into a shift, whichever comes first. Same props as before: { session, onExit, onInvite, onRetry, onNext }.
import { lazy, Suspense } from 'react';
import { StatusScreen } from './ui/menus/index.js'; // already on the page (the solo home uses the menus): no extra download
import './tiffin.css';

const loadImpl = () => import('./TiffinGameImpl.jsx');
const Impl = lazy(loadImpl);

let prefetched = false;
/** Starts downloading the 3D chunks (idempotent). Skipped on data-saver connections and when the browser says it is offline. */
export function prefetchTiffinGame() {
  if (prefetched || typeof window === 'undefined') return;
  const conn = typeof navigator !== 'undefined' ? navigator.connection : null;
  if (conn?.saveData || /(^|-)2g$/.test(String(conn?.effectiveType || '')) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  prefetched = true;
  const go = () => loadImpl().catch(() => { prefetched = false; });
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

export default function TiffinGame(props) {
  return (
    <Suspense fallback={<Fallback />}>
      <Impl {...props} />
    </Suspense>
  );
}
