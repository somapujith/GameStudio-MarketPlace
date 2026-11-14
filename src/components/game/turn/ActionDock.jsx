// Phones (< 600px): the action row lives in a fixed bottom dock (safe-area aware) instead of the board centre.
//   [ decision timer bar ]
//   [ hint ] [ secondaries ] [ PRIMARY ] [ wide rows (ride / auction) ]
//   [ Manage (badge) ] [ Trade (badge) ]
// <ActionDock session spec fire badges onManage onTrade />. Reports its height as --hg-dock on the game root and <html>.
import { useLayoutEffect, useRef } from 'react';
import ActionBar from '../ActionBar.jsx';
import Icon from '../ui/Icon.jsx';
import { TimerBar } from './TurnTimer.jsx';
import '@/styles/turn.css';

function Tool({ icon, label, badge, onClick }) {
  return (
    <button type="button" className="ad-tool" onClick={onClick} aria-label={badge ? `${label}, ${badge.label}` : label}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
      {badge ? <i className="ad-tool__badge" aria-hidden="true">{badge.text}</i> : null}
    </button>
  );
}

export default function ActionDock({ session, spec, fire, badges = {}, onManage, onTrade }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const root = el?.closest('.hg-game');
    if (!el || !root) return undefined;
    // also on <html>, so the shell's toasts can sit above the dock: bottom: calc(var(--hg-dock, 0px) + 12px)
    const doc = document.documentElement;
    const set = () => {
      const h = `${Math.ceil(el.getBoundingClientRect().height)}px`;
      root.style.setProperty('--hg-dock', h);
      doc.style.setProperty('--hg-dock', h);
    };
    set();
    if (typeof ResizeObserver === 'undefined') return () => doc.style.removeProperty('--hg-dock');
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--hg-dock');
      doc.style.removeProperty('--hg-dock');
    };
  }, []);

  return (
    <div ref={ref} className="ad" role="region" aria-label="Your actions">
      <TimerBar session={session} className="ad-timer" />
      <div className="ad-main cp-docked-actions">
        <ActionBar spec={spec} fire={fire} session={session} className="is-dock" />
      </div>
      <div className="ad-tools">
        <Tool icon="home" label="Manage" badge={badges.manage} onClick={onManage} />
        <Tool icon="swap" label="Trade" badge={badges.trade} onClick={onTrade} />
      </div>
    </div>
  );
}
