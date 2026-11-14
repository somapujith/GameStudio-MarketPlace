import { useEffect, useMemo, useState } from 'react';
import { BRAND } from '@/platform/brand.js';
import { homeCatalog, SOON_ID } from '@/platform/home/catalog.js';
import Hero from '@/platform/home/Hero.jsx';
import CategoryChips from '@/platform/home/CategoryChips.jsx';
import CategoryRow from '@/platform/home/CategoryRow.jsx';
import TopPlayers from '@/platform/home/TopPlayers.jsx';
import FriendsStrip from '@/components/shell/home/FriendsStrip.jsx';
import DailyReward from '@/components/shell/home/DailyReward.jsx';
import ResumeCard from '@/components/shell/home/ResumeCard.jsx';
import OpenTables from '@/components/shell/home/OpenTables.jsx';
import { useReducedMotion } from '@/components/shell/hooks.js';
import '@/styles/hubhome.css';
import '@/styles/x-home.css';

// The staggered entrance plays once per visit to the app, not on every return to Home.
let enteredOnce = false;

/**
 * `/` — the Games home: resume your game, featured hero (live table count), open tables, friends,
 * browse (live games by category + one "Coming soon" row), top players and the daily reward.
 */
export default function Home() {
  const reduced = useReducedMotion();
  const [enter] = useState(() => !enteredOnce && !reduced);
  useEffect(() => {
    enteredOnce = true;
  }, []);

  const { cats, soon } = useMemo(homeCatalog, []);
  const chips = useMemo(() => (soon ? [...cats, soon] : cats), [cats, soon]);
  const [cat, setCat] = useState('all');
  const active = chips.some((g) => g.id === cat) ? cat : 'all';
  const showCats = active === 'all' ? cats : cats.filter((g) => g.id === active);
  const showSoon = !!soon && (active === 'all' || active === SOON_ID);
  const shownCount = showCats.length + (showSoon ? 1 : 0);

  let i = 0;
  const rise = () => ({ className: 'xh-rise', style: { '--i': i++ } });

  return (
    <div className={`hub-page hh2 hh2-home xh-home ${enter ? 'xh-enter' : ''}`}>
      <h1 className="hub-sr">{BRAND.name} games</h1>
      <ResumeCard />
      <div {...rise()}>
        <Hero />
      </div>
      <div {...rise()}>
        <OpenTables />
      </div>
      <div {...rise()}>
        <FriendsStrip />
      </div>

      <section {...rise()} className="hub-section hh2-browse xh-rise" aria-labelledby="hh2-browse-h">
        <div className="hub-section__head">
          <h2 id="hh2-browse-h" className="hub-section__title">
            Browse games
          </h2>
        </div>
        {chips.length > 1 && <CategoryChips cats={chips} value={active} onChange={setCat} />}
        {chips.length === 0 ? (
          <p className="hub-muted">New games are on the way. Check back soon.</p>
        ) : (
          <div className="hh2-cats" data-single={shownCount === 1 ? 'true' : 'false'}>
            {showCats.map((g) => (
              <CategoryRow key={g.id} cat={g} games={g.games} />
            ))}
            {showSoon && (
              <CategoryRow cat={soon} games={soon.games} className="xh-soonrow" note="In the works. Tap Notify me and we will flag them for you here." />
            )}
          </div>
        )}
      </section>

      <div {...rise()} className="hh2-duo xh-duo xh-rise">
        <TopPlayers />
        <DailyReward />
      </div>
    </div>
  );
}
