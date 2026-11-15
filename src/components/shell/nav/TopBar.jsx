import { useEffect, useRef, useState } from 'react';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { HubLogo } from '@/platform/game/hubArt.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import ProfileChip from '../ProfileChip.jsx';
import CodeSheet from './CodeSheet.jsx';
import CoinsChip from './CoinsChip.jsx';
import TransitionLink from './TransitionLink.jsx';
import { useTopbarFit } from './useTopbarFit.js';

/** Window event any screen can dispatch to open the "Have a code?" sheet: `window.dispatchEvent(new Event('hub:open-code'))`. */
export const OPEN_CODE_EVENT = 'hub:open-code';

/** Thin top bar: logo, "Have a code?", coins (-> shop), profile chip. Sticky, fixed height (no layout shift). */
export default function TopBar() {
  const [codeOpen, setCodeOpen] = useState(false);
  const rowRef = useRef(null);
  useTopbarFit(rowRef); // sheds wordmark / label / coin icon when a big balance would overflow the row

  useEffect(() => {
    const open = () => setCodeOpen(true);
    window.addEventListener(OPEN_CODE_EVENT, open);
    return () => window.removeEventListener(OPEN_CODE_EVENT, open);
  }, []);

  return (
    <header className="hub-topbar">
      <div className="hub-topbar__inner" ref={rowRef}>
        <TransitionLink to={paths.hub()} className="hub-topbar__logo" aria-label={`${BRAND.name}, home`}>
          <HubLogo size={30} />
        </TransitionLink>
        <div className="hub-topbar__end">
          <button type="button" className="hub-codebtn" onClick={() => setCodeOpen(true)} aria-haspopup="dialog" aria-label="Have a code? Join a table with a room code">
            <HubIcon name="hash" size={18} />
            <span className="hub-codebtn__long">Have a code?</span>
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
