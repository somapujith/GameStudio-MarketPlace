import { FriendAvatar, FriendTitle } from '@/components/online/InviteFriends.jsx';
import AutoMascot from '@/components/art/AutoMascot.jsx';
import { canShare } from '@/components/online/clipboard.js';
import SIcon from './SIcon.jsx';
import { JoinButton, StatusText, canJoin, statusText } from './PresenceBits.jsx';

/** Skeleton rows shaped like the people rows (avatar + two lines). `ho-skel-list` is only a marker class. */
export function RowSkeleton({ n = 3 }) {
  return (
    <ul className="sc-list ho-skel-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="sc-row sc-row--skel" aria-hidden="true">
          <span className="st-skel sc-skel__ava" />
          <span className="sc-skel__lines">
            <span className="st-skel sc-skel__line" style={{ width: `${58 - i * 8}%` }} />
            <span className="st-skel sc-skel__line sc-skel__line--s" style={{ width: '32%' }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Incoming requests with Accept / Decline. `shown` is the usePresence list: [{ key, item, leaving }]. */
export function IncomingRequests({ shown, busy, onAccept, onDecline }) {
  return (
    <ul className="sc-list" aria-label="Friend requests">
      {shown.map(({ key, item: u, leaving }, i) => (
        <li key={key} className={`sc-row sc-req sc-enter${leaving ? ' is-leaving' : ''}`} style={{ '--i': i }} aria-hidden={leaving || undefined}>
          <span className="sc-row__avatar">
            <FriendAvatar person={u} size={46} online={u.online} />
          </span>
          <span className="sc-row__main">
            <span className="sc-row__name">{u.name}</span>
            <span className="sc-row__sub">
              <span>wants to be friends</span>
              <span aria-hidden="true">·</span>
              <span>Lv {u.level}</span>
              <FriendTitle person={u} />
            </span>
          </span>
          <span className="sc-row__actions">
            <button type="button" className="hub-btn hub-btn--primary hub-btn--sm" onClick={() => onAccept(u)} disabled={!!busy[u.id] || leaving} aria-label={`Accept request from ${u.name}`}>
              Accept
            </button>
            <button type="button" className="hub-btn hub-btn--ghost hub-btn--sm" onClick={() => onDecline(u)} disabled={!!busy[u.id] || leaving} aria-label={`Decline request from ${u.name}`}>
              Decline
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Requests you sent, waiting for an answer. */
export function SentRequests({ list, busy, onCancel }) {
  return (
    <ul className="sc-list" aria-label="Sent requests">
      {list.map((u, i) => (
        <li key={u.id} className="sc-row sc-enter" style={{ '--i': i }}>
          <span className="sc-row__avatar">
            <FriendAvatar person={u} size={46} />
          </span>
          <span className="sc-row__main">
            <span className="sc-row__name">{u.name}</span>
            <span className="sc-row__sub">
              <SIcon name="clock" size={13} /> Waiting for reply
            </span>
          </span>
          <span className="sc-row__actions">
            <button type="button" className="hub-btn hub-btn--ghost hub-btn--sm" onClick={() => onCancel(u)} disabled={!!busy[u.id]} aria-label={`Cancel request to ${u.name}`}>
              Cancel
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function FriendRow({ f, leaving, index, room, roomState, busy, onOpen, onInviteRoom, onInvite, onRemove }) {
  const st = room ? roomState(f) : undefined;
  const done = st === 'sent' || st === 'saved' || st === 'joined' || st === 'declined';
  return (
    <li className={`sc-row sc-friend sc-enter${f.online ? ' is-online' : ''}${leaving ? ' is-leaving' : ''}`} style={{ '--i': index }} aria-hidden={leaving || undefined}>
      <button
        type="button"
        className="sc-friend__main"
        onClick={() => onOpen(f)}
        disabled={leaving}
        aria-haspopup="dialog"
        aria-label={`${f.name}, ${statusText(f).toLowerCase()}, level ${f.level}. Open actions`}
      >
        <span className="sc-row__avatar">
          <FriendAvatar person={f} size={46} online={f.online} />
        </span>
        <span className="sc-row__main">
          <span className="sc-row__name">{f.name}</span>
          <span className="sc-row__sub">
            <StatusText friend={f} />
            <span aria-hidden="true">·</span>
            <span>Lv {f.level}</span>
            <FriendTitle person={f} />
          </span>
        </span>
      </button>
      <span className="sc-row__actions">
        {!room && canJoin(f) && <JoinButton friend={f} disabled={leaving} />}
        {room ? (
          <button
            type="button"
            className={`hub-btn hub-btn--sm ${done ? 'hub-btn--ghost' : 'hub-btn--primary'}`}
            onClick={() => onInviteRoom(f, room)}
            disabled={st === 'sending' || done || leaving}
            aria-label={`Invite ${f.name} to room ${room}`}
          >
            {st === 'sending' ? 'Sending...' : st === 'sent' ? 'Invited' : st === 'saved' ? 'Saved' : st === 'joined' ? 'Joined' : st === 'declined' ? 'Declined' : 'Invite'}
          </button>
        ) : (
          <button
            type="button"
            className={`hub-btn hub-btn--sm ${f.online && !canJoin(f) ? 'hub-btn--primary' : 'hub-btn--soft'}`}
            onClick={() => onInvite(f)}
            disabled={leaving}
            title={f.online ? undefined : `${f.name} is offline: they will see the invite when they are back`}
            aria-label={`Invite ${f.name} to a game`}
          >
            <SIcon name="table" size={16} /> Invite
          </button>
        )}
        <button type="button" className="sc-iconbtn sc-tip" data-tip="Remove friend" onClick={() => onRemove(f)} disabled={!!busy[f.id] || leaving} aria-label={`Remove ${f.name} from friends`}>
          <SIcon name="trash" />
        </button>
      </span>
    </li>
  );
}

/**
 * Friends, presence-sorted: "Online now" first, then "Offline". `shown` is the usePresence list so rows that leave
 * animate out. Counts come from the live entries only.
 */
export function FriendsList({ shown, ...rest }) {
  const live = shown.filter((s) => !s.leaving);
  const onlineCount = live.filter((s) => s.item.online).length;
  const offlineCount = live.length - onlineCount;
  const groups = [
    { id: 'on', label: 'Online now', count: onlineCount, items: shown.filter((s) => s.item.online) },
    { id: 'off', label: 'Offline', count: offlineCount, items: shown.filter((s) => !s.item.online) },
  ].filter((g) => g.items.length);
  return (
    <div className="sc-groups">
      {groups.map((g) => (
        <section key={g.id} aria-label={`${g.label}, ${g.count}`}>
          {groups.length > 1 && (
            <h3 className={`sc-group sc-group--${g.id}`}>
              {g.id === 'on' && <span className="st-live" aria-hidden="true" />}
              {g.label} <span className="sc-group__n">{g.count}</span>
            </h3>
          )}
          <ul className="sc-list">
            {g.items.map(({ key, item, leaving }, i) => (
              <FriendRow key={key} f={item} leaving={leaving} index={i} {...rest} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Empty "Your friends": teaches how friend codes work. `onShare` shares your link. */
export function FriendsEmpty({ onShare, canUseShare = canShare(), disabled }) {
  return (
    <div className="sc-teach">
      <div className="sc-teach__top">
        <AutoMascot mood="waiting" size={72} />
        <div>
          <strong className="sc-teach__title">No friends yet</strong>
          <p>Friends are people you play with again and again. Here is how to add one.</p>
        </div>
      </div>
      <ol className="sc-steps">
        <li>
          <span className="sc-steps__n">1</span>
          <span>
            <strong>Share your friend code</strong>
            <span>It looks like HYD-7K2Q and is unique to you. Send the code or your link on WhatsApp.</span>
          </span>
        </li>
        <li>
          <span className="sc-steps__n">2</span>
          <span>
            <strong>They open the link or type the code</strong>
            <span>Paste a code into Add by code, or tap your link: it asks "Add you?" in one tap.</span>
          </span>
        </li>
        <li>
          <span className="sc-steps__n">3</span>
          <span>
            <strong>Play together</strong>
            <span>Once they accept, a green dot shows when they are online and you can invite them to any game.</span>
          </span>
        </li>
      </ol>
      <button type="button" className="hub-btn hub-btn--primary sc-teach__cta" onClick={onShare} disabled={disabled}>
        <SIcon name="share" size={17} /> {canUseShare ? 'Share my link' : 'Copy my invite'}
      </button>
    </div>
  );
}
