import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import { gameSlug } from '@/platform/game/identity.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { featured, gameById, liveList } from '@/platform/home/catalog.js';
import { fmtStat, resolveGameStats, statDefsWithRating, statValue } from '@/platform/home/gameStats.js';
import { useAccountProgress } from '@/platform/home/accountProgress.js';
import { useApi, useApiGate } from '@/platform/home/useApi.js';
import LeaderTabs from '@/platform/home/LeaderTabs.jsx';
import Ava, { Title } from '@/platform/home/Ava.jsx';
import { useAccount, useReducedMotion } from '@/components/shell/hooks.js';
import { fmtNum } from '@/components/shell/ui.jsx';
import { CoinIcon } from '@/components/shell/icons.jsx';
import '@/styles/hubhome.css';
import '@/platform/home/leaderboard-cinema.css';
import '@/platform/home/leaderboard-tablet.css';
import '@/platform/home/leaderboard-phone.css';

const OVERALL_COLS = [
  { key: 'wins', label: 'Wins' },
  { key: 'games', label: 'Games' },
];
const isRow = (r) => !!r && typeof r === 'object' && typeof r.name === 'string';
const PANEL_ID = 'hh2-lb-panel';

function Skeleton() {
  return (
    <div aria-hidden="true">
      <div className="hh2-podium hh2-podium--skel">
        {[2, 1, 3].map((p) => (
          <div key={p} className="hh2-podium__slot" style={{ gridColumn: p === 1 ? 2 : p === 2 ? 1 : 3 }}>
            <span className="hub-skel hub-skel--dot" style={{ width: p === 1 ? 76 : 60, height: p === 1 ? 76 : 60 }} />
            <span className="hub-skel hub-skel--line" style={{ width: '70%', height: 12 }} />
            <span className="hub-skel" style={{ width: '100%', height: p === 1 ? 84 : 60, borderRadius: '14px 14px 0 0' }} />
          </div>
        ))}
      </div>
      <ul className="hh2-lb__list">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="hh2-lb__row">
            <span className="hub-skel hub-skel--line" style={{ width: 24 }} />
            <span className="hub-skel hub-skel--dot" style={{ width: 44, height: 44 }} />
            <span className="hh2-lb__who">
              <span className="hub-skel hub-skel--line" style={{ width: '55%' }} />
              <span className="hub-skel hub-skel--line" style={{ width: '30%', height: 10, marginTop: 8 }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notice({ icon, title, children, action }) {
  return (
    <div className="hub-empty">
      <span className="hub-empty__icon" aria-hidden="true">
        <HubIcon name={icon} size={28} />
      </span>
      <p className="hub-empty__title">{title}</p>
      <p className="hub-empty__text">{children}</p>
      {action && <div className="hub-empty__actions">{action}</div>}
    </div>
  );
}

/** The paper scorecard uses account results for the selected game or platform totals. */
function YourRecord({ game, user, liveGames }) {
  // server level when signed in: the same number the top bar and Profile show
  const { level, coins } = useAccountProgress();
  let tiles;
  let title;
  let note = null;
  if (!game) {
    const per = liveGames.map((g) => resolveGameStats({ user, gameId: g.id })).filter(Boolean);
    const games = per.reduce((n, s) => n + s.games, 0);
    const wins = per.reduce((n, s) => n + s.wins, 0);
    title = 'Your record';
    tiles = [
      { label: 'Level', icon: 'podium', value: fmtNum(level) },
      { label: 'Games', icon: 'gamepad', value: fmtNum(games) },
      { label: 'Wins', icon: 'trophy', value: fmtNum(wins) },
      { label: 'Coins', icon: 'coins', value: fmtNum(coins) },
      { label: 'Win rate', icon: 'target', value: `${games ? Math.round(wins / games * 100) : 0}%` },
    ];
  } else {
    const stats = resolveGameStats({ user, gameId: game.id });
    title = 'Your record';
    tiles = stats ? [
      ...statDefsWithRating(game, 3).map((d) => ({ label: d.label, icon: d.key === 'wins' ? 'trophy' : d.key === 'games' ? 'gamepad' : 'star', value: fmtStat(stats[d.key] ?? (d.key === 'bestScore' ? stats.bestScore : null), d) })),
      { label: 'Coins', icon: 'coins', value: fmtNum(coins) },
      { label: 'Win rate', icon: 'target', value: `${stats.games ? Math.round(stats.wins / stats.games * 100) : 0}%` },
    ] : null;
    if (!tiles) {
      note = (
        <p className="hub-muted">
          No {game.name} games yet.{' '}
          <Link to={paths.game(game.id)} className="hh2-textlink">
            Play your first one
          </Link>
        </p>
      );
    }
  }
  return (
    <section className="leader-record" aria-labelledby="hh2-rec-h">
      <span className="leader-record__eyes" aria-hidden="true"><i /><i /></span>
      <h2 id="hh2-rec-h">
        {title}
      </h2>
      {tiles && (
        <dl className="leader-record__stats">
          {tiles.map((t, i) => (
            <div key={t.label} className={i > 2 ? 'leader-record__wide' : undefined}>
              <dt>{t.icon === 'coins' ? <CoinIcon size={23} /> : <HubIcon name={t.icon} size={23} />}{t.label}</dt>
              <dd>{t.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {note}
    </section>
  );
}

/** Reading order remains first, second, third; the stage places the winner in the middle. */
function ChampionPodium({ rows, cols, isMe }) {
  const medals = ['#ffcf68', '#f3dcc0', '#df9b56'];
  return <div className="leader-podium"><ol className="leader-podium__players" aria-label="Top three players">
    {rows.slice(0,3).map((row,i)=><li key={`${row.rank}-${row.name}`} className={`leader-champion leader-champion--${i+1}${isMe(row)?' is-me':''}`}>
      {i===0 && <span className="leader-champion__crown" aria-hidden="true"><HubIcon name="crown" size={48} /></span>}
      <Ava preset={row.avatar} size={i===0?128:94} ring={medals[i]} frame={row.frame} />
      <b className="leader-champion__name" title={row.name}>{row.name}</b>
      {isMe(row) && <span className="leader-you">You</span>}
      <Title title={row.title} />
      <p className="leader-champion__stats">{cols.slice(0,2).map((c,j)=><span key={c.key}>{j>0 && <span aria-hidden="true"> &middot; </span>}{fmtStat(statValue(row,c.key),c)} {c.label.toLowerCase()}</span>)}</p>
      <span className="hub-sr">Rank {row.rank}</span>
    </li>)}
  </ol><div className="leader-platform" aria-hidden="true"><img src="/art/cinematic/podium-stage.webp" width="1100" height="366" alt="" />{rows.slice(0,3).map((row,i)=><span key={row.rank} className={`leader-platform__rank leader-platform__rank--${i+1}`}>{row.rank}</span>)}</div></div>;
}

function RankingTable({ rows, cols, isMe }) {
  if(!rows.length) return null;
  return <div className="leader-ranks" tabIndex={0} role="region" aria-label="Rankings from fourth place, scroll for more columns">
    <table><caption className="hub-sr">Players ranked fourth and below</caption><thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Level</th>{cols.map(c=><th scope="col" key={c.key}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((row,i)=><tr key={`${row.rank}-${row.name}`} className={isMe(row)?'is-me':undefined} style={{'--rank-delay':`${Math.min(i,8)*25}ms`}}>
        <th scope="row">{row.rank}</th><td><div className="leader-ranks__player"><Ava preset={row.avatar} size={42} frame={row.frame} /><b title={row.name}>{row.name}</b>{isMe(row)&&<span className="leader-you">You</span>}<Title title={row.title} /></div></td>
        <td><span className="leader-ranks__level"><HubIcon name="star" size={18} />Lv {row.level??1}</span></td>{cols.map(c=><td key={c.key}>{fmtStat(statValue(row,c.key),c)}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

/** `/leaderboard` — Overall + one tab per live game (`?game=`), podium for the top three, rows for the rest. */
export default function Leaderboard() {
  const [params, setParams] = useSearchParams();
  const { account, guest, signedIn, user } = useAccount();
  const reduced = useReducedMotion();
  const { booting, ready, retry } = useApiGate();
  const live = useMemo(liveList, []);

  const wanted = params.get('game') || 'overall';
  const wantedGame = gameById(wanted);
  const gameId = wantedGame && live.some((g) => g.id === wantedGame.id) ? wantedGame.id : 'overall';
  const game = gameId === 'overall' ? null : gameById(gameId);
  // the rating column is guaranteed second (the podium shows the first two)
  const cols = game ? statDefsWithRating(game, 3) : OVERALL_COLS;

  const remote = useApi(`/api/leaderboard?game=${encodeURIComponent(gameId)}`, { enabled: ready });
  const state = booting ? 'loading' : !ready ? 'offline' : remote.status === 'idle' ? 'loading' : remote.status;
  const rows = useMemo(() => (Array.isArray(remote.data?.rows) ? remote.data.rows.filter(isRow) : []), [remote.data]);

  const pick = useCallback((id) => setParams(id === 'overall' ? {} : { game: gameSlug(id) }, { replace: true }), [setParams]);
  // The server marks the caller's own row (`isMe`, compared by user id) and sends it as `me` even when it is outside
  // the top N. Rows from an older server without the flag fall back to the name + avatar match.
  const isMe = useCallback(
    (r) => (typeof r.isMe === 'boolean' ? r.isMe : account && !!user?.name && r.name === user.name && (r.avatar === undefined || Number(r.avatar) === Number(user.avatar))),
    [account, user],
  );
  const inTop = rows.find(isMe) || null;
  const meRow = isRow(remote.data?.me) ? remote.data.me : null;
  const mine = inTop || meRow;
  const lead = game || featured();
  const [entered, setEntered] = useState(false);
  const [paused, setPaused] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const change = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if(state !== 'ok' || entered) return undefined;
    const timer = setTimeout(() => setEntered(true), 700);
    return () => clearTimeout(timer);
  }, [state, entered]);

  let body;
  if (state === 'loading') body = <Skeleton />;
  else if (state === 'auth') {
    body = (
      <Notice
        icon="trophy"
        title={guest ? 'Rankings are for signed-in players' : 'Sign in to see the rankings'}
        action={
          <Link to={paths.login(paths.leaderboard(game?.id))} className="hub-btn hub-btn--primary">
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
          <button type="button" className="hub-btn hub-btn--primary" onClick={retry}>
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
          <button type="button" className="hub-btn hub-btn--primary" onClick={remote.reload}>
            <HubIcon name="refresh" size={18} /> Try again
          </button>
        }
      >
        Something went wrong on our side. Try again in a moment.
      </Notice>
    );
  } else if (!rows.length) {
    body = (
      <Notice
        icon="trophy"
        title="No champions yet"
        action={
          lead ? (
            <Link to={paths.game(lead.id)} className="hub-btn hub-btn--primary">
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
          <div className="hh2-banner">
            <HubIcon name="user" size={20} />
            <p>{signedIn && guest ? 'Guests are not ranked. Sign in with Google to get on the board.' : 'Sign in to get on the board and see where you stand.'}</p>
            <Link to={paths.login(paths.leaderboard(game?.id))} className="hub-btn hub-btn--primary hub-btn--sm">
              Sign in
            </Link>
          </div>
        )}
        <ChampionPodium rows={rows} cols={cols} isMe={isMe} />
        <RankingTable rows={rows.slice(3)} cols={cols} isMe={isMe} />
        {account && (
          <p className="leader-standing" aria-live="polite">
            {mine && mine.rank ? (
              <>
                You are <b>#{mine.rank}</b> {game ? `in ${game.name}` : 'overall'}.
              </>
            ) : (
              <>You are not in the top {rows.length} yet. Win online matches to climb the board.</>
            )}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="hub-page hh2 leader-cinema" data-state={state==='ok'&&rows.length?'populated':state} data-intro={!entered&&!reduced?'true':undefined} data-reduced={reduced?'':undefined} data-paused={paused?'':undefined}>
      <img className="leader-cinema__scene" src="/art/cinematic/leaderboard-scene.webp" width="2048" height="1024" alt="" fetchPriority="high" decoding="async" />
      <header className="leader-intro">
        <HubIcon className="leader-intro__crown" name="crown" size={45} />
        <h1>Leaderboard</h1><p>See who&rsquo;s winning across every game.</p>
        <LeaderTabs games={live} value={gameId} onChange={pick} panelId={PANEL_ID} />
      </header>
        <section id={PANEL_ID} role="tabpanel" aria-labelledby={`hh2-tab-${gameId}`} aria-busy={state === 'loading'} className="leader-board">
          {body}
        </section>
        <YourRecord game={game} user={user} liveGames={live} />
    </div>
  );
}
