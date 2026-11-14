import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { featured, liveList } from '@/platform/home/catalog.js';
import ProfileHeader from '@/platform/home/ProfileHeader.jsx';
import GameStatCards, { RecentMatches } from '@/platform/home/GameStatCards.jsx';
import BadgeGrid from '@/platform/home/BadgeGrid.jsx';
import SettingsSection from '@/platform/home/SettingsSection.jsx';
import AccountSection from '@/platform/home/AccountSection.jsx';
import AboutSection from '@/platform/home/AboutSection.jsx';
import { useAccount, useProgress } from '@/components/shell/hooks.js';
import '@/styles/hubhome.css';
import '@/styles/x-profile.css';

/**
 * `/profile` — avatar (frame, title, level ring), coins, per-game stats, recent matches, badges, settings (the old
 * Settings page) and account.
 */
export default function Profile() {
  const { hash } = useLocation();
  const { user, signedIn } = useAccount();
  const { level } = useProgress();
  const games = useMemo(liveList, []);
  const lead = useMemo(featured, []);

  // `/profile#settings` (the old /settings link target) scrolls to the settings block.
  useEffect(() => {
    if (!hash) return undefined;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }), 60);
    return () => clearTimeout(t);
  }, [hash]);

  return (
    <div className="hub-page hh2 hh2-profilepage xp-page">
      <h1 className="hub-sr">Your profile</h1>
      <ProfileHeader />
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
