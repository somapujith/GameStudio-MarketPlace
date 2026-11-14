import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Ava from '@/platform/home/Ava.jsx';
import Sheet from '@/components/online/Sheet.jsx';
import InviteToGameSheet from '@/components/online/InviteToGameSheet.jsx';
import Framed from './Framed.jsx';

/**
 * Quick actions for a friend tapped on the home strip: invite them to a table (reuses the Friends page's
 * InviteToGameSheet: pick a game, a private room opens, the invite is sent, you land in the lobby) or open Friends.
 */
export default function FriendSheet({ friend, onClose }) {
  const navigate = useNavigate();
  const [inviting, setInviting] = useState(false);

  // Portalled to <body>: the home sections animate in (transform), which would trap a fixed overlay.
  const portal = (node) => (typeof document === 'undefined' ? node : createPortal(node, document.body));
  if (inviting) return portal(<InviteToGameSheet friend={friend} onClose={onClose} />);

  return portal(
    <Sheet open title={friend.name} subtitle={friend.online ? 'Online now' : 'Offline · they will see your invite later'} onClose={onClose}>
      <div className="xh-fsheet">
        <div className="xh-fsheet__who" aria-hidden="true">
          <Framed frame={friend.equipped?.frame} size={72}>
            <Ava preset={friend.avatar} size={72} dot={friend.online ? 'on' : 'off'} />
          </Framed>
        </div>
        <ul className="xh-fsheet__list">
          <li>
            <button type="button" className="xh-action xh-action--primary" onClick={() => setInviting(true)}>
              <span className="xh-action__ico" aria-hidden="true">
                <HubIcon name="table" size={22} />
              </span>
              <span className="xh-action__text">
                <b>Invite to a table</b>
                <small>Pick a game, we open a private room and invite {friend.name}.</small>
              </span>
              <HubIcon name="chevR" size={18} className="xh-action__go" />
            </button>
          </li>
          <li>
            <button
              type="button"
              className="xh-action"
              onClick={() => {
                onClose?.();
                navigate(paths.friends());
              }}
            >
              <span className="xh-action__ico" aria-hidden="true">
                <HubIcon name="users" size={22} />
              </span>
              <span className="xh-action__text">
                <b>View friends</b>
                <small>Requests, friend code and everyone on your list.</small>
              </span>
              <HubIcon name="chevR" size={18} className="xh-action__go" />
            </button>
          </li>
        </ul>
      </div>
    </Sheet>,
  );
}
