import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CodeSheet from '@/components/shell/nav/CodeSheet.jsx';
import { radioKeyNav } from '@/components/shell/ui.jsx';
import { featuredGame, getGame } from '@/games/registry.js';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import GameHero from '@/platform/game/GameHero.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Unavailable from '@/platform/game/Unavailable.jsx';
import { themeVars } from '@/platform/game/color.js';
import { useNotify } from '@/platform/game/notify.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { defaultSeats, seatOptions } from '@/platform/game/seats.js';
import useHostRoom from '@/platform/game/useHostRoom.js';
import '@/platform/game/nawabi-detail.css';

const Back = () => (
  <Link to={paths.hub()} className="hub-back">
    <HubIcon name="chevL" size={18} /> Games
  </Link>
);

function Crown() {
  return <svg className="nawabi-poster__crown" width="100" height="85" viewBox="0 0 100 85" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 33 12 39 57-5 8-43-26 26-17-40-10 43zM26 80l52-5" /><circle cx="12" cy="28" r="4" /><circle cx="46" cy="6" r="4" /><circle cx="90" cy="19" r="4" /></g></svg>;
}

function TableDice() {
  return <svg className="nawabi-ticket__dice" width="55" height="48" viewBox="0 0 55 48" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round"><path d="m5 20 15-8 15 8v18l-15 8-15-8zM5 20l15 8 15-8M20 28v18M31 8l10-6 12 7v17l-10 6" /></g><g fill="currentColor"><circle cx="15" cy="20" r="1.8" /><circle cx="24" cy="20" r="1.8" /><circle cx="12" cy="29" r="1.8" /><circle cx="13" cy="36" r="1.8" /><circle cx="27" cy="31" r="1.8" /><circle cx="27" cy="38" r="1.8" /><circle cx="40" cy="9" r="1.8" /><circle cx="46" cy="15" r="1.8" /><circle cx="47" cy="23" r="1.8" /></g></svg>;
}

/** Poster-style quick start, using the existing private-room host and code-join flows. */
function LiveDetail({ game }) {
  const { host, busy } = useHostRoom(game);
  const [codeOpen, setCodeOpen] = useState(false);
  const options = seatOptions(game.players);
  const [seats, setSeats] = useState(() => defaultSeats(options));

  return (
    <div className="hub-page hub-detail nawabi-page">
      <img className="nawabi-page__scene" src="/art/cinematic/nawabi-setup.webp" width="2048" height="1024" alt="" fetchPriority="high" decoding="async" />
      <Back />
      <div className="nawabi-layout">
        <section className="nawabi-poster" aria-label={`About ${game.name}`}>
          <div className="nawabi-poster__identity">
            <Crown />
            <h1 className="nawabi-poster__title" aria-label={game.name}><span>{game.name.split(' ').slice(0, -1).join(' ')}</span><strong>{game.name.split(' ').at(-1)}</strong></h1>
            <p className="nawabi-poster__pitch">Buy landmarks, build your empire,<br />and rule the city.</p>
          </div>
          <dl className="nawabi-poster__facts">
            <div><HubIcon name="users" size={40} /><div><dt>Players</dt><dd>{game.players.min} &ndash; {game.players.max}</dd></div></div>
            <div><HubIcon name="clock" size={40} /><div><dt>Minutes</dt><dd>{game.duration.replace(/\s*min$/, '')}</dd></div></div>
          </dl>
        </section>
        <section className="nawabi-ticket" aria-labelledby="nawabi-create-title">
          <header className="nawabi-ticket__head">
            <p>Play {game.name}</p>
            <h2 id="nawabi-create-title">Create a table</h2>
            <span className="nawabi-ticket__swash" aria-hidden="true" />
          </header>
          <div className="nawabi-ticket__step">
            <h3 id="hub-seats-h">
              How many players?
            </h3>
            <div className="nawabi-ticket__seats" role="radiogroup" aria-labelledby="hub-seats-h" onKeyDown={radioKeyNav}>
              {options.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={n === seats}
                  className={n === seats ? 'is-on' : undefined}
                  tabIndex={n === seats ? 0 : -1}
                  onClick={() => setSeats(n)}
                  disabled={busy}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="nawabi-ticket__create" onClick={() => host({ maxPlayers: seats })} disabled={busy} aria-busy={busy}>
            <TableDice />{busy ? 'Creating table...' : 'Create table'}<HubIcon name="arrowR" size={32} />
          </button>
          <div className="nawabi-ticket__or" aria-hidden="true"><span />Or<span /></div>
          <button type="button" className="nawabi-ticket__join" onClick={() => setCodeOpen(true)} aria-haspopup="dialog">
            <HubIcon name="hash" size={26} /> Join with a code
          </button>
          <p className="nawabi-ticket__hint">Have a code from your friend? Enter it to join their game.</p>
        </section>
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
