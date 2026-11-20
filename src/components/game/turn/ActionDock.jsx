// Phones (portrait and on their side): the action row, in the bottom stack under your wallet bar (GameView renders both
// inside `.hg-bottom`, which reports its own height as --hg-dock). It is in the page flow, never fixed, so it can not hide
// behind the iOS Safari bar / the Android gesture bar and never covers the table.
//   [ decision timer bar ]
//   [ hint ] [ secondaries ] [ PRIMARY ] [ wide rows (ride) ]
//   [ Manage (badge) ] [ Trade (badge) ] [ Chat ]
// <ActionDock session spec fire badges onManage onTrade onChat chatOpen />
import ActionBar from '../ActionBar.jsx';
import Icon from '../ui/Icon.jsx';
import { TimerBar } from './TurnTimer.jsx';
import '@/styles/turn.css';

function Tool({ icon, label, badge, onClick, iconOnly = false, expanded }) {
  return (
    <button
      type="button"
      className={`ad-tool${iconOnly ? ' is-icon' : ''}`}
      onClick={onClick}
      aria-label={badge ? `${label}, ${badge.label}` : label}
      aria-expanded={expanded}
      data-tour={label === 'Manage' ? 'manage' : label === 'Trade' ? 'trade' : undefined}
    >
      <Icon name={icon} size={18} />
      {iconOnly ? null : <span>{label}</span>}
      {badge ? <i className="ad-tool__badge" aria-hidden="true">{badge.text}</i> : null}
    </button>
  );
}

export default function ActionDock({ session, spec, fire, badges = {}, onManage, onTrade, onChat, chatOpen, reopen = null }) {
  return (
    <div className="ad" role="region" aria-label="Your actions">
      <TimerBar session={session} className="ad-timer" />
      <div className="ad-main cp-docked-actions">
        <ActionBar spec={spec} fire={fire} session={session} className="is-dock" reopen={reopen} />
      </div>
      <div className="ad-tools">
        {spec?.kind === 'out' ? null : <Tool icon="home" label="Manage" badge={badges.manage} onClick={onManage} />}
        {spec?.kind === 'out' ? null : <Tool icon="swap" label="Trade" badge={badges.trade} onClick={onTrade} />}
        {onChat ? <Tool icon="chat" label="Chat and reactions" iconOnly onClick={onChat} expanded={!!chatOpen} /> : null}
      </div>
    </div>
  );
}
