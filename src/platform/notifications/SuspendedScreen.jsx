import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth.jsx';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { HubLogo } from '@/platform/game/hubArt.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import '@/styles/notifications.css';

/**
 * The notice itself, presentational (renders on the server): a "suspended" stamp, the headline, the moderator's
 * reason (when one was given), what still works, and Sign out / Help.
 */
export function SuspendedNotice({ reason = '', busy = false, onSignOut }) {
  return (
    <section className="nt-susp__card" aria-labelledby="nt-susp-title">
      <span className="nt-susp__stamp" aria-hidden="true">
        Suspended
      </span>
      <h1 id="nt-susp-title" className="nt-susp__title">
        Your account has been suspended
      </h1>
      <p className="nt-susp__lead">
        You can't play, join tables, chat or use your coins on {BRAND.name} while the suspension lasts.
      </p>
      {reason ? (
        <div className="nt-susp__reason">
          <span className="nt-susp__label">Reason from the moderators</span>
          <p>{reason}</p>
        </div>
      ) : (
        <div className="nt-susp__reason nt-susp__reason--none">
          <span className="nt-susp__label">Reason</span>
          <p>No reason was given.</p>
        </div>
      )}
      <p className="nt-susp__help">
        Think this is a mistake? The <Link to={paths.help()}>Help and support</Link> page explains how to reach us. Our{' '}
        <Link to={paths.terms()}>Terms of service</Link> set out the rules.
      </p>
      <div className="nt-susp__actions">
        <button type="button" className="hub-btn hub-btn--primary hub-btn--lg nt-susp__signout" onClick={onSignOut} aria-busy={busy || undefined} aria-disabled={busy || undefined}>
          <HubIcon name="arrowL" size={18} /> {busy ? 'Signing out…' : 'Sign out'}
        </button>
        <Link to={paths.help()} className="hub-btn hub-btn--soft hub-btn--lg">
          Help and support
        </Link>
      </div>
    </section>
  );
}

function useSignOut() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
      navigate(paths.hub(), { replace: true });
    }
  };
  return [busy, signOut];
}

/**
 * Full-page screen for a suspended account, in place of the whole hub chrome (navigation would only lead back here).
 * The public pages (Help, Privacy, Terms, About) stay reachable through its links: see suspendedModel.js.
 */
export default function SuspendedScreen({ reason = '' }) {
  const [busy, signOut] = useSignOut();
  return (
    <div className="hub-app nt-susp">
      <header className="nt-susp__top">
        <span className="nt-susp__logo" role="img" aria-label={BRAND.name}>
          <HubLogo size={64} compact />
        </span>
      </header>
      <main id="main" className="nt-susp__main" tabIndex={-1}>
        <SuspendedNotice reason={reason} busy={busy} onSignOut={signOut} />
      </main>
      <footer className="nt-susp__foot">
        <Link to={paths.help()}>Help</Link>
        <Link to={paths.privacy()}>Privacy</Link>
        <Link to={paths.terms()}>Terms</Link>
      </footer>
    </div>
  );
}

/** On a public page while suspended: a slim reminder strip with the way out (Sign out). */
export function SuspendedStrip() {
  const [busy, signOut] = useSignOut();
  return (
    <aside className="nt-ann nt-ann--warning nt-ann--susp" aria-label="Account suspended">
      <div className="nt-ann__inner">
        <span className="nt-ann__tag" aria-hidden="true">
          <HubIcon name="lock" size={15} strokeWidth={2.4} />
          <span className="nt-ann__word">Suspended</span>
        </span>
        <p className="nt-ann__msg">Your account is suspended. You can still read help and our policies.</p>
        <button type="button" className="nt-ann__link nt-ann__btn" onClick={signOut} aria-busy={busy || undefined}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
