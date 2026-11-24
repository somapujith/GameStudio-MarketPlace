// The sections of a game's title page below the hero (docs/CINE_UI.md): About / What to expect, How to play, Gallery, Open
// tables, Top players + Your record, Game details and More like this, as cine rows and glass cards. Everything comes from
// the game's manifest and the hub API; every API-backed section has loading / empty / offline states, and a section simply
// disappears when the manifest has nothing to say. Styles: src/styles/cine/detail.css (.cj-detail-*); the `gd-*` ids and
// `.gd-sec__head` hooks stay for the in-page nav and the tour.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOpenRooms } from '@/lib/api.js';
import { getCategory, relatedGames } from '@/games/registry.js';
import { paths } from '@/platform/paths.js';
import { fmtStat, resolveGameStats } from '@/platform/home/gameStats.js';
import { useApi, useApiGate } from '@/platform/home/useApi.js';
import Ava from '@/platform/home/Ava.jsx';
import { CineRow } from '@/platform/home/CineRow.jsx';
import { GamePoster } from '@/platform/browse/GameArt.jsx';
import HubIcon from './HubIcon.jsx';
import Gallery from './Gallery.jsx';
import { categoryHref } from './GameHero.jsx';
import { detailRows, highlightList, howToPlaySteps } from './detailModel.js';

export { howToPlaySteps };

const STEP_ICONS = ['play', 'users', 'star', 'trophy'];
const HIGHLIGHT_ICONS = ['spark', 'users', 'bolt', 'star'];
const MEDAL = ['#f5c66b', '#d9deea', '#e09a5b'];
const NF = new Intl.NumberFormat('en-IN');
const num = (v) => (Number.isFinite(Number(v)) ? NF.format(Math.round(Number(v))) : '—');
const COMPACT = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
/** Big numbers fit a small tile: 24,50,000 -> "24.5L" (money stays money via the stat's `format`). */
const short = (v, def) => (def?.format ? fmtStat(v, def) : Math.abs(Number(v)) >= 100000 ? COMPACT.format(Number(v)) : num(v));

/** The four record tiles for `user.gameStats[gameId]` (zeros when there is none yet). */
export function recordTiles(game, user) {
  const s = resolveGameStats({ user, gameId: game?.id }) || { games: 0, wins: 0, bestScore: 0, rating: 0 };
  const defs = Array.isArray(game?.stats) ? game.stats : [];
  const def = (key) => defs.find((d) => d && d.key === key) || null;
  const best = def('bestScore');
  return {
    empty: !s.games,
    tiles: [
      { key: 'games', label: def('games')?.label || 'Games', value: num(s.games) },
      { key: 'wins', label: def('wins')?.label || 'Wins', value: num(s.wins) },
      { key: 'bestScore', label: best?.label || 'Best', value: s.bestScore ? short(s.bestScore, best) : '—' },
      { key: 'rating', label: def('rating')?.label || 'Rating', value: s.rating ? num(s.rating) : '—' },
    ],
  };
}

/** A title-page section: anchor id, title (a real h2 the in-page nav focuses), optional eyebrow and action on the right. */
export function Section({ id, eyebrow, title, more, busy, className = '', index = 0, children, ...rest }) {
  const hid = `${id}-h`;
  return (
    <section id={id} className={`cj-section cj-detail-sec ${className}`.trim()} style={{ '--i': index }} aria-labelledby={hid} aria-busy={busy || undefined} {...rest}>
      <div className="cj-section__head gd-sec__head">
        <h2 id={hid} className="cj-section__title" tabIndex={-1}>
          {title}
        </h2>
        {eyebrow && <span className="cj-detail-eyebrow">{eyebrow}</span>}
        {more}
      </div>
      {children}
    </section>
  );
}

function Offline({ text, onRetry }) {
  return (
    <div className="cj-detail-note" role="status">
      <span className="cj-detail-note__ico" aria-hidden="true">
        <HubIcon name="wifiOff" size={18} />
      </span>
      <p>{text}</p>
      {onRetry && (
        <button type="button" className="cj-btn cj-btn--sm" onClick={onRetry}>
          <HubIcon name="refresh" size={16} /> Retry
        </button>
      )}
    </div>
  );
}

/** About (live) / What to expect (coming soon): the description, then the manifest's highlights. */
export function AboutSection({ game, soon = false, index = 0 }) {
  const highlights = highlightList(game);
  const features = Array.isArray(game?.features) ? game.features.filter((f) => typeof f === 'string' && f) : [];
  if (!game?.description && !highlights.length && !features.length) return null;
  const paragraphs = String(game.description || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <Section id="gd-about" title={soon ? 'What to expect' : `About ${game.name}`} eyebrow={soon ? 'Preview' : undefined} index={index}>
      <div className="cj-detail-pad cj-detail-about">
        {paragraphs.length > 0 && (
          <div className="cj-detail-prose">
            {paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {soon && <p className="cj-detail-fine">This is a preview. Details can change before the game opens.</p>}
          </div>
        )}
        {highlights.length > 0 ? (
          <ul className="cj-detail-hl">
            {highlights.map((h, i) => (
              <li key={h.title}>
                <span className="cj-detail-hl__ico" aria-hidden="true">
                  <HubIcon name={h.icon || HIGHLIGHT_ICONS[i % HIGHLIGHT_ICONS.length]} size={20} />
                </span>
                <span>
                  <b>{h.title}</b>
                  {h.text && <small>{h.text}</small>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          features.length > 0 && (
            <ul className="cj-detail-feat" aria-label="Features">
              {features.map((f) => (
                <li key={f} className="cj-chip">
                  <HubIcon name="check" size={14} /> {f}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </Section>
  );
}

export function HowToPlay({ game, index = 0 }) {
  const steps = howToPlaySteps(game);
  if (!steps.length) return null;
  return (
    <Section id="gd-how" title="How to play" eyebrow={`${steps.length} steps`} index={index}>
      <ol className="cj-row cj-detail-steps">
        {steps.map((s, i) => (
          <li key={s.title} className="cj-detail-step">
            <span className="cj-detail-step__ico" aria-hidden="true">
              <HubIcon name={s.icon || STEP_ICONS[i % STEP_ICONS.length]} size={20} />
            </span>
            <b>{s.title}</b>
            {s.text && <small>{s.text}</small>}
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function GallerySection({ game, index = 0 }) {
  return (
    <Section id="gd-gallery" title="Gallery" index={index}>
      <Gallery game={game} />
    </Section>
  );
}

export function YourRecord({ game, user }) {
  if (!user) return null;
  const { empty, tiles } = recordTiles(game, user);
  return (
    <section className="cj-detail-record" aria-labelledby="gd-record-h">
      <div className="cj-detail-record__head">
        <h3 id="gd-record-h">Your record</h3>
        <Link to={paths.profile()} className="cj-detail-link">
          Profile
        </Link>
      </div>
      <dl className="cj-detail-record__grid">
        {tiles.map((t) => (
          <div key={t.key}>
            <dt>{t.label}</dt>
            <dd>{t.value}</dd>
          </div>
        ))}
      </dl>
      {empty && <p className="cj-detail-fine">Play your first table and your numbers land here.</p>}
    </section>
  );
}

/** The game's top players as round portraits (rank, name, wins), linking to the full leaderboard. */
export function GameTopPlayers({ game }) {
  const { booting, ready, retry } = useApiGate();
  const { status, data, reload } = useApi(`/api/leaderboard?game=${encodeURIComponent(game.id)}`, { enabled: ready });
  const rows = Array.isArray(data?.rows) ? data.rows.slice(0, 10) : [];
  const state = booting ? 'loading' : !ready ? 'offline' : status;

  let body;
  if (state === 'loading' || state === 'idle') {
    body = (
      <ul className="cj-row" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="cj-person">
            <span className="cj-detail-skel cj-detail-skel--round" />
            <span className="cj-detail-skel cj-detail-skel--line" />
          </li>
        ))}
      </ul>
    );
  } else if (state === 'ok' && rows.length) {
    body = (
      <CineRow label={`Top ${game.name} players`} count={rows.length} className="cj-detail-top-row">
        {rows.map((r, i) => (
          <li key={`${r.rank}-${r.name}`}>
            <Link to={paths.leaderboard(game.id)} className={`cj-person cj-detail-person${r.isMe ? ' is-me' : ''}`} style={{ '--medal': MEDAL[i] || 'rgba(255,255,255,0.16)' }}>
              <span className="cj-detail-person__ava">
                <Ava preset={r.avatar} size={80} frame={r.frame} ring={MEDAL[i]} />
                <span className="cj-detail-person__rank" aria-label={`Rank ${r.rank ?? i + 1}`}>
                  {r.rank ?? i + 1}
                </span>
              </span>
              <span className="cj-detail-person__name">
                {r.name}
                {r.isMe && <em> (you)</em>}
              </span>
              <small>
                {num(r.wins)} win{Number(r.wins) === 1 ? '' : 's'}
                {Number(r.rating) > 0 && <> · {num(r.rating)}</>}
              </small>
            </Link>
          </li>
        ))}
      </CineRow>
    );
  } else if (state === 'ok') {
    body = <p className="cj-detail-pad cj-detail-muted">No champions yet. Win a table to take the first spot.</p>;
  } else {
    body = <Offline text="The rankings are offline right now." onRetry={ready ? reload : retry} />;
  }

  return (
    <div className="cj-detail-top" aria-busy={state === 'loading'}>
      <h3 id="gd-top-h" className="hub-sr">
        Top players
      </h3>
      {body}
    </div>
  );
}

/** Top players (round portraits), plus the signed-in player's own record beside them. */
export function LeaderboardSection({ game, user, index = 0 }) {
  return (
    <Section
      id="gd-board"
      title="Top players"
      index={index}
      more={
        <Link to={paths.leaderboard(game.id)} className="cj-detail-link cj-detail-more">
          Full leaderboard
        </Link>
      }
    >
      <div className={`cj-detail-board${user ? ' has-record' : ''}`}>
        <GameTopPlayers game={game} />
        <YourRecord game={game} user={user} />
      </div>
    </Section>
  );
}

/** `getOpenRooms({ gameId })`, gated on the Worker answering (a static dev server makes no failing requests). Pass `null` to stay idle. */
export function useOpenRooms(gameId) {
  const { booting, ready, retry } = useApiGate();
  const [state, setState] = useState({ status: 'loading', rooms: [] });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!ready || !gameId) return undefined;
    const ctrl = new AbortController();
    let alive = true;
    setState((s) => (s.status === 'ok' ? s : { status: 'loading', rooms: [] }));
    getOpenRooms({ gameId, limit: 5 }, { signal: ctrl.signal, timeout: 10_000 }).then(
      (r) => alive && setState({ status: 'ok', rooms: Array.isArray(r?.rooms) ? r.rooms : [] }),
      () => alive && setState({ status: 'offline', rooms: [] }),
    );
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [gameId, ready, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  if (booting) return { status: 'loading', rooms: [], reload };
  if (!ready) return { status: 'offline', rooms: [], reload: retry };
  return { ...state, reload };
}

/** Joinable tables of a game: `rooms` filtered to this game, real codes only. */
export function openTableList(rooms, gameId) {
  return (Array.isArray(rooms) ? rooms : []).filter((r) => r && typeof r.code === 'string' && (!r.gameId || r.gameId === gameId));
}

/** "Open tables": tables waiting for players, with Join. `state` ({ status, rooms, reload }) lets the page share one request with the hero. */
export function OpenTables({ game, onCreate, busy, state, index = 0 }) {
  const own = useOpenRooms(state ? null : game.id);
  const { status, rooms, reload } = state || own;
  const list = openTableList(rooms, game.id);

  let body;
  if (status === 'loading') {
    body = (
      <ul className="cj-row" aria-hidden="true">
        {[0, 1].map((i) => (
          <li key={i}>
            <span className="cj-detail-table cj-detail-skel" />
          </li>
        ))}
      </ul>
    );
  } else if (status === 'offline') {
    body = <Offline text="Couldn't load open tables." onRetry={reload} />;
  } else if (!list.length) {
    body = (
      <div className="cj-detail-note">
        <span className="cj-detail-note__ico" aria-hidden="true">
          <HubIcon name="table" size={18} />
        </span>
        <p>No open tables right now. Start one and share the code.</p>
        {onCreate && (
          <button type="button" className="cj-btn cj-btn--primary cj-btn--sm" onClick={onCreate} disabled={busy}>
            <HubIcon name="plus" size={16} /> Create table
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <CineRow label="Open tables" count={list.length} className="cj-detail-tables">
        {list.map((r) => {
          const count = Number(r.players) || 0;
          const max = Number(r.maxPlayers) || 0;
          const full = max > 0 && count >= max;
          return (
            <li key={r.code}>
              <div className="cj-detail-table">
                <span className="cj-detail-table__live">
                  <i className="cj-live-dot" aria-hidden="true" /> {full ? 'Full' : 'Waiting'}
                </span>
                <b>{r.hostName ? `${r.hostName}'s table` : 'Open table'}</b>
                <small>
                  <HubIcon name="users" size={13} /> {max ? `${count}/${max}` : count} players
                  {typeof r.summary === 'string' && r.summary && <> · {r.summary}</>}
                </small>
                {full ? (
                  <span className="cj-chip cj-detail-table__act">Full</span>
                ) : (
                  <Link to={paths.join(r.code)} className="cj-btn cj-btn--primary cj-btn--sm cj-detail-table__act" aria-label={`Join ${r.hostName || 'this'} table`}>
                    Join
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </CineRow>
    );
  }

  const eyebrow =
    status === 'ok' && list.length > 0 ? (
      <>
        <i className="cj-live-dot" aria-hidden="true" /> Live now
      </>
    ) : (
      'Live now'
    );
  return (
    <Section id="gd-live" title="Open tables" eyebrow={eyebrow} busy={status === 'loading'} index={index} className="cj-detail-open">
      {body}
    </Section>
  );
}

/** "Game details": a definition list; rows without a value are not rendered. */
export function DetailsTable({ game, index = 0 }) {
  const rows = detailRows(game);
  if (!rows.length) return null;
  return (
    <Section id="gd-details" title="Game details" index={index}>
      <dl className="cj-detail-pad cj-detail-dl">
        {rows.map((r) => (
          <div key={r.label} className={r.list ? 'is-wide' : undefined}>
            <dt>{r.label}</dt>
            <dd>
              {r.list ? (
                <ul className="cj-detail-tags">
                  {r.list.map((t) => (
                    <li key={t} className="cj-chip">
                      {t}
                    </li>
                  ))}
                </ul>
              ) : r.label === 'Category' ? (
                <Link to={categoryHref(getCategory(game.category))} className="cj-detail-link">
                  {r.value}
                </Link>
              ) : (
                r.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/** "More like this": same category first, live before coming soon, as posters. */
export function RelatedGames({ game, index = 0 }) {
  const list = relatedGames(game, 6);
  if (!list.length) return null;
  return (
    <Section
      id="gd-more"
      title="More like this"
      index={index}
      more={
        <Link to={paths.games()} className="cj-detail-link cj-detail-more">
          Browse all games
        </Link>
      }
    >
      <CineRow label="More like this" count={list.length} className="cj-detail-related">
        {list.map((g) => (
          <li key={g.id}>
            <GamePoster game={g} />
          </li>
        ))}
      </CineRow>
    </Section>
  );
}
