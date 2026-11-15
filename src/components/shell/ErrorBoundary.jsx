import { Component } from 'react';
import HubIcon from '@/platform/game/HubIcon.jsx';

const CHUNK_RE = /dynamically imported module|Loading chunk|Importing a module script failed|error loading dynamically|Failed to fetch dynamically/i;
const RELOAD_KEY = 'hub.eb.reloaded';
const RELOAD_WINDOW_MS = 60000;

/** True when `error` is a lazy-chunk load failure (a deploy replaced the hashed files, or the network dropped). */
export const isChunkError = (error) => CHUNK_RE.test(String(error?.message || error || ''));

/** Did this tab already reload for a stale version in the last minute? (then another reload will not help) */
function reloadedRecently() {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < RELOAD_WINDOW_MS;
  } catch {
    return false;
  }
}

/**
 * Catches render errors under it and shows a designed recovery screen (`silent`: render nothing instead).
 *   variant="route"   inline card inside the hub's main area (retry re-renders the screen)
 *   fullscreen        centred full-height screen (outside the shell)
 * A failed lazy chunk means a new version was deployed: the button reloads the page, once per minute at most, so a
 * server that keeps serving a broken file can never trap the tab in a reload loop (a second failure explains and
 * offers Home instead). Nothing here reloads on its own.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  reset() {
    if (isChunkError(this.state.error)) {
      try {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return null; // optional chrome (overlays): fail closed, never take the page down

    const chunk = isChunkError(error);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const again = chunk && !offline && reloadedRecently();
    let icon = 'refresh';
    let eyebrow = 'Something went wrong';
    let title = 'This screen hit a snag';
    let text = 'Something unexpected went wrong here. Your coins, friends and tables are safe. Give it another go.';
    let action = 'Try again';
    if (chunk && offline) {
      icon = 'wifiOff';
      eyebrow = 'No connection';
      title = "You're offline";
      text = "This screen could not be loaded without a connection. Reconnect, then try again.";
    } else if (again) {
      eyebrow = 'Still not loading';
      title = "We couldn't load this screen";
      text = 'Check your connection and try once more. If it keeps happening, close the tab and open GameHub again.';
    } else if (chunk) {
      icon = 'spark';
      eyebrow = 'New version';
      title = 'A fresh version is ready';
      text = 'GameHub was updated while you were away. Reload to pick up the latest version.';
      action = 'Reload now';
    }

    const full = !!this.props.fullscreen;
    return (
      <div className={`hub-err${full ? ' hub-err--full' : ''}${this.props.variant === 'route' ? ' hub-err--route' : ''}`} role="alert">
        <div className="hub-err__card">
          <span className="hub-err__icon" aria-hidden="true">
            <HubIcon name={icon} size={30} />
          </span>
          <p className="st-eyebrow hub-err__eyebrow">{eyebrow}</p>
          <h1 className="hub-err__title">{title}</h1>
          <p className="hub-err__text">{text}</p>
          <div className="hub-err__actions">
            <button type="button" className="hub-btn hub-btn--primary hub-btn--lg" onClick={this.reset}>
              <HubIcon name="refresh" size={18} /> {action}
            </button>
            <a className="hub-btn hub-btn--ghost hub-btn--lg" href="/">
              <HubIcon name="home" size={18} /> Home
            </a>
          </div>
          {import.meta.env?.DEV && <pre className="hub-err__detail">{String(error?.message || error)}</pre>}
        </div>
      </div>
    );
  }
}
