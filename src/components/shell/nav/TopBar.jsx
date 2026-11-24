import { useEffect, useRef, useState } from 'react';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { HubLogo } from '@/platform/game/hubArt.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import SocialBell from '@/platform/social/SocialBell.jsx';
import NotificationBell from '@/platform/notifications/NotificationBell.jsx';
import ProfileChip from '../ProfileChip.jsx';
import { TopNav } from '../TabBar.jsx';
import CodeSheet from './CodeSheet.jsx';
import CoinsChip from './CoinsChip.jsx';
import CommandPalette from './CommandPalette.jsx';
import TransitionLink from './TransitionLink.jsx';
import { OPEN_CODE_EVENT, OPEN_SEARCH_EVENT } from './events.js';
import { isOpenShortcut, shortcutLabel } from './paletteModel.js';
import { useTopbarFit } from './useTopbarFit.js';

export { OPEN_CODE_EVENT, OPEN_SEARCH_EVENT };

/** Is another dialog (a sheet, the code entry) already on screen? Then the shortcut stays quiet. */
const dialogOpen = () => !!document.querySelector('.hh-modal, .xs-pal, .nt-pop');

/** Scrolled past the first few pixels? The pill condenses (tighter, more opaque) while it is. */
const CONDENSE_AT = 16;

/** `true` once the page has scrolled past `at` px (rAF-throttled, passive). */
export function useCondensed(at = CONDENSE_AT) {
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setCondensed(window.scrollY > at);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [at]);
  return condensed;
}

/**
 * The hub's floating nav. Logo top-left; on wide screens (>= 900 px) a floating glass pill top-right holding the
 * destinations (Arcade, Browse, The Adda, Leaderboard: the active one a white pill), a hairline, then search (opens the
 * command palette: Ctrl/Cmd+K, "/" or a tap), "Enter code", coins (signed in), the notifications bell (members), the
 * social bell (only while something waits) and the profile avatar (or a white "Sign in" pill). The pill condenses
 * on scroll. On phones the destinations live in the bottom dock (TabBar), so the bar keeps only the logo and a small
 * cluster (coins and the bells) that scrolls away with the page. `badges` comes from useNavBadges in AppShell.
 */
export default function TopBar({ badges }) {
  const [codeOpen, setCodeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const rowRef = useRef(null);
  const condensed = useCondensed();
  useTopbarFit(rowRef); // tightens the pill one step at a time when a big balance would overflow the row

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
    <header className={`hub-topbar cj-nav${condensed ? ' is-condensed' : ''}`}>
      <div className="cj-nav__row" ref={rowRef}>
        <TransitionLink to={paths.hub()} className="cj-nav__logo" aria-label={`${BRAND.name}, home`}>
          <HubLogo size={44} animated compact />
        </TransitionLink>
        <div className="cj-nav__pill">
          <TopNav badges={badges} />
          <span className="cj-nav__rule" aria-hidden="true" />
          <div className="cj-nav__tools">
            <span id="tour-help-slot" className="hub-topbar__tour cj-nav__tour" />
            <button
              type="button"
              className="cj-nav__btn cj-nav__search"
              data-tour="nav-search"
              onClick={() => setSearchOpen(true)}
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K Meta+K /"
              aria-label="Search games and pages"
              title={`Search (${shortcutLabel()})`}
            >
              <HubIcon name="search" size={20} />
            </button>
            <button
              type="button"
              className="cj-nav__btn cj-nav__code"
              data-tour="nav-code"
              onClick={() => setCodeOpen(true)}
              aria-haspopup="dialog"
              aria-label="Have a code? Join a table with a room code"
              title="Enter a room code"
            >
              <HubIcon name="hash" size={19} />
            </button>
            <CoinsChip />
            <NotificationBell />
            <SocialBell />
            <ProfileChip />
          </div>
        </div>
      </div>
      <CodeSheet open={codeOpen} onClose={() => setCodeOpen(false)} />
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
