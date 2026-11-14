import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { featured, gameById, liveList } from '@/platform/home/catalog.js';
import { fmtStat, resolveGameStats, statDefsWithRating } from '@/platform/home/gameStats.js';
import { useApi, useApiGate } from '@/platform/home/useApi.js';
import PageHead from '@/platform/home/PageHead.jsx';
import LeaderTabs from '@/platform/home/LeaderTabs.jsx';
import Podium from '@/platform/home/Podium.jsx';
import RankRow from '@/platform/home/RankRow.jsx';
import { useAccount, useProgress } from '@/components/shell/hooks.js';
import { fmtNum } from '@/components/shell/ui.jsx';
import '@/styles/hubhome.css';
import '@/styles/x-profile.css';

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

/** "Your record" under the board: the selected game's numbers, or platform totals on the Overall tab. */
function YourRecord({ game, user, liveGames }) {
  const { info: li, coins } = useProgress();
  let tiles;
  let title;
  let note = null;
  if (!game) {
    const per = liveGames.map((g) => resolveGameStats({ user, gameId: g.id })).filter(Boolean);
    title = 'Your record';
    tiles = [
      { label: 'Level', value: fmtNum(li.level) },
      { label: 'Games', value: fmtNum(per.reduce((n, s) => n + s.games, 0)) },
      { label: 'Wins', value: fmtNum(per.reduce((n, s) => n + s.wins, 0)) },
      { label: 'Coins', value: fmtNum(coins) },
    ];
  } else {
    const stats = resolveGameStats({ user, gameId: game.id });
    title = `Your ${game.name} record`;
    tiles = stats ? statDefsWithRating(game, 4).map((d) => ({ label: d.label, value: fmtStat(stats[d.key] ?? null, d) })) : null;
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
    <section className="hub-panel hh2-record" aria-labelledby="hh2-rec-h">
      <h2 id="hh2-rec-h" className="hub-section__title">
        {title}
      </h2>
      {tiles && (
        <dl className="hub-stats">
          {tiles.map((t) => (
            <div key={t.label} className="hub-stats__tile">
              <dt>{t.label}</dt>
              <dd>{t.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {note}
    </section>
  );
}

/** `/leaderboard` — Overall + one tab per live game (`?game=`), podium for the top three, rows for the rest. */
export default function Leaderboard() {
  const [params, setParams] = useSearchParams();
  const { account, guest, signedIn, user } = useAccount();
  const { booting, ready, retry } = useApiGate();
  const live = useMemo(liveList, []);

  const wanted = params.get('game') || 'overall';
  const gameId = wanted !== 'overall' && live.some((g) => g.id === wanted) ? wanted : 'overall';
  const game = gameId === 'overall' ? null : gameById(gameId);
  const cols = game ? statDefsWithRating(game, 3) : OVERALL_COLS;

  const remote = useApi(`/api/leaderboard?game=${encodeURIComponent(gameId)}`, { enabled: ready });
  const state = booting ? 'loading' : !ready ? 'offline' : remote.status === 'idle' ? 'loading' : remote.status;
  const rows = useMemo(() => (Array.isArray(remote.data?.rows) ? remote.data.rows.filter(isRow) : []), [remote.data]);

  const pick = useCallback((id) => setParams(id === 'overall' ? {} : { game: id }, { replace: true }), [setParams]);
  // The server marks the caller's own row (`isMe`) and sends it as `me` even when it is outside the top N.
  const inTop = rows.find((r) => r.isMe === true) || null;
  const meRow = isRow(remote.data?.me) ? { ...remote.data.me, isMe: true } : null;
  const mine = inTop || meRow;
  const pinned = !inTop && meRow ? meRow : null;
  const lead = game || featured();

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
  } else if (state === 'offline' || state === 'error') {
    body = (
      <Notice
        icon="wifiOff"
        title="Cannot reach the server"
        action={
          <button type="button" className="hub-btn hub-btn--primary" onClick={ready ? remote.reload : retry}>
            <HubIcon name="refresh" size={18} /> Try again
          </button>
        }
      >
        The rankings need a connection. Try again in a moment.
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
        Win an online match to claim the first spot on the board.
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
        <Podium rows={rows} cols={cols} />
        {rows.length > 3 && (
          <ol className="hh2-lb__list xp-list" start={4} aria-label="Ranks 4 and below">
            {rows.slice(3).map((r, i) => (
              <RankRow key={`${r.rank}-${r.name}`} row={r} cols={cols} style={{ '--i': Math.min(i, 12) }} />
            ))}
          </ol>
        )}
        {pinned && (
          <div className="xp-pin" role="group" aria-label={`Your rank: ${pinned.rank ?? 'unranked'}`}>
            <span className="xp-pin__gap" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <RankRow as="div" row={pinned} cols={cols} me className="xp-pin__row" />
          </div>
        )}
        {account && (
          <p className="hh2-lb__standing" aria-live="polite">
            {mine && mine.rank ? (
              <>
                You are <b>#{mine.rank}</b> {game ? `in ${game.name}` : 'overall'}
                {pinned ? '. Keep winning to break into the top.' : '.'}
              </>
            ) : (
              <>You are not ranked{game ? ` in ${game.name}` : ''} yet. Finish an online match to get on the board.</>
            )}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="hub-page hh2 hh2-lbpage xp-page">
      <PageHead title="Leaderboard" sub="See who is winning across every game." icon={<HubIcon name="podium" size={26} />} />
      <LeaderTabs games={live} value={gameId} onChange={pick} panelId={PANEL_ID} />
      <div className="hh2-lbgrid">
        <section id={PANEL_ID} role="tabpanel" aria-labelledby={`hh2-tab-${gameId}`} aria-busy={state === 'loading'} className="hh2-lb">
          {body}
        </section>
        <YourRecord game={game} user={user} liveGames={live} />
      </div>
    </div>
  );
}
