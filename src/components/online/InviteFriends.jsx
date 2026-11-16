import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/art/index.js';
import { api, errorMessage, sendInvite } from '@/lib/api.js';
import { useUserEvents } from '@/lib/auth.jsx';
import AddFriendPanel from '@/platform/social/AddFriendPanel.jsx';
import Sheet from './Sheet.jsx';
import { applyPresence, cosmeticsOf, handleLabel, inviteEventResult, inviteFeedback, normalizeFriends, removeFriend } from './friendsModel.js';
import { JoinButton, StatusText, canJoin } from '@/platform/social/PresenceBits.jsx';
import '@/styles/online.css';
import '@/styles/x-social.css';
import '@/styles/lobby-invite.css';
import '@/styles/handle.css';

const RESEND_AFTER = 30000;

// ---------------------------------------------------------------- cosmetics (ART's components when present)

// ART ships `AvatarFrame` / `TitleChip` in components/art/cosmetics.jsx. Optional on purpose: until that file
// exists (or if it fails to load) the small fallbacks below draw the same idea, so nothing here breaks the build.
const artMods = import.meta.glob('../art/cosmetics.jsx', { eager: true });
const art = Object.values(artMods)[0] || {};

function FallbackFrame({ frame, size, children }) {
  const item = frame ? cosmeticsOf({ equipped: { frame } }).frame : null;
  if (!item) return children;
  const [a, b] = item.colors || [];
  return (
    <span className="xs-frame" style={{ '--xs-f1': a, '--xs-f2': b || a, width: size + 6, height: size + 6 }} data-frame={item.id}>
      {children}
    </span>
  );
}

function FallbackTitle({ title }) {
  const item = title ? cosmeticsOf({ equipped: { title } }).title : null;
  if (!item) return null;
  return <span className={`xs-title xs-title--${item.rarity || 'common'}`}>{item.name}</span>;
}

const Frame = typeof art.AvatarFrame === 'function' ? art.AvatarFrame : FallbackFrame;
const Title = typeof art.TitleChip === 'function' ? art.TitleChip : FallbackTitle;

/**
 * A person's avatar inside their equipped frame, with an optional online dot.
 * `person`: { avatar, equipped? } · `online`: true | false | undefined (no dot).
 */
export function FriendAvatar({ person, size = 44, online }) {
  const { frame } = cosmeticsOf(person);
  const preset = person && Number.isInteger(person.avatar) ? person.avatar : 0;
  return (
    <span className="xs-ava" style={{ '--xs-ava': `${size}px` }}>
      <Frame frame={frame ? frame.id : undefined} size={size}>
        <Avatar preset={preset} size={size} />
      </Frame>
      {online !== undefined && <span className={`xs-dot${online ? ' is-on' : ''}`} role="img" aria-label={online ? 'Online' : 'Offline'} />}
    </span>
  );
}

/** The person's equipped title chip, or nothing. */
export function FriendTitle({ person }) {
  const { title } = cosmeticsOf(person);
  return title ? <Title title={title.id} /> : null;
}


// ---------------------------------------------------------------- lobby panel

/** Show the filter box only for long lists. */
export const SEARCH_MIN = 7;

/** Pure: case-insensitive "name contains" filter. Empty query returns the list untouched. */
export function filterByName(list, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((f) => String(f.name).toLowerCase().includes(q));
}

/** Label for the invite button in each state (idle | sending | sent | saved | joined | declined | again | error). */
export const INVITE_LABEL = { idle: 'Invite', sending: 'Sending', sent: 'Invited', saved: 'Saved', joined: 'Joined', declined: 'Invite again', again: 'Invite again', error: 'Retry' };

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="lp-ibtn__check" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** One-tap invite button. The inner span is keyed by state so each change plays a short enter (transform + opacity). */
function InviteButton({ state = 'idle', name, online, onClick }) {
  const done = state === 'sent' || state === 'saved' || state === 'joined';
  const label = INVITE_LABEL[state] || INVITE_LABEL.idle;
  return (
    <button
      type="button"
      className={`lp-ibtn is-${state}`}
      onClick={onClick}
      disabled={state === 'sending' || done}
      aria-label={
        state === 'sending'
          ? `Sending invite to ${name}`
          : done
            ? `${label}: ${name}`
            : `${state === 'error' ? 'Retry invite to' : state === 'again' || state === 'declined' ? 'Invite again' : 'Invite'} ${name}${online ? '' : ' (offline: they will see it when they are back)'}`
      }
    >
      <span className="lp-ibtn__in" key={state}>
        {state === 'sending' && <span className="lp-ibtn__spin" aria-hidden="true" />}
        {done && <CheckIcon />}
        <span>{label}</span>
      </span>
    </button>
  );
}

/** The row's second line: the answer to my invite when there is one, else the friend's status. */
function RowSub({ friend, state }) {
  if (state === 'joined') return <span className="pr-result pr-result--joined">Joined your table</span>;
  if (state === 'declined') return <span className="pr-result pr-result--declined">Declined your invite</span>;
  if (!friend.online) return <>Offline · sees it later</>;
  return <StatusText friend={friend} />;
}

export function FriendRow({ friend, state, onInvite, index }) {
  const joinable = canJoin(friend) && state !== 'joined';
  return (
    <li className={`lp-row${friend.online ? '' : ' is-off'}`} style={{ '--lp-i': index }}>
      <span className="lp-row__ava">
        <FriendAvatar person={friend} size={40} online={friend.online} />
      </span>
      <span className="lp-row__main">
        <span className="lp-row__name">{friend.name}</span>
        {handleLabel(friend) && <span className="hd-handle">{handleLabel(friend)}</span>}
        <span className="lp-row__sub">
          <RowSub friend={friend} state={state} />
        </span>
      </span>
      <span className="pr-rowacts">
        {joinable && <JoinButton friend={friend} className="lp-ibtn is-again" />}
        <InviteButton state={state} name={friend.name} online={friend.online} onClick={() => onInvite(friend)} />
      </span>
    </li>
  );
}

/**
 * Lobby friends list: one tap invites a friend to this room (POST /api/invites; the server adds the game's name).
 * Offline friends can be invited too: the server keeps the invite and they find it in their inbox later.
 *
 * Props: { code, gameName, onNotify(message, tone), onCount?(n | null) }
 *  - `onCount` reports the friend count (null while loading) so the panel can pick its default tab.
 * Live: presence (online dot + order), friend_accepted (reload), friend_removed (drop the row).
 */
export default function InviteFriends({ code, gameName, onNotify, onCount }) {
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [sent, setSent] = useState({}); // userId -> 'sending' | 'sent' | 'saved' | 'again' | 'error'
  const [status, setStatus] = useState(''); // screen-reader announcement
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const timers = useRef(new Set());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const set = timers.current;
    return () => {
      alive.current = false;
      set.forEach((t) => clearTimeout(t));
      set.clear();
    };
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setError(null);
    try {
      const raw = await api.get('/api/friends');
      if (alive.current) setData(normalizeFriends(raw));
    } catch (e) {
      if (alive.current && !silent) setError(errorMessage(e, 'Could not load your friends'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    onCount?.(data ? data.friends.length : null);
  }, [data, onCount]);

  useUserEvents((msg) => {
    if (msg.t === 'presence') setData((d) => (d ? applyPresence(d, msg.userId, msg.online, msg) : d));
    else if (msg.t === 'invite_joined' || msg.t === 'invite_declined') {
      // a friend answered an invite to THIS room: the row says so and the host gets a toast
      const res = inviteEventResult(msg, code);
      if (res && alive.current) {
        setSent((s) => ({ ...s, [res.id]: res.state }));
        setStatus(res.text);
        onNotify?.(res.text, res.tone);
      }
    } else if (msg.t === 'friend_accepted') load({ silent: true });
    else if (msg.t === 'friend_removed') {
      const gone = msg.by ?? msg.userId ?? msg.id;
      if (gone != null) setData((d) => (d ? removeFriend(d, gone) : d));
    }
  }, ['presence', 'friend_accepted', 'friend_removed', 'invite_joined', 'invite_declined']);

  const mark = (id, state) => setSent((s) => ({ ...s, [id]: state }));

  const invite = async (friend) => {
    mark(friend.id, 'sending');
    setStatus(`Sending invite to ${friend.name}`);
    try {
      const res = await sendInvite(code, friend.id);
      if (!alive.current) return;
      const fb = inviteFeedback(res, friend.name);
      mark(friend.id, fb.state);
      setStatus(fb.text);
      onNotify?.(fb.text, fb.tone);
      // After 30 s the button is live again, so a lost invite can be re-sent.
      const t = setTimeout(() => {
        timers.current.delete(t);
        if (alive.current) setSent((s) => (s[friend.id] === 'sent' || s[friend.id] === 'saved' ? { ...s, [friend.id]: 'again' } : s)); // never overwrite Joined / Declined
      }, RESEND_AFTER);
      timers.current.add(t);
    } catch (e) {
      if (!alive.current) return;
      const text = errorMessage(e, 'Could not send the invite');
      mark(friend.id, 'error');
      setStatus(`${text}. Try again.`);
      onNotify?.(text, 'bad');
    }
  };

  const friends = data ? data.friends : [];
  const online = friends.filter((f) => f.online).length;
  const searchable = friends.length >= SEARCH_MIN;
  const shown = searchable ? filterByName(friends, query) : friends;
  const shownOnline = shown.filter((f) => f.online);
  const shownOffline = shown.filter((f) => !f.online);
  const grouped = shownOnline.length > 0 && shownOffline.length > 0;

  const sheet = (
    <Sheet
      open={adding}
      title="Add a friend"
      subtitle="Find someone by name, or use their friend code."
      onClose={() => {
        setAdding(false);
        load({ silent: true });
      }}
    >
      <AddFriendPanel compact onDone={() => load({ silent: true })} />
    </Sheet>
  );

  const addBtn = (
    <button type="button" className="lp-addbtn" onClick={() => setAdding(true)}>
      <PlusIcon /> Add friend
    </button>
  );

  let body;
  if (error) {
    body = (
      <div className="lp-state" role="alert">
        <p className="lp-state__text">{error}</p>
        <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm lp-btn" onClick={() => load()}>
          Retry
        </button>
      </div>
    );
  } else if (!data) {
    body = (
      <ul className="lp-list" aria-busy="true" aria-label="Loading friends">
        {[0, 1, 2].map((i) => (
          <li key={i} className="lp-row lp-skelrow" aria-hidden="true">
            <span className="lp-skel lp-skel--circle" />
            <span className="lp-skel lp-skel--line" />
            <span className="lp-skel lp-skel--btn" />
          </li>
        ))}
      </ul>
    );
  } else if (friends.length === 0) {
    body = (
      <div className="lp-state lp-state--empty">
        <p className="lp-state__title">No friends yet</p>
        <p className="lp-state__text">Add a friend once, then fill your table in one tap every time.</p>
        <button type="button" className="ho-btn ho-btn--primary lp-btn" onClick={() => setAdding(true)}>
          <PlusIcon /> Add a friend
        </button>
      </div>
    );
  } else {
    let n = 0;
    const rows = (list) => list.map((f) => <FriendRow key={f.id} friend={f} state={sent[f.id]} onInvite={invite} index={n++} />);
    body = (
      <>
        <div className="lp-friendhead">
          <span className="lp-friendhead__count">
            {online > 0 ? (
              <>
                <span className="lp-dot" aria-hidden="true" /> {online} online
              </>
            ) : (
              'Nobody online right now'
            )}
          </span>
          {addBtn}
        </div>
        {searchable && (
          <div className="lp-search">
            <input
              type="search"
              className="lp-search__input"
              placeholder="Search friends"
              aria-label="Search your friends"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
        )}
        {shown.length === 0 ? (
          <p className="lp-state__text lp-nomatch">No friend matches “{query.trim()}”.</p>
        ) : (
          <div className="lp-groups">
            {shownOnline.length > 0 && (
              <>
                {grouped && <h3 className="lp-group">Online</h3>}
                <ul className="lp-list">{rows(shownOnline)}</ul>
              </>
            )}
            {shownOffline.length > 0 && (
              <>
                {grouped && <h3 className="lp-group">Offline</h3>}
                <ul className="lp-list">{rows(shownOffline)}</ul>
              </>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="lp-friends" aria-label={gameName ? `Invite friends to ${gameName}` : 'Invite friends'}>
      {body}
      <p className="lp-sr" role="status" aria-live="polite">
        {status}
      </p>
      {sheet}
    </div>
  );
}
