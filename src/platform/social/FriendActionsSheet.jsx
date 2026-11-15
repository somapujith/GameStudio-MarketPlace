import { useEffect, useState } from 'react';
import { getMyRooms } from '@/lib/api.js';
import { useCopied } from '@/components/online/clipboard.js';
import { friendLinkUrl } from '@/components/online/codes.js';
import { gameName } from '@/components/online/games.js';
import { FriendAvatar, FriendTitle } from '@/components/online/InviteFriends.jsx';
import Sheet from '@/components/online/Sheet.jsx';
import SIcon from './SIcon.jsx';

function Action({ icon, title, sub, onClick, disabled, tone, index }) {
  return (
    <li className="sc-enter" style={{ '--i': index }}>
      <button type="button" className={`sc-act${tone ? ` is-${tone}` : ''}`} onClick={onClick} disabled={disabled}>
        <span className="sc-act__icon" aria-hidden="true">
          <SIcon name={icon} />
        </span>
        <span className="sc-act__text">
          <strong>{title}</strong>
          {sub && <span>{sub}</span>}
        </span>
      </button>
    </li>
  );
}

/**
 * Quick actions for one friend, as a sheet: invite to a table you already opened (or the room you came from), start a
 * new table (pick a game -> we open a room and invite them), copy their code or link, remove.
 */
export default function FriendActionsSheet({ friend, room, inviteState, onInvite, onNewTable, onRemove, onNotify, onClose }) {
  const [tables, setTables] = useState(null); // null = loading, [] = none / unavailable
  const [codeCopied, copyCode] = useCopied();
  const [linkCopied, copyLink] = useCopied();

  useEffect(() => {
    if (room) {
      setTables([]);
      return undefined;
    }
    let alive = true;
    getMyRooms()
      .then((r) => {
        if (alive) setTables((r && Array.isArray(r.rooms) ? r.rooms : []).filter((x) => x && x.code && x.status === 'lobby'));
      })
      .catch(() => alive && setTables([]));
    return () => {
      alive = false;
    };
  }, [room]);

  const link = friend.friendCode ? friendLinkUrl(friend.friendCode) : '';
  const targets = room ? [{ code: room, gameId: null, here: true }] : tables || [];
  let n = 0;

  return (
    <Sheet open title={friend.name} subtitle={friend.online ? 'Online now' : 'Offline. Invites wait for them.'} onClose={onClose}>
      <div className="sc-qa">
        <div className="sc-qa__who">
          <FriendAvatar person={friend} size={64} online={friend.online} />
          <span className="sc-qa__meta">
            <span>Level {friend.level}</span>
            <FriendTitle person={friend} />
            {friend.friendCode && <span className="st-chip">{friend.friendCode}</span>}
          </span>
        </div>

        <ul className="sc-qa__list" aria-label={`Actions for ${friend.name}`}>
          {tables === null && (
            <li aria-hidden="true">
              <span className="st-skel sc-qa__skel" />
            </li>
          )}
          {targets.map((t) => {
            const st = inviteState(t.code);
            const done = st === 'sent' || st === 'saved';
            const sub = t.here
              ? 'The room you came from'
              : [t.gameId ? gameName(t.gameId) : '', Number.isFinite(t.players) && Number.isFinite(t.maxPlayers) ? `${t.players}/${t.maxPlayers} seats` : ''].filter(Boolean).join(' · ');
            return (
              <Action
                key={t.code}
                index={n++}
                icon={done ? 'check' : 'table'}
                tone="primary"
                title={st === 'sending' ? 'Sending...' : st === 'sent' ? `Invited to ${t.code}` : st === 'saved' ? `Invite saved for ${t.code}` : t.here ? `Invite to table ${t.code}` : `Invite to my table ${t.code}`}
                sub={sub}
                disabled={st === 'sending' || done}
                onClick={() => onInvite(friend, t.code)}
              />
            );
          })}
          <Action
            index={n++}
            icon="plus"
            tone={targets.length ? undefined : 'primary'}
            title={targets.length ? 'Start a new table instead' : 'Invite to a new table'}
            sub={`Pick a game; we open a private room and invite ${friend.name}`}
            onClick={() => onNewTable(friend)}
          />
          {friend.friendCode && (
            <>
              <Action
                index={n++}
                icon={codeCopied ? 'check' : 'copy'}
                title={codeCopied ? 'Copied!' : 'Copy friend code'}
                sub={friend.friendCode}
                onClick={async () => {
                  if (await copyCode(friend.friendCode)) onNotify('Friend code copied', 'good');
                  else onNotify('Could not copy. Select the code and copy it manually.', 'bad');
                }}
              />
              <Action
                index={n++}
                icon={linkCopied ? 'check' : 'link'}
                title={linkCopied ? 'Copied!' : 'Copy friend link'}
                sub={`Share ${friend.name}'s profile link`}
                onClick={async () => {
                  if (await copyLink(link)) onNotify('Friend link copied', 'good');
                  else onNotify('Could not copy the link.', 'bad');
                }}
              />
            </>
          )}
          <Action index={n++} icon="trash" tone="danger" title="Remove friend" sub="You can add them again with their code" onClick={() => onRemove(friend)} />
        </ul>
      </div>
    </Sheet>
  );
}
