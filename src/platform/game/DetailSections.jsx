// The live game page below the quick-start card: how to play, your record, top players, open tables.
// Everything comes from the game's manifest and the hub API; every section has loading / empty / offline states
// and simply disappears when the manifest has nothing to say.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/art/index.js';
import { getOpenRooms } from '@/lib/api.js';
import { paths } from '@/platform/paths.js';
import { fmtStat, resolveGameStats } from '@/platform/home/gameStats.js';
import { useApi, useApiGate } from '@/platform/home/useApi.js';
import HubIcon from './HubIcon.jsx';

const STEP_ICONS = ['play', 'users', 'star', 'trophy'];
const MEDAL = ['#ffd24d', '#d9deea', '#e09a5b'];
const NF = new Intl.NumberFormat('en-IN');
const num = (v) => (Number.isFinite(Number(v)) ? NF.format(Math.round(Number(v))) : '—');
const COMPACT = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
/** Big numbers fit a small tile: 24,50,000 -> "24.5L" (money stays money via the stat's `format`). */
const short = (v, def) => (def?.format ? fmtStat(v, def) : Math.abs(Number(v)) >= 100000 ? COMPACT.format(Number(v)) : num(v));

/** `manifest.howToPlay` -> clean `[{ title, text, icon? }]` (max 4). */
export function howToPlaySteps(game) {
  const list = Array.isArray(game?.howToPlay) ? game.howToPlay : [];
  return list
    .filter((s) => s && typeof s.title === 'string' && s.title)
    .slice(0, 4)
    .map((s) => ({ title: s.title, text: typeof s.text === 'string' ? s.text : '', icon: typeof s.icon === 'string' ? s.icon : null }));
}

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

function SectionHead({ id, title, more }) {
  return (
    <div className="hub-panel__head xl-sec__head">
      <h2 id={id} className="hub-section__title">
        {title}
      </h2>
      {more}
    </div>
  );
}

function Offline({ text, onRetry }) {
  return (
    <div className="hub-note xl-note">
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

export function HowToPlay({ game }) {
  const steps = howToPlaySteps(game);
  if (!steps.length) return null;
  return (
    <section className="hub-panel xl-sec xl-how" aria-labelledby="xl-how-h">
      <SectionHead id="xl-how-h" title="How to play" />
      <ol className="xl-how__list">
        {steps.map((s, i) => (
          <li key={s.title} className="xl-how__step">
            <span className="xl-how__art" aria-hidden="true">
              <HubIcon name={s.icon || STEP_ICONS[i % STEP_ICONS.length]} size={26} />
              <i className="xl-how__num">{i + 1}</i>
            </span>
            <span className="xl-how__text">
              <b>{s.title}</b>
              {s.text && <small>{s.text}</small>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function YourRecord({ game, user }) {
  if (!user) return null;
  const { empty, tiles } = recordTiles(game, user);
  return (
    <section className="hub-panel xl-sec xl-record" aria-labelledby="xl-record-h">
      <SectionHead
        id="xl-record-h"
        title="Your record"
        more={
          <Link to={paths.profile()} className="hub-section__more">
            Profile
          </Link>
        }
      />
      <dl className="xl-record__grid">
        {tiles.map((t) => (
          <div key={t.key} className="xl-record__tile">
            <dt>{t.label}</dt>
            <dd>{t.value}</dd>
          </div>
        ))}
      </dl>
      {empty && <p className="hub-faint xl-record__hint">Play your first table and your numbers land here.</p>}
    </section>
  );
}

export function GameTopPlayers({ game }) {
  const { booting, ready, retry } = useApiGate();
  const { status, data, reload } = useApi(`/api/leaderboard?game=${encodeURIComponent(game.id)}`, { enabled: ready });
  const rows = Array.isArray(data?.rows) ? data.rows.slice(0, 3) : [];
  const state = booting ? 'loading' : !ready ? 'offline' : status;

  let body;
  if (state === 'loading') {
    body = (
      <ul className="xl-top" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="xl-top__row">
            <span className="hub-skel hub-skel--dot" style={{ width: 40, height: 40 }} />
            <span className="hub-skel hub-skel--line" style={{ width: '50%' }} />
          </li>
        ))}
      </ul>
    );
  } else if (state === 'ok' && rows.length) {
    body = (
      <ol className="xl-top">
        {rows.map((r, i) => (
          <li key={`${r.rank}-${r.name}`} className={`xl-top__row${r.isMe ? ' is-me' : ''}`} style={{ '--xl-medal': MEDAL[i] }}>
            <span className="xl-top__rank" aria-label={`Rank ${r.rank ?? i + 1}`}>
              {r.rank ?? i + 1}
            </span>
            <span className="xl-top__av" aria-hidden="true">
              <Avatar preset={Number(r.avatar) || 0} size={40} />
            </span>
            <span className="xl-top__who">
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
    body = <p className="hub-muted">No champions yet. Win a table to take the first spot.</p>;
  } else {
    body = <Offline text="The rankings are offline right now." onRetry={ready ? reload : retry} />;
  }

  return (
    <section className="hub-panel xl-sec xl-topplayers" aria-labelledby="xl-top-h" aria-busy={state === 'loading'}>
      <SectionHead
        id="xl-top-h"
        title="Top players"
        more={
          <Link to={paths.leaderboard(game.id)} className="hub-section__more">
            Full leaderboard <HubIcon name="chevR" size={16} />
          </Link>
        }
      />
      {body}
    </section>
  );
}

/** `getOpenRooms({ gameId })`, gated on the Worker answering (a static dev server makes no failing requests). */
function useOpenRooms(gameId) {
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

export function OpenTables({ game, onCreate, busy }) {
  const { status, rooms, reload } = useOpenRooms(game.id);
  const list = rooms.filter((r) => r && typeof r.code === 'string' && (!r.gameId || r.gameId === game.id));

  let body;
  if (status === 'loading') {
    body = (
      <ul className="xl-tables" aria-hidden="true">
        {[0, 1].map((i) => (
          <li key={i} className="xl-tables__row">
            <span className="hub-skel hub-skel--line" style={{ width: '60%' }} />
          </li>
        ))}
      </ul>
    );
  } else if (status === 'offline') {
    body = <Offline text="Couldn't load open tables." onRetry={reload} />;
  } else if (!list.length) {
    body = (
      <div className="xl-tables__empty">
        <p className="hub-muted">No open tables right now. Start one and share the code.</p>
        {onCreate && (
          <button type="button" className="hub-btn hub-btn--soft hub-btn--sm" onClick={onCreate} disabled={busy}>
            <HubIcon name="plus" size={16} /> Create table
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <ul className="xl-tables">
        {list.map((r) => {
          const count = Number(r.players) || 0;
          const max = Number(r.maxPlayers) || 0;
          const full = max > 0 && count >= max;
          return (
            <li key={r.code} className="xl-tables__row">
              <span className="xl-tables__who">
                <b>{r.hostName ? `${r.hostName}'s table` : 'Open table'}</b>
                <small>
                  <HubIcon name="users" size={13} /> {max ? `${count}/${max}` : count} players
                  {typeof r.summary === 'string' && r.summary && <> · {r.summary}</>}
                </small>
              </span>
              {full ? (
                <span className="hub-pill">Full</span>
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

  return (
    <section className="hub-panel xl-sec xl-open" aria-labelledby="xl-open-h" aria-busy={status === 'loading'}>
      <SectionHead id="xl-open-h" title="Open tables" />
      {body}
    </section>
  );
}
