import { useEffect, useRef, useState } from 'react';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { HubLogo } from '@/platform/game/hubArt.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import ProfileChip from '../ProfileChip.jsx';
import CodeSheet from './CodeSheet.jsx';
import CoinsChip from './CoinsChip.jsx';
import CommandPalette from './CommandPalette.jsx';
import TransitionLink from './TransitionLink.jsx';
import { OPEN_CODE_EVENT, OPEN_SEARCH_EVENT } from './events.js';
import { isOpenShortcut, shortcutLabel } from './paletteModel.js';
import { useTopbarFit } from './useTopbarFit.js';

export { OPEN_CODE_EVENT, OPEN_SEARCH_EVENT };

/** Is another dialog (a sheet, the code entry) already on screen? Then the shortcut stays quiet. */
const dialogOpen = () => !!document.querySelector('.hh-modal, .xs-pal');

/**
 * Top bar: logo, search (opens the command palette: Ctrl/Cmd+K, "/" or a tap), "Have a code?", coins (signed in)
 * and the profile chip (or a Sign in button). Sticky, fixed height (no layout shift).
 */
export default function TopBar() {
  const [codeOpen, setCodeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const rowRef = useRef(null);
  useTopbarFit(rowRef); // sheds wordmark / label / coin icon when a big balance would overflow the row

  useEffect(() => {
    const openCode = () => setCodeOpen(true);
    const openSearch = () => setSearchOpen(true);
    const onKey = (e) => {
      if (e.defaultPrevented || !isOpenShortcut(e) || dialogOpen()) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener(OPEN_CODE_EVENT, openCode);
    window.addEventListener(OPEN_SEARCH_EVENT, openSearch);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_CODE_EVENT, openCode);
      window.removeEventListener(OPEN_SEARCH_EVENT, openSearch);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <header className="hub-topbar">
      <div className="hub-topbar__inner" ref={rowRef}>
        <TransitionLink to={paths.hub()} className="hub-topbar__logo" aria-label={`${BRAND.name}, home`}>
          <HubLogo size={30} />
        </TransitionLink>
        <button
          type="button"
          className="hub-search"
          data-tour="nav-search"
          onClick={() => setSearchOpen(true)}
          aria-haspopup="dialog"
          aria-keyshortcuts="Control+K Meta+K /"
          aria-label="Search games and pages"
        >
          <HubIcon name="search" size={18} />
          <span className="hub-search__label">Search games</span>
          <kbd className="hub-search__kbd" aria-hidden="true">
            {shortcutLabel()}
          </kbd>
        </button>
        <div className="hub-topbar__end">
          <span id="tour-help-slot" className="hub-topbar__tour" />
          <button type="button" className="hub-codebtn" data-tour="nav-code" onClick={() => setCodeOpen(true)} aria-haspopup="dialog" aria-label="Have a code? Join a table with a room code">
            <HubIcon name="hash" size={18} />
            <span className="hub-codebtn__long">Have a code?</span>
            <span className="hub-codebtn__short">Code</span>
          </button>
          <CoinsChip />
          <ProfileChip />
        </div>
      </div>
      <CodeSheet open={codeOpen} onClose={() => setCodeOpen(false)} />
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
