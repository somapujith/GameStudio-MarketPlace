import { Link } from 'react-router-dom';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { themeVars } from '@/platform/game/color.js';
import { paths } from '@/platform/paths.js';
import { BRAND } from '@/platform/brand.js';
import { liveGames, comingSoonGames } from '@/games/registry.js';
import LegalPage from '@/components/shell/legal/LegalPage.jsx';

const STEPS = [
  { icon: 'gamepad', title: 'Pick a game', text: 'Browse the catalogue and open a game to see how it plays, how many players it takes and how long a round lasts.' },
  { icon: 'hash', title: 'Open a table, share the code', text: 'Choose the number of seats and create a private table. You get a six-character room code and a link to send on WhatsApp or by QR code.' },
  { icon: 'users', title: 'Play together', text: 'Friends join with the code, the host starts, and everyone plays live in their own browser, on a phone, tablet or computer.' },
];

function GameTile({ game }) {
  const Icon = game.art?.icon;
  const soon = game.status === 'coming_soon';
  const players = game.players ? (game.players.min === game.players.max ? `${game.players.min} players` : `${game.players.min} to ${game.players.max} players`) : null;
  const body = (
    <>
      <span className="xl-gicon" style={themeVars(game.theme)} aria-hidden="true">
        {Icon ? <Icon size={56} /> : <span>{String(game.name || '?').trim().charAt(0).toUpperCase()}</span>}
      </span>
      <span className="xl-gtile__text">
        <span className="xl-gtile__name">{game.name}</span>
        {game.tagline ? <span className="xl-gtile__tag">{game.tagline}</span> : null}
        <span className="xl-gtile__facts">
          {soon ? <span className="st-chip">Coming soon</span> : <span className="st-chip"><i className="st-live" aria-hidden="true" /> Playable now</span>}
          {players ? <span className="st-chip">{players}</span> : null}
          {game.duration ? <span className="st-chip">{game.duration}</span> : null}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {soon ? (
        <div className="xl-gtile xl-gtile--soon" style={themeVars(game.theme)}>{body}</div>
      ) : (
        <Link className="xl-gtile" to={paths.game(game.id)} style={themeVars(game.theme)}>
          {body}
        </Link>
      )}
    </li>
  );
}

export default function About() {
  const live = liveGames();
  const soon = comingSoonGames();

  const sections = [
    {
      id: 'what',
      title: 'What Jalebi Games is',
      body: (
        <>
          <p>
            Jalebi Games is a small marketplace of multiplayer games that you play in the browser, with real people. There is nothing to install and no computer-controlled players: every seat at a
            table is a friend, a cousin or a stranger who joined with your code.
          </p>
          <ul>
            <li><strong>Play in seconds.</strong> Create a table, send the code, start. Guests can host and join without signing up.</li>
            <li><strong>Built for friends.</strong> Sign in with Google to get a friend code, see who is online and invite people to a table in one tap.</li>
            <li><strong>Keeps your progress.</strong> Wins and ratings are kept per game and feed the leaderboard; your level and coins follow you across games.</li>
            <li><strong>Made for phones first.</strong> It works on a phone, a tablet or a computer, and you can add it to your home screen.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'how',
      title: 'How it works',
      body: (
        <ol className="xl-steps">
          {STEPS.map((s) => (
            <li key={s.title} className="xl-step">
              <HubIcon name={s.icon} size={24} className="xl-step__icon" />
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      ),
    },
    {
      id: 'games',
      title: 'The games',
      body: (
        <>
          <p>
            {live.length} {live.length === 1 ? 'game is' : 'games are'} playable now{soon.length ? ` and ${soon.length} ${soon.length === 1 ? 'is' : 'are'} on the way` : ''}. Games marked coming soon are
            previews; their details may change before they launch.
          </p>
          <ul className="xl-games">
            {live.map((g) => <GameTile key={g.id} game={g} />)}
            {soon.map((g) => <GameTile key={g.id} game={g} />)}
          </ul>
          <p>
            <Link className="hub-btn hub-btn--primary hub-btn--sm" to={paths.games()}>
              Browse all games
            </Link>
          </p>
        </>
      ),
    },
    {
      id: 'good-to-know',
      title: 'Good to know',
      body: (
        <ul>
          <li><strong>Free to play.</strong> There is nothing to buy. Coins are earned by playing and spent on cosmetic items.</li>
          <li><strong>Light on data.</strong> No ads, no analytics scripts. Read exactly what is kept on the <Link to={paths.privacy()}>Privacy</Link> page.</li>
          <li><strong>English only</strong> for now.</li>
          <li><strong>Online only.</strong> Games are live, so you need a connection. If it drops, Jalebi Games reconnects you to your table.</li>
        </ul>
      ),
    },
    {
      id: 'more',
      title: 'Next steps',
      body: (
        <ul className="xl-links">
          <li><Link to={paths.games()}>Browse games</Link><span>See everything in the catalogue.</span></li>
          <li><Link to={paths.join()}>Join a table</Link><span>Got a room code? Enter it here.</span></li>
          <li><Link to={paths.help()}>Help</Link><span>Codes, friends, reconnecting, installing the app.</span></li>
          <li><Link to={paths.terms()}>Terms</Link> · <Link to={paths.privacy()}>Privacy</Link><span>The rules and your data.</span></li>
        </ul>
      ),
    },
  ];

  return (
    <LegalPage
      eyebrow={`About ${BRAND.name}`}
      title="Pull up a chair. Everyone plays."
      docTitle="About"
      lead="A small marketplace of multiplayer games, built around one idea: the best part of a game is the people at the table."
      description={`${BRAND.name} is a marketplace of online multiplayer games you play in the browser with friends. Create a table, share the room code and play in seconds.`}
      meta={['Play with real people', 'No download', 'Guests welcome']}
      sections={sections}
      wide
    />
  );
}
