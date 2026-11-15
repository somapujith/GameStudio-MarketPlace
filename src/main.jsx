import './styles/tokens.css';
import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { captureInstallPrompt, tagPlatform } from './components/shell/install.js';
import { bootTheme } from './components/shell/theme.js';
import { installViewportSync } from './lib/viewport.js';

// Theme before the first render (no dark -> light flash for light-theme players).
bootTheme();

// <html data-ios / data-standalone> for CSS (status-bar strip, pull-to-refresh), and the on-screen keyboard
// variables (--kb-inset / --vvh / data-kb) that lift sheets above the keyboard.
tagPlatform();
installViewportSync();

// Capture `beforeinstallprompt` before React mounts (it can fire early) and count this visit.
captureInstallPrompt();

// A deploy replaces the hashed chunks: a tab (or an iOS home-screen app that stayed in memory for days) that still runs
// the old index then fails to load a lazy route. Reload once to pick up the new version; the guard stops a loop.
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('hub.chunk.reloaded')) return;
    sessionStorage.setItem('hub.chunk.reloaded', '1');
  } catch {
    return;
  }
  e.preventDefault();
  window.location.reload();
});
setTimeout(() => {
  try {
    sessionStorage.removeItem('hub.chunk.reloaded');
  } catch {
    /* ignore */
  }
}, 20000);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker (push notifications) once the page has loaded; loaded lazily so it never delays first paint.
function registerSw() {
  import('./lib/push.js')
    .then((m) => (typeof m.registerServiceWorker === 'function' ? m.registerServiceWorker() : null))
    .catch(() => {
      /* no service worker: the app still works online */
    });
}
if (typeof window !== 'undefined') {
  const later = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(registerSw, { timeout: 4000 }) : setTimeout(registerSw, 1500));
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}
