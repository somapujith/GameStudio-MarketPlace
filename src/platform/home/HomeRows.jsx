// The rows under the home hero (docs/CINE_UI.md): Play now (posters), How it works (visitors),
// Top 10 on Jalebi today (outlined numerals + player cards), Coming soon (posters) and Achievements to chase (signed in).
// Every number is real; a row with nothing honest to show says so or steps aside.
import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { GamePoster } from '@/platform/browse/GameArt.jsx';
import { fmtNum } from '@/components/shell/ui.jsx';
import { useAccount } from '@/components/shell/hooks.js';
import { getAchievements } from '@/lib/api.js';
import { cosmeticById } from '@shared/cosmetics.js';
import { achievementProgress } from '@/platform/engagement/engagementModel.js';
import Ava from './Ava.jsx';
import { CineRow, CineSection } from './CineRow.jsx';
import { liveList, soonList } from './catalog.js';
import { useApi, useApiGate } from './useApi.js';
import { useLive } from './store/live.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ---------- Play now ---------- */
export function PlayRow() {
  const live = useLive();
  const perGame = live?.perGame || {};
  const games = liveList();
  if (!games.length) return null;
  return (
    <CineSection id="home-play" title="Play now" to={paths.games()} data-tour="home-play" className="cj-home-play">
      <CineRow label="Games you can play now" count={games.length}>
        {games.map((g) => (
          <li key={g.id}>
            <GamePoster game={g} tables={perGame[g.id]} />
          </li>
        ))}
      </CineRow>
    </CineSection>
  );
}

/* ---------- Coming soon ---------- */
export function SoonRow() {
  const games = soonList();
  if (!games.length) return null;
  return (
    <CineSection id="home-soon" title="Coming soon" to={`${paths.games()}?status=soon`} className="cj-home-soon">
      <CineRow label="Coming soon" count={games.length}>
        {games.map((g) => (
          <li key={g.id}>
            <GamePoster game={g} />
          </li>
        ))}
      </CineRow>
    </CineSection>
  );
}

/* ---------- How it works (visitors with no session) ---------- */
const STEPS = [
  { icon: 'gamepad', title: 'Pick a game', text: 'Choose a game and how many players.' },
  { icon: 'hash', title: 'Share a code', text: 'Send the table code to your friends on WhatsApp.' },
  { icon: 'play', title: 'Play together', text: 'Everyone joins from their own phone. No download.' },
];

export function HowItWorks() {
  return (
    <CineSection id="home-how" title="Play with friends in three steps" data-tour="home-how" className="cj-home-how">
      <div className="cj-home-how__body">
        <ol className="cj-home-how__steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="cj-home-how__step">
              <span className="cj-home-how__n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="cj-home-how__ico" aria-hidden="true">
                <HubIcon name={s.icon} size={20} />
              </span>
              <b>{s.title}</b>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
        <div className="cj-home-how__cta sh-how__cta">
          <Link to={paths.login(paths.hub())} className="cj-btn cj-btn--primary">
            Sign in
          </Link>
          <Link to={paths.login(paths.hub())} className="cj-btn">
            Play as guest
          </Link>
        </div>
      </div>
    </CineSection>
  );
}

/* ---------- Top 10 on Jalebi today ---------- */
const TINTS = ['#f5c66b', '#d9deea', '#e09a5b'];

function titleName(id) {
  const c = typeof id === 'string' ? cosmeticById(id) : null;
  return c && c.kind === 'title' ? c.name : '';
}

function PlayerCard({ r, i }) {
  const me = r.isMe === true;
  const title = titleName(r.title);
  const level = Number(r.level) || 0;
  const wins = Number(r.wins) || 0;
  return (
    <Link
      to={paths.leaderboard()}
      className={`cj-poster cj-home-player ${me ? 'is-me' : ''}`}
      style={{ '--tint': TINTS[i] || 'rgba(107, 227, 138, 0.55)' }}
      aria-label={`Rank ${r.rank ?? i + 1}: ${r.name}${me ? ' (you)' : ''}${title ? `, ${title}` : ''}${level ? `, level ${level}` : ''}, ${plural(wins, 'win')}`}
    >
      <span className="cj-home-player__glow" aria-hidden="true" />
      <span className="cj-home-player__ava" aria-hidden="true">
        <Ava preset={r.avatar} size={i < 3 ? 92 : 80} frame={r.frame} />
      </span>
      {me && <span className="cj-poster__badge">You</span>}
      <span className="cj-poster__title cj-home-player__name" aria-hidden="true">
        {r.name}
        <span className="cj-poster__sub">
          {title ? `${title} · ` : ''}
          {level ? `Lv ${level} · ` : ''}
          {fmtNum(wins)} {wins === 1 ? 'win' : 'wins'}
        </span>
      </span>
    </Link>
  );
}

/** Columns for a short grid so the last row is never a lone card: up to 4 in one line, otherwise two even rows. */
const balancedCols = (n) => (n <= 4 ? Math.max(1, n) : Math.ceil(n / 2));

export function Top10Row() {
  const { booting, ready, retry } = useApiGate();
  const { status, data, reload } = useApi('/api/leaderboard?game=overall', { enabled: ready });
  const rows = Array.isArray(data?.rows) ? data.rows.filter((r) => r && r.name).slice(0, 10) : [];
  const state = booting ? 'loading' : !ready ? 'offline' : status === 'idle' ? 'loading' : status;

  let body;
  if (state === 'loading') {
    body = (
      <ul className="cj-top10 cj-home-top10" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <li key={n}>
            <span className="cj-top10__num">{n}</span>
            <span className="cj-poster cj-home-skel" />
          </li>
        ))}
      </ul>
    );
  } else if (state === 'ok' && rows.length) {
    body = (
      <ul className="cj-top10 cj-home-top10" aria-label="Top 10 players" style={{ '--cols': balancedCols(rows.length) }}>
        {rows.map((r, i) => (
          <li key={`${r.rank}-${r.name}`}>
            <span className="cj-top10__num" aria-hidden="true">
              {r.rank ?? i + 1}
            </span>
            <PlayerCard r={r} i={i} />
          </li>
        ))}
      </ul>
    );
  } else if (state === 'ok') {
    body = <Note icon="trophy" title="No champions yet" text="Win an online match to take the first spot." />;
  } else if (state === 'auth') {
    body = (
      <Note icon="trophy" title="Rankings are for signed-in players" text="Sign in to see the leaderboard and climb it.">
        <Link to={paths.login(paths.leaderboard())} className="cj-btn cj-btn--primary cj-btn--sm">
          Sign in
        </Link>
      </Note>
    );
  } else {
    body = (
      <Note icon="wifiOff" title="The rankings are offline" text="They come back as soon as the server does.">
        <button type="button" className="cj-btn cj-btn--sm" onClick={ready ? reload : retry}>
          <HubIcon name="refresh" size={16} /> Retry
        </button>
      </Note>
    );
  }

  return (
    <CineSection id="home-top" title="Top 10 on Jalebi today" to={paths.leaderboard()} data-tour="home-top" className="cj-home-top" aria-busy={state === 'loading' || undefined}>
      {body}
    </CineSection>
  );
}

/** A calm one-line state inside a row (empty, offline, signed out). */
export function Note({ icon, title, text, children, live }) {
  return (
    <div className="cj-home-note" role={live ? 'status' : undefined}>
      <span className="cj-home-note__ico" aria-hidden="true">
        <HubIcon name={icon} size={20} />
      </span>
      <p className="cj-home-note__text">
        <b>{title}</b>
        {text && <span>{text}</span>}
      </p>
      {children && <div className="cj-home-note__act">{children}</div>}
    </div>
  );
}

/* ---------- Achievements to chase (signed in) ---------- */
export function AchievementsRow() {
  const { signedIn } = useAccount();
  const { ready } = useApiGate();
  const { status, data } = useApi('/api/achievements', { enabled: ready && signedIn, fetcher: getAchievements });
  if (!signedIn) return null;
  const list = Array.isArray(data?.achievements) ? data.achievements : [];
  const chase = list
    .filter((a) => a && !a.unlocked && a.progress !== null && a.progress !== undefined)
    .map((a) => ({ a, p: achievementProgress(a) }))
    .filter((x) => x.p)
    .sort((x, y) => y.p.pct - x.p.pct)
    .slice(0, 10);
  const loading = status === 'loading' || status === 'idle';
  if (!loading && (status !== 'ok' || !chase.length)) return null; // nothing honest to chase (or offline): step aside
  const to = `${paths.profile()}#achievements`;
  return (
    <CineSection
      id="home-ach"
      title="Achievements to chase"
      to={to}
      className="cj-home-achs"
      aria-busy={loading || undefined}
      extra={status === 'ok' && Number.isFinite(data?.total) ? <span className="cj-home-count">{`${data.unlocked ?? 0} of ${data.total} unlocked`}</span> : null}
    >
      {loading ? (
        <ul className="cj-row" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i}>
              <span className="cj-home-ach cj-home-skel" />
            </li>
          ))}
        </ul>
      ) : (
        <CineRow label="Achievements to chase" count={chase.length} style={{ '--cols': balancedCols(chase.length) }}>
          {chase.map(({ a, p }) => (
            <li key={a.id}>
              <Link to={to} className="cj-home-ach">
                <span className="cj-home-ach__medal" aria-hidden="true">
                  <HubIcon name={a.icon} size={22} strokeWidth={2.2} />
                </span>
                <span className="cj-home-ach__body">
                  <b>{a.name}</b>
                  <small>{a.description}</small>
                  <span className="cj-home-ach__bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(3, p.pct)}%` }} />
                  </span>
                  <span className="cj-home-ach__foot">
                    <span>
                      <span className="hub-sr">Progress: </span>
                      {p.text}
                    </span>
                    {Number(a.reward?.coins) > 0 && <span className="cj-home-ach__coins">+{fmtNum(a.reward.coins)} coins</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </CineRow>
      )}
    </CineSection>
  );
}
