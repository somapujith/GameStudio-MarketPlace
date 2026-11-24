import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getGame } from '@/games/registry.js';
import PageLoading from '@/platform/game/PageLoading.jsx';
import Unavailable from '@/platform/game/Unavailable.jsx';

/**
 * /play/:gameId for a SOLO game (manifest `solo: true`, or any game with `loaders.soloGame`, e.g. a tutorial before rooms): loads the game's own screen (`manifest.loaders.soloGame`, a default
 * export) and renders it full screen. A game with no solo screen, or an unknown id, gets the hub's "unavailable" page.
 */
export default function SoloGame() {
  const { gameId } = useParams();
  const game = getGame(gameId);
  const loader = game?.solo || game?.loaders?.soloGame ? game.loaders?.soloGame : null; // a hybrid (solo screen + rooms) has loaders.soloGame too
  const [Screen, setScreen] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setScreen(null);
    setFailed(false);
    if (typeof loader !== 'function') return undefined;
    loader()
      .then((m) => live && setScreen(() => m.default))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [loader]);

  if (!game || typeof loader !== 'function') return <Unavailable reason="unknown" query={gameId} />;
  if (failed) return <Unavailable reason="unknown" query={gameId} />;
  if (!Screen) return <PageLoading fullscreen />;
  return <Screen game={game} />;
}
