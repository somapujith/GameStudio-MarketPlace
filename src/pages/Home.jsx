import { useEffect, useMemo, useState } from 'react';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { liveList, soonList } from '@/platform/home/catalog.js';
import Hero from '@/platform/home/Hero.jsx';
import TopPlayers from '@/platform/home/TopPlayers.jsx';
import Rail from '@/platform/home/store/Rail.jsx';
import PlayCard from '@/platform/home/store/PlayCard.jsx';
import LiveStrip from '@/platform/home/store/LiveStrip.jsx';
import HowItWorks from '@/platform/home/store/HowItWorks.jsx';
import CategoryTiles, { categoryTiles } from '@/platform/home/store/CategoryTiles.jsx';
import { LiveProvider, useHomeLive } from '@/platform/home/store/live.js';
import FriendsStrip from '@/components/shell/home/FriendsStrip.jsx';
import DailyReward from '@/components/shell/home/DailyReward.jsx';
import OpenTables from '@/components/shell/home/OpenTables.jsx';
import { useAccount, useReducedMotion } from '@/components/shell/hooks.js';
import '@/styles/hubhome.css';
import '@/styles/x-home.css';
import '@/styles/store-home.css';

// The staggered entrance plays once per visit to the app, not on every return to Home.
let enteredOnce = false;

/**
 * `/` — the storefront: spotlight hero, a live strip (open tables, friends online, your running table), "Play now",
 * open tables, friends, "By category", a "Coming soon" shelf, top players and the daily reward. A visitor with no
 * session also gets a three-step "how it works" with Sign in / Play as guest.
 */
export default function Home() {
  const reduced = useReducedMotion();
  const [enter] = useState(() => !enteredOnce && !reduced);
  useEffect(() => {
    enteredOnce = true;
  }, []);

  const live = useHomeLive();
  const { user, loading } = useAccount();
  const noSession = !loading && !user;

  const games = useMemo(() => liveList(), []);
  const soon = useMemo(() => soonList().filter((g) => !games.some((l) => l.id === g.id)), [games]);
  const tiles = useMemo(() => categoryTiles(), []);

  let i = 0;
  const rise = () => ({ className: enter ? 'st-reveal' : undefined, style: { '--i': i++ } });

  return (
    <LiveProvider value={live}>
      <div className="hub-page hh2 hh2-home xh-home sh-home">
        <h1 className="hub-sr">{BRAND.name} games</h1>

        <div {...rise()}>
          <Hero />
        </div>
        <div {...rise()}>
          <LiveStrip live={live} />
        </div>

        {noSession && (
          <div {...rise()}>
            <HowItWorks />
          </div>
        )}

        {games.length > 0 && (
          <div {...rise()}>
            <Rail
              eyebrow="Ready to play"
              title="Play now"
              sub="Pick a game and start a table in seconds."
              moreTo={paths.games()}
              moreLabel="All games"
              count={games.length}
              solo={games.length === 1}
              label="Games you can play now"
            >
              {games.map((g) => (
                <li key={g.id}>
                  <PlayCard game={g} solo={games.length === 1} tables={live.perGame[g.id] || 0} />
                </li>
              ))}
            </Rail>
          </div>
        )}

        <div {...rise()}>
          <OpenTables />
        </div>

        {(!noSession || loading) && (
          <div {...rise()}>
            <FriendsStrip />
          </div>
        )}

        {tiles.length > 0 && (
          <div {...rise()}>
            <Rail eyebrow="Browse" title="By category" sub="Board, card, word and more." moreTo={paths.games()} moreLabel="All games" bare>
              <CategoryTiles tiles={tiles} />
            </Rail>
          </div>
        )}

        {soon.length > 0 && (
          <div {...rise()}>
            <Rail
              eyebrow="On the way"
              title="Coming soon"
              sub="Tap Notify me and we will flag it for you here."
              count={soon.length}
              label="Coming soon games"
            >
              {soon.map((g) => (
                <li key={g.id}>
                  <PlayCard game={g} />
                </li>
              ))}
            </Rail>
          </div>
        )}

        {games.length === 0 && soon.length === 0 && <p className="hub-muted">New games are on the way. Check back soon.</p>}

        <div {...rise()} className={`${enter ? 'st-reveal ' : ''}hh2-duo xh-duo sh-duo`}>
          <TopPlayers />
          <DailyReward />
        </div>
      </div>
    </LiveProvider>
  );
}
