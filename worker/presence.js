// Rich friend presence: what a user is doing, as friends see it.
//   status: 'offline' | 'online' | 'lobby' | 'playing'   (+ `code` and `gameId` while in a room)
// Pure helpers shared by GameRoom (what to tell a member's hub), UserHub (what to store and push) and the
// friends route (what to reveal). No Durable Object or database imports, so they are trivially testable.

export const STATUSES = ['offline', 'online', 'lobby', 'playing'];

const CODE_RE = /^[A-Z0-9]{4,10}$/;

/**
 * Validate a room-status update sent by a GameRoom to a UserHub. `{status:'lobby'|'playing', code, gameId}` is kept;
 * anything else (including `{status:'online'}`) means "not in a room" and is normalised to `null`.
 */
export function cleanRoomState(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.status !== 'lobby' && input.status !== 'playing') return null;
  if (typeof input.code !== 'string' || !CODE_RE.test(input.code)) return null;
  const state = { status: input.status, code: input.code };
  if (typeof input.gameId === 'string' && input.gameId.length > 0 && input.gameId.length <= 64) state.gameId = input.gameId;
  return state;
}

/** `{status, code?, gameId?}` for a user, given whether they are online and their stored room state. */
export function effectiveStatus(online, roomState) {
  if (!online) return { status: 'offline' };
  const s = cleanRoomState(roomState);
  return s ? { ...s } : { status: 'online' };
}

/** The `presence` push for friends (extras are ignored by old clients). */
export function presenceMessage(userId, online, roomState) {
  const eff = effectiveStatus(online, roomState);
  const msg = { t: 'presence', userId, online: !!online, status: eff.status };
  if (eff.code) msg.code = eff.code;
  if (eff.gameId) msg.gameId = eff.gameId;
  return msg;
}

export const sameState = (a, b) => (a?.status || 'online') === (b?.status || 'online') && (a?.code || '') === (b?.code || '') && (a?.gameId || '') === (b?.gameId || '');

/**
 * What each member's hub should believe about a room: a Map userId -> `{status, code, gameId}`.
 * - lobby: members with a live room socket (a member who wandered off is not "at the table")
 * - playing: every seated, present human (a reload must not flap their status)
 * - finished (or no room): nobody
 */
export function roomMemberStates(room, connectedIds) {
  const out = new Map();
  if (!room || !Array.isArray(room.players)) return out;
  if (room.status !== 'lobby' && room.status !== 'playing') return out;
  for (const p of room.players) {
    if (!p || !p.id || p.left) continue;
    if (room.status === 'lobby' && !connectedIds.has(p.id)) continue;
    out.set(p.id, { status: room.status, code: room.code, gameId: room.gameId });
  }
  return out;
}

/**
 * Compare what was last sent (`sent`: userId -> state | null) with what should be true now (`desired`).
 * Returns `[userId, state | null][]` of the updates to send; `null` clears the status.
 */
export function diffStates(sent, desired) {
  const updates = [];
  for (const [uid, state] of desired) {
    if (!sameState(sent.get(uid) || null, state)) updates.push([uid, state]);
  }
  for (const [uid, prev] of sent) {
    if (prev && !desired.has(uid)) updates.push([uid, null]);
  }
  return updates;
}

/**
 * Should a friend see "Join" for this lobby? `info` is the answer of a GameRoom `/info`. Only an existing, still-open
 * lobby with a free seat counts.
 */
export function isJoinableLobby(info, code) {
  return !!info && info.exists === true && info.status === 'lobby' && Number(info.players) < Number(info.maxPlayers) && !!code;
}
