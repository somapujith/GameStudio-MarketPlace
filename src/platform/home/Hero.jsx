import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { useReducedMotion } from '@/components/shell/hooks.js';
import { featured, groupByCategory, orderedGames } from './catalog.js';
import CategoryChips from './CategoryChips.jsx';
import GameCard from './GameCard.jsx';

/** Live text and controls over the cinematic Hyderabad release artwork. */
export default function Hero() {
  const game = featured();
  const games = useMemo(orderedGames, []);
  const groups = useMemo(groupByCategory, []);
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState(game?.id || games[0]?.id);
  const cards = useRef({});
  const reduced = useReducedMotion();
  const active = groups.some((group) => group.id === category) ? category : 'all';
  const shown = active === 'all' ? games : groups.find((group) => group.id === active)?.games || [];
  const activeId = shown.some((item) => item.id === selected) ? selected : shown[0]?.id;
  const selectCard = (id) => {
    setSelected(id);
    cards.current[id]?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    cards.current[id]?.querySelector('a')?.focus({ preventScroll: true });
  };

  return (
    <section className="street-hero film-hero" aria-label={BRAND.name}>
      <img className="film-hero__scene" src="/art/cinematic/hero.webp" alt="" width="2048" height="1024" fetchPriority="high" decoding="async" />
      <div className="film-hero__shade" aria-hidden="true" />
      <div className="street-hero__message film-hero__message">
        <h1 className="street-hero__headline film-hero__headline"><span>GULLY MADE.</span><span>GAME READY.</span></h1>
        <p className="film-hero__tagline">GAMES FROM HYDERABAD<br />FOR YOUR GANG.<span aria-hidden="true" /></p>
        <div className="street-hero__actions film-hero__actions">
          {game && <Link to={paths.game(game.id)} className="street-hero__play film-ticket"><span aria-hidden="true">&#9654;</span>{game.status === 'live' ? 'PLAY NOW' : 'EXPLORE GAME'}</Link>}
          <a className="street-hero__explore film-explore" href="#games">EXPLORE GAMES <span aria-hidden="true">&#8594;</span></a>
        </div>
      </div>
      <div id="games" className="film-hero__arcade" tabIndex={-1}>
        <h2 className="hub-sr">Choose your game</h2>
        <ul className="film-shelf" aria-label="Games" style={{ gridTemplateColumns: shown.map((_, i) => i === 0 ? '1.3fr' : 'minmax(0, 1fr)').join(' ') }}>
          {shown.map((item) => <li key={item.id} ref={(node) => { cards.current[item.id] = node; }} onFocus={() => setSelected(item.id)}><GameCard game={item} selected={activeId === item.id} /></li>)}
        </ul>
        <div className="film-hero__shelf-tools">
          <div className="film-dots" role="group" aria-label="Choose a game tile">
            {shown.map((item) => <button key={item.id} type="button" className={activeId === item.id ? 'is-active' : ''} aria-label={`Show ${item.name} tile`} aria-pressed={activeId === item.id} onClick={() => selectCard(item.id)}><span /></button>)}
          </div>
          <details className="film-filter"><summary>Browse by category</summary><CategoryChips cats={groups} value={active} onChange={setCategory} /></details>
        </div>
      </div>
    </section>
  );
}
