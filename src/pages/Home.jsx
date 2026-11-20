import { useMemo } from 'react';
import { paths } from '@/platform/paths.js';
import Hero from '@/platform/home/Hero.jsx';
import TopPlayers from '@/platform/home/TopPlayers.jsx';
import Rail from '@/platform/home/store/Rail.jsx';
import LiveStrip from '@/platform/home/store/LiveStrip.jsx';
import HowItWorks from '@/platform/home/store/HowItWorks.jsx';
import CategoryTiles, { categoryTiles } from '@/platform/home/store/CategoryTiles.jsx';
import { LiveProvider, useHomeLive } from '@/platform/home/store/live.js';
import HomeTour from '@/components/tour/HomeTour.jsx';
import FriendsStrip from '@/components/shell/home/FriendsStrip.jsx';
import DailyReward from '@/components/shell/home/DailyReward.jsx';
import OpenTables from '@/components/shell/home/OpenTables.jsx';
import { useAccount } from '@/components/shell/hooks.js';
import IndiaArt from '@/components/art/IndiaArt.jsx';
import '@/styles/hubhome.css';
import '@/styles/x-home.css';
import '@/styles/store-home.css';
import '@/platform/home/street-home.css';

const CITY_PRINTS = [['mumbai', 'MUMBAI', 'Gateway of India'], ['jaipur', 'JAIPUR', 'Hawa Mahal'], ['chennai', 'CHENNAI', 'Chennai Central'], ['kolkata', 'KOLKATA', 'Howrah Bridge']];

/**
 * `/` — the Jalebi street-poster home: the cinematic hero with the game shelf (live table counts on each tile), a
 * live strip (open tables, friends online, your running table), open tables to join, city postcards, The Adda
 * (friends), "By category" (links into Browse) and Gully Legends (top players + the daily reward). A visitor with
 * no session also gets a three-step "how it works" with Sign in / Play as guest. One set of live requests is shared
 * through <LiveProvider>; the first-run tour points at the `data-tour` anchors.
 */
export default function Home() {
  const live = useHomeLive();
  const { user, loading } = useAccount();
  const noSession = !loading && !user;
  const tiles = useMemo(() => categoryTiles(), []);

  return (
    <LiveProvider value={live}>
      <div className="hub-page hh2 hh2-home xh-home street-home film-home">
        <HomeTour />
        <Hero />
        <div className="film-section street-live" data-tour="home-live">
          <LiveStrip live={live} />
        </div>
        {noSession && (
          <div className="film-section street-how" data-tour="home-how">
            <HowItWorks />
          </div>
        )}
        <div className="film-section street-tables" data-tour="home-tables">
          <OpenTables />
        </div>
        <section className="street-prints film-section" aria-labelledby="street-prints-title">
          <div className="street-prints__intro"><p className="street-home__eyebrow">Postcards from the gully</p><h2 id="street-prints-title">LOCAL COLOUR.<br /><span>ALL OVER.</span></h2><p>Landmarks in ink. A little piece of home.</p></div>
          <div className="street-prints__collection">{CITY_PRINTS.map(([art, city, landmark]) => <figure className={`street-print street-print--${art}`} key={art}><IndiaArt art={art} className="street-print__art" decorative /><figcaption><b>{city}</b><span>{landmark}</span></figcaption></figure>)}</div>
        </section>
        <FriendsStrip />
        {tiles.length > 0 && (
          <div className="film-section street-cats" data-tour="home-categories">
            <Rail eyebrow="Browse" title="By category" sub="Board, card, word and more." moreTo={paths.games()} moreLabel="All games" bare>
              <CategoryTiles tiles={tiles} />
            </Rail>
          </div>
        )}
        <section className="street-legends film-section" aria-labelledby="street-legends-title"><header className="street-legends__head"><p className="street-home__eyebrow">Good games deserve good company</p><h2 id="street-legends-title">GULLY <span>LEGENDS.</span></h2></header><div className="hh2-duo street-legends__content"><TopPlayers /><DailyReward /></div></section>
      </div>
    </LiveProvider>
  );
}
