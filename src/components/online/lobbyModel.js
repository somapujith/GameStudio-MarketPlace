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

/**
 * Why the host cannot press Start yet, in one sentence ('' when they can). Never the button label: the label stays
 * "Start game", this sits next to it so a disabled button always says why.
 */
export function startReason({ enough, open = true, starting = false, players = 0, minToStart = 2 } = {}) {
  if (starting) return '';
  if (!open) return 'Reconnecting to the room. You can start as soon as you are back in.';
  if (!enough) {
    const need = Math.max(0, minToStart - players);
    return `Need at least ${minToStart} players to start. ${need === 1 ? 'One more to go' : `${need} more to go`}.`;
  }
  return '';
}

/**
 * The full-screen card for a room we can no longer be in (`fatal` from useRoomConnection) -> { icon, tone, eyebrow,
 * title, body, actions: [{ label, to? | act?: 'reload', primary? }] }, or null when it needs no card (signed out / left:
 * the page navigates instead). `to` values come from `paths`, passed in so this file stays dependency-free.
 */
export function fatalView(fatal, { paths, gameId } = {}) {
  if (!fatal || fatal.kind === 'auth' || fatal.kind === 'left') return null;
  const message = String(fatal.message || '');
  const home = { label: 'Home', to: paths.hub() };
  const another = { label: 'Enter another code', to: paths.join(), primary: true };
  if (fatal.kind === 'kicked') {
    return {
      icon: 'door',
      tone: 'bad',
      eyebrow: 'Removed',
      title: 'You were removed from the room',
      body: 'The host took you out of this lobby. You can join another room, or ask for the code again later.',
      actions: [{ ...another, label: 'Join another room' }, home],
    };
  }
  if (fatal.kind === 'closed') {
    if (fatal.reason === 'replaced') {
      return {
        icon: 'users',
        tone: 'info',
        eyebrow: 'Another tab',
        title: 'You are in this room somewhere else',
        body: 'This room was opened in another tab or on another device, so this one stepped aside. Only one screen can be live at a time.',
        actions: [{ label: 'Use this screen instead', act: 'reload', primary: true }, home],
      };
    }
    if (/expired/i.test(message)) {
      return {
        icon: 'clock',
        tone: 'bad',
        eyebrow: 'Room closed',
        title: 'This room has expired',
        body: 'Rooms close after a day without activity. Start a new table and send your friends the new code.',
        actions: [{ label: 'Start a new table', to: gameId ? paths.game(gameId) : paths.hub(), primary: true }, { label: 'Enter a code', to: paths.join() }],
      };
    }
    return {
      icon: 'wifiOff',
      tone: 'bad',
      eyebrow: 'Connection',
      title: 'Lost the connection',
      body: message || 'The connection to the room was closed.',
      actions: [{ label: 'Try again', act: 'reload', primary: true }, home],
    };
  }
  // 'join': the server refused the seat
  let title = "Can't join this room";
  let icon = 'lock';
  if (/already started/i.test(message)) {
    title = 'This game has already started';
    icon = 'clock';
  } else if (/full/i.test(message)) {
    title = 'This table is full';
    icon = 'users';
  } else if (/does not exist|no longer exists/i.test(message)) {
    title = 'Room not found';
    icon = 'search';
  } else if (/removed from this room/i.test(message)) {
    title = 'You were removed from this room';
    icon = 'door';
  } else if (/no longer available/i.test(message)) {
    title = 'This game is no longer available';
    icon = 'info';
  }
  return { icon, tone: 'bad', eyebrow: 'Could not join', title, body: message || 'You cannot join this room.', actions: [another, home] };
}

/**
 * "3 custom rules" / "1 custom rule": what a screen reader hears for the lobby's "Custom rules" badge ('' for none).
 * (The table summary line carries its own "Custom rules (3)" tag: the game's `summarize`, see games/*\/settings.js.)
 */
export const customRulesSpoken = (n) => (n > 0 ? `${n} custom ${n === 1 ? 'rule' : 'rules'}` : '');

/**
 * What the piece picker tells its player, from `pieceChoices().choices`:
 * -> { mine: choice|null, free: number, taken: number, status: 'You are the Auto-rickshaw' | 'Pick a piece to play with' }
 */
export function pieceStatus(choices) {
  const list = Array.isArray(choices) ? choices : [];
  const mine = list.find((c) => c.mine) || null;
  const taken = list.filter((c) => c.takenBy).length;
  return {
    mine,
    free: list.length - taken,
    taken,
    status: mine ? `You are the ${mine.name}` : 'Pick a piece to play with',
  };
}
