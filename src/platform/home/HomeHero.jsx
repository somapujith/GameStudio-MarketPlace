// The home hero: a full-bleed carousel of the games, behind the floating nav (docs/CINE_UI.md). Live games first (Play),
// then the coming-soon teasers (Notify me). Each slide: the backdrop art fading into the canvas, the name in the wide
// display type, a meta row (players, time, category, open tables when there are any), a short description, a white
// pill and a glass group (invite / share, details). It crossfades every 8 seconds, and stops on hover, on focus, in a
// hidden tab, under reduced motion and after the pause button; the dots and Left / Right pick a slide.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import useShareGame from '@/platform/game/useShareGame.js';
import { useNotify } from '@/platform/game/notify.js';
import { useReducedMotion } from '@/components/shell/hooks.js';
import { ArtFill } from '@/platform/browse/GameArt.jsx';
import { categoryLabel, featured, liveList, soonList } from './catalog.js';
import { playersLabel, themeVars } from './gameTheme.js';
import { useLive } from './store/live.js';

const ADVANCE_MS = 8000;

/** Featured live game first, the other live games, then the teasers. */
export function heroSlides() {
  const lead = featured();
  const live = liveList();
  const ordered = lead ? [lead, ...live.filter((g) => g.id !== lead.id)] : live;
  return [...ordered, ...soonList().filter((g) => !ordered.some((l) => l.id === g.id))];
}

const firstParagraph = (text) =>
  String(text || '')
    .split(/\n{2,}/)[0]
    .trim();

function NotifyPill({ game }) {
  const [on, toggle] = useNotify(game.id);
  return (
    <button type="button" className="cj-btn cj-btn--primary cj-btn--lg" aria-pressed={on} onClick={toggle}>
      <HubIcon name={on ? 'check' : 'bell'} size={20} />
      {on ? 'On the list' : 'Notify me'}
    </button>
  );
}

function Actions({ game, active }) {
  const share = useShareGame(game);
  const soon = game.status === 'coming_soon';
  const tab = active ? undefined : -1;
  let primary;
  if (soon) primary = <NotifyPill game={game} />;
  else if (game.solo)
    primary = (
      <a href={paths.solo(game.id)} className="cj-btn cj-btn--primary cj-btn--lg" tabIndex={tab}>
        <HubIcon name="play" size={20} /> Play
      </a>
    );
  else
    primary = (
      <Link to={paths.game(game.id)} className="cj-btn cj-btn--primary cj-btn--lg" tabIndex={tab}>
        <HubIcon name="play" size={20} /> Play
      </Link>
    );
  return (
    <div className="cj-home-hero__actions film-hero__actions">
      {primary}
      <div className="cj-btngroup">
        <button type="button" onClick={share} aria-label={soon ? `Share ${game.name}` : `Invite friends to ${game.name}`} title={soon ? 'Share' : 'Invite friends'} tabIndex={tab}>
          <HubIcon name={soon ? 'share' : 'plus'} size={22} />
        </button>
        <Link to={paths.game(game.id)} aria-label={`${game.name} details`} title="Details" tabIndex={tab}>
          <HubIcon name="info" size={22} />
        </Link>
      </div>
    </div>
  );
}

function Slide({ game, index, count, active, tables, eager }) {
  const soon = game.status === 'coming_soon';
  const players = playersLabel(game.players);
  const cat = categoryLabel(game.category);
  return (
    <div
      className={`cj-home-slide ${active ? 'is-on' : ''}`}
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${count}: ${game.name}`}
      aria-hidden={active ? undefined : true}
      inert={active ? undefined : true}
      style={themeVars(game)}
    >
      <div className="cj-home-slide__art" aria-hidden="true">
        <ArtFill game={game} backdrop eager={eager} />
      </div>
      <div className="cj-home-slide__copy">
        {soon && <p className="cj-home-slide__kicker">Coming soon</p>}
        <h2 className="cj-title-art cj-home-slide__title">{game.name}</h2>
        <ul className="cj-meta cj-home-slide__meta">
          {players && (
            <li>
              <HubIcon name="users" size={16} />
              {players}
            </li>
          )}
          {game.duration && (
            <li>
              <HubIcon name="clock" size={16} />
              {game.duration}
            </li>
          )}
          {cat && <li>{cat}</li>}
          {!soon && Number(tables) > 0 && (
            <li className="cj-home-slide__tables">
              <i className="cj-live-dot" aria-hidden="true" />
              {tables} open {tables === 1 ? 'table' : 'tables'}
            </li>
          )}
        </ul>
        <p className="cj-home-slide__desc">{firstParagraph(game.description) || game.tagline}</p>
        <Actions game={game} active={active} />
      </div>
    </div>
  );
}

export default function HomeHero() {
  const slides = useMemo(heroSlides, []);
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [stopped, setStopped] = useState(false); // the pause button
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const reduced = useReducedMotion();
  const live = useLive();
  const perGame = live?.perGame || {};
  const root = useRef(null);

  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const running = count > 1 && !stopped && !reduced;
  const moving = running && !hover && !focus && !hidden;
  useEffect(() => {
    if (!moving) return undefined;
    const t = setTimeout(() => setIndex((i) => (i + 1) % count), ADVANCE_MS);
    return () => clearTimeout(t);
  }, [moving, index, count]);

  const go = useCallback((i) => setIndex(((i % count) + count) % count), [count]);
  const onKey = (e) => {
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
    else return;
    e.preventDefault();
  };
  const onBlur = (e) => {
    if (!root.current?.contains(e.relatedTarget)) setFocus(false);
  };

  if (!count) return null;
  return (
    <section
      ref={root}
      className="cj-home-hero"
      aria-roledescription="carousel"
      aria-label={`${BRAND.name}: featured games`}
      data-tour="home-hero"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={onBlur}
    >
      <h1 className="hub-sr">{BRAND.name}: games to play with friends</h1>
      <div className="cj-home-hero__slides" aria-live={moving ? 'off' : 'polite'}>
        {slides.map((g, i) => (
          <Slide key={g.id} game={g} index={i} count={count} active={i === index} tables={perGame[g.id]} eager={i === 0} />
        ))}
      </div>
      {count > 1 && (
        <div className="cj-home-hero__controls" role="group" aria-label="Choose a featured game" onKeyDown={onKey}>
          {!reduced && (
            <button type="button" className="cj-home-hero__pause" onClick={() => setStopped((s) => !s)} aria-label={stopped ? 'Play the slideshow' : 'Pause the slideshow'}>
              {stopped ? (
                <HubIcon name="play" size={14} />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              )}
            </button>
          )}
          <ul className="cj-dots">
            {slides.map((g, i) => (
              <li key={g.id}>
                <button type="button" aria-label={`Show ${g.name}`} aria-current={i === index ? 'true' : undefined} onClick={() => go(i)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
