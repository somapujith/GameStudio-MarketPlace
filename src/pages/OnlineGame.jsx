import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { getRoom } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { normalizeGameId } from '@/platform/game/identity.js';
import { isRoomCode, normalizeRoomCode } from '@/components/online/codes.js';
import { gameOf, gameName, loadOnlineGame, loadedOnlineGame } from '@/components/online/games.js';
import { knownRoomGame, lookupResult, resolveOnlineRoute } from '@/components/online/gameRoute.js';
import GameLoadScreen from '@/components/online/GameLoadScreen.jsx';
import StatusPanel from '@/components/online/StatusPanel.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import '@/styles/online.css';
import '@/styles/store-rooms.css';

function Screen({ children }) {
  return <div className="ho-screen">{children}</div>;
}

/**
 * /play/:gameId/online/:code: the generic dispatcher. It knows no game. It finds the game in the registry,
 * checks the room really belongs to it (otherwise redirects to the room's own game), lazy-loads
 * `manifest.loaders.onlineGame` and renders it with nothing but the route params (the plugin reads `useParams()`).
 */
export default function OnlineGame() {
  const { gameId: routeGameId, code: rawCode } = useParams();
  const gameId = normalizeGameId(routeGameId);
  const code = normalizeRoomCode(rawCode || '');
  const { user, loading } = useAuth();

  if (!isRoomCode(code)) {
    return (
      <Screen>
        <StatusPanel
          icon={<HubIcon name="hash" size={30} />}
          tone="bad"
          eyebrow="Room link"
          title="That is not a room code"
          body="Room codes are 6 letters or numbers, like ABC234."
          actions={[
            { label: 'Home', to: paths.hub(), primary: true },
            { label: 'Enter a code', to: paths.join() },
          ]}
        />
      </Screen>
    );
  }
  if (loading) {
    return (
      <Screen>
        <StatusPanel busy title="Loading..." />
      </Screen>
    );
  }
  if (!user) return <Navigate to={paths.login(paths.online(gameId, code))} replace />;
  return <Dispatch gameId={gameId} code={code} />;
}

/** The room check: null while pending, else the `resolveOnlineRoute` outcome. */
function useRoomRoute(gameId, code) {
  const initial = useMemo(() => {
    const known = knownRoomGame(code); // the lobby just told us which game this room is
    return known ? resolveOnlineRoute({ gameId, code, room: { gameId: known } }) : null;
  }, [gameId, code]);
  const [looked, setLooked] = useState(null); // { gameId, code, route }

  useEffect(() => {
    if (initial) return undefined;
    let alive = true;
    const done = (err, info) => {
      if (alive) setLooked({ gameId, code, route: resolveOnlineRoute({ gameId, code, room: lookupResult(err, info) }) });
    };
    getRoom(code).then(
      (info) => done(null, info),
      (err) => done(err),
    );
    return () => {
      alive = false;
    };
  }, [gameId, code, initial]);

  if (initial) return initial;
  return looked && looked.gameId === gameId && looked.code === code ? looked.route : null;
}

/** Loads the game's online page (in parallel with the room check); `{ Comp, error, retry }`. */
function useOnlinePage(game) {
  const [state, setState] = useState(() => ({ id: game && game.id, Comp: game ? loadedOnlineGame(game.id) : null, error: null }));
  const [attempt, setAttempt] = useState(0);
  const id = game ? game.id : null;
  const playable = !!(game && game.status !== 'coming_soon' && game.loaders && typeof game.loaders.onlineGame === 'function');

  useEffect(() => {
    if (!playable) return undefined;
    let alive = true;
    const cached = loadedOnlineGame(id);
    if (cached) {
      setState({ id, Comp: cached, error: null });
      return undefined;
    }
    setState({ id, Comp: null, error: null });
    loadOnlineGame(game).then(
      (Comp) => alive && setState({ id, Comp, error: null }),
      (error) => alive && setState({ id, Comp: null, error: error || new Error('load failed') }),
    );
    return () => {
      alive = false;
    };
    // `game` is the registry's stable manifest object; `id` identifies it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, playable, attempt]);

  const fresh = state.id === id;
  return { playable, Comp: fresh ? state.Comp : loadedOnlineGame(id), error: fresh ? state.error : null, retry: () => setAttempt((n) => n + 1) };
}

function Dispatch({ gameId, code }) {
  const game = gameOf(gameId);
  const route = useRoomRoute(gameId, code);
  const page = useOnlinePage(game);

  if (route && route.kind === 'redirect') return <Navigate to={route.to} replace />;

  if (route && route.kind === 'missing') {
    return (
      <Screen>
        <StatusPanel
          icon={<HubIcon name="search" size={30} />}
          tone="bad"
          eyebrow={`Room ${code}`}
          title="That room no longer exists"
          body="Rooms close a little while after everyone leaves. Ask the host for a new code, or start a new table."
          actions={[
            { label: 'Enter a code', to: paths.join(), primary: true },
            { label: 'Home', to: paths.hub() },
          ]}
        />
      </Screen>
    );
  }

  if (route && (route.kind === 'ended' || route.kind === 'started')) {
    const ended = route.kind === 'ended';
    const g = gameOf(route.gameId) || game;
    return (
      <Screen>
        <StatusPanel
          icon={<HubIcon name={ended ? 'trophy' : 'clock'} size={30} />}
          eyebrow={`Room ${code}`}
          title={ended ? 'This game has already ended' : 'This game has already started'}
          body={
            ended
              ? 'The match in this room is over, so there is nothing to join. See the game, or check how you did on your profile.'
              : 'Players who were not seated cannot join a match in progress. Ask the host for the code of their next table.'
          }
          actions={[
            ...(g ? [{ label: `About ${gameName(g.id, g)}`, to: paths.game(g.id), primary: true }] : []),
            { label: 'Your profile', to: paths.profile(), primary: !g },
            { label: 'Enter a code', to: paths.join() },
          ]}
        />
      </Screen>
    );
  }

  if (!game && !route) {
    // the room may belong to a game we do know: wait for the lookup before giving up
    return <GameLoadScreen game={null} code={code} title="Joining the match..." body="Looking up the room." />;
  }

  if (!game) {
    return (
      <Screen>
        <StatusPanel
          icon={<HubIcon name="gamepad" size={30} />}
          tone="bad"
          eyebrow="Unknown game"
          title="We do not have that game"
          body={`There is no game called "${gameId}" here. The link may be old, or from a newer version of the app.`}
          actions={[
            { label: 'Browse games', to: paths.hub(), primary: true },
            { label: 'Enter a code', to: paths.join() },
          ]}
        />
      </Screen>
    );
  }

  if (!page.playable) {
    return (
      <Screen>
        <StatusPanel
          icon={<HubIcon name="spark" size={30} />}
          eyebrow="Coming soon"
          title={`${gameName(game.id, game)} is not playable online yet`}
          body="This game is still being built. Check back soon."
          actions={[
            { label: 'About the game', to: paths.game(game.id), primary: true },
            { label: 'Home', to: paths.hub() },
          ]}
        />
      </Screen>
    );
  }

  if (page.error) {
    return (
      <Screen>
        <StatusPanel
          icon={<HubIcon name="wifiOff" size={30} />}
          tone="bad"
          eyebrow="Load failed"
          title={`Could not load ${gameName(game.id, game)}`}
          body="The game files did not load. Check your connection and try again."
          actions={[
            { label: 'Try again', onClick: page.retry, primary: true },
            { label: 'Back to the lobby', to: paths.lobby(code) },
            { label: 'Home', to: paths.hub() },
          ]}
        />
      </Screen>
    );
  }

  if (!route || !page.Comp) {
    return (
      <GameLoadScreen
        game={game}
        code={code}
        title="Joining the match..."
        body={`Getting ${gameName(game.id, game)} ready.`}
        roomChecked={!!route}
        pageReady={!!page.Comp}
        onRetry={page.retry}
      />
    );
  }

  const GamePage = page.Comp;
  return <GamePage key={`${game.id}:${code}`} />;
}
