// The primary action of a game listing: players stepper, Create table, sign-in copy, Join with a code, Share.
// Desktop: the panel sits in the sticky side column. Phones: it follows the title, and once it has scrolled
// away a compact bar anchored above the tab bar keeps "Create table" one tap away.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '@/components/shell/Toast.jsx';
import { featuredGame } from '@/games/registry.js';
import { paths } from '@/platform/paths.js';
import { GameIcon } from '@/platform/home/GameArt.jsx';
import HubIcon from './HubIcon.jsx';
import MapPicker from '@/components/online/MapPicker.jsx';
import { hasMaps, playersLabel, shareData } from './detailModel.js';
import { useNotify } from './notify.js';

const DEFAULT_HINT = 'You get a code to share. Friends join, then you start.';

/** Share the listing: the system share sheet when there is one, otherwise copy the link and say so. */
export function ShareButton({ game, className = 'hub-btn hub-btn--ghost hub-btn--lg' }) {
  const toast = useToast();
  const onShare = async () => {
    const url = typeof window !== 'undefined' ? window.location.href.split('#')[0] : '';
    const data = shareData(game, url);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (typeof navigator.canShare !== 'function' || navigator.canShare(data))) {
        await navigator.share(data);
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // the player closed the share sheet
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. Send it to your friends.', { tone: 'success' });
    } catch {
      toast(`Copy this link: ${url}`, { duration: 7000 });
    }
  };
  return (
    <button type="button" className={className} onClick={onShare} data-tour="game-share">
      <HubIcon name="share" size={18} /> Share
    </button>
  );
}

/** Minus / value / plus. `options` is the contiguous list of allowed seat counts. */
export function Stepper({ options, value, onChange, disabled, label }) {
  const min = options[0];
  const max = options[options.length - 1];
  const set = (n) => onChange(Math.max(min, Math.min(max, n)));
  return (
    <div className="gd-stepper" role="group" aria-label={label}>
      <button type="button" className="gd-stepper__btn" onClick={() => set(value - 1)} disabled={disabled || value <= min} aria-label="One fewer player">
        <HubIcon name="minus" size={20} />
      </button>
      <output className="gd-stepper__val" aria-live="polite" aria-label={`${value} players`}>
        <b key={value}>{value}</b>
      </output>
      <button type="button" className="gd-stepper__btn" onClick={() => set(value + 1)} disabled={disabled || value >= max} aria-label="One more player">
        <HubIcon name="plus" size={20} />
      </button>
    </div>
  );
}

/** Label and helper copy for the current session state. */
export function createCopy({ user, authLoading, reachable, busy, game }) {
  const signedOut = !user && !authLoading;
  if (busy) return { label: 'Creating table…', signedOut, hint: DEFAULT_HINT };
  if (signedOut) return { label: 'Sign in to play', signedOut, hint: 'Sign in with Google, or continue as a guest with just a name, before you host or join a table.', offline: reachable === false };
  const hint = typeof game?.createHint === 'string' && game.createHint ? game.createHint : DEFAULT_HINT;
  return { label: 'Create table', signedOut, hint, offline: reachable === false };
}

export function LivePanel({ game, options, seats, setSeats, host, busy, user, authLoading, reachable, onJoinCode, panelRef, mapId, setMapId }) {
  const copy = createCopy({ user, authLoading, reachable, busy, game });
  const friends = seats - 1;
  return (
    <section className="gd-panel" ref={panelRef} aria-labelledby="gd-panel-h" data-tour="game-panel">
      <h2 id="gd-panel-h" className="gd-panel__title">
        Start a table
      </h2>
      <div className="gd-panel__row" data-tour="game-seats">
        <div className="gd-panel__lab">
          <b>Players</b>
          <small aria-live="polite">
            You + {friends} {friends === 1 ? 'friend' : 'friends'}
          </small>
        </div>
        <Stepper options={options} value={seats} onChange={setSeats} disabled={busy || options.length < 2} label="Players at the table" />
      </div>
      {hasMaps(game) && setMapId && (
        <div className="gd-panel__row gd-panel__row--map" data-tour="game-map">
          <MapPicker compact isHost value={mapId} onPick={(patch) => setMapId(patch.map)} disabled={busy} label="Map" />
        </div>
      )}
      <button
        type="button"
        className="hub-btn hub-btn--accent hub-btn--lg hub-btn--block gd-panel__create"
        data-tour="game-create"
        onClick={() => host({ maxPlayers: seats })}
        disabled={busy || (authLoading && !user)}
        aria-busy={busy || undefined}
      >
        {copy.label}
      </button>
      {!(copy.signedOut && copy.offline) && <p className="gd-panel__hint">{copy.hint}</p>}
      {copy.signedOut && !copy.offline && (
        <Link to={paths.login(paths.game(game.id))} className="gd-panel__signin">
          Sign in or continue as a guest <HubIcon name="arrowR" size={16} />
        </Link>
      )}
      {copy.offline && (
        <p className="gd-panel__offline" role="status">
          <HubIcon name="wifiOff" size={16} /> Can't reach the server right now. Check your connection and try again.
        </p>
      )}
      <div className="gd-panel__alt">
        <button type="button" className="hub-btn hub-btn--soft hub-btn--block" onClick={onJoinCode} data-tour="game-join">
          <HubIcon name="hash" size={18} /> Join with a code
        </button>
        <ShareButton game={game} className="hub-btn hub-btn--ghost hub-btn--block" />
      </div>
    </section>
  );
}

/** Phone-only bar, shown once the panel has scrolled out of view. */
export function MobileBar({ game, seats, host, busy, user, authLoading, panelRef }) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = panelRef?.current;
    if (!el || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting && e.boundingClientRect.bottom < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [panelRef]);
  const copy = createCopy({ user, authLoading, reachable: true, busy, game });
  return (
    <div className={`gd-bar${past ? ' is-on' : ''}`} inert={!past} role="region" aria-label={`Play ${game.name}`}>
      <GameIcon game={game} size={40} />
      <span className="gd-bar__who">
        <b>{game.name}</b>
        <small>{seats} players</small>
      </span>
      <button type="button" className="hub-btn hub-btn--accent" onClick={() => host({ maxPlayers: seats })} disabled={busy || (authLoading && !user)}>
        {copy.label}
      </button>
    </div>
  );
}

/**
 * Panel of a SOLO game (manifest `solo: true`): no table, code or sign-in, just "Play now". The game is its own static page,
 * so this is a plain link (a full page load), not a router <Link>.
 */
export function SoloPanel({ game }) {
  const players = playersLabel(game.players);
  return (
    <section className="gd-panel gd-panel--solo" aria-labelledby="gd-panel-h" data-tour="game-panel">
      <h2 id="gd-panel-h" className="gd-panel__title">
        Play {game.name}
      </h2>
      <p className="gd-panel__hint">
        {players ? `${players}. ` : ''}No table, code or sign-in: it opens full screen in this browser.
      </p>
      <a href={paths.solo(game.id)} className="hub-btn hub-btn--accent hub-btn--lg hub-btn--block gd-panel__create" data-tour="game-create">
        <HubIcon name="play" size={20} /> Play now
      </a>
      <div className="gd-panel__alt">
        <ShareButton game={game} className="hub-btn hub-btn--ghost hub-btn--block" />
      </div>
    </section>
  );
}

/** Coming-soon panel: Notify me (stored on this device only), play something else meanwhile, share. */
export function SoonPanel({ game }) {
  const [notify, toggle] = useNotify(game.id);
  const live = featuredGame();
  const meanwhile = live && live.status !== 'coming_soon' && live.id !== game.id ? live : null;
  const players = playersLabel(game.players);
  return (
    <section className="gd-panel gd-panel--soon" aria-labelledby="gd-panel-h">
      <h2 id="gd-panel-h" className="gd-panel__title">
        Not open yet
      </h2>
      <p className="gd-panel__hint">
        {game.name} {players ? `(${players.toLowerCase()}) ` : ''}isn't open for play yet. Tap Notify me to mark it as one you're waiting for.
      </p>
      <button type="button" className={`hub-btn hub-btn--lg hub-btn--block ${notify ? 'hub-btn--soft' : 'hub-btn--accent'}`} aria-pressed={notify} onClick={toggle}>
        <HubIcon name={notify ? 'check' : 'bell'} size={20} /> {notify ? 'On the list' : 'Notify me'}
      </button>
      <p className="gd-panel__fine">Saved on this device only.</p>
      <div className="gd-panel__alt">
        {meanwhile && (
          <Link to={paths.game(meanwhile.id)} className="hub-btn hub-btn--soft hub-btn--block">
            <HubIcon name="play" size={16} /> Play {meanwhile.name} meanwhile
          </Link>
        )}
        <ShareButton game={game} className="hub-btn hub-btn--ghost hub-btn--block" />
      </div>
    </section>
  );
}
