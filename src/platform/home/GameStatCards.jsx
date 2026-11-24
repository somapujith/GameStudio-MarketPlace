import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { getMyMatches } from '@/lib/api.js';
import { GameIcon } from './GameArt.jsx';
import Ava from './Ava.jsx';
import { gameById } from './catalog.js';
import { fmtStat, matchResult, relTime, resolveGameStats, statDefsWithRating, statValue } from './gameStats.js';
import { useApi, useApiReady } from './useApi.js';

/** One card per live game with the player's numbers (the server's per-game stats), rating included. */
export default function GameStatCards({ games, user }) {
  if (!games.length) return null;
  return (
    <section id="games" className="cj-pro-sec" aria-labelledby="hh2-stats-h" data-tour="profile-stats">
      <div className="cj-pro-sec__head">
        <h2 id="hh2-stats-h" className="cj-pro-sec__title">
          Your games
        </h2>
      </div>
      <ul className="cj-pro-games">
        {games.map((g) => {
          const stats = resolveGameStats({ user, gameId: g.id });
          const defs = statDefsWithRating(g, 4);
          return (
            <li key={g.id}>
              <article className="cj-pro-game">
                <header className="cj-pro-game__head">
                  <GameIcon game={g} size={48} />
                  <div>
                    <h3>{g.name}</h3>
                    <p>{stats ? 'Your record' : 'Not played yet'}</p>
                  </div>
                </header>
                {stats ? (
                  <dl className="cj-facts cj-pro-game__facts">
                    {defs.map((d) => (
                      <div key={d.key}>
                        <dt>{d.label}</dt>
                        <dd>{d.key === 'rating' && !stats.rating ? '—' : fmtStat(statValue(stats, d.key), d)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="cj-pro-game__empty">Play an online game to start your record.</p>
                )}
                <footer className="cj-pro-game__foot">
                  <Link to={paths.game(g.id)} className="cj-btn cj-btn--primary cj-btn--sm">
                    <HubIcon name="play" size={14} /> Play
                  </Link>
                  <Link to={paths.leaderboard(g.id)} className="cj-btn cj-btn--sm">
                    <HubIcon name="podium" size={16} /> Rank
                  </Link>
                </footer>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** How a game's match score reads: its manifest `bestScore` stat (label without "Best"), rupees unless it says otherwise. */
function scoreDef(game) {
  const d = (Array.isArray(game?.stats) ? game.stats : []).find((s) => s.key === 'bestScore');
  const label = (d?.label || 'Score').replace(/^best\s+/i, '');
  return { key: 'score', label: label.charAt(0).toUpperCase() + label.slice(1), format: d?.format ?? 'inr' };
}

const MATCH_LIMIT = 10;

function MatchSkeleton() {
  return (
    <ul className="cj-pro-matches" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="cj-pro-match">
          <span className="cj-pro-skel" style={{ width: 44, height: 44, borderRadius: 12 }} />
          <span className="cj-pro-match__main">
            <span className="cj-pro-skel" style={{ width: '45%', height: 12 }} />
            <span className="cj-pro-skel" style={{ width: '70%', height: 10, marginTop: 8 }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function MatchRow({ m, i, now }) {
  const game = gameById(m.gameId);
  const res = matchResult(m);
  const def = scoreDef(game);
  const players = (Array.isArray(m.players) ? m.players : []).filter((p) => p && typeof p.name === 'string');
  const ordered = [...players].sort((a, b) => (Number(a.rank) || 99) - (Number(b.rank) || 99));
  const shown = ordered.slice(0, 4);
  const more = ordered.length - shown.length;
  const others = ordered.filter((p) => !p.isMe).map((p) => p.name);
  const when = relTime(m.endedAt, now);
  const count = Number(m.playerCount) || players.length;
  const meta = [count ? `${count} players` : null, Number(m.rounds) ? `${m.rounds} rounds` : null].filter(Boolean).join(' · ');
  const t = Date.parse(m.endedAt);
  return (
    <li className={`cj-pro-match cj-pro-match--${res.tone}`} style={{ '--i': Math.min(i, 10) }}>
      <GameIcon game={game || { name: m.gameId }} size={44} />
      <span className="cj-pro-match__main">
        <span className="cj-pro-match__top">
          <span className={`cj-pro-result cj-pro-result--${res.tone}`}>
            {res.tone === 'win' && <HubIcon name="crown" size={13} />}
            {res.text}
          </span>
          <b className="cj-pro-match__game">{game?.name || 'Game'}</b>
        </span>
        <small className="cj-pro-match__meta">
          {meta}
          {when && (
            <>
              {meta ? ' · ' : ''}
              <time dateTime={Number.isFinite(t) ? new Date(t).toISOString() : undefined}>{when}</time>
            </>
          )}
        </small>
        {shown.length > 0 && (
          <span className="cj-pro-match__players" aria-label={others.length ? `With ${others.join(', ')}` : undefined}>
            {shown.map((p, k) => (
              <span key={`${p.name}-${k}`} className={`cj-pro-match__p ${p.isMe ? 'is-me' : ''}`} title={`${p.rank ? `#${p.rank} ` : ''}${p.name}${p.isMe ? ' (you)' : ''}`}>
                <Ava preset={p.avatar} size={22} ring={p.isMe ? 'rgba(255,255,255,0.85)' : undefined} />
              </span>
            ))}
            {more > 0 && <span className="cj-pro-match__more">+{more}</span>}
          </span>
        )}
      </span>
      <span className="cj-pro-match__score">
        <b>{fmtStat(m.score, def)}</b>
        <small>{def.label}</small>
      </span>
    </li>
  );
}

/** Profile > Recent matches (`GET /api/me/matches`): result chip, score, players and when. Signed-in players only. */
export function RecentMatches({ signedIn, lead }) {
  const ready = useApiReady();
  const res = useApi(`/api/me/matches?limit=${MATCH_LIMIT}`, { enabled: ready && signedIn, fetcher: (o) => getMyMatches(MATCH_LIMIT, o) });
  const matches = Array.isArray(res.data?.matches) ? res.data.matches.filter((m) => m && typeof m === 'object') : [];
  const now = Date.now();

  let body;
  if (!signedIn) {
    body = (
      <div className="cj-pro-empty">
        <p className="cj-pro-empty__title">Your match history lives on your account</p>
        <p className="cj-pro-empty__text">Sign in and every online match you finish shows up here.</p>
        <div className="cj-pro-empty__actions">
          <Link to={paths.login(paths.profile())} className="cj-btn cj-btn--primary cj-btn--sm">
            Sign in
          </Link>
        </div>
      </div>
    );
  } else if (!ready) {
    body = <p className="cj-pro-muted">Match history needs a connection.</p>;
  } else if (res.status === 'loading') {
    body = <MatchSkeleton />;
  } else if (res.status !== 'ok') {
    body = (
      <div className="cj-pro-inline-err" role="status">
        <HubIcon name="wifiOff" size={18} />
        <span>{res.status === 'offline' ? 'Cannot reach the server.' : 'Could not load your matches.'}</span>
        <button type="button" className="cj-btn cj-btn--sm" onClick={res.reload}>
          <HubIcon name="refresh" size={16} /> Retry
        </button>
      </div>
    );
  } else if (!matches.length) {
    body = (
      <div className="cj-pro-empty">
        <p className="cj-pro-empty__title">No matches yet</p>
        <p className="cj-pro-empty__text">Finish an online game and it lands here with your result and score.</p>
        {lead && (
          <div className="cj-pro-empty__actions">
            <Link to={paths.game(lead.id)} className="cj-btn cj-btn--primary cj-btn--sm">
              <HubIcon name="play" size={14} /> Play {lead.name}
            </Link>
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <ul className="cj-pro-matches">
        {matches.map((m, i) => (
          <MatchRow key={m.id ?? `${m.gameId}-${m.endedAt}-${i}`} m={m} i={i} now={now} />
        ))}
      </ul>
    );
  }

  return (
    <section id="matches" className="cj-pro-sec" aria-labelledby="xp-matches-h" aria-busy={res.status === 'loading'}>
      <div className="cj-pro-sec__head">
        <h2 id="xp-matches-h" className="cj-pro-sec__title">
          Recent matches
          {matches.length > 0 && (
            <span className="cj-pro-sec__count">
              {matches.filter((m) => m.won || Number(m.rank) === 1).length} won of {matches.length}
            </span>
          )}
        </h2>
      </div>
      {body}
    </section>
  );
}
