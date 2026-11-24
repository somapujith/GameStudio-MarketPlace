import { useState } from 'react';
import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Modal from '@/components/shell/Modal.jsx';
import { Icon } from '@/components/shell/icons.jsx';
import { useToast } from '@/components/shell/Toast.jsx';
import { useAccount } from '@/components/shell/hooks.js';
import { useProfile } from '@/components/shell/stores.js';
import Ava from './Ava.jsx';

/** Profile > Account: who is signed in, sign out (with a confirm), friend code, or a sign-in prompt. */
export default function AccountSection() {
  const toast = useToast();
  const [profile] = useProfile();
  const { user, signedIn, guest, auth } = useAccount();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await auth.logout?.();
      setConfirm(false);
      toast('Signed out.', { tone: 'info' });
    } catch {
      toast('Could not sign out. Try again.', { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Friend code copied', { tone: 'good' });
    } catch {
      toast(text, { tone: 'info' });
    }
  };

  return (
    <section id="account" className="cj-pro-panel cj-pro-account" aria-labelledby="hh2-acct-h">
      <h2 id="hh2-acct-h" className="cj-pro-panel__title">
        <HubIcon name="user" size={18} /> Account
      </h2>
      {signedIn ? (
        <>
          <div className="cj-pro-account__row">
            <Ava preset={user?.avatar ?? profile.avatar} size={52} dot={guest ? undefined : 'on'} />
            <div className="cj-pro-account__text">
              <b>{user?.name || profile.name}</b>
              <small>{guest ? 'Guest account: rooms and play only' : 'Signed in with Google'}</small>
            </div>
            <button type="button" className="cj-btn cj-btn--sm" onClick={() => setConfirm(true)}>
              <Icon name="logout" size={16} /> Sign out
            </button>
            {user?.friendCode && !guest && (
              <button type="button" className="cj-pro-codechip" onClick={() => copy(user.friendCode)} aria-label={`Copy friend code ${user.friendCode}`}>
                <span>Friend code</span>
                <b>{user.friendCode}</b>
                <Icon name="copy" size={16} />
              </button>
            )}
          </div>
          {guest && (
            <p className="cj-pro-muted">
              Guests cannot add friends, get invites or appear on the leaderboard, and lose their progress if browser data is cleared.{' '}
              <Link to={paths.login(paths.profile())} className="cj-pro-link">
                Sign in with Google
              </Link>
            </p>
          )}
        </>
      ) : (
        <div className="cj-pro-account__row">
          <p className="cj-pro-muted cj-pro-account__text">You are not signed in yet. Sign in to save your progress, add friends and get invites.</p>
          <Link to={paths.login(paths.profile())} className="cj-btn cj-btn--primary">
            <Icon name="login" size={18} /> Sign in
          </Link>
        </div>
      )}

      <Modal
        open={confirm}
        onClose={() => (busy ? undefined : setConfirm(false))}
        dismissible={!busy}
        title="Sign out?"
        actions={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirm(false)} disabled={busy} data-autofocus>
              Stay signed in
            </button>
            <button type="button" className="btn btn--danger" onClick={logout} disabled={busy}>
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </>
        }
      >
        <p>
          {guest
            ? 'This guest account lives only in this browser. Once you sign out you cannot get back to its level, coins or cosmetics. Sign in with Google first if you want to keep them.'
            : 'Your level, coins and badges stay on your account. Sign in again any time, on any device.'}
        </p>
      </Modal>
    </section>
  );
}
