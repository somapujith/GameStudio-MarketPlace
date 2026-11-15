import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AVATAR_PRESETS, Avatar } from '@/components/art/index.js';
import { HubMark } from '@/components/art/hub/index.js';
import AutoMascot from '@/components/art/AutoMascot.jsx';
import { errorMessage } from '@/lib/api.js';
import { GoogleButton, useAuth } from '@/lib/auth.jsx';
import { loadProfile } from '@/lib/storage.js';
import BRAND from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { safeNext } from '@/components/shell/nav/safeNext.js';
import '@/styles/online.css';
import '@/styles/x-social.css';
import '@/styles/hubMoments.css';
import '@/styles/store-account.css';

const NAME_MAX = 24;

/** The three real reasons to be here, in the order a new visitor cares about them. */
const BENEFITS = [
  { icon: 'users', title: 'Play with friends by code', text: 'Open a table, share the room code or link, and your friends are in. No setup.' },
  { icon: 'bolt', title: 'No install, no waiting', text: 'It runs in your browser on any phone, tablet or laptop. Add it to your home screen if you like.' },
  { icon: 'star', title: 'Your stats and coins follow you', text: 'Level, coins, badges and match history are saved to your account, on every device.' },
];

/** What a guest gets compared with a Google account. `guest` / `member` are true (included) or false (not). */
const COMPARE = [
  { label: 'Host and join tables, play online', guest: true, member: true },
  { label: 'Level, coins and the shop', guest: 'this browser', member: 'every device' },
  { label: 'Add friends and get invites', guest: false, member: true },
  { label: 'Appear on the leaderboard', guest: false, member: true },
  { label: 'Keep your progress if you clear cookies', guest: false, member: true },
];

function readProfile() {
  try {
    return loadProfile() || {};
  } catch {
    return {};
  }
}

function Mark({ on }) {
  return (
    <span className={`sa-mark ${on ? 'is-yes' : 'is-no'}`} aria-hidden="true">
      <HubIcon name={on ? 'check' : 'close'} size={14} strokeWidth={3} />
    </span>
  );
}

function CompareTable() {
  return (
    <table className="sa-compare">
      <caption className="sa-compare__cap">Guest or Google account</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="hub-sr">What you get</span>
          </th>
          <th scope="col">Guest</th>
          <th scope="col" className="is-member">
            Google
          </th>
        </tr>
      </thead>
      <tbody>
        {COMPARE.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            {['guest', 'member'].map((k) => (
              <td key={k} className={k === 'member' ? 'is-member' : ''}>
                {typeof r[k] === 'string' ? (
                  <span className="sa-compare__note">{r[k]}</span>
                ) : (
                  <>
                    <Mark on={r[k]} />
                    <span className="hub-sr">{r[k] ? 'Yes' : 'No'}</span>
                  </>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Legal() {
  return (
    <p className="sa-legal">
      By continuing you agree to the{' '}
      <Link to={paths.terms()} className="st-link">
        Terms
      </Link>{' '}
      and the{' '}
      <Link to={paths.privacy()} className="st-link">
        Privacy Policy
      </Link>
      .
    </p>
  );
}

function CardSkeleton() {
  return (
    <div className="sa-card sa-card--skel" role="status" aria-busy="true" aria-live="polite">
      <span className="hub-sr">Checking your session...</span>
      <span className="st-skel sa-skel sa-skel--h" />
      <span className="st-skel sa-skel sa-skel--btn" />
      <span className="st-skel sa-skel sa-skel--line" />
      <span className="st-skel sa-skel sa-skel--input" />
      <span className="st-skel sa-skel sa-skel--btn" />
    </div>
  );
}

export default function Login() {
  const { user, loading, configured, reachable, authError, clearAuthError, loginWithGoogle, loginGuest, logout, reloadConfig, refresh, signingIn } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'), paths.hub());
  const navigate = useNavigate();
  const profile = useMemo(readProfile, []);
  const [name, setName] = useState(profile.name && profile.name !== 'Guest' ? String(profile.name).slice(0, NAME_MAX) : '');
  const [avatar, setAvatar] = useState(Number.isInteger(profile.avatar) ? profile.avatar : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const prompted = useRef(false);

  // Google One Tap, once per visit, only when it can actually succeed
  useEffect(() => {
    if (loading || !configured || prompted.current) return;
    if (user && !user.isGuest) return;
    prompted.current = true;
    loginWithGoogle(undefined, { silent: true });
  }, [loading, configured, user, loginWithGoogle]);

  // Signed in with Google (or just became a guest here): go where the user was headed.
  // A guest who opened this page on purpose (to upgrade) stays and sees the Google option.
  if (!loading && user && (!user.isGuest || justLoggedIn)) return <Navigate to={next} replace />;

  const retry = async () => {
    setRetrying(true);
    try {
      await Promise.all([reloadConfig(), refresh()]);
    } finally {
      setRetrying(false);
    }
  };

  const submitGuest = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    clearAuthError();
    try {
      await loginGuest(name, avatar);
      setJustLoggedIn(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not start a guest session'));
    } finally {
      setBusy(false);
    }
  };

  const isGuestUser = !!(user && user.isGuest);
  const toGame = next !== paths.hub();

  let card;
  if (loading) {
    card = <CardSkeleton />;
  } else if (!reachable) {
    card = (
      <div className="sa-card sa-offline" role="alert">
        <span className="sa-offline__icon" aria-hidden="true">
          <HubIcon name="wifiOff" size={26} />
        </span>
        <h2 id="sa-login-title" className="sa-card__title">
          Can&rsquo;t reach {BRAND.name} right now
        </h2>
        <p className="sa-muted">Signing in and rooms need a connection. Check your network and try again; nothing you have done is lost.</p>
        <button type="button" className="hub-btn hub-btn--primary" onClick={retry} disabled={retrying}>
          <HubIcon name="refresh" size={18} className={retrying ? 'hub-spin' : undefined} /> {retrying ? 'Trying...' : 'Try again'}
        </button>
      </div>
    );
  } else {
    card = (
      <div className="sa-card">
        <header className="sa-card__head">
          <h2 id="sa-login-title" className="sa-card__title">
            {isGuestUser ? 'Upgrade to a full account' : 'Sign in or just jump in'}
          </h2>
          <p className="sa-muted">
            {isGuestUser
              ? `You are playing as ${user.name} (guest). Sign in with Google to add friends, join the leaderboard and keep your progress.`
              : toGame
                ? 'Sign in to continue. You will land right back where you were.'
                : 'A Google account keeps everything. A guest only needs a name.'}
          </p>
        </header>

        <div className="sa-google" aria-busy={signingIn ? 'true' : undefined}>
          <GoogleButton />
          {signingIn && (
            <p className="sa-muted sa-google__busy" role="status">
              Signing you in...
            </p>
          )}
          {authError && (
            <p className="ho-inline-error" role="alert">
              {authError}
            </p>
          )}
        </div>

        {isGuestUser ? (
          <div className="sa-actions">
            <button type="button" className="hub-btn hub-btn--soft" onClick={() => navigate(next, { replace: true })}>
              Keep playing as guest
            </button>
            <button type="button" className="hub-btn hub-btn--ghost" onClick={logout}>
              Sign out
            </button>
          </div>
        ) : (
          <>
            <div className="ho-or" role="separator">
              <span>or</span>
            </div>

            <form className="sa-guest" onSubmit={submitGuest} noValidate>
              <h3 className="sa-guest__title">Continue as guest</h3>
              <div>
                <label className="ho-field__label" htmlFor="sa-guest-name">
                  Your name
                </label>
                <input
                  id="sa-guest-name"
                  className="ho-input"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
                  maxLength={NAME_MAX}
                  placeholder="e.g. Biryani Bhai"
                  autoComplete="nickname"
                  enterKeyHint="go"
                  aria-describedby="sa-guest-hint"
                />
                <p id="sa-guest-hint" className="sa-hint">
                  Friends see this at the table. Leave it empty and you are &ldquo;Guest&rdquo;.
                </p>
              </div>

              <fieldset className="ho-avatars">
                <legend className="ho-field__label">Pick your character</legend>
                <div className="ho-avatars__grid">
                  {AVATAR_PRESETS.map((p) => (
                    <label key={p.id} className={`ho-avatar-opt${avatar === p.id ? ' is-on' : ''}`} title={p.label}>
                      <input type="radio" name="avatar" value={p.id} checked={avatar === p.id} onChange={() => setAvatar(p.id)} className="ho-sr" />
                      <Avatar preset={p.id} size={48} />
                      <span className="ho-sr">{p.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {error && (
                <p className="ho-inline-error" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="hub-btn hub-btn--soft hub-btn--lg hub-btn--block" disabled={busy}>
                {busy ? (
                  <>
                    <HubIcon name="refresh" size={18} className="hub-spin" /> Starting...
                  </>
                ) : (
                  'Continue as guest'
                )}
              </button>
            </form>
          </>
        )}

        <details className="sa-why" open={isGuestUser}>
          <summary>What does a guest miss out on?</summary>
          <CompareTable />
        </details>

        <Legal />
      </div>
    );
  }

  return (
    <div className="hub-page st-scope sa-login" aria-labelledby="sa-login-h1">
      <div className="sa-login__grid">
        <section className="sa-welcome st-reveal" aria-label={`Welcome to ${BRAND.name}`}>
          <div className="sa-welcome__brand">
            <span className="sa-welcome__logo">
              <HubMark size={44} />
              <b>{BRAND.name}</b>
            </span>
            <Link to={paths.hub()} className="sa-welcome__back st-link">
              Browse games first
            </Link>
          </div>
          <p className="st-eyebrow">{isGuestUser ? 'Level up' : `Welcome to ${BRAND.name}`}</p>
          <h1 id="sa-login-h1" className="sa-welcome__title">
            {isGuestUser ? 'Make your progress permanent.' : 'Your seat at the table is waiting.'}
          </h1>
          <p className="sa-welcome__lede">{BRAND.tagline} Pick a game, send the code, and play in seconds.</p>
          <ul className="sa-benefits">
            {BENEFITS.map((b, i) => (
              <li key={b.title} className="sa-benefit st-reveal" style={{ '--i': i + 1 }}>
                <span className="sa-benefit__icon" aria-hidden="true">
                  <HubIcon name={b.icon} size={20} />
                </span>
                <span>
                  <b>{b.title}</b>
                  <small>{b.text}</small>
                </span>
              </li>
            ))}
          </ul>
          <div className="sa-welcome__mascot hub-moment-welcome" aria-hidden="true">
            <AutoMascot mood="welcome" size={132} />
          </div>
        </section>

        <section className="sa-login__card st-reveal" style={{ '--i': 2 }} aria-labelledby="sa-login-title" aria-live="polite">
          {card}
        </section>
      </div>
    </div>
  );
}
