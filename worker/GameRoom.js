// GameRoom: one Durable Object per room code (WebSocket Hibernation API). Game-agnostic: every
// rule of the game being played lives in the adapter chosen by the room's `gameId`
// (worker/games/<id>.js, see worker/games/index.js); this class only knows about seats, timers,
// sockets and persistence.
//
// Lobby: players join over WS, pick a piece (when the adapter has `pieces`), the host edits settings
// and visibility, kicks, starts (>= adapter.minPlayers). Every seat is a real player: there are no bots.
// Game: the server owns the game state; clients only send intents (`{t:'action'}`), the server forces `playerId`, applies them through the adapter
// and broadcasts the result. Idle players (45 s) and disconnected players (15 s grace) are
// played on their behalf by DO alarms. The whole room record lives in DO storage, so eviction/hibernation is safe.
// A listing row in the `rooms` table is kept in step on a best-effort basis (never breaks a room).
//
// Wire additions (docs/HUSTLE_PLAN.md 3.9):
//   {t:'state', state, events, seq, clock, now}  clock = { deadline: epochMs|null, waitingFor: playerId[] }; now = server epoch ms
//       deadline = when the server will next act on its own (the 45 s decision timer counted after the
//       animation, the faster pace for idle / disconnected players, or an adapter timer); null when nothing is due.
//   {t:'room', room}  room.players[i] = { id, name, avatar, ready, connected, piece, cosmetics, net }
//       connected stays true through the 15 s reconnect grace (a reload does not flap the seat).
//       net = { q: 0..4|null, rtt, stale? }: connection strength (netpresence.js), presence data only: in memory, never saved.
//   client -> {t:'net', rtt}  the member's own measured round-trip time in ms (0..20000); at most one per 2 s is used.
//   client -> {t:'piece', piece}  lobby only; piece must be in adapter.pieces and not taken.
import { DurableObject } from 'cloudflare:workers';
import { getAdapter, DEFAULT_GAME_ID } from './games/index.js';
import { buildMatchRecord, persistMatch } from './match.js';
import {
  parseRoomInit,
  parseSettingsPatch,
  parseVisibility,
  defaultSanitizeAction,
  DEFAULT_VISIBILITY,
} from './roomrules.js';
import { roomRow, rowSignature, upsertRoomRow, deleteRoomRow, hasDb, loadEquipped, loadOwnedItemIds, LISTING_HEARTBEAT_MS } from './roomsdb.js';
import { sanitizeName, parseAvatar, sanitizeChat, sanitizeEmote, sanitizeVoiceId, isUuid, parseNetRtt } from './validate.js';
import { NetPresence, NET_BROADCAST_GAP_MS } from './netpresence.js';
import { cleanEquipped, isVoiceId, VOICE_LIMITS } from '../shared/cosmetics.js';
import { DECISION_MS } from '../shared/timing.js';
import { setUserRoomStatus } from './hub.js';
import { roomMemberStates, diffStates } from './presence.js';
import { notifyInviteJoined } from './invitefeedback.js';

// Version of the stored room record. 3 = the 40-square Hyderabad board; a record below it still holds
// a 28-tile game, which the game adapter's `upgradeRecord` calls off instead of resuming.
export const ROOM_VERSION = 3;
export const TURN_MS = DECISION_MS; // human idle limit per decision (shared/timing.js)
export const GRACE_MS = 30_000; // disconnected human is auto-played after this (long enough to switch apps and come back)
const AUTO_MOVE_DELAY_MS = 1500; // pause before an automated move (adapters may shorten it via moveDelayMs)
// A CONNECTED human is never auto-played after a short pause: every decision gets the room's full decision timer (turnMs).
// Only a player who let AFK_STRIKES decisions run out in a row without doing anything (no action, no reconnect) is treated as
// away: from then on their window is shortened to AFK_TURN_MS (never below a few seconds). "In a row" counts whole turns. A DISCONNECTED human is played for
// only after GRACE_MS. Any action or a reconnect clears the strikes. docs/GAME_RULES.md (timers).
export const AFK_STRIKES = 2;
export const AFK_TURN_MS = 10_000;
const LOBBY_GRACE_MS = 60_000; // a disconnected lobby member is dropped after this
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const ABANDON_MS = 5 * 60 * 1000; // nobody connected for this long -> stop playing the game
const KICK_BAN_MS = 10 * 60 * 1000;
const CHAT_GAP_MS = 700;
const MAX_MESSAGE_CHARS = 4096;
const MAX_SOCKETS_PER_USER = 3;
const PERSIST_BACKOFF_MS = [2_000, 10_000, 30_000, 120_000, 600_000];
const PERSIST_MAX_ATTEMPTS = 8;
const HUB_RETRY_MS = 20_000; // a UserHub that was offline for a room-status update is asked again after this
const COSMETICS_REFRESH_MS = 30_000; // a member's equipped cosmetics are re-read at most this often

// Voice lines (soundboard, docs/CONTRACT.md "Voice lines"): a purchased clip any owner may play at any time, heard by the whole
// room. Limits are in memory only (a hibernating object forgets them: harmless). Never touches game state, timers or idle logic.
// The numbers are VOICE_LIMITS in shared/cosmetics.js (the client's cooldown ring reads the same ones); the lobby counts as its own "match".
const VOICE_OWNED_TTL_MS = 60_000; // a member's owned voice lines are cached this long
const VOICE_RECHECK_MS = 5000; // a "not owned" answer is re-checked against the database at most this often (a fresh purchase works within seconds)

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const randomId = (n = 6) => {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
};

function shuffled(list) {
  const a = [...list];
  const r = crypto.getRandomValues(new Uint32Array(a.length));
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = r[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** WebSocket close codes must be 1000 or 3000-4999 for close(); coerce anything else. */
const safeCode = (code) => (code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000);

/** The adapter's optional `pieces` hook as a list of ids (strings; `{id}` objects are tolerated). */
export function pieceIds(adapter) {
  const list = adapter && adapter.pieces;
  if (!Array.isArray(list)) return [];
  const ids = list.map((x) => (typeof x === 'string' ? x : x && typeof x.id === 'string' ? x.id : null));
  return ids.filter((id, i) => id && ids.indexOf(id) === i);
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.adapter = null;
    this.chatAt = new Map(); // userId -> last chat time
    this.rate = new Map(); // userId -> { start, count }
    this.autoFailures = new Map(); // playerId -> consecutive failed auto moves
    this.lastActivitySaved = 0;
    this.listingChain = Promise.resolve(); // listing writes run strictly in order
    this.listedSig = null; // signature of the last row written to `rooms`
    this.listedAt = 0;
    this.voiceOwned = new Map(); // userId -> { ids:Set, at } owned voice lines (one DB read, then cached)
    this.voiceTimes = new Map(); // userId -> accepted voice timestamps within the burst window
    this.voiceRoomTimes = []; // accepted voice timestamps of the whole room within the room window
    this.voiceSeq = new Map(); // userId -> number of voice lines accepted from them (the `seq` field; never reset)
    this.voiceGame = { key: null, counts: new Map() }; // per-match voice counts
    this.cosmeticsAt = new Map(); // userId -> when their equipped cosmetics were last read
    this.cosmeticsJob = Promise.resolve(); // the latest background cosmetics read (tests await it)
    this.net = new NetPresence(); // connection strength per member: memory only, never stored (netpresence.js)
    this.netSig = null; // what the last `room` broadcast said about it
    this.netBroadcastAt = 0; // when the last `room` broadcast went out (net changes are coalesced to one per second)
    this.netTimer = null;
    this.netTimerAt = 0;
    this.hubSent = new Map(); // userId -> { state, ok, at }: the room state last told to that member's UserHub (memory only)
    this.hubJob = Promise.resolve(); // the latest background hub update (tests await it)
    // Answer heartbeats without waking a hibernating object.
    try {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    } catch {
      /* older runtimes: the message handler answers pings instead */
    }
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || null;
      this.bindAdapter();
    });
  }

  // ------------------------------------------------------------------ plumbing

  /**
   * Pick the adapter of the loaded room and fill in fields that rooms created by older versions
   * lack (they were all Nawabi Raj rooms, private, without per-match meta or deadlines).
   */
  bindAdapter() {
    const r = this.room;
    this.adapter = null;
    if (!r) return;
    r.gameId ||= DEFAULT_GAME_ID;
    r.visibility ||= DEFAULT_VISIBILITY;
    r.meta ||= {};
    r.deadlines ||= {};
    this.adapter = getAdapter(r.gameId);
    if (this.adapter && typeof this.adapter.upgradeRecord === 'function') this.adapter.upgradeRecord(r);
    if ((r.v || 0) < ROOM_VERSION) r.v = ROOM_VERSION; // written back with the next save
  }

  async save() {
    if (this.room) {
      await this.ctx.storage.put('room', this.room);
      this.syncListing();
      this.syncHubStatus();
    }
  }

  /**
   * Keep each member's UserHub in step with this room (friends see "In a lobby" / "Playing"): tell the hub when a
   * member enters, when the room starts, and clear it when they leave or the room finishes / expires. Only changes
   * are sent. A hub that did not take the update (the user is offline) is retried at most every HUB_RETRY_MS.
   * Best effort: never throws, never blocks the game.
   */
  syncHubStatus(clearAll = false) {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    const sent = new Map();
    for (const [uid, e] of this.hubSent) if (e.ok || now - e.at < HUB_RETRY_MS) sent.set(uid, e.state);
    const desired = clearAll ? new Map() : roomMemberStates(r, this.connectedIds());
    const updates = diffStates(sent, desired);
    if (!updates.length) return;
    const jobs = updates.map(async ([uid, state]) => {
      if (state) this.hubSent.set(uid, { state, ok: false, at: now });
      else this.hubSent.delete(uid);
      const accepted = await setUserRoomStatus(this.env, uid, state);
      const e = this.hubSent.get(uid);
      if (accepted && e && e.state === state) e.ok = true;
    });
    this.hubJob = Promise.all(jobs).catch(() => {});
    try {
      this.ctx.waitUntil(this.hubJob);
    } catch {
      /* no execution context (tests) */
    }
  }

  touch() {
    if (this.room) this.room.lastActivity = Date.now();
  }

  liveSockets() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === 1);
  }

  /** Set of user ids that have at least one open socket. */
  connectedIds() {
    const ids = new Set();
    for (const ws of this.liveSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.userId) ids.add(a.userId);
    }
    return ids;
  }

  send(ws, msg) {
    try {
      ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } catch {
      /* socket is gone */
    }
  }

  broadcast(msg, skip) {
    const payload = JSON.stringify(msg);
    for (const ws of this.liveSockets()) if (ws !== skip) this.send(ws, payload);
  }

  sendError(ws, message) {
    this.send(ws, { t: 'error', message });
  }

  /** What the state looks like to one viewer (the adapter hides secrets; same object = nothing hidden). */
  viewOf(userId) {
    const a = this.adapter;
    return this.withWindowClock(a && typeof a.redact === 'function' ? a.redact(this.room.state, userId) : this.room.state);
  }

  /**
   * An open Snatch window tells each client how much of it is left (`pending.remainingMs`, of `pending.ms`), so a page
   * that reloads or reconnects mid-window resumes the countdown instead of restarting it. Display only: the server
   * timer (adapter.deadlines) decides when the window really closes.
   */
  withWindowClock(view) {
    const r = this.room;
    const p = view && view.pending;
    // Same for an open sealed auction (`pending.type` 'auction', window `pending.ms`): the countdown survives a reload.
    if (!view || (view.phase !== 'snatch' && view.phase !== 'auction') || !p || p.type !== view.phase || !Number.isFinite(p.ms)) return view;
    const d = (typeof this.adapter.deadlines === 'function' ? this.adapter.deadlines(r.state) : [])[0];
    const startedAt = d ? this.deadlineStart(d) : Date.now();
    return { ...view, pending: { ...p, remainingMs: Math.max(0, Math.min(p.ms, startedAt + p.ms - Date.now())) } };
  }

  /** When an adapter timer started counting: when it first appeared (after the animation, or at once for `anchor: 'apply'`). */
  deadlineStart(d) {
    const r = this.room;
    return r.deadlines?.[d.key] ?? (d.anchor === 'apply' ? r.lastApplyAt : r.lastApplyAt + r.animMs);
  }

  /** Seated players the game is waiting for (adapter.pendingPlayerIds, default the turn player). */
  waitingIds() {
    const r = this.room;
    const a = this.adapter;
    if (!r || !a || r.status !== 'playing' || !r.state || a.isOver(r.state)) return [];
    const raw = typeof a.pendingPlayerIds === 'function' ? a.pendingPlayerIds(r.state) || [] : [a.turnPlayerId(r.state)];
    const out = [];
    for (const id of raw) if (id != null && !out.includes(id) && r.players.some((p) => p.id === id)) out.push(id);
    return out;
  }

  /**
   * The decision clock sent with every state: `deadline` = when the room will next play a move on its
   * own (see plan(): the 45 s timer counted after the animation, the shorter pace for idle or
   * disconnected players, or an adapter timer), `waitingFor` = who the game waits for.
   */
  clockView() {
    const plan = this.plan();
    return { deadline: plan ? plan.at : null, waitingFor: this.waitingIds() };
  }

  /** One `state` message (the clock is the same for every viewer). */
  stateMessage(state, events, clock = this.clockView()) {
    // `now` = the server's clock at sending: clients correct their countdowns for a wrong device clock (see localClock)
    return { t: 'state', state, events, seq: this.room.seq, clock, now: Date.now() };
  }

  /** Pieces nobody (except `exceptId`) holds, in the adapter's order. */
  freePieces(exceptId) {
    const taken = new Set(this.room.players.filter((p) => p.id !== exceptId && p.piece).map((p) => p.piece));
    return pieceIds(this.adapter).filter((id) => !taken.has(id));
  }

  /**
   * `connected` as the room shows it: an open socket, or a socket that closed less than GRACE_MS ago
   * (a reload or a network blip does not flap the seat). Finished rooms and departed seats: live sockets only.
   */
  presenceOf(p, sockets, now) {
    const r = this.room;
    if (sockets.has(p.id)) return true;
    if (p.left || r.status === 'finished') return false;
    const since = r.disc[p.id];
    return since != null && now - since < GRACE_MS;
  }

  presenceSignature(view) {
    return JSON.stringify(view.players.map((p) => [p.id, p.connected]));
  }

  /** Settings as the lobby shows them (adapters may complete them with the engine's own defaults). */
  lobbySettings() {
    const a = this.adapter;
    const s = this.room.settings;
    return a && typeof a.lobbySettings === 'function' ? a.lobbySettings(s) : s;
  }

  /**
   * How long a connected human has to act on this room's game, in ms: the adapter's `turnMs(state)` (host rule
   * `turnSeconds`, kept by the running game in its own config), else the old constant TURN_MS.
   */
  turnMs() {
    const a = this.adapter;
    const ms = a && typeof a.turnMs === 'function' ? Number(a.turnMs(this.room && this.room.state)) : NaN;
    return Number.isFinite(ms) && ms >= 1000 ? Math.round(ms) : TURN_MS;
  }

  /** How many decisions in a row this connected human let run out without acting (0 for anyone who has acted or reconnected since). */
  idleStrikes(id) {
    const r = this.room;
    return (r && r.idle && r.idle[id]) || 0;
  }

  clearIdle(id) {
    const r = this.room;
    if (r.idle) delete r.idle[id];
    if (r.idleTurn) delete r.idleTurn[id];
  }

  roomView() {
    const r = this.room;
    const connected = this.connectedIds();
    const now = Date.now();
    return {
      code: r.code,
      status: r.status,
      hostId: r.hostId,
      maxPlayers: r.maxPlayers,
      gameId: r.gameId,
      visibility: r.visibility,
      settings: this.lobbySettings(),
      players: r.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        ready: !!p.ready,
        connected: this.presenceOf(p, connected, now),
        piece: typeof p.piece === 'string' ? p.piece : null,
        cosmetics: cleanEquipped(p.cosmetics),
        net: this.net.view(p.id, connected.has(p.id), now),
      })),
    };
  }

  /**
   * Broadcast the authoritative state. Each recipient gets the adapter's `redact` view of it;
   * when nothing is hidden (the view is the state itself) one serialised payload fits everyone.
   */
  broadcastState(events) {
    const r = this.room;
    const clock = this.clockView();
    let shared = null;
    for (const ws of this.liveSockets()) {
      const uid = ws.deserializeAttachment()?.userId;
      const view = this.viewOf(uid);
      if (view === r.state) {
        shared ||= JSON.stringify(this.stateMessage(r.state, events, clock));
        this.send(ws, shared);
      } else {
        this.send(ws, this.stateMessage(view, events, clock));
      }
    }
  }

  broadcastRoom() {
    const room = this.roomView();
    this.room.presenceSig = this.presenceSignature(room); // kept in the record: survives hibernation
    this.netSig = NetPresence.signature(room.players); // memory only: net never goes into the record
    this.netBroadcastAt = Date.now();
    this.broadcast({ t: 'room', room });
  }

  /**
   * A member reported their round-trip time. Everyone else sees it as `net` in the `room` message, but only when a
   * member's bars (or their staleness) change, at most once per second; the rest is dropped on the floor.
   */
  onNet(att, msg) {
    const r = this.room;
    if (!r || !r.players.some((p) => p.id === att.userId)) return; // not seated: nothing to show
    const rtt = parseNetRtt(msg.rtt);
    if (rtt == null) return;
    if (!this.net.report(att.userId, rtt, Date.now())) return; // faster than one report per 2 s: ignored
    this.flushNet();
  }

  /** Broadcast `room` if the visible net state changed (coalesced), and arm the timer for the next change. */
  flushNet() {
    const r = this.room;
    if (!r || !r.players.length) return;
    const now = Date.now();
    if (NetPresence.signature(this.roomView().players) !== this.netSig) {
      const wait = this.netBroadcastAt + NET_BROADCAST_GAP_MS - now;
      if (wait > 0) return this.armNetTimer(wait);
      this.broadcastRoom();
    }
    const next = this.net.nextChangeAt(this.connectedIds(), now);
    if (next != null) this.armNetTimer(next - now);
  }

  /** One short timer (never longer than NET_LOST_MS): the coalesced broadcast, or a report turning stale / its member lost. */
  armNetTimer(delay) {
    const at = Date.now() + delay;
    if (this.netTimer && this.netTimerAt <= at) return; // an earlier wake-up is pending
    if (this.netTimer) clearTimeout(this.netTimer);
    this.netTimerAt = at;
    this.netTimer = setTimeout(() => {
      this.netTimer = null;
      try {
        this.flushNet();
      } catch (err) {
        console.error('net broadcast failed:', err && err.message);
      }
    }, Math.max(0, delay));
  }

  /** Re-broadcast `room` when somebody's `connected` flag changed without an event (their grace ran out). */
  async broadcastPresenceIfChanged() {
    const r = this.room;
    if (!r || !r.players.length) return;
    if (this.presenceSignature(this.roomView()) === r.presenceSig) return;
    this.broadcastRoom();
    await this.save();
  }

  /**
   * Read a member's equipped cosmetics (`users.equipped`) in the background. Best effort: on failure
   * the member keeps what they had (`{}` for a new member). Broadcasts `room` when they changed.
   */
  refreshCosmetics(userId) {
    if (!hasDb(this.env)) return;
    const now = Date.now();
    if (now - (this.cosmeticsAt.get(userId) || 0) < COSMETICS_REFRESH_MS) return;
    this.cosmeticsAt.set(userId, now);
    const job = (async () => {
      let equipped;
      try {
        equipped = cleanEquipped(await loadEquipped(this.env, userId));
      } catch (err) {
        this.cosmeticsAt.delete(userId); // try again on the next connect
        console.error('cosmetics load failed:', err && err.code ? `${err.code} ${err.message}` : err && err.message);
        return;
      }
      const m = this.room && this.room.players.find((p) => p.id === userId);
      if (!m || JSON.stringify(cleanEquipped(m.cosmetics)) === JSON.stringify(equipped)) return;
      m.cosmetics = equipped;
      await this.save();
      this.broadcastRoom();
    })().catch(() => {});
    this.cosmeticsJob = job;
    try {
      this.ctx.waitUntil(job);
    } catch {
      /* no execution context (tests) */
    }
  }

  hostName() {
    const h = this.room.players.find((p) => p.id === this.room.hostId);
    return h ? h.name : null;
  }

  /** Make sure the host is a present player (transfer if not). */
  fixHost() {
    const r = this.room;
    if (r.players.some((p) => p.id === r.hostId)) return;
    const next = r.players.find((p) => !p.left);
    r.hostId = next ? next.id : null;
  }

  /** A lobby with no players left is pointless: let it expire in ~10 minutes instead of 24 h. */
  expireSoonIfEmpty() {
    const r = this.room;
    if (r.status === 'lobby' && r.players.length === 0) {
      r.lastActivity = Math.min(r.lastActivity, Date.now() - ROOM_TTL_MS + 10 * 60 * 1000);
    }
  }

  // ------------------------------------------------------------------ listing (`rooms` table)

  /** Run one listing write after the previous ones; failures are logged, never thrown. */
  queueListing(op) {
    this.listingChain = this.listingChain.then(op).catch((err) => {
      this.listedSig = null; // try again on the next change
      console.error('room listing failed:', err && err.code ? `${err.code} ${err.message}` : err && err.message);
    });
    try {
      this.ctx.waitUntil(this.listingChain);
    } catch {
      /* no execution context (tests): the chain still runs */
    }
  }

  /**
   * Keep this room's row in `rooms` in step with the record (called after every save). Unchanged
   * rows are only rewritten every LISTING_HEARTBEAT_MS; a lobby without humans is removed.
   */
  syncListing(force = false) {
    const r = this.room;
    if (!r || !hasDb(this.env)) return;
    const now = Date.now();
    const empty = r.status === 'lobby' && r.players.length === 0;
    const row = roomRow(r);
    const sig = empty ? 'empty' : rowSignature(row);
    if (!force && sig === this.listedSig && now - this.listedAt < LISTING_HEARTBEAT_MS) return;
    this.listedSig = sig;
    this.listedAt = now;
    this.queueListing(() => (empty ? deleteRoomRow(this.env, row.code) : upsertRoomRow(this.env, row)));
  }

  dropListing(code) {
    this.listedSig = 'gone';
    if (hasDb(this.env)) this.queueListing(() => deleteRoomRow(this.env, code));
  }

  // ------------------------------------------------------------------ HTTP / WS entry

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/init' && request.method === 'POST') return this.handleInit(request);
    if (url.pathname === '/info') return this.handleInfo(url);

    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected WebSocket' }, 426);
    return this.handleUpgrade(request);
  }

  async handleInit(request) {
    if (this.room) return json({ error: 'Room code already in use.' }, 409);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Bad request.' }, 400);
    }
    const host = body && body.host;
    const code = body && body.code;
    if (!host || !isUuid(host.id) || typeof code !== 'string' || !/^[A-Z0-9]{4,10}$/.test(code)) {
      return json({ error: 'Bad request.' }, 400);
    }
    // Defence in depth: the route validated this already, the room validates it again.
    const init = parseRoomInit(body);
    if (!init.ok) return json({ error: init.error }, 400);
    const now = Date.now();
    this.room = {
      v: ROOM_VERSION,
      code,
      gameId: init.gameId,
      visibility: init.visibility,
      status: 'lobby',
      hostId: host.id,
      maxPlayers: init.maxPlayers,
      settings: init.settings,
      players: [
        {
          id: host.id,
          name: sanitizeName(host.name) || 'Player',
          avatar: parseAvatar(host.avatar) ?? 0,
          ready: true,
          guest: !!host.guest,
        },
      ],
      state: null,
      seq: 0,
      matchId: null,
      startedAt: null,
      endedAt: null,
      persisted: false,
      abandoned: false,
      persistAttempts: 0,
      persistAt: null,
      lastActivity: now,
      createdAt: now,
      lastApplyAt: now,
      animMs: 0,
      meta: {}, // opaque per-match data the adapter folds events into (see adapter.track)
      deadlines: {}, // adapter timer key -> when it started counting
      afk: {},
      idle: {}, // consecutive decisions a connected human let run out (see AFK_STRIKES)
      disc: { [host.id]: now }, // the host must connect within LOBBY_GRACE_MS
      banned: {},
      noHumanSince: null,
    };
    this.adapter = init.adapter;
    await this.save();
    await this.scheduleAlarm();
    return json({ code, gameId: init.gameId }, 201);
  }

  handleInfo(url) {
    const r = this.room;
    if (!r) return json({ exists: false });
    const member = url.searchParams.get('member');
    return json({
      exists: true,
      status: r.status,
      players: r.players.length,
      maxPlayers: r.maxPlayers,
      hostName: this.hostName(),
      isMember: !!member && r.players.some((p) => p.id === member),
      gameId: r.gameId,
      visibility: r.visibility,
      settings: this.lobbySettings(),
    });
  }

  /** Accept a socket just to tell the client why it cannot join, then close it. */
  rejectSocket(closeCode, message) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ['rejected']);
    this.send(server, { t: 'error', message });
    try {
      server.close(closeCode, message.slice(0, 100));
    } catch {
      /* ignore */
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleUpgrade(request) {
    const userId = request.headers.get('X-User-Id');
    if (!isUuid(userId)) return json({ error: 'Unauthorized' }, 401);
    let name = '';
    try {
      name = sanitizeName(decodeURIComponent(request.headers.get('X-User-Name') || ''));
    } catch {
      /* malformed encoding */
    }
    name = name || 'Player';
    const avatar = parseAvatar(Number(request.headers.get('X-User-Avatar'))) ?? 0;
    const guest = request.headers.get('X-User-Guest') === '1';

    const r = this.room;
    if (!r) return this.rejectSocket(4004, 'That room does not exist.');
    if (!this.adapter) return this.rejectSocket(4004, 'This game is no longer available.');

    const now = Date.now();
    const banUntil = r.banned[userId];
    if (banUntil && banUntil > now) return this.rejectSocket(4003, 'You were removed from this room.');

    let member = r.players.find((p) => p.id === userId);
    if (!member) {
      if (r.status !== 'lobby') return this.rejectSocket(4003, 'This game has already started.');
      if (r.players.length >= r.maxPlayers) return this.rejectSocket(4003, 'This room is full.');
      member = { id: userId, name, avatar, ready: false, guest, piece: this.freePieces(userId)[0] ?? null, cosmetics: {} };
      r.players.push(member);
      if (!r.hostId) r.hostId = userId;
      if (!guest) this.inviteJoined = notifyInviteJoined(this.env, r.code, { id: userId, name, avatar }, this.ctx);
    } else {
      // Rejoin: refresh the display identity, clear absence markers.
      member.name = name;
      member.avatar = avatar;
      member.guest = guest;
      member.left = false;
      if (r.status === 'lobby' && !member.piece) member.piece = this.freePieces(userId)[0] ?? null;
    }
    this.hubSent.delete(userId); // (re)connecting: make sure their hub hears where they are
    delete r.disc[userId];
    delete r.afk[userId];
    this.clearIdle(userId); // back at the table: a full decision timer again
    r.noHumanSince = null;
    this.touch();

    // Keep a bounded number of sockets per user (stale ones from flaky networks pile up).
    const mine = this.ctx.getWebSockets(userId).filter((ws) => ws.readyState === 1);
    if (!mine.length) this.net.forget(userId); // a fresh connection starts "measuring", not with the last session's number
    if (mine.length >= MAX_SOCKETS_PER_USER) {
      const oldest = mine.sort(
        (a, b) => (a.deserializeAttachment()?.at || 0) - (b.deserializeAttachment()?.at || 0),
      )[0];
      try {
        oldest.close(4009, 'replaced');
      } catch {
        /* ignore */
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, name, avatar, guest, at: now });

    await this.save();
    this.broadcastRoom();
    if (r.state) this.send(server, this.stateMessage(this.viewOf(userId), []));
    await this.scheduleAlarm();
    this.refreshCosmetics(userId);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ------------------------------------------------------------------ socket events

  allowMessage(userId) {
    const now = Date.now();
    const b = this.rate.get(userId);
    if (!b || now - b.start > 5000) {
      this.rate.set(userId, { start: now, count: 1 });
      return true;
    }
    b.count += 1;
    return b.count <= 40;
  }

  async webSocketMessage(ws, message) {
    const att = ws.deserializeAttachment();
    if (!att || !att.userId || !this.room) return;
    if (typeof message !== 'string') return this.sendError(ws, 'Only text messages are supported.');
    if (message.length > MAX_MESSAGE_CHARS) return this.sendError(ws, 'Message too large.');
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return this.sendError(ws, 'Invalid message.');
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this.sendError(ws, 'Invalid message.');
    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
    if (msg.t === 'net') return this.onNet(att, msg); // own gentle limit (1 per 2 s); never an error, never counted as a game message
    if (!this.allowMessage(att.userId)) return this.sendError(ws, 'You are sending messages too fast.');
    if (!this.adapter) return this.sendError(ws, 'This game is no longer available.');

    const r = this.room;
    const me = r.players.find((p) => p.id === att.userId);
    if (!me) return this.sendError(ws, 'You are not in this room.');
    const isHost = r.hostId === me.id;

    switch (msg.t) {
      case 'ready':
        return this.onReady(ws, me, msg);
      case 'piece':
        return this.onPiece(ws, me, msg);
      case 'settings':
        return this.onSettings(ws, isHost, msg);
      case 'visibility':
        return this.onVisibility(ws, isHost, msg);
      case 'kick':
        return this.onKick(ws, isHost, msg);
      case 'start':
        return this.onStart(ws, isHost);
      case 'action':
        return this.onAction(ws, me, msg);
      case 'chat':
        return this.onChat(ws, me, msg);
      case 'voice':
        return this.onVoice(ws, me, msg);
      case 'leave':
        return this.onLeave(ws, me);
      default:
        return this.sendError(ws, 'Unknown message type.');
    }
  }

  async webSocketClose(ws, code) {
    try {
      ws.close(safeCode(code), 'closed');
    } catch {
      /* already closed */
    }
    await this.onDisconnect(ws);
  }

  async webSocketError(ws) {
    await this.onDisconnect(ws);
  }

  async onDisconnect(ws) {
    const r = this.room;
    if (!r) return;
    this.net.prune(this.connectedIds()); // whoever has no live socket left is no longer measured
    if (r.players.length && this.reconcileConnections(Date.now())) await this.save();
    this.syncHubStatus(); // a lobby member whose socket dropped is no longer "at the table"
    this.broadcastRoom();
    await this.scheduleAlarm();
  }

  // ------------------------------------------------------------------ lobby handlers

  onReady(ws, me, msg) {
    if (this.room.status !== 'lobby') return this.sendError(ws, 'The game has already started.');
    if (typeof msg.ready !== 'boolean') return this.sendError(ws, 'Invalid ready value.');
    me.ready = msg.ready;
    this.touch();
    return this.save().then(() => this.broadcastRoom());
  }

  async onPiece(ws, me, msg) {
    const r = this.room;
    if (r.status !== 'lobby') return this.sendError(ws, 'Pieces can only be chosen in the lobby.');
    const ids = pieceIds(this.adapter);
    if (!ids.length) return this.sendError(ws, 'This game has no pieces to choose from.');
    if (typeof msg.piece !== 'string' || !ids.includes(msg.piece)) return this.sendError(ws, 'Unknown piece.');
    if (me.piece === msg.piece) return this.send(ws, { t: 'room', room: this.roomView() });
    if (r.players.some((p) => p.id !== me.id && p.piece === msg.piece)) return this.sendError(ws, 'That piece is taken.');
    me.piece = msg.piece;
    this.touch();
    await this.save();
    this.broadcastRoom();
  }

  async onSettings(ws, isHost, msg) {
    const r = this.room;
    if (!isHost) return this.sendError(ws, 'Only the host can change settings.');
    if (r.status !== 'lobby') return this.sendError(ws, 'Settings are locked once the game starts.');
    const parsed = parseSettingsPatch(this.adapter, r.settings, msg.settings);
    if (!parsed.ok) return this.sendError(ws, parsed.error);
    if (parsed.maxPlayers !== undefined && parsed.maxPlayers < r.players.length) {
      return this.sendError(ws, 'There are already more players than that.');
    }
    r.settings = parsed.settings;
    if (parsed.maxPlayers !== undefined) r.maxPlayers = parsed.maxPlayers;
    this.touch();
    await this.save();
    this.broadcastRoom();
  }

  async onVisibility(ws, isHost, msg) {
    const r = this.room;
    if (!isHost) return this.sendError(ws, 'Only the host can change who can see this room.');
    if (r.status !== 'lobby') return this.sendError(ws, 'Visibility is locked once the game starts.');
    const visibility = parseVisibility(msg.visibility);
    if (!visibility) return this.sendError(ws, 'Visibility must be private or public.');
    r.visibility = visibility;
    this.touch();
    await this.save();
    this.broadcastRoom();
    await this.scheduleAlarm();
  }

  async onKick(ws, isHost, msg) {
    const r = this.room;
    if (!isHost) return this.sendError(ws, 'Only the host can remove players.');
    if (r.status !== 'lobby') return this.sendError(ws, 'Players can only be removed in the lobby.');
    const target = r.players.find((p) => p.id === msg.id);
    if (!target) return this.sendError(ws, 'That player is not in the room.');
    if (target.id === r.hostId) return this.sendError(ws, 'You cannot remove yourself.');
    r.players = r.players.filter((p) => p.id !== target.id);
    r.banned[target.id] = Date.now() + KICK_BAN_MS;
    this.touch();
    for (const sock of this.ctx.getWebSockets(target.id)) {
      this.send(sock, { t: 'kicked' });
      try {
        sock.close(4003, 'kicked');
      } catch {
        /* ignore */
      }
    }
    await this.save();
    this.broadcastRoom();
  }

  async onLeave(ws, me) {
    const r = this.room;
    if (r.status === 'lobby') {
      r.players = r.players.filter((p) => p.id !== me.id);
      delete r.disc[me.id];
      this.fixHost();
      this.touch();
      this.expireSoonIfEmpty();
      await this.save();
      for (const sock of this.ctx.getWebSockets(me.id)) {
        try {
          sock.close(1000, 'left');
        } catch {
          /* ignore */
        }
      }
      this.broadcastRoom();
      await this.scheduleAlarm();
      return;
    }
    if (r.status === 'playing' && r.state && !this.adapter.isOver(r.state)) {
      const resign = typeof this.adapter.resignAction === 'function' ? this.adapter.resignAction(r.state, me.id) : null;
      if (resign) await this.applyAndBroadcast(resign);
    }
    me.left = true;
    this.touch();
    await this.save();
    for (const sock of this.ctx.getWebSockets(me.id)) {
      try {
        sock.close(1000, 'left');
      } catch {
        /* ignore */
      }
    }
    this.broadcastRoom();
    await this.scheduleAlarm();
  }

  async onStart(ws, isHost) {
    const r = this.room;
    const a = this.adapter;
    if (!isHost) return this.sendError(ws, 'Only the host can start the game.');
    if (r.status !== 'lobby') return this.sendError(ws, 'The game has already started.');
    if (r.players.length < a.minPlayers) {
      return this.sendError(ws, `You need at least ${a.minPlayers} players to start.`);
    }
    if (r.players.length > r.maxPlayers) return this.sendError(ws, 'Too many players for this room.');

    const order = shuffled(r.players);
    let state;
    try {
      state = a.createGame({
        players: order.map((p) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          ...(typeof p.piece === 'string' && p.piece ? { piece: p.piece } : {}),
        })),
        settings: { ...r.settings },
        seed: crypto.getRandomValues(new Uint32Array(1))[0],
      });
    } catch (err) {
      console.error('createGame failed:', err && err.message);
      return this.sendError(ws, 'Could not start the game.');
    }
    const now = Date.now();
    r.status = 'playing';
    r.state = state;
    r.seq = 1;
    r.matchId = crypto.randomUUID();
    r.startedAt = now;
    r.endedAt = null;
    r.persisted = false;
    r.persistAttempts = 0;
    r.persistAt = null;
    r.abandoned = false;
    r.lastApplyAt = now;
    r.animMs = a.startAnimMs || 0; // e.g. a short "game start" intro the client plays
    r.meta = {};
    r.deadlines = {};
    this.syncDeadlines(); // a game may start with a timer already running
    r.afk = {};
    r.idle = {};
    r.idleTurn = {};
    r.disc = {};
    r.noHumanSince = null;
    this.autoFailures.clear();
    this.touch();
    await this.save();
    this.broadcastRoom();
    this.broadcastState([]);
    await this.scheduleAlarm();
  }

  // ------------------------------------------------------------------ game handlers

  async onAction(ws, me, msg) {
    const r = this.room;
    if (r.status !== 'playing' || !r.state) return this.sendError(ws, 'No game is in progress.');
    const a = this.adapter;
    // playerId is forced to the socket's user
    const action = typeof a.sanitizeAction === 'function' ? a.sanitizeAction(msg.action, me.id) : defaultSanitizeAction(msg.action, me.id);
    if (!action) return this.sendError(ws, 'Invalid action.');
    delete r.afk[me.id]; // a human who acts is no longer idle
    this.clearIdle(me.id);
    delete r.disc[me.id];
    const res = await this.applyAndBroadcast(action);
    if (res.error) {
      this.sendError(ws, res.error);
      await this.scheduleAlarm();
    }
  }

  /**
   * Apply one action to the authoritative state, bump seq, broadcast, persist, reschedule.
   * Returns the adapter result (with `error` when rejected; nothing is changed then).
   */
  async applyAndBroadcast(action) {
    const r = this.room;
    const a = this.adapter;
    const res = a.applyAction(r.state, action);
    if (res.error) return res;
    r.state = res.state;
    if (action.type === 'SNATCH' && r.state.phase === 'snatch') {
      // A sealed press (docs/GAME_RULES.md 9.4): nobody else may learn that it happened, or when. No seq bump, no
      // broadcast; only the presser gets a snapshot so their own button locks. The window's timer is unchanged.
      this.touch();
      const clock = this.clockView();
      for (const ws of this.liveSockets()) {
        if (ws.deserializeAttachment()?.userId === action.playerId) {
          this.send(ws, this.stateMessage(this.viewOf(action.playerId), [], clock));
        }
      }
      await this.save();
      await this.scheduleAlarm();
      return res;
    }
    r.seq += 1;
    r.lastApplyAt = Date.now();
    r.animMs = typeof a.animationMs === 'function' ? a.animationMs(res.events, res.state) : 0;
    if (typeof a.track === 'function') r.meta = a.track(r.meta || {}, res.events, r.state) || r.meta || {};
    this.syncDeadlines();
    this.touch();
    this.broadcastState(res.events);
    if (a.isOver(r.state)) {
      r.status = 'finished';
      r.endedAt = Date.now();
      r.persistAt = Date.now();
      this.broadcastRoom();
    }
    await this.save();
    await this.scheduleAlarm();
    return res;
  }

  /**
   * Game timers (adapter.deadlines): a timer that is new gets its clock started when the animation
   * of the action that created it ends; timers that persist keep their start; finished ones go.
   */
  syncDeadlines() {
    const r = this.room;
    const list = typeof this.adapter.deadlines === 'function' ? this.adapter.deadlines(r.state) || [] : [];
    const next = {};
    for (const d of list) next[d.key] = this.deadlineStart(d);
    r.deadlines = next;
  }

  async onChat(ws, me, msg) {
    const now = Date.now();
    if (now - (this.chatAt.get(me.id) || 0) < CHAT_GAP_MS) return; // silently drop floods
    const text = sanitizeChat(msg.text);
    const emote = sanitizeEmote(msg.emote, this.adapter.emotes || []);
    if (!text && !emote) return;
    this.chatAt.set(me.id, now);
    this.broadcast({ t: 'chat', id: randomId(8), from: me.id, name: me.name, text, emote, ts: now });
    this.touch();
    if (now - this.lastActivitySaved > 10 * 60 * 1000) {
      this.lastActivitySaved = now;
      await this.save();
      await this.scheduleAlarm();
    }
  }

  /** Does this member own voice line `id`? Cached per member; a miss re-reads the database at most every VOICE_RECHECK_MS. Throws if the read fails. */
  async ownsVoice(userId, id) {
    const now = Date.now();
    const c = this.voiceOwned.get(userId);
    if (c && now - c.at < VOICE_OWNED_TTL_MS && c.ids.has(id)) return true;
    if (c && now - c.at < VOICE_RECHECK_MS) return false;
    const bought = await loadOwnedItemIds(this.env, userId);
    this.voiceOwned.set(userId, { ids: new Set(bought.filter(isVoiceId)), at: Date.now() });
    return this.voiceOwned.get(userId).ids.has(id);
  }

  /**
   * `{t:'voice', id}`: play an owned voice line for everybody in the room (lobby or game, any time, not only on the sender's
   * turn). Broadcast to EVERY open socket including the sender's: `{t:'voice', from, id, ts, seq}` (seq counts this sender's
   * accepted lines so their client can drop the echo of an optimistic local play). Nothing is stored; it is not an action:
   * it never changes the game, resets no timer and clears no idle / afk flag.
   */
  async onVoice(ws, me, msg) {
    const id = sanitizeVoiceId(msg.id);
    if (!id) return this.sendError(ws, 'Unknown voice line.');
    let owns = false;
    try {
      owns = await this.ownsVoice(me.id, id);
    } catch (err) {
      console.error('voice ownership check failed:', err && err.code ? `${err.code} ${err.message}` : err && err.message);
      return this.sendError(ws, 'Could not check your voice lines. Try again.');
    }
    if (!owns) return this.sendError(ws, 'Buy voice lines in the shop (sign in).');

    const L = VOICE_LIMITS;
    const now = Date.now();
    const key = (this.room && this.room.matchId) || 'lobby';
    if (this.voiceGame.key !== key) this.voiceGame = { key, counts: new Map() };
    const mine = (this.voiceTimes.get(me.id) || []).filter((t) => now - t < L.burstWindowMs);
    this.voiceRoomTimes = this.voiceRoomTimes.filter((t) => now - t < L.roomWindowMs);
    if ((this.voiceGame.counts.get(me.id) || 0) >= L.perGame) return this.sendError(ws, 'Voice line limit reached for this game.');
    if (
      (mine.length && now - mine[mine.length - 1] < L.cooldownMs) ||
      mine.length >= L.burst ||
      this.voiceRoomTimes.length >= L.roomMax
    ) {
      return this.sendError(ws, 'Voice lines are limited: wait a few seconds.');
    }
    mine.push(now);
    this.voiceTimes.set(me.id, mine);
    this.voiceRoomTimes.push(now);
    this.voiceGame.counts.set(me.id, (this.voiceGame.counts.get(me.id) || 0) + 1);
    const seq = (this.voiceSeq.get(me.id) || 0) + 1;
    this.voiceSeq.set(me.id, seq);
    this.broadcast({ t: 'voice', from: me.id, id, ts: now, seq });
  }

  // ------------------------------------------------------------------ timers (alarms)

  /**
   * What the game is waiting for next: `{ at, id, action, timeout }` or null. Candidates:
   * - the adapter's own timers (`deadlines`, e.g. an unanswered offer is auto-rejected);
   * - every human the game waits for (`pendingPlayerIds`): idle (afk) and disconnected-past-grace
   *   humans are auto-played (`idleAction`) after the same short pause; a connected human gets
   *   this room's decision time (`turnMs()`, counted from when the last animation ends), then is flagged idle.
   * The earliest one wins.
   */
  plan() {
    const r = this.room;
    const a = this.adapter;
    if (!r || !a || r.status !== 'playing' || !r.state || a.isOver(r.state)) return null;
    const pace = (action) => {
      const delay = typeof a.moveDelayMs === 'function' ? a.moveDelayMs(action) : AUTO_MOVE_DELAY_MS;
      return r.lastApplyAt + Math.max(delay, r.animMs);
    };
    const candidates = [];

    const deadlines = typeof a.deadlines === 'function' ? a.deadlines(r.state) || [] : [];
    for (const d of deadlines) {
      const startedAt = this.deadlineStart(d);
      candidates.push({ at: startedAt + d.afterMs, id: d.playerId, action: d.action, timeout: false });
    }
    const adapterAt = candidates.length ? Math.min(...candidates.map((c) => c.at)) : 0; // when the first adapter timer is due

    const waiting =typeof a.pendingPlayerIds === 'function' ? a.pendingPlayerIds(r.state) : [a.turnPlayerId(r.state)];
    for (const id of waiting) {
      const seat = id == null ? null : r.players.find((p) => p.id === id);
      if (!seat) continue;
      const action = a.idleAction(r.state, id);
      if (!action) continue;
      let at;
      let timeout = false;
      if (r.disc[id] != null) {
        // Gone (no socket): played for only once the reconnect grace has run out, however idle they were before.
        at = Math.max(pace(action), r.disc[id] + GRACE_MS);
      } else {
        // Present: the full decision timer for THIS decision, counted from when the last animation ends. Being slow on an
        // earlier turn never shortens it (a stale idle flag used to auto-roll every later turn after ~1.5 s); only a player
        // who let AFK_STRIKES decisions run out in a row gets the shorter AFK window.
        // A running adapter timer (an unanswered trade offer) is the timer for what it waits on: the idle move never
        // comes before it, so a trade timer longer than the decision timer is not cut short (and nobody is flagged idle).
        const limit = this.idleStrikes(id) >= AFK_STRIKES ? Math.min(this.turnMs(), AFK_TURN_MS) : this.turnMs();
        at = Math.max(r.lastApplyAt + r.animMs + limit, adapterAt);
        timeout = true;
      }
      candidates.push({ at, id, action, timeout });
    }

    let best = null;
    for (const c of candidates) if (!best || c.at < best.at) best = c;
    return best;
  }

  /** Reconcile `disc` with the live sockets (covers restarts that dropped sockets silently). */
  reconcileConnections(now) {
    const r = this.room;
    if (!r || r.status === 'finished') return false;
    const connected = this.connectedIds();
    let changed = false;
    for (const p of r.players) {
      if (connected.has(p.id)) {
        if (r.disc[p.id] != null) {
          delete r.disc[p.id];
          changed = true;
        }
      } else if (r.disc[p.id] == null) {
        r.disc[p.id] = now;
        changed = true;
      }
    }
    const anyHuman = r.players.some((p) => !p.left && connected.has(p.id));
    const marker = anyHuman ? null : r.noHumanSince ?? now;
    if (marker !== r.noHumanSince) {
      r.noHumanSince = marker;
      changed = true;
    }
    return changed;
  }

  async scheduleAlarm() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    const times = [r.lastActivity + ROOM_TTL_MS];
    // A seat's `connected` flag turns false when its reconnect grace runs out: wake up to tell everyone.
    if (r.status !== 'finished') {
      for (const p of r.players) {
        const end = r.disc[p.id] != null ? r.disc[p.id] + GRACE_MS : null;
        if (end != null && end > now) times.push(end);
      }
    }
    if (r.status === 'finished' && !r.persisted && !r.abandoned && r.persistAt != null) times.push(r.persistAt);
    if (r.status === 'playing') {
      const plan = this.plan();
      if (plan) times.push(plan.at);
      if (r.noHumanSince != null) times.push(r.noHumanSince + ABANDON_MS);
    }
    if (r.status === 'lobby') {
      for (const p of r.players) {
        if (r.disc[p.id] != null) times.push(r.disc[p.id] + LOBBY_GRACE_MS);
      }
      // A public lobby refreshes its listing row now and then so it keeps counting as fresh.
      if (r.visibility === 'public' && hasDb(this.env)) times.push(this.listedAt + LISTING_HEARTBEAT_MS);
    }
    const when = Math.max(Math.min(...times), now + 5);
    await this.ctx.storage.setAlarm(when);
  }

  async alarm() {
    try {
      await this.tick();
    } catch (err) {
      // Never let an unexpected error spin the alarm retry loop: log and try again shortly.
      console.error('alarm failed:', err && err.message);
      try {
        await this.ctx.storage.setAlarm(Date.now() + 5000);
      } catch {
        /* ignore */
      }
    }
  }

  async tick() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();

    // 1) Expired room: tell everyone, close, wipe (and take it off the listing).
    if (now - r.lastActivity >= ROOM_TTL_MS) {
      for (const ws of this.ctx.getWebSockets()) {
        this.send(ws, { t: 'error', message: 'This room has expired.' });
        try {
          ws.close(4004, 'expired');
        } catch {
          /* ignore */
        }
      }
      this.dropListing(r.code);
      this.syncHubStatus(true);
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.room = null;
      this.adapter = null;
      return;
    }
    if (!this.adapter) {
      // The game was removed from the registry: nothing can be played, just wait for the expiry.
      await this.scheduleAlarm();
      return;
    }

    let dirty = this.reconcileConnections(now);

    // 2) Lobby housekeeping: drop members who vanished; keep a public listing fresh.
    if (r.status === 'lobby') {
      const gone = r.players.filter((p) => r.disc[p.id] != null && now - r.disc[p.id] >= LOBBY_GRACE_MS);
      if (gone.length) {
        const ids = new Set(gone.map((p) => p.id));
        r.players = r.players.filter((p) => !ids.has(p.id));
        for (const id of ids) delete r.disc[id];
        this.fixHost();
        this.expireSoonIfEmpty();
        await this.save();
        this.broadcastRoom();
        dirty = false;
      } else if (r.visibility === 'public') {
        this.syncListing(); // no-op unless the heartbeat is due
      }
    }

    // 3) Game over -> write the match to Neon (retried with backoff, exactly once overall).
    if (r.status === 'finished' && !r.persisted && !r.abandoned && r.persistAt != null && now >= r.persistAt) {
      await this.persist();
      dirty = false;
    }

    // 4) Playing: abandon when nobody is around, else make the due automated move.
    if (r.status === 'playing' && r.state) {
      const allLeft = !r.players.some((p) => !p.left);
      const deserted = r.noHumanSince != null && now - r.noHumanSince >= ABANDON_MS;
      if (allLeft || deserted) {
        r.status = 'finished';
        r.abandoned = true;
        r.endedAt = now;
        await this.save();
        this.broadcastRoom();
        dirty = false;
      } else {
        const plan = this.plan();
        if (plan && plan.at <= now + 25) {
          if (plan.timeout) {
            r.afk[plan.id] = true;
            // One strike per TURN left idle (roll + buy + end turn are three decisions of one turn, not three strikes).
            const turnKey = r.state && r.state.turnCount;
            r.idle = r.idle || {};
            r.idleTurn = r.idleTurn || {};
            if (turnKey == null || r.idleTurn[plan.id] !== turnKey) r.idle[plan.id] = (r.idle[plan.id] || 0) + 1;
            r.idleTurn[plan.id] = turnKey ?? null;
          }
          const res = await this.applyAndBroadcast(plan.action);
          dirty = false;
          if (res.error) await this.handleAutoFailure(plan.id, res.error);
          else this.autoFailures.delete(plan.id);
        }
      }
    }

    if (dirty) await this.save();
    if (this.room) await this.broadcastPresenceIfChanged();
    await this.scheduleAlarm();
  }

  /** Safety net: an automated move the game rejected must never stall it. */
  async handleAutoFailure(playerId, error) {
    const r = this.room;
    const n = (this.autoFailures.get(playerId) || 0) + 1;
    this.autoFailures.set(playerId, n);
    console.error(`auto-move rejected (${n}):`, error);
    if (n >= 3) {
      this.autoFailures.delete(playerId);
      const resign = typeof this.adapter.resignAction === 'function' ? this.adapter.resignAction(r.state, playerId) : null;
      if (resign) {
        await this.applyAndBroadcast(resign);
      } else {
        // Nothing can unstick this game: call it off (it is not recorded).
        r.status = 'finished';
        r.abandoned = true;
        r.endedAt = Date.now();
        await this.save();
        this.broadcastRoom();
      }
    }
  }

  async persist() {
    const r = this.room;
    try {
      const rec = buildMatchRecord(r, this.adapter);
      // Achievement / referral checks and their pushes run after the write, in the background (never failing it).
      await persistMatch(this.env, rec, { defer: (p) => this.ctx.waitUntil(p) });
      r.persisted = true;
      r.persistAt = null;
      await this.save();
    } catch (err) {
      r.persistAttempts += 1;
      console.error('match persist failed:', err && err.code ? `${err.code} ${err.message}` : err && err.message);
      if (r.persistAttempts >= PERSIST_MAX_ATTEMPTS) {
        r.persistAt = null; // give up; the room still works
      } else {
        const wait = PERSIST_BACKOFF_MS[Math.min(r.persistAttempts - 1, PERSIST_BACKOFF_MS.length - 1)];
        r.persistAt = Date.now() + wait;
      }
      await this.save();
    }
  }
}
