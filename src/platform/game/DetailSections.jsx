// The sections of a game listing below the title block: About / What to expect, How to play, Gallery, Live now
// (open tables), Leaderboard + Your record, Game details and More like this. Everything comes from the game's
// manifest and the hub API; every API-backed section has loading / empty / offline states, and a section simply
// disappears when the manifest has nothing to say. Styles: src/styles/store-detail.css (.gd-*).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/art/index.js';
import { getOpenRooms } from '@/lib/api.js';
import { getCategory, relatedGames } from '@/games/registry.js';
import { paths } from '@/platform/paths.js';
import { fmtStat, resolveGameStats } from '@/platform/home/gameStats.js';
import { useApi, useApiGate } from '@/platform/home/useApi.js';
import HubIcon from './HubIcon.jsx';
import Gallery from './Gallery.jsx';
import { Cover, categoryHref, playersLabel } from './GameHero.jsx';
import { themeVars } from './color.js';
import { detailRows, highlightList, howToPlaySteps } from './detailModel.js';

export { howToPlaySteps };

const STEP_ICONS = ['play', 'users', 'star', 'trophy'];
const HIGHLIGHT_ICONS = ['spark', 'users', 'bolt', 'star'];
const MEDAL = ['#ffd24d', '#d9deea', '#e09a5b'];
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

/** A listing section: anchor id, optional eyebrow, title, optional action on the right. */
export function Section({ id, eyebrow, title, more, busy, className = '', index = 0, children, ...rest }) {
  const hid = `${id}-h`;
  return (
    <section id={id} className={`gd-sec st-reveal ${className}`.trim()} style={{ '--i': index }} aria-labelledby={hid} aria-busy={busy || undefined} {...rest}>
      <div className="gd-sec__head">
        <div>
          {eyebrow && <span className="st-eyebrow gd-sec__eyebrow">{eyebrow}</span>}
          <h2 id={hid} className="gd-sec__title" tabIndex={-1}>
            {title}
          </h2>
        </div>
        {more}
      </div>
      {children}
    </section>
  );
}

function Offline({ text, onRetry }) {
  return (
    <div className="gd-note">
      <p>
        <HubIcon name="wifiOff" size={16} /> {text}
      </p>
      {onRetry && (
        <button type="button" className="hub-btn hub-btn--soft hub-btn--sm" onClick={onRetry}>
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
      {paragraphs.length > 0 && (
        <div className="gd-prose">
          {paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      {soon && <p className="gd-fine">This is a preview. Details can change before the game opens.</p>}
      {highlights.length > 0 ? (
        <ul className="gd-hl">
          {highlights.map((h, i) => (
            <li key={h.title} className="gd-hl__item">
              <span className="gd-hl__ico" aria-hidden="true">
                <HubIcon name={h.icon || HIGHLIGHT_ICONS[i % HIGHLIGHT_ICONS.length]} size={22} />
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
          <ul className="gd-feat" aria-label="Features">
            {features.map((f) => (
              <li key={f} className="st-chip">
                <HubIcon name="check" size={14} /> {f}
              </li>
            ))}
          </ul>
        )
      )}
    </Section>
  );
}

export function HowToPlay({ game, index = 0 }) {
  const steps = howToPlaySteps(game);
  if (!steps.length) return null;
  return (
    <Section id="gd-how" title="How to play" eyebrow={`${steps.length} steps`} index={index}>
      <ol className="gd-steps">
        {steps.map((s, i) => (
          <li key={s.title} className="gd-step">
            <span className="gd-step__num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="gd-step__ico" aria-hidden="true">
              <HubIcon name={s.icon || STEP_ICONS[i % STEP_ICONS.length]} size={22} />
            </span>
            <span className="gd-step__text">
              <b>{s.title}</b>
              {s.text && <small>{s.text}</small>}
            </span>
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
    <section className="gd-card gd-record" aria-labelledby="gd-record-h">
      <div className="gd-card__head">
        <h3 id="gd-record-h" className="gd-card__title">
          Your record
        </h3>
        <Link to={paths.profile()} className="st-link">
          Profile
        </Link>
      </div>
      <dl className="gd-record__grid">
        {tiles.map((t) => (
          <div key={t.key} className="gd-record__tile">
            <dt>{t.label}</dt>
            <dd>{t.value}</dd>
          </div>
        ))}
      </dl>
      {empty && <p className="gd-fine">Play your first table and your numbers land here.</p>}
    </section>
  );
}

export function GameTopPlayers({ game }) {
  const { booting, ready, retry } = useApiGate();
  const { status, data, reload } = useApi(`/api/leaderboard?game=${encodeURIComponent(game.id)}`, { enabled: ready });
  const rows = Array.isArray(data?.rows) ? data.rows.slice(0, 5) : [];
  const state = booting ? 'loading' : !ready ? 'offline' : status;

  let body;
  if (state === 'loading' || state === 'idle') {
    body = (
      <ul className="gd-top" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="gd-top__row">
            <span className="st-skel" style={{ width: 40, height: 40, borderRadius: '50%' }} />
            <span className="st-skel" style={{ width: '50%', height: 14 }} />
          </li>
        ))}
      </ul>
    );
  } else if (state === 'ok' && rows.length) {
    body = (
      <ol className="gd-top">
        {rows.map((r, i) => (
          <li key={`${r.rank}-${r.name}`} className={`gd-top__row${r.isMe ? ' is-me' : ''}`} style={{ '--gd-medal': MEDAL[i] || 'transparent' }}>
            <span className="gd-top__rank" aria-label={`Rank ${r.rank ?? i + 1}`}>
              {r.rank ?? i + 1}
            </span>
            <span className="gd-top__av" aria-hidden="true">
              <Avatar preset={Number(r.avatar) || 0} size={40} />
            </span>
            <span className="gd-top__who">
              <b>
                {r.name}
                {r.isMe && <em> (you)</em>}
              </b>
              <small>
                {num(r.wins)} win{Number(r.wins) === 1 ? '' : 's'}
                {Number(r.rating) > 0 && <> · {num(r.rating)} rating</>}
              </small>
            </span>
          </li>
        ))}
      </ol>
    );
  } else if (state === 'ok') {
    body = <p className="gd-muted">No champions yet. Win a table to take the first spot.</p>;
  } else {
    body = <Offline text="The rankings are offline right now." onRetry={ready ? reload : retry} />;
  }

  return (
    <section className="gd-card gd-topplayers" aria-labelledby="gd-top-h" aria-busy={state === 'loading'}>
      <div className="gd-card__head">
        <h3 id="gd-top-h" className="gd-card__title">
          Top players
        </h3>
        <Link to={paths.leaderboard(game.id)} className="st-link">
          Full leaderboard
        </Link>
      </div>
      {body}
    </section>
  );
}

/** Leaderboard section: top players, plus the signed-in player's own record beside it. */
export function LeaderboardSection({ game, user, index = 0 }) {
  return (
    <Section id="gd-board" title="Leaderboard" eyebrow="Top players" index={index}>
      <div className={`gd-board${user ? ' has-record' : ''}`}>
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

/** "Live now": open tables with Join. `state` ({ status, rooms, reload }) lets the page share one request with the hero chip. */
export function OpenTables({ game, onCreate, busy, state, index = 0 }) {
  const own = useOpenRooms(state ? null : game.id);
  const { status, rooms, reload } = state || own;
  const list = openTableList(rooms, game.id);

  let body;
  if (status === 'loading') {
    body = (
      <ul className="gd-tables" aria-hidden="true">
        {[0, 1].map((i) => (
          <li key={i} className="gd-tables__row">
            <span className="st-skel" style={{ width: '60%', height: 16 }} />
          </li>
        ))}
      </ul>
    );
  } else if (status === 'offline') {
    body = <Offline text="Couldn't load open tables." onRetry={reload} />;
  } else if (!list.length) {
    body = (
      <div className="gd-empty">
        <p className="gd-muted">No open tables right now. Start one and share the code.</p>
        {onCreate && (
          <button type="button" className="hub-btn hub-btn--soft hub-btn--sm" onClick={onCreate} disabled={busy}>
            <HubIcon name="plus" size={16} /> Create table
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <ul className="gd-tables">
        {list.map((r) => {
          const count = Number(r.players) || 0;
          const max = Number(r.maxPlayers) || 0;
          const full = max > 0 && count >= max;
          return (
            <li key={r.code} className="gd-tables__row">
              <span className="gd-tables__who">
                <b>{r.hostName ? `${r.hostName}'s table` : 'Open table'}</b>
                <small>
                  <HubIcon name="users" size={13} /> {max ? `${count}/${max}` : count} players
                  {typeof r.summary === 'string' && r.summary && <> · {r.summary}</>}
                </small>
              </span>
              {full ? (
                <span className="st-chip">Full</span>
              ) : (
                <Link to={paths.join(r.code)} className="hub-btn hub-btn--accent hub-btn--sm" aria-label={`Join ${r.hostName || 'this'} table`}>
                  Join
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const eyebrow =
    status === 'ok' && list.length > 0 ? (
      <>
        <i className="st-live" aria-hidden="true" /> Live now
      </>
    ) : (
      'Live now'
    );
  return (
    <Section id="gd-live" title="Open tables" eyebrow={eyebrow} busy={status === 'loading'} index={index} className="gd-open">
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
      <dl className="gd-dl">
        {rows.map((r) => (
          <div key={r.label} className={`gd-dl__row${r.list ? ' is-wide' : ''}`}>
            <dt>{r.label}</dt>
            <dd>
              {r.list ? (
                <ul className="gd-tags">
                  {r.list.map((t) => (
                    <li key={t} className="st-chip">
                      {t}
                    </li>
                  ))}
                </ul>
              ) : r.label === 'Category' ? (
                <Link to={categoryHref(getCategory(game.category))} className="st-link">
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

/** "More like this": same category first, live before coming soon. */
export function RelatedGames({ game, index = 0 }) {
  const list = relatedGames(game, 6);
  if (!list.length) return null;
  return (
    <section id="gd-more" className="gd-sec gd-more st-reveal" style={{ '--i': index }} aria-labelledby="gd-more-h">
      <div className="gd-sec__head">
        <h2 id="gd-more-h" className="gd-sec__title" tabIndex={-1}>
          More like this
        </h2>
        <Link to={paths.games()} className="st-link">
          Browse all games
        </Link>
      </div>
      <ul className="gd-rail">
        {list.map((g) => {
          const soon = g.status === 'coming_soon';
          const players = playersLabel(g.players);
          return (
            <li key={g.id} style={themeVars(g.theme)}>
              <Link to={paths.game(g.id)} className={`gd-rel${soon ? ' is-soon' : ''}`}>
                <span className="gd-rel__cover">
                  <Cover game={g} />
                  {soon && <span className="gd-rel__badge">Soon</span>}
                </span>
                <span className="gd-rel__body">
                  <b>{g.name}</b>
                  {g.tagline && <small>{g.tagline}</small>}
                  {players && <span className="gd-rel__meta">{players}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
