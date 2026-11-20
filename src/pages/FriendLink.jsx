import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage, getFriendByCode } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { parseFriendLink } from '@/components/online/codes.js';
import { FriendAvatar, FriendTitle } from '@/components/online/InviteFriends.jsx';
import InviteToGameSheet from '@/components/online/InviteToGameSheet.jsx';
import { useToasts } from '@/components/online/Toasts.jsx';
import SIcon from '@/platform/social/SIcon.jsx';
import StateCard from '@/platform/social/StateCard.jsx';
import '@/styles/online.css';
import '@/styles/x-social.css';
import '@/styles/store-social.css';

const REL_LABEL = { friends: 'Friends', outgoing: 'Request sent', incoming: 'Wants to be friends', me: 'You' };

function Page({ children }) {
  return <div className="hub-page sc-page st-scope sc-linkpage">{children}</div>;
}

/** Placeholder card shaped like the real one, so the page does not jump when the lookup lands. */
function CardSkeleton({ text }) {
  return (
    <Page>
      <section className="sc-link sc-link--skel" aria-busy="true">
        <span className="st-skel sc-link__skelava" aria-hidden="true" />
        <span className="st-skel sc-link__skelline" aria-hidden="true" />
        <span className="st-skel sc-link__skelline sc-link__skelline--s" aria-hidden="true" />
        <p className="sc-link__body" role="status">
          {text}
        </p>
      </section>
    </Page>
  );
}

/** A gate (signed out / guest): the card says why and sends the visitor to sign in, then back here. */
function Gate({ code, title, body, cta, to }) {
  return (
    <Page>
      <section className="sc-link sc-link--gate st-reveal" aria-labelledby="sc-link-h">
        <span className="sc-link__lamp" aria-hidden="true" />
        <span className="sc-link__gateicon" aria-hidden="true">
          <SIcon name="userPlus" size={30} />
        </span>
        <span className="st-eyebrow">Friend link</span>
        <h1 id="sc-link-h" className="sc-link__title">
          {title}
        </h1>
        <p className="sc-link__who">
          <span className="sc-ticket">{code}</span>
        </p>
        <p className="sc-link__body">{body}</p>
        <div className="sc-link__actions">
          <Link to={to} className="hub-btn hub-btn--primary hub-btn--lg">
            {cta}
          </Link>
          <Link to={paths.hub()} className="hub-btn hub-btn--ghost hub-btn--lg">
            Home
          </Link>
        </div>
      </section>
    </Page>
  );
}

/**
 * /f/:code (a friend link): "Add <name>?" with Add / Cancel, or the current relation when there is nothing to add
 * (already friends, request pending, it is you). Signed-out visitors and guests are asked to sign in first and come back.
 */
export default function FriendLink() {
  const { code: raw } = useParams();
  const code = parseFriendLink(raw || '');
  const { user, loading } = useAuth();

  if (!code) {
    return (
      <Page>
        <StateCard
          icon="question"
          tone="bad"
          title="That friend link does not look right"
          actions={[
            { label: 'Open Friends', to: paths.friends(), primary: true },
            { label: 'Home', to: paths.hub() },
          ]}
        >
          Friend codes look like HYD-7K2Q. Ask your friend to send their link again, or type their code on the Friends page.
        </StateCard>
      </Page>
    );
  }
  if (loading) {
    return <CardSkeleton text="Opening the friend link..." />;
  }
  const here = paths.friendLink(code);
  if (!user) {
    return (
      <Gate
        code={code}
        title="Sign in to add this friend"
        body="Someone shared their friend link with you. Sign in (it takes a few seconds) and you will land right back here."
        cta="Sign in"
        to={paths.login(here)}
      />
    );
  }
  if (user.isGuest) {
    return (
      <Gate
        code={code}
        title="Friends are for Google accounts"
        body="Guests can host and join rooms with a code or link. Sign in with Google to add friends, then open this link again."
        cta="Sign in with Google"
        to={paths.login(here)}
      />
    );
  }
  // the canonical spelling of the link (`/f/hyd7k2q` -> `/f/HYD-7K2Q`)
  if (raw !== code) return <Navigate to={here} replace />;
  return <FriendCard code={code} me={user} />;
}

function FriendCard({ code, me }) {
  const navigate = useNavigate();
  const { push, node } = useToasts();
  const [state, setState] = useState({ phase: 'loading', person: null, message: '', offline: false }); // loading | ready | notfound | error
  const [relation, setRelation] = useState('none');
  const [busy, setBusy] = useState('');
  const [sheet, setSheet] = useState(false);
  const [done, setDone] = useState(''); // 'sent' | 'accepted' once you acted here: the card celebrates it

  const load = useCallback(async () => {
    setState({ phase: 'loading', person: null, message: '', offline: false });
    try {
      const res = await getFriendByCode(code);
      const person = res && res.user;
      if (!person || person.id == null) throw Object.assign(new Error('No player with that code.'), { status: 404 });
      setRelation(person.relation || 'none');
      setState({ phase: 'ready', person, message: '', offline: false });
    } catch (e) {
      if (e && (e.status === 404 || e.status === 400)) setState({ phase: 'notfound', person: null, message: '', offline: false });
      else setState({ phase: 'error', person: null, message: errorMessage(e, 'Could not open this friend link'), offline: !!e && e.status === 0 });
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  const { phase, person } = state;
  const isMe = phase === 'ready' && (String(person.id) === String(me.id) || code === me.friendCode);

  const act = async (name, request, success, failure, outcome) => {
    if (busy) return;
    setBusy(name);
    try {
      await request();
      if (success) push(success, 'good');
      if (outcome) setDone(outcome);
      // the server decides the resulting relation (a request to someone who already asked you becomes a friendship)
      try {
        const res = await getFriendByCode(code);
        if (res && res.user && res.user.relation) setRelation(res.user.relation);
      } catch {
        /* keep the optimistic relation */
      }
    } catch (e) {
      push(errorMessage(e, failure), 'bad');
    } finally {
      setBusy('');
    }
  };

  const add = () => act('add', () => api.post('/api/friends/request', { friendCode: code }), `Friend request sent to ${person.name}`, 'Could not send the request', 'sent');
  const accept = () => act('accept', () => api.post('/api/friends/accept', { userId: person.id }), `You and ${person.name} are friends now`, 'Could not accept the request', 'accepted');
  const decline = async () => {
    await act('decline', () => api.post('/api/friends/decline', { userId: person.id }), null, 'Could not decline the request');
    navigate(paths.friends(), { replace: true });
  };
  const cancelRequest = () => act('cancel', () => api.del(`/api/friends/${encodeURIComponent(person.id)}`), 'Request cancelled', 'Could not cancel the request');

  if (phase === 'loading') {
    return <CardSkeleton text="Looking up this friend..." />;
  }
  if (phase === 'notfound') {
    return (
      <Page>
        <StateCard
          icon="question"
          tone="bad"
          title="No player with that code"
          actions={[
            { label: 'Open Friends', to: paths.friends(), primary: true },
            { label: 'Home', to: paths.hub() },
          ]}
        >
          We could not find {code}. The link may have a typo or be out of date. Check it with your friend and try again.
        </StateCard>
      </Page>
    );
  }
  if (phase === 'error') {
    return (
      <Page>
        <StateCard
          icon={state.offline ? 'wifiOff' : 'refresh'}
          tone={state.offline ? 'warn' : 'bad'}
          title={state.offline ? 'You are offline' : 'Could not open this link'}
          actions={[
            { label: 'Try again', icon: 'refresh', onClick: load, primary: true },
            { label: 'Home', to: paths.hub() },
          ]}
        >
          {state.message}
        </StateCard>
      </Page>
    );
  }

  const relKey = isMe ? 'me' : relation;
  const success = !isMe && ((relation === 'outgoing' && done === 'sent') || (relation === 'friends' && done === 'accepted'));
  let title;
  let body;
  let actions;
  if (isMe) {
    title = 'This is your own friend link';
    body = 'Send it to a friend so they can add you. They tap it, press Add, and you are connected.';
    actions = (
      <>
        <Link to={paths.friends()} className="hub-btn hub-btn--primary hub-btn--lg">
          Share from Friends
        </Link>
        <Link to={paths.hub()} className="hub-btn hub-btn--ghost hub-btn--lg">
          Home
        </Link>
      </>
    );
  } else if (relation === 'friends') {
    title = `You and ${person.name} are friends`;
    body = success ? 'Done. Invite them to a game now: if they are offline, the invite waits for them.' : 'Already connected. Invite them to a game any time: if they are offline, the invite waits for them.';
    actions = (
      <>
        <button type="button" className="hub-btn hub-btn--primary hub-btn--lg" onClick={() => setSheet(true)}>
          <SIcon name="table" size={18} /> Invite to game
        </button>
        <Link to={paths.friends()} className="hub-btn hub-btn--ghost hub-btn--lg">
          Open Friends
        </Link>
      </>
    );
  } else if (relation === 'outgoing') {
    title = 'Request sent';
    body = `Waiting for ${person.name} to accept. You will get a note when they do.`;
    actions = (
      <>
        <Link to={paths.friends()} className="hub-btn hub-btn--primary hub-btn--lg">
          Open Friends
        </Link>
        <button type="button" className="hub-btn hub-btn--ghost hub-btn--lg" onClick={cancelRequest} disabled={!!busy}>
          {busy === 'cancel' ? 'Cancelling...' : 'Cancel request'}
        </button>
      </>
    );
  } else if (relation === 'incoming') {
    title = `${person.name} wants to be friends`;
    body = 'They already sent you a request. Accept it to become friends.';
    actions = (
      <>
        <button type="button" className="hub-btn hub-btn--primary hub-btn--lg" onClick={accept} disabled={!!busy}>
          {busy === 'accept' ? 'Accepting...' : 'Accept'}
        </button>
        <button type="button" className="hub-btn hub-btn--ghost hub-btn--lg" onClick={decline} disabled={!!busy}>
          Decline
        </button>
      </>
    );
  } else {
    title = `Add ${person.name}?`;
    body = 'You will be able to see when they are online and invite each other to games.';
    actions = (
      <>
        <button type="button" className="hub-btn hub-btn--primary hub-btn--lg" onClick={add} disabled={!!busy}>
          <SIcon name="userPlus" size={18} /> {busy === 'add' ? 'Sending...' : 'Add friend'}
        </button>
        <button type="button" className="hub-btn hub-btn--ghost hub-btn--lg" onClick={() => navigate(paths.hub())} disabled={!!busy}>
          Cancel
        </button>
      </>
    );
  }

  return (
    <Page>
      <section className={`sc-link sc-link--${relKey}${success ? ' is-success' : ''} st-reveal`} aria-labelledby="ho-fl-title">
        <span className="sc-link__lamp" aria-hidden="true" />
        <div className="sc-link__ring">
          <FriendAvatar person={person} size={104} />
          {success && (
            <span className="sc-link__check" aria-hidden="true">
              <SIcon name="check" size={22} strokeWidth={3} />
            </span>
          )}
        </div>
        <span className="st-eyebrow">Friend link</span>
        {REL_LABEL[relKey] && <span className={`sc-relchip sc-relchip--${relKey}`}>{REL_LABEL[relKey]}</span>}
        <h1 id="ho-fl-title" className="sc-link__title">
          {title}
        </h1>
        <p className="sc-link__who">
          <strong>{person.name}</strong>
          {Number.isFinite(person.level) && <span className="st-chip">Level {person.level}</span>}
          <span className="sc-ticket">{person.friendCode || code}</span>
        </p>
        <FriendTitle person={person} />
        <p className="sc-link__body" aria-live="polite">
          {body}
        </p>
        <div className="sc-link__actions">{actions}</div>
      </section>
      {sheet && <InviteToGameSheet friend={{ id: person.id, name: person.name }} onClose={() => setSheet(false)} />}
      {node}
    </Page>
  );
}
