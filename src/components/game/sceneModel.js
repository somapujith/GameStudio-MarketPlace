import { GROUPS, TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';

/** Read the presenter's display, never the future authoritative position. */
export function sceneOf(session = {}) {
  const d = session.display || session.view || {};
  const player = d.players?.[d.turn];
  if (!player || session.result || d.phase === 'over' || session.card) return null;
  const bubble = session.bubble;
  const tile = TILES[Number.isInteger(session.stageTile) ? session.stageTile : player.pos] || TILES[0];
  const base = { tile, player, level: d.levels?.[tile.id] || 0, color: GROUPS[tile.group]?.color || '#55d6c2' };
  const make = (kind, label, mood, detail = '') => ({ ...base, kind, label, mood, detail, key: `${kind}:${bubble?.id ?? tile.id}` });
  if (session.rolling) return make('roll', 'Rolling through Hyderabad', 'roll');
  if (session.busy && (player.motion || d.moving != null)) {
    const transport = player.motion === 'ride' ? TILES[session.stageTile]?.art : 'walk';
    return { ...make('travel', player.motion === 'ride' ? 'Taking a shortcut' : 'Across the city', 'roll'), transport };
  }
  if (session.busy && bubble) {
    switch (bubble.type) {
      case 'own': return bubble.reason === 'buy' || bubble.reason === 'auction' ? make('purchase', 'A new business opens', 'buy') : make('place', 'Business changes hands', 'welcome');
      case 'level': return bubble.reason === 'upgrade' ? make('build', 'Growing the neighbourhood', 'buy') : make('place', 'A change of plans', 'welcome');
      case 'cash': {
        const cash = session.lastCash || d.lastCash;
        if (!cash) break;
        const who = d.players?.find((p) => p.id === cash.player);
        const positive = cash.delta > 0;
        return { ...make('cash', cash.reason === 'rent' ? 'Rent changes hands' : cash.reason === 'salary' ? 'Another lap, another payday' : positive ? 'Money coming in' : 'Settling up', positive ? 'earn' : 'traffic', `${who?.name || 'Player'} ${positive ? '+' : '−'}${formatINR(Math.abs(cash.delta))}`), key: `cash:${cash.id ?? bubble.id}`, positive };
      }
      case 'ride': return { ...make('travel', 'Your ride has arrived', 'roll'), transport: tile.art };
      case 'traffic': return make('traffic', player.stuck ? 'Hyderabad has other plans' : 'Back on the road', player.stuck ? 'traffic' : 'welcome');
      case 'chai': return make('chai', 'A little chai goes a long way', 'earn');
      case 'city_event': {
        const group = d.event?.group || d.event?.groups?.[0];
        const eventTile = TILES[GROUPS[group]?.tiles?.[0]] || tile;
        return { ...make('city', d.event?.title || 'The city comes alive', 'welcome'), tile: eventTile, level: d.levels?.[eventTile.id] || 0, event: d.event?.id };
      }
      default: break;
    }
  }
  if (player.stuck) return make('traffic', 'A pause at the signal', 'traffic');
  if (d.phase === 'roll' || (!session.busy && session.options?.roll)) return make('welcome', 'Your next city story', 'waiting');
  return make('place', tile.name, 'welcome');
}
