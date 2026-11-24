import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import GameTour from '@/components/tour/GameTour.jsx';
import CodeSheet from '@/components/shell/nav/CodeSheet.jsx';
import { radioKeyNav } from '@/components/shell/ui.jsx';
import MapPicker from '@/components/online/MapPicker.jsx';
import { featuredGame, getCategory, getGame } from '@/games/registry.js';
import { useAuth } from '@/lib/auth.jsx';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { MobileBar, createCopy } from '@/platform/game/ActionPanel.jsx';
import MapsSection from '@/platform/game/MapsSection.jsx';
import { DEFAULT_MAP } from '@/components/online/mapModel.js';
import { AboutSection, DetailsTable, GallerySection, HowToPlay, LeaderboardSection, OpenTables, RelatedGames, openTableList, useOpenRooms } from '@/platform/game/DetailSections.jsx';
import { categoryHref, playersLabel } from '@/platform/game/GameHero.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Unavailable from '@/platform/game/Unavailable.jsx';
import { themeVars } from '@/platform/game/color.js';
import { gameJsonLd, hasMaps, howToPlaySteps, metaDescription, sectionList } from '@/platform/game/detailModel.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { defaultSeats, seatOptions } from '@/platform/game/seats.js';
import { roomsLocked } from '@/platform/game/tutorial.js';
import useHostRoom from '@/platform/game/useHostRoom.js';
import useShareGame from '@/platform/game/useShareGame.js';
import { useNotify } from '@/platform/game/notify.js';
import { ArtFill } from '@/platform/browse/GameArt.jsx';
import '@/styles/mappicker.css';
import '@/styles/cine/detail.css';

/** Games › Category › Name. */
function Crumbs({ game }) {
  const cat = getCategory(game.category);
  return (
    <nav className="cj-detail-crumbs" aria-label="Breadcrumb">
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
    <nav className="cj-detail-subnav" aria-label="On this page" data-tour="game-subnav">
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <a href={`#${it.id}`} className="cj-chip" aria-current={active === it.id ? 'location' : undefined}>
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

const firstParagraph = (text) =>
  String(text || '')
    .split(/\n{2,}/)[0]
    .trim();
const mapNames = (line) => (typeof line === 'string' ? line.replace(/^\s*\d+\s+maps?:\s*/i, '').trim() : '');

/** The info card on the right of the hero: label left, value right (only rows the manifest can fill). */
function Facts({ game, soon }) {
  const rows = [];
  const players = playersLabel(game.players);
  if (players) rows.push(['Players', players]);
  if (game.duration) rows.push(['Match length', game.duration]);
  if (hasMaps(game) && mapNames(game.mapsLine)) rows.push(['Maps', mapNames(game.mapsLine)]);
  if (howToPlaySteps(game).length)
    rows.push([
      'Rules',
      <a key="r" href="#gd-how" className="cj-detail-link">
        How to play
      </a>,
    ]);
  if (soon) rows.push(['Status', 'Coming soon']);
  if (game.ageRating) rows.push(['Age rating', game.ageRating]);
  if (Array.isArray(game.platforms) && game.platforms.length) rows.push(['Plays on', game.platforms.join(', ')]);
  if (game.publisher) rows.push(['Publisher', game.publisher]);
  if (!rows.length) return null;
  return (
    <dl className="cj-facts cj-detail-facts" aria-label={`${game.name} at a glance`}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The title-page hero: the backdrop fading left and down into the canvas; breadcrumbs; the name in the wide display type
 * and a category line; `actions` (the white pill + round icon buttons); `notes` (sign-in / offline); the meta line
 * (players · time · maps · open tables); the tagline and description; `children` (the table setup); the facts card.
 */
function TitleHero({ game, soon = false, tables, actions, notes, children }) {
  const cat = getCategory(game.category);
  const players = playersLabel(game.players);
  const maps = hasMaps(game) ? mapNames(game.mapsLine).split('·').filter(Boolean).length : 0;
  const tags = Array.isArray(game.tags) ? game.tags.filter((t) => typeof t === 'string' && t).slice(0, 2) : [];
  return (
    <section className={`cj-detail-hero${soon ? ' is-soon' : ''}`} aria-labelledby="gd-title">
      <div className="cj-detail-hero__art" aria-hidden="true">
        <ArtFill game={game} backdrop detail eager />
      </div>
      <div className="cj-detail-hero__grid">
        <div className="cj-detail-hero__main">
          <Crumbs game={game} />
          <header className="cj-detail-head" data-tour="game-head">
            {soon && <p className="cj-detail-kicker">Coming soon</p>}
            <h1 id="gd-title" className="cj-title-art cj-detail-title">
              {game.name}
            </h1>
            <p className="cj-detail-cats">
              {cat && (
                <Link to={categoryHref(cat)} aria-label={`More ${cat.label} games`}>
                  {cat.label}
                </Link>
              )}
              {tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </p>
          </header>
          {actions}
          {notes}
          <ul className="cj-meta cj-detail-meta gd-facts" aria-label="Quick facts">
            {soon ? (
              <li className="cj-detail-meta__soon">
                <HubIcon name="spark" size={15} /> Coming soon
              </li>
            ) : (
              <li>
                <i className="cj-live-dot" aria-hidden="true" /> Live
              </li>
            )}
            {players && (
              <li>
                <HubIcon name="users" size={15} /> {players}
              </li>
            )}
            {game.duration && (
              <li>
                <HubIcon name="clock" size={15} /> {game.duration}
              </li>
            )}
            {maps > 0 && (
              <li>
                <HubIcon name="map" size={15} /> {maps} maps
              </li>
            )}
            {game.ageRating && <li title="Age rating">{game.ageRating}</li>}
            {!soon && Number(tables) > 0 && (
              <li>
                <a href="#gd-live" className="cj-detail-meta__tables">
                  {tables} open {Number(tables) === 1 ? 'table' : 'tables'} now
                </a>
              </li>
            )}
          </ul>
          {game.tagline && <p className="cj-detail-tagline">{game.tagline}</p>}
          {game.description && <p className="cj-detail-desc">{firstParagraph(game.description)}</p>}
          {children}
        </div>
        <aside className="cj-detail-hero__side">
          <Facts game={game} soon={soon} />
          <p className="cj-detail-maker">
            <span>{game.publisher || BRAND.name}</span>
          </p>
        </aside>
      </div>
    </section>
  );
}

/**
 * A playable game's title page: the hero with Create table (seats + map in the table setup under it), Join with a code,
 * Invite, Share and Rules, then About, Maps, How to play, Gallery, Open tables, Top players, Game details and More like
 * this. A phone bar offers Create table once the table setup has scrolled away.
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
  const locked = roomsLocked(user, game); // manifest `tutorial.requiredForRooms` and the tutorial is not finished: no tables yet
  const rooms = useOpenRooms(locked ? null : game.id);
  const tables = rooms.status === 'ok' ? openTableList(rooms.rooms, game.id).length : undefined;
  const jump = useJumpLinks();
  const share = useShareGame(game);
  const [mapId, setMapId] = useState(DEFAULT_MAP); // the map the table will start on (games with maps only)
  const hostOn = useCallback((o) => host({ ...o, map: mapId }), [host, mapId]);
  const create = () => hostOn({ maxPlayers: seats });
  const nav = sectionList(game, { live: true, locked });
  const copy = createCopy({ user, authLoading, reachable, busy, game });

  const actions = (
    <div className="cj-detail-actions">
      {locked ? (
        <a href={paths.solo(game.id)} className="cj-btn cj-btn--primary cj-btn--lg" data-tour="game-create">
          <HubIcon name="play" size={20} /> Play tutorial
        </a>
      ) : (
        <button type="button" className="cj-btn cj-btn--primary cj-btn--lg" data-tour="game-create" onClick={create} disabled={busy || (authLoading && !user)} aria-busy={busy || undefined}>
          <HubIcon name="play" size={20} /> {copy.label}
        </button>
      )}
      {!locked && game.loaders?.soloGame && (
        <a href={paths.solo(game.id)} className="cj-btn cj-btn--lg">
          <HubIcon name="play" size={20} /> Play solo / practice
        </a>
      )}
      {!locked && (
        <button type="button" className="cj-iconbtn" data-tour="game-join" onClick={() => setCodeOpen(true)} aria-haspopup="dialog" aria-label="Join with a code" title="Join with a code">
          <HubIcon name="hash" size={20} />
        </button>
      )}
      {!locked && (
        <Link to={paths.friends()} className="cj-iconbtn" aria-label="Invite friends" title="Invite friends">
          <HubIcon name="users" size={20} />
        </Link>
      )}
      <button type="button" className="cj-iconbtn" data-tour="game-share" onClick={share} aria-label={`Share ${game.name}`} title="Share">
        <HubIcon name="share" size={20} />
      </button>
      {howToPlaySteps(game).length > 0 && (
        <a href="#gd-how" className="cj-iconbtn" aria-label="Rules: how to play" title="How to play">
          <HubIcon name="book" size={20} />
        </a>
      )}
    </div>
  );
  const notes = (
    <>
      {locked && (
        <p className="cj-detail-hint cj-detail-lock" role="status">
          <HubIcon name="lock" size={16} /> Finish the tutorial to open a table with friends
        </p>
      )}
      {copy.signedOut && !copy.offline && (
        <Link to={paths.login(paths.game(game.id))} className="cj-detail-signin">
          Sign in or continue as a guest <HubIcon name="arrowR" size={15} />
        </Link>
      )}
      {copy.offline && (
        <p className="cj-detail-offline" role="status">
          <HubIcon name="wifiOff" size={16} /> Can't reach the server right now. Check your connection and try again.
        </p>
      )}
    </>
  );

  return (
    <div className="hub-page cj-detail" style={themeVars(game.theme)} onClick={jump}>
      <GameTour game={game} />
      <TitleHero game={game} tables={tables} actions={actions} notes={notes}>
        {!locked && (
        <section className="cj-detail-setup" ref={panelRef} aria-labelledby="nawabi-create-title" data-tour="game-panel">
          <h2 id="nawabi-create-title" className="cj-detail-setup__title">
            Table setup
          </h2>
          <div className="cj-detail-setup__row" data-tour="game-seats">
            <h3 id="hub-seats-h" className="cj-detail-setup__label">
              How many players?
            </h3>
            <div className="cj-detail-seats" role="radiogroup" aria-labelledby="hub-seats-h" onKeyDown={radioKeyNav}>
              {options.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={n === seats}
                  className={`cj-chip${n === seats ? ' is-on' : ''}`}
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
            <div className="cj-detail-setup__row cj-detail-setup__map" data-tour="game-map">
              <MapPicker compact isHost value={mapId} onPick={(patch) => setMapId(patch.map)} disabled={busy} label="Map" />
            </div>
          )}
          {!(copy.signedOut && copy.offline) && <p className="cj-detail-setup__hint">{copy.hint}</p>}
        </section>
        )}
      </TitleHero>

      <SubNav items={nav} />
      <AboutSection game={game} index={0} />
      <MapsSection game={game} index={1} />
      <HowToPlay game={game} index={1} />
      <GallerySection game={game} index={2} />
      {!locked && <OpenTables game={game} state={rooms} onCreate={create} busy={busy} index={3} />}
      <LeaderboardSection game={game} user={user} index={4} />
      <DetailsTable game={game} index={5} />
      <RelatedGames game={game} />
      {!locked && <MobileBar game={game} seats={seats} host={hostOn} busy={busy} user={user} authLoading={authLoading} panelRef={panelRef} />}
      <CodeSheet open={codeOpen} onClose={() => setCodeOpen(false)} />
    </div>
  );
}

/**
 * A SOLO game's title page (manifest `solo: true`): Play opens the game's own full-screen route, no table, code or sign-in.
 * It has no maps or open tables; it has a leaderboard when it saves scores (manifest `stats`).
 */
function SoloDetail({ game }) {
  useGameMeta(game, false);
  const { user } = useAuth() || {};
  const jump = useJumpLinks();
  const share = useShareGame(game);
  const nav = sectionList(game, { live: true });
  const actions = (
    <div className="cj-detail-actions" data-tour="game-panel">
      <a href={paths.solo(game.id)} className="cj-btn cj-btn--primary cj-btn--lg" data-tour="game-create">
        <HubIcon name="play" size={20} /> Play now
      </a>
      <button type="button" className="cj-iconbtn" data-tour="game-share" onClick={share} aria-label={`Share ${game.name}`} title="Share">
        <HubIcon name="share" size={20} />
      </button>
      {howToPlaySteps(game).length > 0 && (
        <a href="#gd-how" className="cj-iconbtn" aria-label="Rules: how to play" title="How to play">
          <HubIcon name="book" size={20} />
        </a>
      )}
    </div>
  );
  const players = playersLabel(game.players);
  return (
    <div className="hub-page cj-detail" style={themeVars(game.theme)} onClick={jump}>
      <TitleHero game={game} actions={actions} notes={<p className="cj-detail-hint">{players ? `${players}. ` : ''}No table, code or sign-in: it opens full screen in this browser.</p>} />
      <SubNav items={nav} />
      <AboutSection game={game} index={0} />
      <HowToPlay game={game} index={1} />
      <GallerySection game={game} index={2} />
      {Array.isArray(game.stats) && <LeaderboardSection game={game} user={user} index={4} />}
      <DetailsTable game={game} index={3} />
      <RelatedGames game={game} />
    </div>
  );
}

/** A coming-soon teaser: the same title page, with Notify me (this device only), Share and a way to play something else. */
function SoonDetail({ game }) {
  useGameMeta(game, true);
  const jump = useJumpLinks();
  const share = useShareGame(game);
  const [notify, toggle] = useNotify(game.id);
  const nav = sectionList(game, { live: false });
  const live = featuredGame();
  const meanwhile = live && live.status !== 'coming_soon' && live.id !== game.id ? live : null;
  const players = playersLabel(game.players);
  const actions = (
    <div className="cj-detail-actions">
      <button type="button" className="cj-btn cj-btn--primary cj-btn--lg" aria-pressed={notify} onClick={toggle}>
        <HubIcon name={notify ? 'check' : 'bell'} size={20} /> {notify ? 'On the list' : 'Notify me'}
      </button>
      <button type="button" className="cj-iconbtn" onClick={share} aria-label={`Share ${game.name}`} title="Share">
        <HubIcon name="share" size={20} />
      </button>
      {meanwhile && (
        <Link to={paths.game(meanwhile.id)} className="cj-btn cj-detail-meanwhile">
          <HubIcon name="play" size={16} /> Play {meanwhile.name} meanwhile
        </Link>
      )}
    </div>
  );
  const notes = (
    <p className="cj-detail-hint">
      {game.name} {players ? `(${players.toLowerCase()}) ` : ''}isn't open for play yet. Notify me marks it as one you're waiting for, saved on this device only.
    </p>
  );
  return (
    <div className="hub-page cj-detail cj-detail--soon" style={themeVars(game.theme)} onClick={jump}>
      <TitleHero game={game} soon actions={actions} notes={notes} />
      <SubNav items={nav} />
      <AboutSection game={game} soon index={0} />
      <GallerySection game={game} index={1} />
      <DetailsTable game={game} index={2} />
      <RelatedGames game={game} />
    </div>
  );
}

/** /games/:gameId: a live game is a title page with the create-table flow, a solo game opens its own page, a coming-soon game a teaser. */
export default function GameDetail() {
  const { gameId } = useParams();
  const game = getGame(gameId);
  if (!game) return <Unavailable reason="unknown" query={gameId} />;
  if (game.status === 'coming_soon') return <SoonDetail key={game.id} game={game} />;
  return game.solo && !game.loaders?.onlineGame ? <SoloDetail key={game.id} game={game} /> : <LiveDetail key={game.id} game={game} />;
}
