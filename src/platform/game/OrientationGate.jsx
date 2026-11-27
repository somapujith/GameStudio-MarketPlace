// <OrientationGate policy="landscape"> wraps a game screen that needs a particular orientation (manifest `orientation: 'landscape'`).
//
//   - Desktop (a mouse is the main pointer) and a device already in the right orientation: the children render untouched. The only DOM
//     added is a `display: contents` wrapper, so a full-screen game root (`position: fixed; inset: 0`) behaves exactly as before.
//   - A phone or tablet in the wrong orientation: the children STAY MOUNTED (no state is lost, nothing reloads) but are hidden and inert,
//     a full-screen "Turn your phone sideways" screen (English + Telugu, animated phone, reduced-motion aware) covers them, and the
//     `paused` signal goes out through context: the game stops its rAF loop and its audio with `useGamePaused()`.
//   - The moment the device is in the right orientation again the screen goes and the signal drops: the game resumes, no reload.
// See docs/perf/landscape.md for the design and docs/ADDING_A_GAME.md for how a game opts in.
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/noto-sans-telugu';
import { themeVars } from './color.js';
import { OrientationContext } from './orientationContext.js';
import { normalizePolicy } from './orientationPolicy.js';
import { gateCopy } from './orientationText.js';
import { useOrientationPolicy } from './useOrientationPolicy.js';
import './orientation.css';

/** A phone that turns on its side (a compositor-only CSS turn, four times, then it rests; `reverse` for the portrait policy). Static under reduced motion. */
export function PhoneTurnIcon({ reverse = false, size = 112 }) {
  return (
    <span className={`og-icon${reverse ? ' og-icon--reverse' : ''}`} style={size === 112 ? undefined : { '--og-icon': `${size}px` }} aria-hidden="true">
      <span className="og-icon__phone" />
      <svg className="og-icon__arrow" viewBox="0 0 120 120" fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d="M88 22a44 44 0 0 1 22 30" />
        <path d="M104 40l7.5 14.5L96 54.5" />
      </svg>
    </span>
  );
}

const inNativeApp = () => {
  try {
    return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};

/** The cover screen itself (also rendered on its own in tests). */
export function TurnScreen({ policy = 'landscape', gameName, theme, backTo = '/', canLock = false, onPlay }) {
  const ref = useRef(null);
  const copy = useMemo(() => gateCopy(policy, gameName), [policy, gameName]);
  useEffect(() => {
    const el = ref.current;
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true }); // a screen reader announces the dialog when it appears
  }, []);
  const { en, te } = copy;
  return (
    <div className="og-gate" role="dialog" aria-modal="true" aria-labelledby="og-title" aria-describedby="og-body" data-og-gate={policy} tabIndex={-1} ref={ref} style={themeVars(theme)}>
      <div className="og-card">
        <PhoneTurnIcon reverse={policy === 'portrait'} />
        <h2 id="og-title" className="og-title">
          <span>{en.title}</span>
          <span className="og-te" lang="te">
            {te.title}
          </span>
        </h2>
        <p id="og-body" className="og-body">
          <span>{en.body}</span>
          <span className="og-te" lang="te">
            {te.body}
          </span>
        </p>
        <div className="og-actions">
          {canLock && (
            <button type="button" className="og-btn og-btn--primary" onClick={onPlay} data-og-play="">
              <span>{en.play}</span>
              <small lang="te">{te.play}</small>
            </button>
          )}
          <Link className="og-btn og-btn--ghost" to={backTo} data-og-back="">
            <span>{en.back}</span>
            <small lang="te">{te.back}</small>
          </Link>
        </div>
        {/* "Screen rotation locked? Switch it off": not true inside the Android app, where the native lock overrides the OS rotation setting */}
        {!inNativeApp() && (
          <p className="og-hint">
            <span>{en.hint}</span>
            <span lang="te">{te.hint}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Props: `policy` ('landscape' | 'portrait' | 'any'), `game` (the manifest: its name and theme dress the screen), `backTo` (the game page
 * link), `freezeFrames` (false: do not freeze the page's animation-frame loops while it is up), `win` (tests: a stub window instead of `window`),
 * `children` (the game screen).
 */
export default function OrientationGate({ policy = 'landscape', game, backTo = '/', win, freezeFrames, children }) {
  const o = useOrientationPolicy(policy, { ...(win !== undefined ? { win } : null), freezeFrames });
  const value = useMemo(() => ({ paused: o.paused, gated: o.gated, policy: o.policy }), [o.paused, o.gated, o.policy]);
  return (
    <OrientationContext.Provider value={value}>
      <div className="og-game" data-og={o.gated ? 'paused' : 'live'} inert={o.gated || undefined}>
        {children}
      </div>
      {o.gated && <TurnScreen policy={o.policy} gameName={game && game.name} theme={game && game.theme} backTo={backTo} canLock={o.canLock} onPlay={o.requestLandscape} />}
    </OrientationContext.Provider>
  );
}

/** The gate a game's manifest asks for (`orientation: 'landscape'`), or just the children when it asks for none. Used by the solo and online game pages. */
export function ManifestOrientationGate({ game, backTo = '/', children }) {
  const policy = normalizePolicy(game && game.orientation);
  if (policy === 'any') return children;
  return (
    <OrientationGate policy={policy} game={game} backTo={backTo}>
      {children}
    </OrientationGate>
  );
}

export { OrientationGate };
