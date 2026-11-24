import HomeHero from '@/platform/home/HomeHero.jsx';
import { AchievementsRow, HowItWorks, PlayRow, SoonRow, Top10Row } from '@/platform/home/HomeRows.jsx';
import LiveStrip from '@/platform/home/store/LiveStrip.jsx';
import { LiveProvider, useHomeLive } from '@/platform/home/store/live.js';
import HomeTour from '@/components/tour/HomeTour.jsx';
import FriendsStrip from '@/components/shell/home/FriendsStrip.jsx';
import DailyReward from '@/components/shell/home/DailyReward.jsx';
import OpenTables from '@/components/shell/home/OpenTables.jsx';
import { useAccount } from '@/components/shell/hooks.js';
// The daily-reward card (another area's component) still draws with the shared .hh2-daily / .xh-* classes.
import '@/styles/hubhome.css';
import '@/styles/x-home.css';
import '@/styles/cine/home.css';

/**
 * `/` in the cine skin (docs/CINE_UI.md): a full-bleed hero carousel of the games behind the floating nav, the live
 * chips (your running table, open tables, friends online), then rows: Play now, How it works (a
 * visitor with no session), Top 10 on Jalebi today, Open tables, Friends online, the daily reward, Coming soon and
 * Achievements to chase. One set of live requests is shared through <LiveProvider>; the first-run tour points at the
 * `data-tour` anchors.
 */
export default function Home() {
  const live = useHomeLive();
  const { user, loading } = useAccount();
  const noSession = !loading && !user;

  return (
    <LiveProvider value={live}>
      <div className="hub-page cj-home">
        <HomeTour />
        <HomeHero />
        <div className="cj-home-rows">
          <div className="cj-home-livewrap" data-tour="home-live">
            <LiveStrip live={live} />
          </div>
          <PlayRow />
          {noSession && <HowItWorks />}
          <Top10Row />
          <OpenTables />
          <FriendsStrip />
          <section className="cj-section cj-home-daily" aria-label="Daily reward">
            <DailyReward />
          </section>
          <SoonRow />
          <AchievementsRow />
        </div>
      </div>
    </LiveProvider>
  );
}
