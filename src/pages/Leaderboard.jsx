import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import { featured, gameById, liveList } from '@/platform/home/catalog.js';
import { statDefsWithRating } from '@/platform/home/gameStats.js';
import { themeVars } from '@/platform/home/gameTheme.js';
import { useApi, useApiGate } from '@/platform/home/useApi.js';
import LeaderTabs from '@/platform/home/LeaderTabs.jsx';
import Podium from '@/platform/home/Podium.jsx';
import RankRow, { RankHead } from '@/platform/home/RankRow.jsx';
import SocialHead from '@/platform/social/SocialHead.jsx';
import StateCard from '@/platform/social/StateCard.jsx';
import YourRank from '@/platform/social/YourRank.jsx';
import { useAccount } from '@/components/shell/hooks.js';
import '@/styles/hubhome.css'; // Ava / game icon primitives
import '@/styles/store-social.css';

const OVERALL_COLS = [
  { key: 'wins', label: 'Wins' },
  { key: 'games', label: 'Games' },
];
const isRow = (r) => !!r && typeof r === 'object' && typeof r.name === 'string';
const PANEL_ID = 'hh2-lb-panel';

/** Placeholder shaped like the board (podium + rows) so nothing jumps when the data lands. */
function BoardSkeleton() {
  return (
    <div aria-hidden="true" className="sl-skel">
      <div className="sl-podium sl-podium--skel">
        {[2, 1, 3].map((p) => (
          <div key={p} className={`sl-slot sl-slot--${p}`}>
            <span className="st-skel sl-skel__ava" style={{ '--s': p === 1 ? '76px' : '58px' }} />
            <span className="st-skel sl-skel__line" style={{ width: '70%' }} />
            <span className="st-skel sl-skel__block" style={{ '--h': p === 1 ? '96px' : p === 2 ? '72px' : '56px' }} />
          </div>
        ))}
      </div>
      <ul className="sl-list">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="sl-row sl-row--skel">
            <span className="st-skel sl-skel__line" style={{ width: 22 }} />
            <span className="st-skel sl-skel__ava" style={{ '--s': '42px' }} />
            <span className="sl-row__who">
              <span className="st-skel sl-skel__line" style={{ width: `${62 - i * 6}%` }} />
              <span className="st-skel sl-skel__line sl-skel__line--s" style={{ width: '28%' }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** `/leaderboard`: Overall + one tab per live game (`?game=`), a podium for the top three, rows for the rest. */
export default function Leaderboard() {
  const [params, setParams] = useSearchParams();
  const { account, guest, user } = useAccount();
  const { booting, ready, retry } = useApiGate();
  const live = useMemo(liveList, []);

  const wanted = params.get('game') || 'overall';
  const gameId = wanted !== 'overall' && live.some((g) => g.id === wanted) ? wanted : 'overall';
  const game = gameId === 'overall' ? null : gameById(gameId);
  const cols = game ? statDefsWithRating(game, 4) : OVERALL_COLS;

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
  const loginHere = paths.login(paths.leaderboard(game?.id));

  let body;
  if (state === 'loading') body = <BoardSkeleton />;
  else if (state === 'auth') {
    body = (
      <StateCard
        icon="lock"
        title={guest ? 'Rankings are for signed-in players' : 'Sign in to see the rankings'}
        actions={[{ label: guest ? 'Sign in with Google' : 'Sign in', to: loginHere, primary: true }]}
      >
        The leaderboard ranks players by their results in online games.
      </StateCard>
    );
  } else if (state === 'offline') {
    body = (
      <StateCard
        icon="wifiOff"
        tone="warn"
        title="You are offline"
        actions={[{ label: 'Try again', icon: 'refresh', onClick: retry, primary: true }]}
      >
        The rankings need a connection. Reconnect and try again.
      </StateCard>
    );
  } else if (state === 'error') {
    body = (
      <StateCard
        icon="refresh"
        tone="bad"
        title="Could not load the rankings"
        actions={[{ label: 'Try again', icon: 'refresh', onClick: remote.reload, primary: true }]}
      >
        Something went wrong on our side. Try again in a moment.
      </StateCard>
    );
  } else if (!rows.length) {
    body = (
      <StateCard
        icon="trophy"
        title="No ranked games yet. Be the first."
        actions={lead ? [{ label: `Play ${lead.name}`, to: paths.game(lead.id), icon: 'play', primary: true }] : []}
      >
        {game ? `Win an online ${game.name} match to claim the first spot on this board.` : 'Win an online match to claim the first spot on the board.'}
      </StateCard>
    );
  } else {
    body = (
      <>
        <Podium rows={rows} cols={cols} />
        {rows.length > 3 && (
          <div className="sl-listwrap st-reveal" style={{ '--i': 1, '--cols': cols.length }}>
            <RankHead cols={cols} />
            <ol className="sl-list" start={4} aria-label="Ranks 4 and below">
              {rows.slice(3).map((r, i) => (
                <RankRow key={`${r.rank}-${r.name}`} row={r} cols={cols} style={{ '--i': Math.min(i, 10) }} />
              ))}
            </ol>
          </div>
        )}
        {pinned && (
          <div className="sl-pin" role="group" aria-label={`Your rank: ${pinned.rank ?? 'unranked'}`} style={{ '--cols': cols.length }}>
            <span className="sl-pin__gap" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <RankRow as="div" row={pinned} cols={cols} me className="sl-pin__row" />
          </div>
        )}
      </>
    );
  }

  return (
    <div className="hub-page sl-page st-scope" style={game ? themeVars(game) : undefined}>
      <SocialHead eyebrow="Rank" title="Leaderboard" sub="See who is winning across every game." id="sl-title" />
      <LeaderTabs games={live} value={gameId} onChange={pick} panelId={PANEL_ID} />
      <div className="sl-grid">
        <aside className="sl-side" aria-label="Your standing">
          <YourRank game={game} user={user} account={account} guest={guest} mine={mine} ready={state === 'ok'} liveGames={live} />
        </aside>
        <section id={PANEL_ID} role="tabpanel" aria-labelledby={`hh2-tab-${gameId}`} aria-busy={state === 'loading'} className="sl-board">
          {body}
          {state === 'ok' && rows.length > 0 && !game && live.length > 0 && (
            <p className="sl-foot">
              Ranked by experience across every game. Pick a game tab to see its own wins, rating and best score, or{' '}
              <Link to={paths.games()} className="st-link">
                browse all games
              </Link>
              .
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
