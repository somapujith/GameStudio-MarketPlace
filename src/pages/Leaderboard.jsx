import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import { gameSlug } from '@/platform/game/identity.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { featured, gameById, rankedList } from '@/platform/home/catalog.js';
import { fmtStat, resolveGameStats, statDefsWithRating, statValue } from '@/platform/home/gameStats.js';
import { useAccountProgress } from '@/platform/home/accountProgress.js';
import { useApi, useApiGate } from '@/platform/home/useApi.js';
import LeaderTabs from '@/platform/home/LeaderTabs.jsx';
import Ava, { Title } from '@/platform/home/Ava.jsx';
import { useAccount, useReducedMotion } from '@/components/shell/hooks.js';
import { fmtNum } from '@/components/shell/ui.jsx';
import { CoinIcon } from '@/components/shell/icons.jsx';
import { getCurrentSeason } from '@/lib/api.js';
import SeasonCard from '@/platform/engagement/SeasonCard.jsx';
import { useNow } from '@/platform/engagement/useNow.jsx';
import { SEASON_COLS, seasonCountdown, seasonRowToBoard, seasonStanding, seasonStatusAt } from '@/platform/engagement/engagementModel.js';
import '@/styles/cine/leaderboard.css';

const OVERALL_COLS = [
  { key: 'wins', label: 'Wins' },
  { key: 'games', label: 'Games' },
];
const isRow = (r) => !!r && typeof r === 'object' && typeof r.name === 'string';
const PANEL_ID = 'hh2-lb-panel';
/** `?tab=season`: the current season's points race (docs/ENGAGEMENT.md section 3). */
const SEASON_TAB = 'season';
const EXTRA_TABS = [{ id: SEASON_TAB, label: 'Season' }];

function Skeleton() {
  return (
    <>
      <ol className="cj-top10 cj-lb-top" aria-hidden="true">
        {[1, 2, 3].map((p) => (
          <li key={p} className="cj-lb-top__item">
            <span className="cj-top10__num">{p}</span>
            <span className="cj-lb-card cj-lb-skel" />
          </li>
        ))}
      </ol>
      <div className="cj-lb-ranks cj-lb-ranks--skel" aria-hidden="true">
        <ul className="cj-lb-skelrows">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i}>
              <span className="cj-lb-skel" style={{ width: 18, height: 12 }} />
              <span className="cj-lb-skel" style={{ width: 36, height: 36, borderRadius: '50%' }} />
              <span className="cj-lb-skel" style={{ flex: 1, height: 12, maxWidth: 160 }} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function Notice({ icon, title, children, action }) {
  return (
    <div className="cj-empty cj-lb-empty">
      <span className="cj-empty__art cj-lb-empty__art" aria-hidden="true">
        <span className="cj-lb-empty__icon">
          <HubIcon name={icon} size={22} />
        </span>
      </span>
      <p className="cj-empty__title">{title}</p>
      <p className="cj-empty__body">{children}</p>
      {action && <div className="cj-empty__actions">{action}</div>}
    </div>
  );
}

/** "Your record" as a calm glass stat strip: account results for the selected game, or platform totals on Overall. */
function YourRecord({ game, user, liveGames }) {
  // server level when signed in: the same number the top bar and Profile show
  const { level, coins } = useAccountProgress();
  let tiles;
  let note = null;
  if (!game) {
    const per = liveGames.map((g) => resolveGameStats({ user, gameId: g.id })).filter(Boolean);
    const games = per.reduce((n, s) => n + s.games, 0);
    const wins = per.reduce((n, s) => n + s.wins, 0);
    tiles = [
      { label: 'Level', value: fmtNum(level) },
      { label: 'Games', value: fmtNum(games) },
      { label: 'Wins', value: fmtNum(wins) },
      { label: 'Coins', icon: 'coins', value: fmtNum(coins) },
      { label: 'Win rate', value: `${games ? Math.round((wins / games) * 100) : 0}%` },
    ];
  } else {
    const stats = resolveGameStats({ user, gameId: game.id });
    tiles = stats
      ? [
          ...statDefsWithRating(game, 3).map((d) => ({ label: d.label, value: fmtStat(stats[d.key] ?? (d.key === 'bestScore' ? stats.bestScore : null), d) })),
          { label: 'Coins', icon: 'coins', value: fmtNum(coins) },
          { label: 'Win rate', value: `${stats.games ? Math.round((stats.wins / stats.games) * 100) : 0}%` },
        ]
      : null;
    if (!tiles) {
      note = (
        <p className="cj-lb-rec__note">
          No {game.name} games yet.{' '}
          <Link to={paths.game(game.id)} className="cj-lb-link">
            Play your first one
          </Link>
        </p>
      );
    }
  }
  return (
    <section className="cj-lb-rec" aria-labelledby="hh2-rec-h">
      <h2 id="hh2-rec-h" className="cj-lb-rec__title">
        Your record
      </h2>
      {tiles && (
        <dl className="cj-lb-rec__stats">
          {tiles.map((t) => (
            <div key={t.label}>
              <dt>{t.label}</dt>
              <dd>
                {t.icon === 'coins' && <CoinIcon size={15} />}
                {t.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {note}
    </section>
  );
}

const statLine = (row, cols) =>
  cols
    .slice(0, 2)
    .map((c) => `${fmtStat(statValue(row, c.key), c)} ${c.label.toLowerCase()}`)
    .join(' · ');

/** The top three as Top-10 style poster cards over huge outlined numerals; reading order stays first, second, third. */
function TopThree({ rows, cols, isMe }) {
  return (
    <ol className="cj-top10 cj-lb-top" aria-label="Top three players">
      {rows.slice(0, 3).map((row, i) => {
        const me = isMe(row);
        return (
          <li key={`${row.rank}-${row.name}`} className={`cj-lb-top__item${me ? ' is-me' : ''}`} style={{ '--i': i }}>
            <span className="cj-top10__num" aria-hidden="true">
              {row.rank}
            </span>
            <article className="cj-lb-card" data-place={i + 1}>
              {i === 0 && (
                <span className="cj-lb-card__crown" aria-hidden="true">
                  <HubIcon name="crown" size={16} />
                </span>
              )}
              <span className="cj-lb-card__ava">
                <Ava preset={row.avatar} size={88} ring="rgba(255,255,255,0.16)" frame={row.frame} />
              </span>
              <span className="cj-lb-card__info">
                <b className="cj-lb-card__name" title={row.name}>
                  {row.name}
                </b>
                <span className="cj-lb-card__stats">{statLine(row, cols)}</span>
                {(me || row.title) && (
                  <span className="cj-lb-card__chips">
                    {me && <span className="cj-lb-you">You</span>}
                    <Title title={row.title} />
                  </span>
                )}
              </span>
              <span className="sr-only">Rank {row.rank}</span>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

/** Fourth place and below in a calm glass list: rank, player (level under the name), the tab's stat columns. */
function RankingTable({ rows, cols, isMe, season = false }) {
  const box = useRef(null);
  // bring the viewer's own row into view inside the list (the list scrolls, never the page)
  useEffect(() => {
    const el = box.current;
    const me = el?.querySelector('tr.is-me');
    if (!el || !me) return;
    const head = el.querySelector('thead')?.offsetHeight || 0;
    const top = me.offsetTop - head;
    if (top < el.scrollTop || top + me.offsetHeight > el.scrollTop + el.clientHeight - head) el.scrollTop = Math.max(0, top - (el.clientHeight - head - me.offsetHeight) / 2);
  }, [rows]);
  if (!rows.length) return <p className="cj-lb-ranks__none">Only the top three so far. Win a match to join them.</p>;
  return (
    <div className="cj-lb-ranks__scroll" ref={box} tabIndex={0} role="region" aria-label="Rankings from fourth place, scroll for more">
      <table className="cj-lb-table">
        <caption className="sr-only">{season ? 'Season standings from fourth place' : 'Players ranked fourth and below'}</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Player</th>
            {cols.map((c) => (
              <th scope="col" key={c.key}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const me = isMe(row);
            return (
              <tr key={`${row.rank}-${row.name}`} className={me ? 'is-me' : undefined} style={{ '--i': Math.min(i, 8) }}>
                <th scope="row">{row.rank}</th>
                <td>
                  <div className="cj-lb-player">
                    <Ava preset={row.avatar} size={34} frame={row.frame} />
                    <span className="cj-lb-player__text">
                      <span className="cj-lb-player__line">
                        <b title={row.name}>{row.name}</b>
                        {me && <span className="cj-lb-you">You</span>}
                      </span>
                      <span className="cj-lb-player__sub">
                        {!season && <span>Lv {row.level ?? 1}</span>}
                        <Title title={row.title} />
                      </span>
                    </span>
                  </div>
                </td>
                {cols.map((c) => (
                  <td key={c.key}>{fmtStat(statValue(row, c.key), c)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `/leaderboard`: Overall + one tab per ranked game (`?game=`) + the Season race (`?tab=season`). A cine page head with the
 * tabs as dim siblings, the top three as Top-10 numeral cards, the rest in a glass list that scrolls inside itself (the
 * page always fits the viewport). On the Season tab the season card (status, countdown, prize tiers) takes the record's spot.
 */
export default function Leaderboard() {
  const [params, setParams] = useSearchParams();
  const { account, guest, signedIn, user } = useAccount();
  const reduced = useReducedMotion();
  const { booting, ready, retry } = useApiGate();
  const live = useMemo(rankedList, []); // solo games keep no stats, so they get no tab

  const seasonOn = params.get('tab') === SEASON_TAB;
  const now = useNow();
  const wanted = params.get('game') || 'overall';
  const wantedGame = gameById(wanted);
  const gameId = wantedGame && live.some((g) => g.id === wantedGame.id) ? wantedGame.id : 'overall';
  const game = gameId === 'overall' ? null : gameById(gameId);
  // the rating column is guaranteed second (the top-three cards show the first two)
  const cols = seasonOn ? SEASON_COLS : game ? statDefsWithRating(game, 3) : OVERALL_COLS;
  const tab = seasonOn ? SEASON_TAB : gameId;

  const remote = useApi(seasonOn ? '/api/seasons/current' : `/api/leaderboard?game=${encodeURIComponent(gameId)}`, {
    enabled: ready,
    fetcher: seasonOn ? getCurrentSeason : undefined,
  });
  const state = booting ? 'loading' : !ready ? 'offline' : remote.status === 'idle' ? 'loading' : remote.status;
  const season = seasonOn && remote.data?.season && typeof remote.data.season === 'object' ? remote.data.season : null;
  const rows = useMemo(() => {
    if (seasonOn) return Array.isArray(remote.data?.standings) ? remote.data.standings.map(seasonRowToBoard).filter(Boolean) : [];
    return Array.isArray(remote.data?.rows) ? remote.data.rows.filter(isRow) : [];
  }, [remote.data, seasonOn]);

  const pick = useCallback(
    (id) => setParams(id === SEASON_TAB ? { tab: SEASON_TAB } : id === 'overall' ? {} : { game: gameSlug(id) }, { replace: true }),
    [setParams],
  );
  // The server marks the caller's own row (`isMe`, compared by user id) and sends it as `me` even when it is outside
  // the top N. Rows from an older server without the flag fall back to the name + avatar match.
  const isMe = useCallback(
    (r) => (typeof r.isMe === 'boolean' ? r.isMe : account && !!user?.name && r.name === user.name && (r.avatar === undefined || Number(r.avatar) === Number(user.avatar))),
    [account, user],
  );
  const inTop = rows.find(isMe) || null;
  const meRow = seasonOn ? seasonStanding(remote.data?.me) : isRow(remote.data?.me) ? remote.data.me : null;
  const mine = inTop || meRow;
  const lead = game || featured();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (state !== 'ok' || entered) return undefined;
    const timer = setTimeout(() => setEntered(true), 900);
    return () => clearTimeout(timer);
  }, [state, entered]);

  const populated = state === 'ok' && rows.length > 0 && (!seasonOn || !!season);
  let body;
  if (state === 'loading') body = <Skeleton />;
  else if (state === 'auth') {
    body = (
      <Notice
        icon="trophy"
        title={guest ? 'Rankings are for signed-in players' : 'Sign in to see the rankings'}
        action={
          <Link to={paths.login(paths.leaderboard(game?.id))} className="cj-btn cj-btn--primary">
            {guest ? 'Sign in with Google' : 'Sign in'}
          </Link>
        }
      >
        The leaderboard ranks players by their results in online games.
      </Notice>
    );
  } else if (state === 'offline') {
    body = (
      <Notice
        icon="wifiOff"
        title="You are offline"
        action={
          <button type="button" className="cj-btn cj-btn--primary" onClick={retry}>
            <HubIcon name="refresh" size={18} /> Try again
          </button>
        }
      >
        The rankings need a connection. Reconnect and try again.
      </Notice>
    );
  } else if (state === 'error') {
    body = (
      <Notice
        icon="refresh"
        title="Could not load the rankings"
        action={
          <button type="button" className="cj-btn cj-btn--primary" onClick={remote.reload}>
            <HubIcon name="refresh" size={18} /> Try again
          </button>
        }
      >
        Something went wrong on our side. Try again in a moment.
      </Notice>
    );
  } else if (seasonOn && !season) {
    body = (
      <Notice icon="trophy" title="No season right now">
        Seasons are points races with prizes for the top players: 3 points a win, 1 a game. The next one shows up here.
      </Notice>
    );
  } else if (seasonOn && !rows.length) {
    const cd = seasonCountdown(season, now);
    const upcoming = seasonStatusAt(season, now) === 'scheduled';
    body = (
      <Notice
        icon="trophy"
        title={upcoming ? `${season.name} is coming` : 'No points yet'}
        action={
          lead ? (
            <Link to={paths.game(lead.id)} className="cj-btn cj-btn--primary">
              <HubIcon name="play" size={16} /> Play {lead.name}
            </Link>
          ) : null
        }
      >
        {upcoming
          ? `${cd ? `${cd.text}. ` : ''}Every online match you finish in the season counts: 3 points a win, 1 a game.`
          : 'Finish an online match to put the first points on the board: 3 points a win, 1 a game.'}
      </Notice>
    );
  } else if (!rows.length) {
    body = (
      <Notice
        icon="trophy"
        title="No champions yet"
        action={
          lead ? (
            <Link to={paths.game(lead.id)} className="cj-btn cj-btn--primary">
              <HubIcon name="play" size={16} /> Play {lead.name}
            </Link>
          ) : null
        }
      >
        {game ? `Win an online ${game.name} match to claim the first spot on this board.` : 'Win an online match to claim the first spot on the board.'}
      </Notice>
    );
  } else {
    body = (
      <>
        {!account && (
          <div className="cj-lb-banner" role="note">
            <HubIcon name="user" size={18} />
            <p>{signedIn && guest ? 'Guests are not ranked. Sign in with Google to get on the board.' : 'Sign in to get on the board and see where you stand.'}</p>
            <Link to={paths.login(paths.leaderboard(game?.id))} className="cj-btn cj-btn--primary cj-btn--sm">
              Sign in
            </Link>
          </div>
        )}
        <TopThree rows={rows} cols={cols} isMe={isMe} />
        <section className="cj-lb-ranks" aria-labelledby="cj-lb-ranks-h">
          <header className="cj-lb-ranks__head">
            <h2 id="cj-lb-ranks-h" className="cj-lb-ranks__title">
              {seasonOn ? 'Standings' : 'Rankings'}
            </h2>
            <span className="cj-lb-ranks__count">{rows.length > 3 ? `#4 to #${rows[rows.length - 1].rank}` : `${rows.length} ranked`}</span>
          </header>
          <RankingTable rows={rows.slice(3)} cols={cols} isMe={isMe} season={seasonOn} />
          {account && (
            <p className="cj-lb-standing" aria-live="polite">
              {seasonOn ? (
                mine && mine.rank ? (
                  <>
                    You are <b>#{mine.rank}</b> this season with {fmtNum(mine.points ?? 0)} {Number(mine.points) === 1 ? 'point' : 'points'}.
                  </>
                ) : (
                  <>Finish an online match this season to get ranked.</>
                )
              ) : mine && mine.rank ? (
                <>
                  You are <b>#{mine.rank}</b> {game ? `in ${game.name}` : 'overall'}.
                </>
              ) : (
                <>You are not in the top {rows.length} yet. Win online matches to climb the board.</>
              )}
            </p>
          )}
        </section>
      </>
    );
  }

  return (
    <div
      className={`hub-page cj-lb${seasonOn ? ' cj-lb--season' : ''}`}
      data-state={populated ? 'populated' : state}
      data-intro={!entered && !reduced ? 'true' : undefined}
    >
      <div className="cj-ambient cj-lb-ambient" aria-hidden="true" />
      <header className="cj-pagehead cj-lb-head">
        <h1 className="cj-pagehead__title">Leaderboard</h1>
        <LeaderTabs games={live} value={tab} onChange={pick} panelId={PANEL_ID} extra={EXTRA_TABS} />
      </header>
      <section id={PANEL_ID} role="tabpanel" aria-labelledby={`hh2-tab-${tab}`} aria-busy={state === 'loading'} className="cj-lb-board">
        {body}
        {seasonOn ? (
          state === 'ok' ? <SeasonCard season={season} now={now} avatar={user?.avatar} /> : null
        ) : (
          <YourRecord game={game} user={user} liveGames={live} />
        )}
      </section>
    </div>
  );
}
