// PWA install plumbing: captures `beforeinstallprompt` as early as possible (imported by main.jsx), counts
// visits, and decides when the shell's "Install GameHub" card may show. All storage is try/catch'd.
//
//   captureInstallPrompt()            call once at boot (idempotent)
//   subscribeInstall(fn) -> off       fn() when the deferred prompt arrives / is used / the app gets installed
//   promptInstall() -> 'accepted' | 'dismissed' | 'unavailable'
//   installPlatform() -> 'prompt' | 'ios' | null
//   shouldOfferInstall(state) (pure) / installState()

const VISITS_KEY = 'hub.visits.v1';
const DISMISS_KEY = 'hub.install.dismissed.v1';
const SESSION_KEY = 'hub.visit.counted';
export const MIN_VISITS = 2;
export const SNOOZE_DAYS = 21;

let deferred = null;
let installed = false;
let captured = false;
const subs = new Set();
const emit = () => subs.forEach((fn) => {
  try {
    fn();
  } catch {
    /* ignore */
  }
});

function lsGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

/** Counts one visit per browser session (tab). Returns the visit count. */
export function countVisit() {
  let n = Math.max(0, Math.floor(Number(lsGet(VISITS_KEY)) || 0));
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return n;
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* no session storage: count every boot */
  }
  n += 1;
  lsSet(VISITS_KEY, String(n));
  return n;
}

export function isStandalone() {
  try {
    if (typeof window === 'undefined') return false;
    if (window.navigator?.standalone) return true;
    return typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/** iPhone / iPad Safari (no beforeinstallprompt there; installing is Share -> Add to Home Screen). */
export function isIosSafari(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0) {
  const s = String(ua || '');
  const ios = /iphone|ipad|ipod/i.test(s) || (/macintosh/i.test(s) && Number(touchPoints) > 1);
  return ios && /safari/i.test(s) && !/crios|fxios|edgios|opios|gsa\//i.test(s);
}

/** Pure gate: may the install card show? */
export function shouldOfferInstall({ visits = 0, dismissedAt = null, now = Date.now(), standalone = false, platform = null } = {}) {
  if (standalone || !platform) return false;
  if (visits < MIN_VISITS) return false;
  const d = Number(dismissedAt);
  if (Number.isFinite(d) && d > 0 && now - d < SNOOZE_DAYS * 86400000) return false;
  return true;
}

export function installPlatform() {
  if (installed || isStandalone()) return null;
  if (deferred) return 'prompt';
  if (isIosSafari()) return 'ios';
  return null;
}

export function installState() {
  return {
    visits: Math.max(0, Math.floor(Number(lsGet(VISITS_KEY)) || 0)),
    dismissedAt: Number(lsGet(DISMISS_KEY)) || null,
    standalone: isStandalone(),
    platform: installPlatform(),
  };
}

export function dismissInstall(now = Date.now()) {
  lsSet(DISMISS_KEY, String(now));
  emit();
}

export function captureInstallPrompt() {
  if (captured || typeof window === 'undefined') return;
  captured = true;
  countVisit();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own card
    deferred = e;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export async function promptInstall() {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null;
  try {
    await e.prompt();
    const choice = await e.userChoice;
    const outcome = choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    if (outcome === 'accepted') installed = true;
    emit();
    return outcome;
  } catch {
    emit();
    return 'unavailable';
  }
}

export function subscribeInstall(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
