import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { isStaff } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import { featured, liveList } from '@/platform/home/catalog.js';
import ProfileHeader from '@/platform/home/ProfileHeader.jsx';
import GameStatCards, { RecentMatches } from '@/platform/home/GameStatCards.jsx';
import BadgeGrid from '@/platform/home/BadgeGrid.jsx';
import AchievementsGrid from '@/platform/engagement/AchievementsGrid.jsx';
import ReferralCard from '@/platform/engagement/ReferralCard.jsx';
import SettingsSection from '@/platform/home/SettingsSection.jsx';
import AccountSection from '@/platform/home/AccountSection.jsx';
import AboutSection from '@/platform/home/AboutSection.jsx';
import HandleField from '@/platform/social/HandleField.jsx';
import ProfileTour from '@/components/tour/ProfileTour.jsx';
import { useAccountProgress } from '@/platform/home/accountProgress.js';
import { useAccount, useReducedMotion } from '@/components/shell/hooks.js';
import '@/styles/hubhome.css';
import '@/styles/x-profile.css';
import '@/styles/store-account.css';
import IndiaArt from '@/components/art/IndiaArt.jsx';
import '@/platform/home/adda.css';

const JUMPS = [
  { id: 'games', label: 'Games' },
  { id: 'matches', label: 'Matches' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'invite', label: 'Invite' },
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

/** `/profile`: identity (level ring, coins, streak, daily reward), per-game stats, recent matches, achievements, the invite card, badges, settings, account. */
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
    <div className="hub-page hh2 hh2-profilepage adda-profile-page xp-page sa-profile st-scope">
      <h1 className="hub-sr">Your profile</h1>
      <ProfileTour />
      <div className="adda-profile-intro">
        {loading ? <ProfileSkeleton /> : <ProfileHeader />}
        <IndiaArt art="kolkata" className="adda-profile-intro__art" />
      </div>
      <nav className="sa-jump" aria-label="Profile sections">
        {JUMPS.map((j) => (
          <a key={j.id} href={`#${j.id}`} className="st-chip sa-jump__chip" onClick={(e) => jump(e, j.id)}>
            {j.label}
          </a>
        ))}
      </nav>
      {isStaff(user) ? (
        <p className="sa-staff">
          <Link to={paths.admin()} className="hub-btn hub-btn--ghost">
            Admin console
          </Link>
        </p>
      ) : null}
      <div className="xp-procols">
        <GameStatCards games={games} user={user} />
        <RecentMatches signedIn={signedIn} lead={lead} />
      </div>
      <AchievementsGrid />
      <ReferralCard />
      <BadgeGrid games={games} user={user} level={level} />
      <SettingsSection />
      <HandleField />
      <div className="hh2-duo">
        <AccountSection />
        <AboutSection />
      </div>
    </div>
  );
}
