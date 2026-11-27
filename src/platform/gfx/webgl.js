// Can this browser make a WebGL 2 context at all? Asked BEFORE the heavy 3D chunks are imported (three.js and a game are 1-2 MB; on a weak phone
// they take 5-9 s to arrive), so a device that cannot run the game says so at once instead of after the download.
//
//   const gl2 = probeWebgl2();                   // { ok, native, reason }  (a throw-away canvas; its context is released)
//   if (!gl2.ok) return <NoWebgl {...webglFailureText(gl2)} />;
//
// Inside the Android app (Capacitor: `window.Capacitor.isNativePlatform()`) there is no "hardware acceleration" switch to point at, so the wording
// changes. Pure over injected `doc` / `win`, never throws, tested with fakes (webgl.test.js).

/** Running inside the native app shell (Capacitor)? */
export function isNativeApp(win = typeof window !== 'undefined' ? window : null) {
  try {
    return !!win?.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/**
 * @returns {{ ok: boolean, native: boolean, reason: 'no-dom' | 'no-webgl2' | 'error' | null }}
 *   `no-dom` (server render, tests) is reported as ok: it is not evidence that the browser lacks WebGL 2.
 */
export function probeWebgl2({ doc = typeof document !== 'undefined' ? document : null, win = typeof window !== 'undefined' ? window : null } = {}) {
  const native = isNativeApp(win);
  if (!doc?.createElement) return { ok: true, native, reason: 'no-dom' };
  let gl = null;
  try {
    const canvas = doc.createElement('canvas');
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, failIfMajorPerformanceCaveat: false });
  } catch {
    return { ok: false, native, reason: 'error' };
  }
  const ok = !!gl && typeof gl.getParameter === 'function';
  try {
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext(); // hand the context back: browsers allow only ~16
  } catch {
    /* already gone */
  }
  return { ok, native, reason: ok ? null : 'no-webgl2' };
}

/** What to tell the player when WebGL 2 is missing: { title, body }. `game` is the display name used in the browser wording. */
export function webglFailureText({ native = false } = {}, game = 'This game') {
  if (native) {
    return {
      title: 'This phone can’t run this game',
      body: `${game} needs WebGL 2, and this phone’s web view does not offer it. Updating Android System WebView (or Chrome) in the Play Store may fix it; otherwise try one of the other games.`,
    };
  }
  return {
    title: 'This browser can’t run the 3D city',
    body: `${game} needs WebGL 2 with hardware acceleration. Turn on hardware acceleration in your browser settings, or try an up-to-date Chrome, Edge, Firefox or Safari 16.4+.`,
  };
}
