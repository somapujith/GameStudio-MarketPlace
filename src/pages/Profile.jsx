import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { featured, liveList } from '@/platform/home/catalog.js';
import ProfileHeader from '@/platform/home/ProfileHeader.jsx';
import GameStatCards, { RecentMatches } from '@/platform/home/GameStatCards.jsx';
import BadgeGrid from '@/platform/home/BadgeGrid.jsx';
import SettingsSection from '@/platform/home/SettingsSection.jsx';
import AccountSection from '@/platform/home/AccountSection.jsx';
import AboutSection from '@/platform/home/AboutSection.jsx';
import { useAccountProgress } from '@/platform/home/accountProgress.js';
import { useAccount, useReducedMotion } from '@/components/shell/hooks.js';
import '@/styles/hubhome.css';
import '@/styles/x-profile.css';
import '@/styles/store-account.css';

const JUMPS = [
  { id: 'games', label: 'Games' },
  { id: 'matches', label: 'Matches' },
  { id: 'badges', label: 'Badges' },
  { id: 'settings', label: 'Settings' },
  { id: 'account', label: 'Account' },
];

/** Skeleton shaped like the identity header while the session loads (no flash of a wrong name or level). */
function ProfileSkeleton() {
  return (
    <div className="hub-panel sa-proskel" role="status" aria-busy="true">
      <span className="hub-sr">Loading your profile...</span>
      <div className="sa-proskel__top">
        <span className="st-skel sa-proskel__ring" />
        <span className="sa-proskel__lines">
          <span className="st-skel" style={{ height: 24, width: '55%' }} />
          <span className="st-skel" style={{ height: 14, width: '70%' }} />
          <span className="st-skel" style={{ height: 22, width: '40%' }} />
        </span>
      </div>
      <div className="sa-proskel__row">
        <span className="st-skel" style={{ height: 64 }} />
        <span className="st-skel" style={{ height: 64 }} />
      </div>
    </div>
  );
}

/** `/profile`: identity (level ring, coins, streak, daily reward), per-game stats, recent matches, badges, settings, account. */
export default function Profile() {
  const { hash } = useLocation();
  const { user, signedIn, loading } = useAccount();
  const { level } = useAccountProgress();
  const reduced = useReducedMotion();
  const games = useMemo(liveList, []);
  const lead = useMemo(featured, []);

  // `/profile#settings` (the old /settings link target) scrolls to the settings block.
  useEffect(() => {
    if (!hash) return undefined;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }), 60);
    return () => clearTimeout(t);
  }, [hash]);

  const jump = (e, id) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    try {
      window.history.replaceState(null, '', `#${id}`);
    } catch {
      /* sandboxed frame: scrolling is enough */
    }
  };

  return (
    <div className="hub-page hh2 hh2-profilepage xp-page sa-profile st-scope">
      <h1 className="hub-sr">Your profile</h1>
      {loading ? <ProfileSkeleton /> : <ProfileHeader />}
      <nav className="sa-jump" aria-label="Profile sections">
        {JUMPS.map((j) => (
          <a key={j.id} href={`#${j.id}`} className="st-chip sa-jump__chip" onClick={(e) => jump(e, j.id)}>
            {j.label}
          </a>
        ))}
      </nav>
      <div className="xp-procols">
        <GameStatCards games={games} user={user} />
        <RecentMatches signedIn={signedIn} lead={lead} />
      </div>
      <BadgeGrid games={games} user={user} level={level} />
      <SettingsSection />
      <div className="hh2-duo">
        <AccountSection />
        <AboutSection />
      </div>
    </div>
  );
}
