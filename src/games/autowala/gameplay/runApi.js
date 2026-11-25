// Score saving for Autowala: a tiny client for the Worker's solo-run API (worker/routes/solo.js, worker/solo.js).
//
//   POST /api/solo/autowala/start   -> { ok, token, seed, expiresAt }   (signed in; guests count as signed in)
//   POST /api/solo/autowala/finish  { token, earned, seconds, distance, quests, fares, style } -> { ok, duplicate, earned, newBest,
//                                      bestScore, games, wins, xp, coins, level }
//
// Rules the server enforces (so we respect them up front and never put the player through a pointless 422):
//   - every number is a whole number from 0 to 1e9;  seconds is 30..7200 and cannot exceed the time since /start (+5 s)
//   - a token finishes ONCE (a replay answers with the stored outcome, duplicate: true); a token lives 3 hours
// Nothing here ever blocks or breaks gameplay: every call resolves (no throw) with a plain result object, and the progress is
// already saved in the local profile whatever the server says. There is no secret in this file; auth is the hub's cookie / bearer.
import { api as hubApi } from '@/lib/api.js';

export const GAME_ID = 'autowala';
export const MIN_SECONDS = 30; // worker/games/solo.js autowala.minSeconds
export const MAX_SECONDS = 7200; // autowala.maxSeconds
export const MAX_FIELD = 1_000_000_000; // worker/solo.js MAX_FIELD
export const FIELDS = ['earned', 'seconds', 'distance', 'quests', 'fares', 'style'];

/** A whole number in [0, max]; anything that is not a finite number becomes 0. */
export function wholeNumber(v, max = MAX_FIELD) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

/** The /finish body. `stats` may hold floats, negatives or junk: the result is always eligible for the server's parser. */
export function buildFinishPayload(token, stats = {}) {
  const s = stats && typeof stats === 'object' ? stats : {};
  return {
    token: typeof token === 'string' ? token : '',
    earned: wholeNumber(s.earned),
    seconds: wholeNumber(s.seconds, MAX_SECONDS),
    distance: wholeNumber(s.distance),
    quests: wholeNumber(s.quests),
    fares: wholeNumber(s.fares),
    style: wholeNumber(s.style),
  };
}

/** `{ ok:true }` when the run is long enough to be accepted, else `{ ok:false, need, have }` (seconds). */
export function checkRunLength(seconds) {
  const have = wholeNumber(seconds, MAX_SECONDS);
  return have >= MIN_SECONDS ? { ok: true, have } : { ok: false, have, need: MIN_SECONDS - have };
}

/** The server's success body -> what the summary screen shows. Unknown / missing fields become 0 / false. */
export function normalizeOutcome(body) {
  const b = body && typeof body === 'object' ? body : {};
  return {
    duplicate: b.duplicate === true,
    earned: wholeNumber(b.earned),
    newBest: b.newBest === true,
    bestScore: wholeNumber(b.bestScore),
    games: wholeNumber(b.games),
    wins: wholeNumber(b.wins),
    xp: wholeNumber(b.xp),
    coins: wholeNumber(b.coins),
    level: wholeNumber(b.level),
  };
}

/**
 * A thrown ApiError (or anything) -> `{ reason, message }` with a calm, player-facing sentence.
 * reason: 'offline' | 'signin' | 'expired' | 'rejected' | 'busy' | 'unavailable'
 */
export function describeRunError(err) {
  const status = Number(err && err.status);
  const kept = 'Your progress is saved on this device.';
  if (!Number.isFinite(status) || status === 0) return { reason: 'offline', message: `Couldn't reach the server, so this score is saved on this device only. ${kept}` };
  if (status === 401) return { reason: 'signin', message: `Sign in to save scores online. ${kept}` };
  if (status === 403) return { reason: 'expired', message: `This run belongs to a different player, so it was kept on this device only.` };
  if (status === 404) return { reason: 'unavailable', message: `Online scores are not switched on here yet. ${kept}` };
  if (status === 429) return { reason: 'busy', message: `The server is busy right now, so try again in a minute. ${kept}` };
  if (status === 400 || status === 422) return { reason: 'rejected', message: `The server could not verify this run, so it stays on this device only.` };
  return { reason: 'unavailable', message: `The server is not available right now. ${kept}` };
}

/**
 * The run client. `client` is anything with `post(path, body)` (the hub's `api` by default; tests pass a fake).
 *
 *   const runs = createRunClient();
 *   runs.start()            // when the player presses START: never throws, keeps the token in memory
 *   runs.finish(stats)      // when the player clocks out: resolves to one of
 *     { status: 'saved',     outcome }                  the server stored it (outcome: see normalizeOutcome)
 *     { status: 'too-short', need, have }               under 30 s: nothing sent, the token is kept for later
 *     { status: 'local',     reason, message }          not sent / not stored; progress stays in the local profile
 */
export function createRunClient({ client = hubApi, now = () => Date.now() } = {}) {
  let run = null; // { token, seed, expiresAt, startedAt }
  let lastStart = null; // the failure of the last start(), for the summary's message
  let starting = null;

  const path = (verb) => `/api/solo/${GAME_ID}/${verb}`;

  async function start() {
    if (starting) return starting;
    starting = (async () => {
      try {
        const body = await client.post(path('start'), {});
        if (body && body.ok !== false && typeof body.token === 'string' && body.token) {
          run = { token: body.token, seed: wholeNumber(body.seed, 0xffffffff), expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null, startedAt: now() };
          lastStart = null;
          return { ok: true, seed: run.seed, expiresAt: run.expiresAt };
        }
        lastStart = describeRunError({ status: 500 });
      } catch (err) {
        lastStart = describeRunError(err);
      }
      run = null;
      return { ok: false, ...lastStart };
    })().finally(() => {
      starting = null;
    });
    return starting;
  }

  async function finish(stats) {
    const length = checkRunLength(stats && stats.seconds);
    if (!length.ok) return { status: 'too-short', need: length.need, have: length.have };
    if (starting) await starting;
    if (!run) return { status: 'local', ...(lastStart || describeRunError({ status: 0 })) };
    const payload = buildFinishPayload(run.token, stats);
    try {
      const body = await client.post(path('finish'), payload);
      if (!body || body.ok === false) return { status: 'local', ...describeRunError({ status: 500 }) };
      run = null; // a token finishes once; the next sitting starts a fresh one
      return { status: 'saved', outcome: normalizeOutcome(body) };
    } catch (err) {
      const info = describeRunError(err);
      // 401 / 403: the token is dead (expired or someone else's). The rest may be retried with the same token.
      if (info.reason === 'signin' || info.reason === 'expired') run = null;
      return { status: 'local', ...info };
    }
  }

  return {
    start,
    finish,
    /** Not signed in: do not even ask the server (it would answer 401); finish() then explains why nothing was sent. */
    skipStart() {
      run = null;
      lastStart = describeRunError({ status: 401 });
      return { ok: false, ...lastStart };
    },
    reset: () => {
      run = null;
      lastStart = null;
    },
    get hasToken() {
      return !!run;
    },
    get seed() {
      return run ? run.seed : null;
    },
    get startError() {
      return lastStart;
    },
  };
}
