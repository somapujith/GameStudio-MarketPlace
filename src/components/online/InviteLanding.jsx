import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '@/lib/api.js';
import { GoogleButton, useAuth } from '@/lib/auth.jsx';
import { loadProfile } from '@/lib/storage.js';
import RoomPreview, { previewFacts } from './RoomPreview.jsx';
import { cleanGuestName, GUEST_NAME_MAX, initialGuestName, inviteHeadline, inviteLoginTarget, readJoinDraft, readLastGuestName, rememberGuestName, writeJoinDraft } from './inviteModel.js';
import '@/styles/join-code.css';

/** Name to prefill the guest form with: what they typed before a reload, the last one they used, or a friendly default. */
function startingName(code) {
  let profileName = '';
  try {
    profileName = (loadProfile() || {}).name || '';
  } catch {
    profileName = '';
  }
  return initialGuestName({ draft: readJoinDraft().name, lastUsed: readLastGuestName() || profileName, seed: code });
}

/** The guest path: one name field, one button. Presentational (the page owns the session call), so every state renders in a test. */
export function GuestForm({ name, onName, error = '', busy = false, onSubmit, primary = false, hostName = '' }) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <form className="jc-path jc-path--guest" onSubmit={onSubmit} noValidate aria-labelledby={`${id}-h`}>
      <b id={`${id}-h`} className="jc-path__title">
        Play as a guest
      </b>
      <span className="jc-path__sub">Just a name{hostName ? `, so ${hostName} knows who is joining` : ''}. No account needed.</span>
      <label className="jc-field__label" htmlFor={`${id}-name`}>
        Your name at the table
      </label>
      <input
        id={`${id}-name`}
        className="jc-field"
        value={name}
        onChange={(e) => onName(e.target.value.slice(0, GUEST_NAME_MAX))}
        maxLength={GUEST_NAME_MAX}
        autoComplete="nickname"
        enterKeyHint="go"
        placeholder="e.g. Lucky Mango"
        disabled={busy}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
      />
      {error && (
        <span id={errId} className="jc-path__error" role="alert">
          {error}
        </span>
      )}
      <button type="submit" className={`ho-btn ${primary ? 'ho-btn--primary' : 'ho-btn--ghost'} ho-btn--block jc-path__go`} disabled={busy} aria-busy={busy || undefined}>
        {busy ? 'Taking a seat...' : 'Join as guest'}
      </button>
    </form>
  );
}

/** Placeholder shaped like the landing while the invite is checked. */
export function InviteSkeleton({ text = 'Opening your invite...' }) {
  return (
    <section className="jc-invite jc-invite--skel" aria-busy="true">
      <div className="sr-preview sr-preview--skel" aria-hidden="true">
        <div className="sr-preview__cover st-skel" />
        <div className="sr-preview__body">
          <span className="st-skel sr-skel-line sr-skel-line--s" />
          <span className="st-skel sr-skel-line sr-skel-line--l" />
          <span className="st-skel sr-skel-line sr-skel-line--m" />
        </div>
      </div>
      <p className="jc-invite__status" role="status">
        <span className="ho-spinner" aria-hidden="true" /> {text}
      </p>
    </section>
  );
}

/**
 * "You're invited": what a signed-out visitor sees after opening the host's link. The table first (game, who
 * invited you, seats), then two clear ways in: continue with Google (when it is set up) or play as a guest with
 * just a name. Choosing either signs the visitor in; the join page then takes them straight to the lobby.
 * `info` is the room lookup, or null when the lookup needs a session ("sign in or play as guest to see this table").
 */
export default function InviteLanding({ code, info, onOtherCode }) {
  const { configured, signingIn, authError, loginGuest } = useAuth();
  const [name, setName] = useState(() => startingName(code));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const hostName = (info && info.hostName) || '';
  const facts = info ? previewFacts(info) : null;

  const changeName = (v) => {
    setName(v);
    setError('');
    writeJoinDraft({ name: v });
  };
  const submit = async (e) => {
    e.preventDefault();
    if (busyRef.current) return; // a second tap or Enter while the first is in flight
    const checked = cleanGuestName(name);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await loginGuest(checked.value);
      rememberGuestName(checked.value);
      // the session arrives through useAuth: the page checks the room again and goes straight to the lobby
    } catch (err) {
      busyRef.current = false;
      setBusy(false);
      setError(errorMessage(err, 'Could not start a guest session. Check your connection and try again.'));
    }
  };

  return (
    <section className="jc-invite st-reveal" aria-labelledby="jc-invite-h">
      <h2 id="jc-invite-h" className="jc-invite__title">
        {inviteHeadline(hostName)}
        {facts ? <span className="jc-invite__game"> to play {facts.name}</span> : null}
      </h2>

      {info ? (
        <RoomPreview info={info}>
          <span className="jc-pill jc-pill--open">Open to join</span>
        </RoomPreview>
      ) : (
        <p className="jc-invite__generic">Sign in or play as a guest to see this table and take a seat.</p>
      )}

      <div className="jc-invite__paths">
        {configured && (
          <div className="jc-path jc-path--google" aria-busy={signingIn ? 'true' : undefined}>
            <b className="jc-path__title">Sign in</b>
            <span className="jc-path__sub">Keep your coins, level and friends.</span>
            <GoogleButton />
            {signingIn && (
              <span className="jc-path__sub" role="status">
                Signing you in...
              </span>
            )}
            {authError && (
              <span className="jc-path__error" role="alert">
                {authError}
              </span>
            )}
          </div>
        )}
        {configured && (
          <div className="ho-or" role="separator">
            <span>or</span>
          </div>
        )}
        <GuestForm name={name} onName={changeName} error={error} busy={busy} onSubmit={submit} primary={!configured} hostName={hostName} />
      </div>

      <p className="jc-invite__foot">
        {configured ? (
          <>
            Already have an account?{' '}
            <Link to={inviteLoginTarget(code)} className="jc-link">
              Sign in
            </Link>
            .{' '}
          </>
        ) : null}
        <button type="button" className="jc-link" onClick={onOtherCode}>
          Not your table? Use a different code
        </button>
      </p>
    </section>
  );
}
