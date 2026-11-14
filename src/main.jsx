import './styles/tokens.css';
import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { captureInstallPrompt } from './components/shell/install.js';
import { bootTheme } from './components/shell/theme.js';

// Theme before the first render (no dark -> light flash for light-theme players).
bootTheme();

// Capture `beforeinstallprompt` before React mounts (it can fire early) and count this visit.
captureInstallPrompt();

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
