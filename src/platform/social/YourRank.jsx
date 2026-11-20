import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import { fmtStat, resolveGameStats, statDefsWithRating } from '@/platform/home/gameStats.js';
import { fmtNum } from '@/components/shell/ui.jsx';
import { useAccountProgress } from '@/platform/home/accountProgress.js';
import SIcon from './SIcon.jsx';

/**
 * The "your standing" card beside / above the board. Signed in: your rank on this tab (or "not ranked yet") and your
 * numbers for it. Signed out or guest: an honest invitation to sign in. `mine` is your row (or null).
 */
export default function YourRank({ game, user, account, guest, mine, ready, liveGames }) {
  // server level when signed in: the same number the top bar and Profile show
  const { level, coins } = useAccountProgress();
  const where = game ? game.name : 'Overall';
  const here = paths.login(paths.leaderboard(game?.id));

  if (!account) {
    return (
      <section className="sl-me sl-me--gate" aria-labelledby="sl-me-h">
        <span className="st-eyebrow">Your rank</span>
        <h2 id="sl-me-h" className="sl-me__title">
          {guest ? 'Guests are not ranked' : 'Get on the board'}
        </h2>
        <p className="sl-me__text">
          {guest ? 'Sign in with Google to turn your wins into a rank and see where you stand.' : 'Sign in, win online matches and your name lands here for everyone to see.'}
        </p>
        <Link to={here} className="hub-btn hub-btn--primary">
          {guest ? 'Sign in with Google' : 'Sign in'}
        </Link>
      </section>
    );
  }

  let tiles;
  if (game) {
    const stats = resolveGameStats({ user, gameId: game.id });
    tiles = stats ? statDefsWithRating(game, 4).map((d) => ({ label: d.label, value: fmtStat(stats[d.key] ?? null, d) })) : null;
  } else {
    const per = liveGames.map((g) => resolveGameStats({ user, gameId: g.id })).filter(Boolean);
    tiles = [
      { label: 'Level', value: fmtNum(level) },
      { label: 'Wins', value: fmtNum(per.reduce((n, s) => n + s.wins, 0)) },
      { label: 'Games', value: fmtNum(per.reduce((n, s) => n + s.games, 0)) },
      { label: 'Coins', value: fmtNum(coins) },
    ];
  }
  const rank = mine && mine.rank ? mine.rank : null;

  return (
    <section className="sl-me" aria-labelledby="sl-me-h" aria-live="polite">
      <span className="st-eyebrow">Your rank</span>
      <h2 id="sl-me-h" className="sl-me__title">
        {rank ? (
          <>
            <span className="sl-me__hash" aria-hidden="true">
              #
            </span>
            <span className="sl-me__num">{rank}</span>
            <span className="sl-me__where">in {where}</span>
          </>
        ) : ready ? (
          <>
            <span className="sl-me__num sl-me__num--none">Unranked</span>
            <span className="sl-me__where">in {where}</span>
          </>
        ) : (
          <span className="sl-me__num sl-me__num--none">Your record</span>
        )}
      </h2>
      {ready && !rank && (
        <p className="sl-me__text">
          {game ? `Finish an online ${game.name} match to get on the board.` : 'Finish an online match to get on the board.'}
        </p>
      )}
      {tiles ? (
        <dl className="sl-me__tiles">
          {tiles.map((t) => (
            <div key={t.label}>
              <dt>{t.label}</dt>
              <dd>{t.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="sl-me__text">
          No {game?.name} games yet.{' '}
          <Link to={paths.game(game.id)} className="st-link">
            Play your first one
          </Link>
        </p>
      )}
      {game && (
        <Link to={paths.game(game.id)} className="hub-btn hub-btn--accent hub-btn--sm sl-me__cta">
          <SIcon name="play" size={16} /> Play {game.name}
        </Link>
      )}
    </section>
  );
}
