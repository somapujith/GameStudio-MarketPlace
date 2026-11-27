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
export const RUN_EXPIRED = 'run-expired'; // the `code` worker/routes/solo.js puts on a dead / unknown run token (401)
export const FIELDS = ['earned', 'seconds', 'distance', 'quests', 'fares', 'style'];
/** When a failed /start is tried again in the background (ms). The token must exist early: the server only accepts a run that is not longer than the time since /start. */
export const START_RETRY_MS = [4000, 15000, 45000, 120000];

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
 * reason: 'offline' | 'signin' | 'expired' | 'rejected' | 'busy' | 'unavailable'.  `retry` is true when asking again later can work.
 * A 401 with `code: 'run-expired'` is the run token (it lives 3 hours), not the player's session: nothing to sign in to.
 */
export function describeRunError(err) {
  const status = Number(err && err.status);
  const kept = 'Your progress is saved on this device.';
  if (!Number.isFinite(status) || status === 0) return { reason: 'offline', retry: true, message: `Couldn't reach the server, so this score is saved on this device only. ${kept}` };
  if (status === 401 && err.code === RUN_EXPIRED) return { reason: 'expired', retry: false, message: `This shift ran too long to be counted online (a run lasts 3 hours). ${kept}` };
  if (status === 401) return { reason: 'signin', retry: false, message: `Sign in to save scores online. ${kept}` };
  if (status === 403) return { reason: 'expired', retry: false, message: `This run belongs to a different player, so it was kept on this device only.` };
  if (status === 404) return { reason: 'unavailable', retry: false, message: `Online scores are not switched on here yet. ${kept}` };
  if (status === 429) return { reason: 'busy', retry: true, message: `The server is busy right now, so try again in a minute. ${kept}` };
  if (status === 400 || status === 422) return { reason: 'rejected', retry: false, message: `The server could not verify this run, so it stays on this device only.` };
  return { reason: 'unavailable', retry: status >= 500, message: `The server is not available right now. ${kept}` };
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
export function createRunClient({ client = hubApi, now = () => Date.now(), retryDelays = START_RETRY_MS, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let run = null; // { token, seed, expiresAt, startedAt }
  let lastStart = null; // the failure of the last start(), for the summary's message
  let starting = null;
  let retryTimer = null;
  let retries = 0;

  const path = (verb) => `/api/solo/${GAME_ID}/${verb}`;
  const stopRetry = () => {
    if (retryTimer) cancel(retryTimer);
    retryTimer = null;
  };
  /** A start that failed for a reason that may pass (offline, busy, 5xx) is tried again a few times while the player drives on. */
  function scheduleRetry() {
    if (retryTimer || retries >= retryDelays.length) return;
    retryTimer = schedule(() => {
      retryTimer = null;
      if (!run && !starting) attempt();
    }, retryDelays[retries++]);
    if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
  }

  function attempt() {
    if (starting) return starting;
    starting = (async () => {
      try {
        const body = await client.post(path('start'), {});
        if (body && body.ok !== false && typeof body.token === 'string' && body.token) {
          run = { token: body.token, seed: wholeNumber(body.seed, 0xffffffff), expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null, startedAt: now() };
          lastStart = null;
          stopRetry();
          return { ok: true, seed: run.seed, expiresAt: run.expiresAt };
        }
        lastStart = describeRunError({ status: 500 });
      } catch (err) {
        lastStart = describeRunError(err);
      }
      run = null;
      if (lastStart.retry) scheduleRetry();
      return { ok: false, ...lastStart };
    })().finally(() => {
      starting = null;
    });
    return starting;
  }

  /** Ask for a run token now (a new sitting). */
  function start() {
    stopRetry();
    retries = 0;
    return attempt();
  }

  /** Seconds the token has lived, as the server will see it at the earliest (the response arrived after the token was made). */
  const age = (r) => Math.max(0, Math.floor((now() - r.startedAt) / 1000));

  async function finish(stats) {
    const asked = checkRunLength(stats && stats.seconds);
    if (!asked.ok) return { status: 'too-short', need: asked.need, have: asked.have };
    if (starting) await starting;
    if (!run) return { status: 'local', ...(lastStart || describeRunError({ status: 0 })) };
    // The sitting counts from the START button, the token from the moment the server made it (later, when /start was slow or had to be
    // retried): a run may not claim more seconds than the token has lived, so report no more than that.
    const used = run;
    const seconds = Math.min(wholeNumber(stats.seconds, MAX_SECONDS), age(used));
    const length = checkRunLength(seconds);
    if (!length.ok) return { status: 'too-short', need: length.need, have: length.have };
    // Detach the token while the request is in flight: a player who keeps driving meanwhile must get a NEW run for the next shift
    // (the old code kept `hasToken` true, so the next shift was never started and was lost when the reply nulled the token).
    run = null;
    const payload = buildFinishPayload(used.token, { ...stats, seconds });
    const restore = () => {
      if (!run && !starting) run = used; // unless a new sitting already asked for its own token
    };
    try {
      const body = await client.post(path('finish'), payload);
      if (!body || body.ok === false) {
        restore();
        return { status: 'local', ...describeRunError({ status: 500 }) };
      }
      return { status: 'saved', outcome: normalizeOutcome(body) };
    } catch (err) {
      const info = describeRunError(err);
      // 401 / 403: the token is dead (expired or someone else's). The rest may be retried with the same token.
      if (info.reason !== 'signin' && info.reason !== 'expired') restore();
      return { status: 'local', ...info };
    }
  }

  return {
    start,
    finish,
    /** Not signed in: do not even ask the server (it would answer 401); finish() then explains why nothing was sent. */
    skipStart() {
      stopRetry();
      run = null;
      lastStart = describeRunError({ status: 401 });
      return { ok: false, ...lastStart };
    },
    reset: () => {
      stopRetry();
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
