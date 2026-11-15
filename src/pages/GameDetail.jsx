import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import GameTour from '@/components/tour/GameTour.jsx';
import CodeSheet from '@/components/shell/nav/CodeSheet.jsx';
import { getCategory, getGame } from '@/games/registry.js';
import { useAuth } from '@/lib/auth.jsx';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { LivePanel, MobileBar, SoonPanel } from '@/platform/game/ActionPanel.jsx';
import MapsSection from '@/platform/game/MapsSection.jsx';
import { DEFAULT_MAP } from '@/components/online/mapModel.js';
import { AboutSection, DetailsTable, GallerySection, HowToPlay, LeaderboardSection, OpenTables, RelatedGames, openTableList, useOpenRooms } from '@/platform/game/DetailSections.jsx';
import { GameHead, HeroArt, categoryHref } from '@/platform/game/GameHero.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Unavailable from '@/platform/game/Unavailable.jsx';
import { themeVars } from '@/platform/game/color.js';
import { gameJsonLd, metaDescription, sectionList } from '@/platform/game/detailModel.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { defaultSeats, seatOptions } from '@/platform/game/seats.js';
import useHostRoom from '@/platform/game/useHostRoom.js';
import '@/styles/store-detail.css';

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
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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
 * A playable game's store listing: shopfront art and title block, a sticky "Start a table" panel, then About,
 * How to play, Gallery, Open tables, Leaderboard, Game details and More like this.
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

  return (
    <div className="hub-page gd" style={themeVars(game.theme)} onClick={jump}>
      <GameTour game={game} />
      <Crumbs game={game} />
      <div className="gd-grid">
        <HeroArt game={game} />
        <aside className="gd-aside">
          <div className="gd-aside__in">
            <GameHead game={game} tables={tables} />
            <LivePanel
              game={game}
              options={options}
              seats={seats}
              setSeats={setSeats}
              host={hostOn}
              busy={busy}
              user={user}
              authLoading={authLoading}
              reachable={reachable}
              onJoinCode={() => setCodeOpen(true)}
              panelRef={panelRef}
              mapId={mapId}
              setMapId={setMapId}
            />
          </div>
        </aside>
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
      </div>
      <RelatedGames game={game} />
      <MobileBar game={game} seats={seats} host={hostOn} busy={busy} user={user} authLoading={authLoading} panelRef={panelRef} />
      <CodeSheet open={codeOpen} onClose={() => setCodeOpen(false)} />
    </div>
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
