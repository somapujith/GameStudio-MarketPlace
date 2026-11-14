// What the lobby's seat grid, piece picker and Start button say, from the room's numbers. Pure and unit-tested.

const same = (a, b) => a != null && b != null && String(a) === String(b);
const plural = (n, word) => `${n} more ${word}${n === 1 ? '' : 's'}`;

/**
 * `players` = people in the room, `joined` = taken seats, `maxPlayers` = seats, `minToStart` = the game's minimum,
 * `open` = the socket is connected.
 * -> { enough, full, emptySeats, need, label, help }
 */
export function startState({ players, joined, maxPlayers, minToStart = 2, starting = false, open = true }) {
  const emptySeats = Math.max(0, maxPlayers - joined);
  const need = Math.max(0, minToStart - players);
  const enough = need === 0;
  const full = emptySeats === 0;
  const label = starting
    ? 'Starting...'
    : !open
      ? 'Reconnecting...'
      : !enough
        ? `Waiting for ${plural(need, 'player')}`
        : full
          ? 'Table full - start!'
          : `Start with ${players} players`;
  const help = !open
    ? 'Hold on, getting you back into the room.'
    : !enough
      ? `Share the code or link. You need at least ${minToStart} players to start.`
      : full
        ? 'Everyone is here.'
        : `${emptySeats} ${emptySeats === 1 ? 'seat is' : 'seats are'} still open. Start now, or wait for more.`;
  return { enough, full, emptySeats, need, label, help };
}

/** What a player who is not the host sees instead of Start. */
export function waitingText({ need = 0, hostName } = {}) {
  if (need > 0) return `Waiting for ${plural(need, 'player')}...`;
  return hostName ? `Waiting for ${hostName} to start...` : 'Waiting for the host to start...';
}

/** "2 of 4 joined". */
export const joinedLabel = (joined, maxPlayers) => `${joined} of ${maxPlayers} joined`;

/** Width (0..100) of the seat progress bar. */
export const joinedPercent = (joined, maxPlayers) => (maxPlayers > 0 ? Math.max(0, Math.min(100, (joined / maxPlayers) * 100)) : 0);

/** A manifest's `pieces`, cleaned: `[{ id, name }]` (unknown shapes dropped, name falls back to the id). */
export function cleanPieces(pieces) {
  if (!Array.isArray(pieces)) return [];
  const seen = new Set();
  const out = [];
  for (const p of pieces) {
    const id = p && typeof p.id === 'string' ? p.id : typeof p === 'string' ? p : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: (p && typeof p.name === 'string' && p.name) || id });
  }
  return out;
}

/**
 * The piece picker's tiles. `pending` = the piece I just asked for (optimistic), shown as mine until the server
 * answers, unless the server already gave it to someone else.
 * -> { mine: pieceId|null, choices: [{ id, name, mine, takenBy: player|null }] }
 */
export function pieceChoices(pieces, players, myId, pending = null) {
  const list = cleanPieces(pieces);
  const people = Array.isArray(players) ? players.filter(Boolean) : [];
  const owner = new Map();
  for (const p of people) if (typeof p.piece === 'string' && p.piece && !owner.has(p.piece)) owner.set(p.piece, p);
  const me = people.find((p) => same(p.id, myId));
  const known = (id) => list.some((p) => p.id === id);
  const pendingOk = pending && known(pending) && (!owner.has(pending) || same(owner.get(pending).id, myId));
  const serverMine = me && typeof me.piece === 'string' && known(me.piece) ? me.piece : null;
  const mine = pendingOk ? pending : serverMine;
  return {
    mine,
    choices: list.map((p) => {
      const o = owner.get(p.id) || null;
      return { id: p.id, name: p.name, mine: p.id === mine, takenBy: o && !same(o.id, myId) ? o : null };
    }),
  };
}

/** The piece `{ id, name }` a player holds, or null. */
export function pieceOf(player, pieces) {
  if (!player || typeof player.piece !== 'string') return null;
  return cleanPieces(pieces).find((p) => p.id === player.piece) || null;
}

/**
 * Who arrived / left between two room payloads (by id; me excluded). `prev` null = first payload: nobody "joined".
 * -> { joined: player[], left: player[] }
 */
export function rosterChanges(prev, next, myId) {
  if (!Array.isArray(prev)) return { joined: [], left: [] };
  const list = Array.isArray(next) ? next.filter(Boolean) : [];
  const before = new Set(prev.filter(Boolean).map((p) => String(p.id)));
  const after = new Set(list.map((p) => String(p.id)));
  return {
    joined: list.filter((p) => !before.has(String(p.id)) && !same(p.id, myId)),
    left: prev.filter((p) => p && !after.has(String(p.id)) && !same(p.id, myId)),
  };
}

/** The colour of seat `i`: the game's own `playerColors` when it has them. */
export const DEFAULT_SEAT_COLORS = ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#b794f6', '#ff9f43'];
export function seatColor(game, i) {
  const list = game && Array.isArray(game.playerColors) && game.playerColors.length ? game.playerColors : DEFAULT_SEAT_COLORS;
  return list[((i % list.length) + list.length) % list.length];
}
