// Which map's art to draw. Two sources, in this order:
//   1. ArtMapContext: the game root provides its table's map (GameView, from the game's cfg), which always wins;
//   2. the active client map (shared/maps.js applyMap / activeMapId), so any art drawn after applyMap('andhra') (a
//      deed sheet, an auction, the lobby preview) is on the same map as the names applyMap rewrote.
// The art kit (LocationScene, TileIcon, BuildingArt, PieceArt) and the board read useArtMap() and swap to the Andhra set
// when it is 'andhra'. Everything else (and every test) stays on Hyderabad, byte for byte.
import { createContext, useContext, useSyncExternalStore } from 'react';
import { activeMapId, subscribeMap } from '@shared/maps.js';

export const ANDHRA = 'andhra';
export const HYDERABAD = 'hyderabad';

/** null = no table-level override: follow the active client map. */
export const ArtMapContext = createContext(null);

/** Normalise a map id or a game cfg / state ({ map } or { cfg: { map } }) to a known art map id. Unknown -> Hyderabad. */
export function artMapId(idOrCfg) {
  const id = typeof idOrCfg === 'string' ? idOrCfg : idOrCfg && typeof idOrCfg === 'object' ? idOrCfg.map ?? idOrCfg.cfg?.map : null;
  return id === ANDHRA ? ANDHRA : HYDERABAD;
}

const snapshot = () => artMapId(activeMapId());
const serverSnapshot = snapshot; // a client-only app: the module state is the truth everywhere (tests render on the server renderer)

/** The map whose art to draw: 'andhra' | 'hyderabad'. */
export function useArtMap() {
  const forced = useContext(ArtMapContext);
  const live = useSyncExternalStore(subscribeMap, snapshot, serverSnapshot);
  return forced || live;
}

/** True while the Andhra art is active. */
export const useIsAndhra = () => useArtMap() === ANDHRA;
