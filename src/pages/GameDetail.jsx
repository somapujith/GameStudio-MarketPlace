import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import GameTour from '@/components/tour/GameTour.jsx';
import CodeSheet from '@/components/shell/nav/CodeSheet.jsx';
import { radioKeyNav } from '@/components/shell/ui.jsx';
import MapPicker from '@/components/online/MapPicker.jsx';
import { getCategory, getGame } from '@/games/registry.js';
import { useAuth } from '@/lib/auth.jsx';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { MobileBar, ShareButton, SoonPanel, createCopy } from '@/platform/game/ActionPanel.jsx';
import MapsSection from '@/platform/game/MapsSection.jsx';
import { DEFAULT_MAP } from '@/components/online/mapModel.js';
import { AboutSection, DetailsTable, GallerySection, HowToPlay, LeaderboardSection, OpenTables, RelatedGames, openTableList, useOpenRooms } from '@/platform/game/DetailSections.jsx';
import { GameHead, HeroArt, categoryHref } from '@/platform/game/GameHero.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Unavailable from '@/platform/game/Unavailable.jsx';
import { themeVars } from '@/platform/game/color.js';
import { gameJsonLd, hasMaps, metaDescription, sectionList } from '@/platform/game/detailModel.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { defaultSeats, seatOptions } from '@/platform/game/seats.js';
import useHostRoom from '@/platform/game/useHostRoom.js';
import '@/styles/store-detail.css';
import '@/platform/game/nawabi-detail.css';

/** Games › Category › Name. */
function Crumbs({ game }) {
  const cat = getCategory(game.category);
  return (
    <nav className="gd-crumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <Link to={paths.games()}>
            <HubIcon name="chevL" size={16} /> Games
          </Link>
        </li>
        {cat && (
          <li>
            <Link to={categoryHref(cat)}>{cat.label}</Link>
          </li>
        )}
        <li aria-current="page">
          <span>{game.name}</span>
        </li>
      </ol>
    </nav>
  );
}

function Crown() {
  return <svg className="nawabi-poster__crown" width="100" height="85" viewBox="0 0 100 85" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 33 12 39 57-5 8-43-26 26-17-40-10 43zM26 80l52-5" /><circle cx="12" cy="28" r="4" /><circle cx="46" cy="6" r="4" /><circle cx="90" cy="19" r="4" /></g></svg>;
}

function TableDice() {
  return <svg className="nawabi-ticket__dice" width="55" height="48" viewBox="0 0 55 48" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round"><path d="m5 20 15-8 15 8v18l-15 8-15-8zM5 20l15 8 15-8M20 28v18M31 8l10-6 12 7v17l-10 6" /></g><g fill="currentColor"><circle cx="15" cy="20" r="1.8" /><circle cx="24" cy="20" r="1.8" /><circle cx="12" cy="29" r="1.8" /><circle cx="13" cy="36" r="1.8" /><circle cx="27" cy="31" r="1.8" /><circle cx="27" cy="38" r="1.8" /><circle cx="40" cy="9" r="1.8" /><circle cx="46" cy="15" r="1.8" /><circle cx="47" cy="23" r="1.8" /></g></svg>;
}

/** Anchor nav for the page's sections, with the section in view marked. */
function SubNav({ items }) {
  const [active, setActive] = useState(items[0]?.id || '');
  const key = items.map((i) => i.id).join('|');
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return undefined;
    const ids = key ? key.split('|') : [];
    const seen = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => seen.set(e.target.id, e.isIntersecting));
        const first = ids.find((id) => seen.get(id));
        if (first) setActive(first);
      },
      { rootMargin: '-25% 0px -60% 0px' },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [key]);

  if (items.length < 2) return null;
  return (
    <nav className="gd-subnav" aria-label="On this page" data-tour="game-subnav">
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <a href={`#${it.id}`} className="gd-subnav__a" aria-current={active === it.id ? 'location' : undefined}>
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** In-page `#gd-*` links scroll smoothly (instantly under reduced motion) and move focus to the section heading. */
function useJumpLinks() {
  return useCallback((e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="#gd-"]') : null;
    if (!a) return;
    const sec = document.getElementById(a.getAttribute('href').slice(1));
    if (!sec) return;
    e.preventDefault();
    const reduce = document.documentElement.dataset.motion === 'reduced' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    sec.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    sec.querySelector('h2')?.focus({ preventScroll: true });
  }, []);
}

/** `<title>`, description, canonical + Open Graph tags and schema.org data for one game. */
function useGameMeta(game, soon) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const path = paths.game(game.id);
  useDocTitle(soon ? `${game.name} (coming soon) · ${BRAND.name}` : `Play ${game.name} online · ${BRAND.name}`, {
    description: metaDescription(game),
    path,
    jsonLd: gameJsonLd(game, origin ? `${origin}${path}` : ''),
  });
}

/**
 * A playable game's listing: framed release artwork and quick start with seats, map,
 * Create table, Join with a code and Share, using the private-room host and code-join flows), then About, Maps,
 * How to play, Gallery, Open tables, Leaderboard, Game details and More like this. A phone bar offers Create table
 * once the ticket has scrolled away.
 */
function LiveDetail({ game }) {
  useGameMeta(game, false);
  const { host, busy } = useHostRoom(game);
  const auth = useAuth() || {};
  const { user, loading: authLoading, reachable } = auth;
  const [codeOpen, setCodeOpen] = useState(false);
  const options = seatOptions(game.players);
  const [seats, setSeats] = useState(() => defaultSeats(options));
  const panelRef = useRef(null);
  const rooms = useOpenRooms(game.id);
  const tables = rooms.status === 'ok' ? openTableList(rooms.rooms, game.id).length : undefined;
  const jump = useJumpLinks();
  const [mapId, setMapId] = useState(DEFAULT_MAP); // the map the table will start on (games with maps only)
  const hostOn = useCallback((o) => host({ ...o, map: mapId }), [host, mapId]);
  const create = () => hostOn({ maxPlayers: seats });
  const nav = sectionList(game, { live: true });
  const copy = createCopy({ user, authLoading, reachable, busy, game });

  return (
    <>
      <div className="hub-page hub-detail nawabi-page" onClick={jump}>
        <GameTour game={game} />
        <Crumbs game={game} />
        <div className="nawabi-layout">
          <section className="nawabi-poster" aria-label={`About ${game.name}`}>
            <div className="nawabi-poster__identity">
              <p className="nawabi-poster__edition"><span>01 / THE JALEBI COLLECTION</span><span className="nawabi-poster__available"><i aria-hidden="true" /> PLAYABLE NOW</span></p>
              <Crown />
              <h1 className="nawabi-poster__title" aria-label={game.name}><span>{game.name.split(' ').slice(0, -1).join(' ')}</span><strong>{game.name.split(' ').at(-1)}</strong></h1>
              <p className="nawabi-poster__pitch">{game.tagline}</p>
            </div>
            <figure className="nawabi-poster__art">
              <img className="nawabi-page__scene" src="/art/cinematic/nawabi-setup.webp" width="2048" height="1024" alt="" fetchPriority="high" decoding="async" />
              <figcaption><span>{game.name} / Jalebi Games</span><span>Multiplayer. In your browser.</span></figcaption>
            </figure>
            <dl className="nawabi-poster__facts">
              <div><HubIcon name="users" size={40} /><div><dt>Players</dt><dd>{game.players.min} &ndash; {game.players.max}</dd></div></div>
              <div><HubIcon name="clock" size={40} /><div><dt>Minutes</dt><dd>{game.duration.replace(/\s*min$/, '')}</dd></div></div>
              {tables > 0 && <div><i className="st-live" aria-hidden="true" /><div><dt>Open now</dt><dd>{tables} {tables === 1 ? 'table' : 'tables'}</dd></div></div>}
            </dl>
            {game.mapsLine && <p className="hh2-gcard__maps nawabi-poster__maps">{game.mapsLine}</p>}
          </section>
          <section className="nawabi-ticket" ref={panelRef} aria-labelledby="nawabi-create-title" data-tour="game-panel">
            <header className="nawabi-ticket__head">
              <p><span className="nawabi-ticket__index">01</span> Your next game starts here</p>
              <h2 id="nawabi-create-title">Create a table</h2>
            </header>
            <div className="nawabi-ticket__step" data-tour="game-seats">
              <h3 id="hub-seats-h">
                How many players?
              </h3>
              <div className="nawabi-ticket__seats" role="radiogroup" aria-labelledby="hub-seats-h" onKeyDown={radioKeyNav}>
                {options.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={n === seats}
                    className={n === seats ? 'is-on' : undefined}
                    tabIndex={n === seats ? 0 : -1}
                    onClick={() => setSeats(n)}
                    disabled={busy}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {hasMaps(game) && (
              <div className="nawabi-ticket__step nawabi-ticket__map" data-tour="game-map">
                <MapPicker compact isHost value={mapId} onPick={(patch) => setMapId(patch.map)} disabled={busy} label="Map" />
              </div>
            )}

            <button type="button" className="nawabi-ticket__create" data-tour="game-create" onClick={create} disabled={busy || (authLoading && !user)} aria-busy={busy || undefined}>
              <span className="nawabi-ticket__create-label"><TableDice />{copy.label}</span><span className="nawabi-ticket__launch" aria-hidden="true"><HubIcon name="arrowR" size={26} /></span>
            </button>
            {copy.signedOut && !copy.offline && (
              <Link to={paths.login(paths.game(game.id))} className="nawabi-ticket__signin">
                Sign in or continue as a guest <HubIcon name="arrowR" size={16} />
              </Link>
            )}
            {copy.offline && (
              <p className="nawabi-ticket__offline" role="status">
                <HubIcon name="wifiOff" size={16} /> Can't reach the server right now. Check your connection and try again.
              </p>
            )}
            <div className="nawabi-ticket__or" aria-hidden="true"><span />Or<span /></div>
            <button type="button" className="nawabi-ticket__join" data-tour="game-join" onClick={() => setCodeOpen(true)} aria-haspopup="dialog">
              <HubIcon name="hash" size={26} /> Join with a code
            </button>
            <p className="nawabi-ticket__hint">Have a code from your friend? Enter it to join their game.</p>
            <ShareButton game={game} className="nawabi-ticket__share" />
          </section>
        </div>
      </div>

      <div className="hub-page gd nawabi-more" style={themeVars(game.theme)} onClick={jump}>
        <div className="gd-main">
          <SubNav items={nav} />
          <AboutSection game={game} index={0} />
          <MapsSection game={game} index={1} />
          <HowToPlay game={game} index={1} />
          <GallerySection game={game} index={2} />
          <OpenTables game={game} state={rooms} onCreate={create} busy={busy} index={3} />
          <LeaderboardSection game={game} user={user} index={4} />
          <DetailsTable game={game} index={5} />
        </div>
        <RelatedGames game={game} />
        <MobileBar game={game} seats={seats} host={hostOn} busy={busy} user={user} authLoading={authLoading} panelRef={panelRef} />
        <CodeSheet open={codeOpen} onClose={() => setCodeOpen(false)} />
      </div>
    </>
  );
}

/** A coming-soon teaser: the same shopfront, with What to expect, Notify me and a way to play something else. */
function SoonDetail({ game }) {
  useGameMeta(game, true);
  const jump = useJumpLinks();
  const nav = sectionList(game, { live: false });
  return (
    <div className="hub-page gd gd--soon" style={themeVars(game.theme)} onClick={jump}>
      <Crumbs game={game} />
      <div className="gd-grid">
        <HeroArt game={game} soon />
        <aside className="gd-aside">
          <div className="gd-aside__in">
            <GameHead game={game} soon />
            <SoonPanel game={game} />
          </div>
        </aside>
        <div className="gd-main">
          <SubNav items={nav} />
          <AboutSection game={game} soon index={0} />
          <GallerySection game={game} index={1} />
          <DetailsTable game={game} index={2} />
        </div>
      </div>
      <RelatedGames game={game} />
    </div>
  );
}

/** /games/:gameId: a live game is a store listing (details + start a table), a coming-soon game a teaser. */
export default function GameDetail() {
  const { gameId } = useParams();
  const game = getGame(gameId);
  if (!game) return <Unavailable reason="unknown" query={gameId} />;
  return game.status === 'coming_soon' ? <SoonDetail key={game.id} game={game} /> : <LiveDetail key={game.id} game={game} />;
}
