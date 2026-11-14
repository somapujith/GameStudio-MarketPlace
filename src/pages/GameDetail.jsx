import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CodeSheet from '@/components/shell/nav/CodeSheet.jsx';
import { radioKeyNav } from '@/components/shell/ui.jsx';
import { featuredGame, getGame } from '@/games/registry.js';
import { useAuth } from '@/lib/auth.jsx';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { GameIcon } from '@/platform/home/GameArt.jsx';
import GameHero, { Cover, playersLabel } from '@/platform/game/GameHero.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Unavailable from '@/platform/game/Unavailable.jsx';
import { themeVars } from '@/platform/game/color.js';
import { useNotify } from '@/platform/game/notify.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { defaultSeats, seatOptions } from '@/platform/game/seats.js';
import useHostRoom from '@/platform/game/useHostRoom.js';
import { GameTopPlayers, HowToPlay, OpenTables, YourRecord } from '@/platform/game/DetailSections.jsx';
import '@/styles/x-lobby.css';

const DEFAULT_HINT = 'You get a code to share. Friends join, then you start.';

const Back = () => (
  <Link to={paths.hub()} className="hub-back">
    <HubIcon name="chevL" size={18} /> Games
  </Link>
);

/**
 * Quick start: how many players -> Create table (a private room) -> the lobby, where friends are invited.
 * Below it: how to play, your record, top players and open tables for this game (all from the manifest / API).
 */
function LiveDetail({ game }) {
  const { host, busy } = useHostRoom(game);
  const { user } = useAuth() || {};
  const [codeOpen, setCodeOpen] = useState(false);
  const options = seatOptions(game.players);
  const [seats, setSeats] = useState(() => defaultSeats(options));

  return (
    <div className="hub-page hub-detail hub-quick xl-detail" style={themeVars(game.theme)}>
      <Back />
      <div className="xl-detail__grid">
        <section className="hub-quick__card xl-detail__main" aria-labelledby="hub-quick-title">
          <div className="hub-quick__banner" aria-hidden="true">
            <Cover game={game} />
            <span className="hub-quick__facts">
              <HubIcon name="users" size={14} /> {playersLabel(game.players)}
              {game.duration && (
                <>
                  <i /> <HubIcon name="clock" size={14} /> {game.duration}
                </>
              )}
            </span>
          </div>
          <div className="hub-quick__body">
            <header className="hub-quick__head">
              <GameIcon game={game} size={56} />
              <div className="hub-quick__titles">
                <h1 id="hub-quick-title" className="hub-quick__title">
                  {game.name}
                </h1>
                {game.tagline && <p className="hub-quick__tagline">{game.tagline}</p>}
              </div>
            </header>

            <div className="hub-quick__step">
              <h2 id="hub-seats-h" className="hub-quick__label">
                How many players?
              </h2>
              <div className="hub-quick__seats" role="radiogroup" aria-labelledby="hub-seats-h" onKeyDown={radioKeyNav}>
                {options.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={n === seats}
                    className={`hub-quick__seat${n === seats ? ' is-on' : ''}`}
                    onClick={() => setSeats(n)}
                    disabled={busy}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="hub-quick__seatnote" aria-live="polite">
                You + {seats - 1} {seats - 1 === 1 ? 'friend' : 'friends'}
              </p>
            </div>

            <button type="button" className="hub-btn hub-btn--accent hub-btn--lg hub-btn--block hub-quick__create" onClick={() => host({ maxPlayers: seats })} disabled={busy} aria-busy={busy}>
              {busy ? 'Creating table...' : 'Create table'}
            </button>
            <p className="hub-faint hub-quick__hint">{typeof game.createHint === 'string' && game.createHint ? game.createHint : DEFAULT_HINT}</p>

            <div className="hub-quick__or" role="separator">
              <span>Got a code?</span>
            </div>
            <button type="button" className="hub-quick__join" onClick={() => setCodeOpen(true)}>
              <HubIcon name="hash" size={18} /> Join with a code
            </button>
          </div>
        </section>

        <div className="xl-detail__side">
          <HowToPlay game={game} />
          <YourRecord game={game} user={user} />
          <GameTopPlayers game={game} />
          <OpenTables game={game} onCreate={() => host({ maxPlayers: seats })} busy={busy} />
        </div>
      </div>

      <CodeSheet open={codeOpen} onClose={() => setCodeOpen(false)} />
    </div>
  );
}

function SoonDetail({ game }) {
  const [notify, toggle] = useNotify(game.id);
  const playable = featuredGame();
  const meanwhile = playable && playable.status !== 'coming_soon' ? playable : null;
  return (
    <div className="hub-page hub-detail" style={themeVars(game.theme)}>
      <Back />
      <GameHero game={game} soon />
      <section className="hub-panel hub-soon" aria-labelledby="hub-soon-h">
        <div className="hub-soon__text">
          <h2 id="hub-soon-h" className="hub-section__title">
            Coming soon
          </h2>
          <p className="hub-muted">{game.name} isn't open for play yet. Tap Notify me to mark it as one you're waiting for.</p>
        </div>
        <div className="hub-soon__actions">
          <button type="button" className={`hub-btn hub-btn--lg ${notify ? 'hub-btn--soft' : 'hub-btn--accent'}`} aria-pressed={notify} onClick={toggle}>
            <HubIcon name={notify ? 'check' : 'bell'} size={20} /> {notify ? 'On the list' : 'Notify me'}
          </button>
          {meanwhile && (
            <Link to={paths.game(meanwhile.id)} className="hub-btn hub-btn--ghost hub-btn--lg">
              Play {meanwhile.name} meanwhile
            </Link>
          )}
        </div>
        <p className="hub-faint">Saved on this device only.</p>
      </section>
    </div>
  );
}

/** /games/:gameId: a live game is a quick-start card (players, create table); a coming-soon game a teaser. */
export default function GameDetail() {
  const { gameId } = useParams();
  const game = getGame(gameId);
  useDocTitle(game ? `${game.name} · ${BRAND.name}` : `Game not available · ${BRAND.name}`);
  if (!game) return <Unavailable reason="unknown" />;
  return game.status === 'coming_soon' ? <SoonDetail game={game} /> : <LiveDetail game={game} />;
}
