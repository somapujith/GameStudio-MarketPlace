import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AVATAR_PRESETS, Avatar } from '@/components/art/index.js';
import { HubLogo } from '@/components/art/hub/index.js';
import { errorMessage } from '@/lib/api.js';
import { GoogleButton, useAuth } from '@/lib/auth.jsx';
import { loadProfile } from '@/lib/storage.js';
import BRAND from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { safeNext } from '@/components/shell/nav/safeNext.js';
import '@/styles/online.css';
import '@/styles/cine.css';
import '@/styles/cine/bridge.css';
import '@/styles/cine/account.css';

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
    <span className={`cj-acc-mark ${on ? 'is-yes' : 'is-no'}`} aria-hidden="true">
      <HubIcon name={on ? 'check' : 'close'} size={13} strokeWidth={3} />
    </span>
  );
}

function CompareTable() {
  return (
    <table className="cj-acc-compare">
      <caption className="cj-acc-sr">Guest or Google account</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="cj-acc-sr">What you get</span>
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
                  <span className="cj-acc-compare__note">{r[k]}</span>
                ) : (
                  <>
                    <Mark on={r[k]} />
                    <span className="cj-acc-sr">{r[k] ? 'Yes' : 'No'}</span>
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
    <p className="cj-acc-legal">
      By continuing you agree to the <Link to={paths.terms()}>Terms</Link> and the <Link to={paths.privacy()}>Privacy Policy</Link>.
    </p>
  );
}

function CardSkeleton() {
  return (
    <div className="cj-acc-form cj-acc-form--skel" role="status" aria-busy="true" aria-live="polite">
      <span className="cj-acc-sr">Checking your session...</span>
      <span className="ho-skel cj-acc-skel cj-acc-skel--h" />
      <span className="ho-skel cj-acc-skel cj-acc-skel--btn" />
      <span className="ho-skel cj-acc-skel cj-acc-skel--line" />
      <span className="ho-skel cj-acc-skel cj-acc-skel--input" />
      <span className="ho-skel cj-acc-skel cj-acc-skel--btn" />
    </div>
  );
}

/** /login: one calm glass card over the ambient field (like a cinejoy modal): a welcome side with the reasons, and the form. */
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
      <div className="cj-acc-form cj-acc-offline" role="alert">
        <span className="cj-acc-offline__icon" aria-hidden="true">
          <HubIcon name="wifiOff" size={24} />
        </span>
        <h2 id="sa-login-title" className="cj-acc-form__title">
          Can&rsquo;t reach {BRAND.name} right now
        </h2>
        <p className="cj-acc-muted">Signing in and rooms need a connection. Check your network and try again; nothing you have done is lost.</p>
        <button type="button" className="cj-btn cj-btn--primary cj-btn--block" onClick={retry} disabled={retrying}>
          <HubIcon name="refresh" size={18} className={retrying ? 'hub-spin' : undefined} /> {retrying ? 'Trying...' : 'Try again'}
        </button>
      </div>
    );
  } else {
    card = (
      <div className="cj-acc-form">
        <header className="cj-acc-form__head">
          <h2 id="sa-login-title" className="cj-acc-form__title">
            {isGuestUser ? 'Upgrade to a full account' : 'Sign in or just jump in'}
          </h2>
          <p className="cj-acc-muted">
            {isGuestUser
              ? `You are playing as ${user.name} (guest). Sign in with Google to add friends, join the leaderboard and keep your progress.`
              : toGame
                ? 'Sign in to continue. You will land right back where you were.'
                : 'A Google account keeps everything. A guest only needs a name.'}
          </p>
        </header>

        <div className="cj-acc-google" aria-busy={signingIn ? 'true' : undefined}>
          <GoogleButton />
          {signingIn && (
            <p className="cj-acc-muted cj-acc-google__busy" role="status">
              Signing you in...
            </p>
          )}
          {authError && (
            <p className="ho-inline-error cj-acc-error" role="alert">
              {authError}
            </p>
          )}
        </div>

        {isGuestUser ? (
          <div className="cj-acc-actions">
            <button type="button" className="cj-btn cj-btn--block" onClick={() => navigate(next, { replace: true })}>
              Keep playing as guest
            </button>
            <button type="button" className="cj-btn cj-btn--block cj-acc-quiet" onClick={logout}>
              Sign out
            </button>
          </div>
        ) : (
          <>
            <div className="cj-acc-or" role="separator">
              <span>or</span>
            </div>

            <form className="cj-acc-guest" onSubmit={submitGuest} noValidate>
              <h3 className="cj-acc-guest__title">Continue as guest</h3>
              <fieldset className="cj-acc-avatars" aria-describedby="sa-avatar-hint">
                <legend className="cj-acc-label">Pick your character</legend>
                <p id="sa-avatar-hint" className="cj-acc-hint cj-acc-hint--top">
                  Choose your character &mdash; you can change it later
                </p>
                <div className="cj-acc-avatars__grid">
                  {AVATAR_PRESETS.map((p) => (
                    <label key={p.id} className={`cj-acc-avatar${avatar === p.id ? ' is-on' : ''}`} title={p.label}>
                      <input type="radio" name="avatar" value={p.id} checked={avatar === p.id} onChange={() => setAvatar(p.id)} className="cj-acc-sr" />
                      <Avatar preset={p.id} size={44} />
                      <span className="cj-acc-sr">{p.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="cj-acc-field">
                <label className="cj-acc-label" htmlFor="sa-guest-name">
                  Your name
                </label>
                <input
                  id="sa-guest-name"
                  className="cj-input cj-acc-input"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
                  maxLength={NAME_MAX}
                  placeholder="e.g. Biryani Bhai"
                  autoComplete="nickname"
                  enterKeyHint="go"
                  aria-describedby="sa-guest-hint"
                />
                <p id="sa-guest-hint" className="cj-acc-hint">
                  Friends see this at the table. Leave it empty and you are &ldquo;Guest&rdquo;.
                </p>
              </div>

              {error && (
                <p className="ho-inline-error cj-acc-error" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="cj-btn cj-btn--lg cj-btn--block cj-acc-guest__go" disabled={busy}>
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

        <details className="cj-acc-why" open={isGuestUser}>
          <summary>
            What does a guest miss out on?
            <HubIcon name="chevDown" size={18} className="cj-acc-why__chev" />
          </summary>
          <CompareTable />
        </details>

        <Legal />
      </div>
    );
  }

  return (
    <div className="cj-scope cj-acc cj-acc--login" aria-labelledby="sa-login-h1">
      <div className="cj-ambient cj-amb-art cj-acc-ambient cj-acc-ambient--login" aria-hidden="true" />
      <div className="cj-acc-stage">
        <div className="cj-acc-card cj-acc-card--login">
          <section className="cj-acc-welcome" aria-label={`Welcome to ${BRAND.name}`}>
            <div className="cj-acc-welcome__brand">
              <span className="cj-acc-welcome__logo">
                <HubLogo size={56} />
              </span>
              <Link to={paths.hub()} className="cj-acc-welcome__back">
                Browse games first <HubIcon name="arrowR" size={15} />
              </Link>
            </div>
            <p className="cj-acc-eyebrow">{isGuestUser ? 'Level up' : `Welcome to ${BRAND.name}`}</p>
            <h1 id="sa-login-h1" className="cj-acc-welcome__title">
              {isGuestUser ? 'Make your progress permanent.' : 'Your seat at the table is waiting.'}
            </h1>
            <p className="cj-acc-welcome__lede">{BRAND.tagline} Pick a game, send the code, and play in seconds.</p>
            <ul className="cj-checks cj-acc-benefits">
              {BENEFITS.map((b) => (
                <li key={b.title}>
                  <span className="cj-checks__icon" aria-hidden="true">
                    <HubIcon name={b.icon} size={15} />
                  </span>
                  <span className="cj-acc-benefit">
                    <b>{b.title}</b>
                    <small>{b.text}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="cj-acc-formwrap" aria-labelledby="sa-login-title" aria-live="polite">
            {card}
          </section>
        </div>
      </div>
    </div>
  );
}
