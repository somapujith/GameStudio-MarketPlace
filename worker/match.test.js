import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const transactionMock = vi.fn(async () => []);
vi.mock('./db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  query: (...a) => queryMock(...a),
  transaction: (...a) => transactionMock(...a),
}));

const { buildMatchRecord, persistMatch, PERSIST_SQL } = await import('./match.js');
const { getAdapter } = await import('./games/index.js');
const engine = await import('../shared/index.js');

const tycoon = getAdapter('hyderabad-tycoon');
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const U3 = '00000000-0000-4000-8000-000000000003';

function finishedTycoonRoom(settings) {
  const players = [
    { id: U1, name: 'Host', avatar: 1 },
    { id: U2, name: 'Guest', avatar: 2 },
    { id: U3, name: 'Third', avatar: 3 },
  ];
  const state = engine.createGame({ players, settings, seed: 11 });
  state.players[0].stats.rentEarned = 1234;
  state.owners[1] = U1;
  state.phase = 'over';
  state.winner = U1;
  state.winReason = 'rounds';
  state.round = 9;
  return {
    code: 'ABCD23',
    matchId: '11111111-1111-4111-8111-111111111111',
    startedAt: Date.parse('2026-10-16T10:00:00Z'),
    endedAt: Date.parse('2026-10-16T10:20:00Z'),
    state,
    meta: { hotels: { [U1]: 2 } },
    players: players.map((p) => ({ ...p })),
  };
}

describe('buildMatchRecord (game-agnostic, via the adapter)', () => {
  it('maps a finished Tycoon room: game id, legacy columns, hotels, rewards', () => {
    const rec = buildMatchRecord(finishedTycoonRoom(), tycoon);
    expect(rec).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      gameId: 'hyderabad-tycoon',
      roomCode: 'ABCD23',
      rounds: 9,
      winnerId: U1,
      winReason: 'rounds',
      goal: null, // the Hustle rules have no end-cash goal
      maxRounds: 20, // standard mode
      diceMode: 'lucky',
      playerCount: 3,
    });
    // the legacy columns follow the mode / dice the game ran with (classic = no round limit)
    expect(buildMatchRecord(finishedTycoonRoom({ mode: 'quick', dice: 'fair' }), tycoon)).toMatchObject({ maxRounds: 12, diceMode: 'fair', goal: null });
    expect(buildMatchRecord(finishedTycoonRoom({ mode: 'classic' }), tycoon)).toMatchObject({ maxRounds: null, rounds: 9 });
    expect(rec.startedAt).toBe('2026-10-16T10:00:00.000Z');
    expect(rec.players).toHaveLength(3);
    const host = rec.players.find((p) => p.user_id === U1);
    expect(host).toMatchObject({ name: 'Host', is_bot: false, hotels_built: 2, rent_earned: 1234 });
    expect(rec.players.every((p) => p.is_bot === false && p.user_id)).toBe(true);
    expect(rec.players.find((p) => p.user_id === U3)).toMatchObject({ name: 'Third', hotels_built: 0 });
    expect(rec.players.map((p) => p.rank).sort()).toEqual([1, 2, 3]);

    expect(rec.users.map((u) => u.user_id).sort()).toEqual([U1, U2, U3]);
    const win = rec.users.find((u) => u.user_id === U1);
    expect(win).toMatchObject({ won: 1, lg: 1, lw: 1, lrent: 1234 });
    expect(win.lworth).toBe(win.score);
    expect(win.xp).toBeGreaterThan(rec.users.find((u) => u.user_id === U2).xp);
    expect(rec.users.find((u) => u.user_id === U2)).toMatchObject({ won: 0, lw: 0, lg: 1 });
    expect(rec.seats).toHaveLength(3);
    expect(rec.seats.map((s) => s.id).sort()).toEqual([U1, U2, U3]);
  });

  it('a game without legacy columns leaves users.* alone', () => {
    const room = finishedTycoonRoom();
    expect(buildMatchRecord(room, tycoon).winnerId).toBe(U1);

    const other = {
      id: 'counter-race',
      result: () => ({
        winnerId: U1,
        reason: 'target',
        rounds: 3,
        standings: [
          { id: U1, rank: 1, score: 5 },
          { id: U2, rank: 2, score: 2 },
        ],
      }),
    };
    const rec = buildMatchRecord({ ...room, players: room.players.slice(0, 2) }, other);
    expect(rec).toMatchObject({ gameId: 'counter-race', rounds: 3, goal: null, maxRounds: null, diceMode: null, winnerId: U1 });
    for (const u of rec.users) expect(u).toMatchObject({ lg: 0, lw: 0, lworth: 0, lrent: 0 });
    expect(rec.users.find((u) => u.user_id === U1)).toMatchObject({ won: 1, score: 5 });
  });
});

describe('persistMatch', () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionMock.mockClear();
  });

  it('writes the match, the legacy columns and user_game_stats in ONE statement, ratings first', async () => {
    queryMock.mockImplementation(async (env, text) => {
      if (/FROM user_game_stats WHERE/.test(text)) return [{ user_id: U1, rating: 1100 }]; // U2 and U3 are new
      return [{ inserted: 1, users: [{ id: U1, xp: 130 }, { id: U2, xp: 60 }, { id: U3, xp: 50 }] }];
    });
    const rec = buildMatchRecord(finishedTycoonRoom(), tycoon);
    const res = await persistMatch({}, rec);
    expect(res).toEqual({ inserted: true, coinMultiplier: 1 });

    const [ratingCall] = queryMock.mock.calls;
    const writeCall = queryMock.mock.calls.find((c) => c[1] === PERSIST_SQL);
    expect(ratingCall[1]).toMatch(/SELECT user_id, rating FROM user_game_stats WHERE game_id = \$1/);
    expect(ratingCall[2]).toEqual(['hyderabad-tycoon', [U1, U2, U3]]);

    expect(writeCall[1]).toBe(PERSIST_SQL);
    const params = writeCall[2];
    expect(params).toHaveLength(15);
    expect(params[14]).toBe(1); // no live coin boost
    expect(params[0]).toBe(rec.id);
    expect(params[13]).toBe('hyderabad-tycoon');
    const users = JSON.parse(params[11]);
    expect(users.map((u) => u.user_id).sort()).toEqual([U1, U2, U3]);
    for (const u of users) expect(Number.isInteger(u.delta) && Math.abs(u.delta) <= 24).toBe(true);
    // the winner (rated 1100) against a 1000 newcomer and another 1000 newcomer gains less than +24
    const winner = users.find((u) => u.user_id === U1);
    expect(winner.delta).toBeGreaterThan(0);
    expect(winner.delta).toBeLessThan(24);
    // the level sync follows the stat write
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  it('the SQL is idempotent per match and keeps legacy + per-game stats in step', () => {
    expect(PERSIST_SQL).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(PERSIST_SQL).toMatch(/game_id\)/);
    expect(PERSIST_SQL).toMatch(/INSERT INTO user_game_stats/);
    expect(PERSIST_SQL).toMatch(/ON CONFLICT \(user_id, game_id\) DO UPDATE/);
    expect(PERSIST_SQL).toMatch(/GREATEST\(100, user_game_stats\.rating \+ \(EXCLUDED\.rating - 1000\)\)/);
    expect(PERSIST_SQL).toMatch(/games = u\.games \+ r\.lg/);
    // every write part (match_players, users, user_game_stats) reads from `ins`, so a replayed match changes nothing
    expect(PERSIST_SQL.match(/FROM ins/g)).toHaveLength(4); // mp, up, gs and the final count
  });

  it('a replayed match reports inserted:false and skips the level sync', async () => {
    queryMock.mockImplementation(async (env, text) => (/FROM user_game_stats WHERE/.test(text) ? [] : [{ inserted: 0, users: '[]' }]));
    const res = await persistMatch({}, buildMatchRecord(finishedTycoonRoom(), tycoon));
    expect(res).toEqual({ inserted: false, coinMultiplier: 1 });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('a failed rating lookup does not block the match (new players start at 1000)', async () => {
    queryMock.mockImplementation(async (env, text) => {
      if (/FROM user_game_stats WHERE/.test(text)) throw new Error('boom');
      return [{ inserted: 1, users: [] }];
    });
    await expect(persistMatch({}, buildMatchRecord(finishedTycoonRoom(), tycoon))).resolves.toEqual({ inserted: true, coinMultiplier: 1 });
  });

  it('a failed write is thrown (the room retries with backoff)', async () => {
    queryMock.mockImplementation(async (env, text) => {
      if (/FROM user_game_stats WHERE/.test(text)) return [];
      throw new Error('neon down');
    });
    await expect(persistMatch({}, buildMatchRecord(finishedTycoonRoom(), tycoon))).rejects.toThrow('neon down');
  });
});

// ---- opt-in reward rules: `stats.idle` (a seat that earned nothing) and `adapter.dailyRewardedMatches` ------------------------------

describe('idle seats (standings[i].stats.idle === true, opt-in for any game)', () => {
  const room = { code: 'TIFF22', matchId: '22222222-2222-4222-8222-222222222222', startedAt: Date.parse('2026-11-25T10:00:00Z'), endedAt: Date.parse('2026-11-25T10:09:00Z'), state: {}, players: [{ id: U1, name: 'A' }, { id: U2, name: 'B' }] };
  const coop = (idleIds, extra = {}) => ({
    id: 'tiffin-centre',
    ...extra,
    result: () => ({
      winnerId: U1,
      reason: 'cleared',
      rounds: 100,
      standings: [
        { id: U1, rank: 1, score: 900, stats: idleIds.includes(U1) ? { idle: true } : { served: 4 } },
        { id: U2, rank: 1, score: 0, stats: idleIds.includes(U2) ? { idle: true } : { served: 1 } },
      ],
    }),
  });

  it('pays an idle seat nothing: no XP, no coins, no win, and the seat is flagged for the rating step; a working seat is paid as usual', () => {
    const rec = buildMatchRecord(room, coop([U2]));
    const a = rec.users.find((u) => u.user_id === U1);
    const b = rec.users.find((u) => u.user_id === U2);
    expect(a).toMatchObject({ xp: 100, coins: 200, won: 1 }); // two shared rank-1 seats: 30 + 10 + 60 win / 40 + 20 + 140 win
    expect(b).toMatchObject({ xp: 0, coins: 0, won: 0 });
    expect(rec.seats).toEqual([{ id: U1, rank: 1 }, { id: U2, rank: 1, idle: true }]);
    expect(rec.winnerId).toBe(U1); // the match row still names the top earner
  });

  it('an idle top earner gets no win bonus, an all-idle table pays nobody, and nobody idle pays everybody', () => {
    const top = buildMatchRecord(room, coop([U1]));
    expect(top.users.find((u) => u.user_id === U1)).toMatchObject({ xp: 0, coins: 0, won: 0 });
    expect(top.users.find((u) => u.user_id === U2)).toMatchObject({ xp: 40, coins: 60, won: 0 });
    const all = buildMatchRecord(room, coop([U1, U2]));
    expect(all.users.map((u) => [u.xp, u.coins])).toEqual([[0, 0], [0, 0]]);
    const none = buildMatchRecord(room, coop([]));
    expect(none.users.map((u) => [u.xp, u.coins])).toEqual([[100, 200], [40, 60]]);
  });

  it('other games are unchanged: no idle flag means the old record, key for key (no `idle`, no `dailyRewardedMatches`)', () => {
    const plain = { id: 'counter-race', result: () => ({ winnerId: U1, reason: 'target', rounds: 3, standings: [{ id: U1, rank: 1, score: 5 }, { id: U2, rank: 2, score: 2 }] }) };
    const rec = buildMatchRecord(room, plain);
    expect(rec.seats).toEqual([{ id: U1, rank: 1 }, { id: U2, rank: 2 }]);
    expect(Object.keys(rec)).not.toContain('dailyRewardedMatches');
    expect(rec.users.map((u) => [u.xp, u.coins])).toEqual([[100, 200], [30, 40]]);
    const t = buildMatchRecord(finishedTycoonRoom(), tycoon);
    expect(t.seats.every((s) => Object.keys(s).sort().join() === 'id,rank')).toBe(true);
    expect(Object.keys(t)).not.toContain('dailyRewardedMatches');
    expect(t.users.every((u) => u.xp >= 30)).toBe(true);
  });

  it('persistMatch: an idle seat gets rating delta 0 while the others are rated as before', async () => {
    queryMock.mockReset();
    queryMock.mockImplementation(async (env, text) => (/FROM user_game_stats WHERE/.test(text) ? [] : [{ inserted: 1, users: [] }]));
    const rec = buildMatchRecord(room, {
      id: 'tiffin-centre',
      result: () => ({ winnerId: U1, reason: 'cleared', rounds: 10, standings: [{ id: U1, rank: 1, score: 5, stats: { served: 1 } }, { id: U2, rank: 2, score: 0, stats: { idle: true } }] }),
    });
    await persistMatch({}, rec);
    const write = queryMock.mock.calls.find((c) => c[1] === PERSIST_SQL);
    const users = JSON.parse(write[2][11]);
    expect(users.find((u) => u.user_id === U1).delta).toBeGreaterThan(0);
    expect(users.find((u) => u.user_id === U2)).toMatchObject({ delta: 0, xp: 0, coins: 0 });
  });
});

describe('per-account daily limit of rewarded matches (adapter.dailyRewardedMatches)', () => {
  const room = { code: 'TIFF22', matchId: '33333333-3333-4333-8333-333333333333', startedAt: Date.parse('2026-11-25T10:00:00Z'), endedAt: Date.parse('2026-11-25T10:09:00Z'), state: {}, players: [{ id: U1, name: 'A' }, { id: U2, name: 'B' }] };
  const game = {
    id: 'tiffin-centre',
    dailyRewardedMatches: 3,
    result: () => ({ winnerId: U1, reason: 'cleared', rounds: 10, standings: [{ id: U1, rank: 1, score: 5, stats: { served: 1 } }, { id: U2, rank: 1, score: 5, stats: { served: 1 } }] }),
  };

  beforeEach(() => queryMock.mockReset());

  it('carries the limit in the record only for games that opt in', () => {
    expect(buildMatchRecord(room, game).dailyRewardedMatches).toBe(3);
    expect(Object.keys(buildMatchRecord(room, { ...game, dailyRewardedMatches: undefined }))).not.toContain('dailyRewardedMatches');
  });

  it('a player who already has the limit of matches today since the IST day start gets 0 XP and 0 coins; the other is paid; the stats still count', async () => {
    queryMock.mockImplementation(async (env, text, params) => {
      if (/FROM match_players mp JOIN matches m/.test(text)) {
        expect(params[0]).toBe('tiffin-centre');
        expect(params[1]).toBe('2026-11-25T00:00:00+05:30'); // the match ended 15:39 IST on the 25th
        expect(params[2]).toBe(room.matchId);
        return [{ user_id: U1, n: 3 }, { user_id: U2, n: 2 }];
      }
      if (/FROM user_game_stats WHERE/.test(text)) return [];
      return [{ inserted: 1, users: [] }];
    });
    await persistMatch({}, buildMatchRecord(room, game));
    const write = queryMock.mock.calls.find((c) => c[1] === PERSIST_SQL);
    const users = JSON.parse(write[2][11]);
    expect(users.find((u) => u.user_id === U1)).toMatchObject({ xp: 0, coins: 0, won: 1 });
    expect(users.find((u) => u.user_id === U2).xp).toBeGreaterThan(0);
    expect(users.find((u) => u.user_id === U2).coins).toBeGreaterThan(0);
  });

  it('a failed lookup caps nobody, and a game without the limit never runs the lookup', async () => {
    queryMock.mockImplementation(async (env, text) => {
      if (/FROM match_players mp JOIN matches m/.test(text)) throw new Error('boom');
      if (/FROM user_game_stats WHERE/.test(text)) return [];
      return [{ inserted: 1, users: [] }];
    });
    await persistMatch({}, buildMatchRecord(room, game));
    expect(JSON.parse(queryMock.mock.calls.find((c) => c[1] === PERSIST_SQL)[2][11]).every((u) => u.xp > 0)).toBe(true);
    queryMock.mockClear();
    await persistMatch({}, buildMatchRecord(room, { ...game, dailyRewardedMatches: undefined }));
    expect(queryMock.mock.calls.some((c) => /match_players mp JOIN/.test(c[1]))).toBe(false);
  });
});
