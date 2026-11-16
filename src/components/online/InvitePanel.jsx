import { useCallback, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import InviteFriends from '@/components/online/InviteFriends.jsx';
import { ShareTools } from '@/components/online/ShareCard.jsx';
import '@/styles/lobby-invite.css';

const TABS = ['friends', 'share'];

/**
 * Pure: which tab shows. A choice the player made always wins; otherwise Share for guests and for members
 * whose friend list is empty, Friends while loading (count === null) or when they have friends.
 */
export function pickTab({ chosen, isGuest, friendCount }) {
  if (TABS.includes(chosen)) return chosen;
  if (isGuest) return 'share';
  return friendCount === 0 ? 'share' : 'friends';
}

/**
 * The lobby's "Fill the table" panel: invite friends in one tap (Friends tab) or share the code / link / QR (Share tab).
 *
 * Props: { code, gameName, isGuest, onNotify(message, tone), openSeats?, id }
 *  - `id` is the DOM id the lobby scrolls to when an empty seat is tapped (default 'sr-invite').
 *  - `openSeats` (optional number) shows "N seats open" in the header.
 *  - Guests have no friends list: the Friends tab holds a sign-in nudge and Share is the default.
 * Tour hooks: lobby-invite (the tab strip, always visible) and lobby-friends (the body: friends list or guest note).
 * Renders exactly one root element so the page shell can place it in a sticky column.
 */
export default function InvitePanel({ code, gameName, isGuest, onNotify, openSeats, id = 'sr-invite' }) {
  const uid = useId();
  const [chosen, setChosen] = useState(null); // the player's own pick, once they make one
  const [count, setCount] = useState(null); // friend count; null while loading
  const [dir, setDir] = useState(1); // slide direction of the incoming panel
  const tabRefs = useRef({});

  const tab = pickTab({ chosen, isGuest, friendCount: count });
  const onCount = useCallback((n) => setCount(n), []);

  const select = (next, focus) => {
    if (next === tab) {
      if (chosen == null) setChosen(next);
      return;
    }
    setDir(TABS.indexOf(next) > TABS.indexOf(tab) ? 1 : -1);
    setChosen(next);
    if (focus) tabRefs.current[next]?.focus();
  };

  const onKeyDown = (e) => {
    const i = TABS.indexOf(tab);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = TABS[(i - 1 + TABS.length) % TABS.length];
    else if (e.key === 'Home') next = TABS[0];
    else if (e.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    select(next, true);
  };

  const tabId = (t) => `${uid}-tab-${t}`;
  const panelId = (t) => `${uid}-panel-${t}`;
  const seatsLabel = Number.isFinite(openSeats) && openSeats > 0 ? `${openSeats} ${openSeats === 1 ? 'seat' : 'seats'} open` : null;

  return (
    <aside className="lp" id={id} aria-label="Fill the table" tabIndex={-1} data-tab={tab} style={{ '--lp-dx': `${dir * 10}px` }}>
      <header className="lp__head">
        <div className="lp__titles">
          <span className="st-eyebrow">Invite</span>
          <h2 className="lp__title">Fill the table</h2>
        </div>
        {seatsLabel && <span className="lp__seats">{seatsLabel}</span>}
      </header>

      <div className="lp__tabs" data-tour="lobby-invite">
        <div className="lp-tabs" role="tablist" aria-label="Invite method" onKeyDown={onKeyDown}>
          <span className="lp-tabs__thumb" aria-hidden="true" />
          {TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              type="button"
              role="tab"
              id={tabId(t)}
              aria-selected={tab === t}
              aria-controls={panelId(t)}
              tabIndex={tab === t ? 0 : -1}
              className={`lp-tab${tab === t ? ' is-on' : ''}`}
              onClick={() => select(t)}
            >
              {t === 'friends' ? 'Friends' : 'Share'}
            </button>
          ))}
        </div>
      </div>

      <div className="lp__body" data-tour="lobby-friends">
        {/* Both panels stay mounted so friend data, sent states and the QR toggle survive a tab switch. */}
        <div className="lp-panel" role="tabpanel" id={panelId('friends')} aria-labelledby={tabId('friends')} hidden={tab !== 'friends'}>
          {isGuest ? (
            <p className="lp-note">
              Friends need an account. <Link to={paths.login(paths.lobby(code))}>Sign in with Google</Link> to invite them in one tap, or share the code from the Share tab.
            </p>
          ) : (
            <InviteFriends code={code} gameName={gameName} onNotify={onNotify} onCount={onCount} />
          )}
        </div>
        <div className="lp-panel" role="tabpanel" id={panelId('share')} aria-labelledby={tabId('share')} hidden={tab !== 'share'}>
          <ShareTools code={code} gameName={gameName} onNotify={onNotify} />
        </div>
      </div>
    </aside>
  );
}
