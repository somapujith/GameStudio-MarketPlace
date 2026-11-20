import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { HubLogo } from '@/platform/game/hubArt.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import ProfileChip from '../ProfileChip.jsx';
import CodeSheet from './CodeSheet.jsx';
import CoinsChip from './CoinsChip.jsx';
import { NAV_ITEMS, useIsActive } from './navItems.js';

/** Window event any screen can dispatch to open the "Have a code?" sheet: `window.dispatchEvent(new Event('hub:open-code'))`. */
export const OPEN_CODE_EVENT = 'hub:open-code';

/** Branded top bar with a prominent mascot and a stable responsive height. */
export default function TopBar() {
  const [codeOpen, setCodeOpen] = useState(false);
  const active = useIsActive();

  useEffect(() => {
    const open = () => setCodeOpen(true);
    window.addEventListener(OPEN_CODE_EVENT, open);
    return () => window.removeEventListener(OPEN_CODE_EVENT, open);
  }, []);

  return (
    <header className="hub-topbar">
      <div className="hub-topbar__inner">
        <Link to={paths.hub()} className="hub-topbar__logo" aria-label={`${BRAND.name}, home`}>
          <HubLogo size={78} animated compact style={{ fontSize: 'var(--jalebi-nav-size, 78px)' }} />
        </Link>
        <nav className="label-nav" aria-label="Main">
          {NAV_ITEMS.filter((item) => item.id !== 'profile').map((item) => (
            <Link key={item.id} to={item.to} className={`label-nav__link${active(item) ? ' is-active' : ''}`} aria-current={active(item) ? 'page' : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hub-topbar__end">
          <button type="button" className="hub-codebtn" onClick={() => setCodeOpen(true)} aria-haspopup="dialog" aria-label="Have a code? Join a table with a room code">
            <HubIcon name="hash" size={18} />
            <span className="hub-codebtn__long">Enter code</span>
            <span className="hub-codebtn__short">Code</span>
          </button>
          <CoinsChip />
          <ProfileChip />
        </div>
      </div>
      <CodeSheet open={codeOpen} onClose={() => setCodeOpen(false)} />
    </header>
  );
}
