import { describe, it, expect } from 'vitest';
import {
  buildFinishPayload, checkRunLength, normalizeOutcome, describeRunError, createRunClient, wholeNumber,
  MAX_FIELD, MAX_SECONDS, MIN_SECONDS, FIELDS, START_RETRY_MS, RUN_EXPIRED,
} from './runApi.js';

const err = (status, message = 'x', code) => Object.assign(new Error(message), { status, code });
/** A clock in which every look is two minutes after the last one: the token is always old enough for the seconds the test reports. */
const slow = () => {
  let t = 1_000_000;
  return () => (t += 120_000);
};
/** A clock the test moves by hand (seconds). */
const hand = () => {
  const c = { t: 1_000_000, now: () => c.t, tick: (s) => { c.t += s * 1000; } };
  return c;
};
/** A scheduler that records what was scheduled and runs it when told to. */
const timers = () => {
  const q = [];
  return { q, schedule: (fn, ms) => { const t = { fn, ms }; q.push(t); return t; }, cancel: (t) => { const i = q.indexOf(t); if (i >= 0) q.splice(i, 1); }, run: () => { const t = q.shift(); t.fn(); } };
};
/** A fake hub client: `script` maps a path to a value (resolved) or an Error (thrown). Calls are recorded. */
function fake(script) {
  const calls = [];
  return {
    calls,
    post: async (path, body) => {
      calls.push({ path, body });
      const r = typeof script[path] === 'function' ? script[path](body, calls.length) : script[path];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}
const START = '/api/solo/autowala/start';
const FINISH = '/api/solo/autowala/finish';
const OK_START = { ok: true, token: 'tok.en', seed: 12345, expiresAt: '2030-01-01T00:00:00.000Z' };
const GOOD = { earned: 480, seconds: 95, distance: 1800, fares: 3 };

describe('wholeNumber', () => {
  it('rounds, clamps and survives junk', () => {
    expect(wholeNumber(12.6)).toBe(13);
    expect(wholeNumber(-4)).toBe(0);
    expect(wholeNumber(NaN)).toBe(0);
    expect(wholeNumber('abc')).toBe(0);
    expect(wholeNumber(undefined)).toBe(0);
    expect(wholeNumber(Infinity)).toBe(0);
    expect(wholeNumber(5e12)).toBe(MAX_FIELD);
    expect(wholeNumber('42')).toBe(42);
  });
});

describe('buildFinishPayload', () => {
  it('sends every field as a non-negative safe integer', () => {
    const p = buildFinishPayload('abc', { earned: 123.4, seconds: 61.5, distance: 999.9, fares: 2.2, quests: -3, style: NaN });
    expect(p.token).toBe('abc');
    for (const k of FIELDS) {
      expect(Number.isSafeInteger(p[k])).toBe(true);
      expect(p[k]).toBeGreaterThanOrEqual(0);
      expect(p[k]).toBeLessThanOrEqual(MAX_FIELD);
    }
    expect(p).toEqual({ token: 'abc', earned: 123, seconds: 62, distance: 1000, quests: 0, fares: 2, style: 0 });
  });
  it('always reports quests and style as 0 unless given, and caps seconds at the server maximum', () => {
    const p = buildFinishPayload('t', { ...GOOD, seconds: 99999 });
    expect(p.quests).toBe(0);
    expect(p.style).toBe(0);
    expect(p.seconds).toBe(MAX_SECONDS);
    expect(buildFinishPayload('t', { earned: 9e15 }).earned).toBe(MAX_FIELD);
  });
  it('tolerates a missing token and missing stats', () => {
    expect(buildFinishPayload(undefined, undefined)).toEqual({ token: '', earned: 0, seconds: 0, distance: 0, quests: 0, fares: 0, style: 0 });
    expect(buildFinishPayload('t', null).earned).toBe(0);
  });
});

describe('checkRunLength', () => {
  it('requires the server minimum', () => {
    expect(checkRunLength(MIN_SECONDS - 1)).toEqual({ ok: false, have: MIN_SECONDS - 1, need: 1 });
    expect(checkRunLength(0).need).toBe(MIN_SECONDS);
    expect(checkRunLength(MIN_SECONDS).ok).toBe(true);
    expect(checkRunLength(undefined).ok).toBe(false);
  });
});

describe('normalizeOutcome', () => {
  it('maps the server body and defaults the rest', () => {
    expect(normalizeOutcome({ ok: true, duplicate: false, earned: 480, newBest: true, bestScore: 480, games: 3, wins: 0, xp: 40, coins: 12, level: 2 })).toEqual({
      duplicate: false, earned: 480, newBest: true, bestScore: 480, games: 3, wins: 0, xp: 40, coins: 12, level: 2,
    });
    expect(normalizeOutcome(null).xp).toBe(0);
    expect(normalizeOutcome({ newBest: 'yes' }).newBest).toBe(false);
  });
});

describe('describeRunError', () => {
  it('maps every status to a calm, specific reason', () => {
    expect(describeRunError(err(0)).reason).toBe('offline');
    expect(describeRunError(new Error('boom')).reason).toBe('offline');
    expect(describeRunError(err(401)).reason).toBe('signin');
    expect(describeRunError(err(401, 'x', RUN_EXPIRED))).toMatchObject({ reason: 'expired', retry: false }); // a dead token is not "sign in"
    expect(describeRunError(err(401, 'x', RUN_EXPIRED)).message).not.toMatch(/sign in/i);
    expect(describeRunError(err(403)).reason).toBe('expired');
    expect(describeRunError(err(404)).reason).toBe('unavailable');
    expect(describeRunError(err(422)).reason).toBe('rejected');
    expect(describeRunError(err(400)).reason).toBe('rejected');
    expect(describeRunError(err(429)).reason).toBe('busy');
    expect(describeRunError(err(503)).reason).toBe('unavailable');
    for (const s of [0, 401, 403, 404, 422, 429, 500]) expect(describeRunError(err(s)).message).toMatch(/\S/);
  });
});

describe('createRunClient', () => {
  it('start keeps the token and finish posts the validated payload', async () => {
    const c = fake({ [START]: OK_START, [FINISH]: { ok: true, duplicate: false, earned: 480, newBest: true, bestScore: 480, games: 1, wins: 0, xp: 25, coins: 8, level: 1 } });
    const runs = createRunClient({ client: c, now: slow() });
    expect(await runs.start()).toMatchObject({ ok: true, seed: 12345 });
    expect(runs.hasToken).toBe(true);
    const r = await runs.finish(GOOD);
    expect(r.status).toBe('saved');
    expect(r.outcome).toMatchObject({ xp: 25, coins: 8, newBest: true, bestScore: 480 });
    expect(c.calls[1]).toEqual({ path: FINISH, body: { token: 'tok.en', earned: 480, seconds: 95, distance: 1800, quests: 0, fares: 3, style: 0 } });
    expect(runs.hasToken).toBe(false); // a token finishes once
  });

  it('does not call the server for a run under the minimum, and keeps the token', async () => {
    const c = fake({ [START]: OK_START, [FINISH]: { ok: true } });
    const runs = createRunClient({ client: c, now: slow() });
    await runs.start();
    const r = await runs.finish({ ...GOOD, seconds: 12 });
    expect(r).toEqual({ status: 'too-short', need: MIN_SECONDS - 12, have: 12 });
    expect(c.calls.length).toBe(1);
    expect(runs.hasToken).toBe(true);
  });

  it('start failures never throw and explain themselves at finish time', async () => {
    const c = fake({ [START]: err(401), [FINISH]: { ok: true } });
    const runs = createRunClient({ client: c, now: slow() });
    expect(await runs.start()).toMatchObject({ ok: false, reason: 'signin' });
    const r = await runs.finish(GOOD);
    expect(r).toMatchObject({ status: 'local', reason: 'signin' });
    expect(c.calls.length).toBe(1); // nothing was sent without a token
  });

  it('network failure on finish is local-only and the token survives for a retry', async () => {
    let n = 0;
    const c = fake({ [START]: OK_START, [FINISH]: () => (++n === 1 ? err(0, 'Offline') : { ok: true, earned: 480, bestScore: 480, xp: 5 }) });
    const runs = createRunClient({ client: c, now: slow() });
    await runs.start();
    const first = await runs.finish(GOOD);
    expect(first).toMatchObject({ status: 'local', reason: 'offline' });
    expect(runs.hasToken).toBe(true);
    const second = await runs.finish(GOOD);
    expect(second.status).toBe('saved');
    expect(second.outcome.xp).toBe(5);
  });

  it('422 keeps the token (the run may grow) while 401 / 403 drop it', async () => {
    for (const [status, keeps] of [[422, true], [401, false], [403, false], [404, true]]) {
      const c = fake({ [START]: OK_START, [FINISH]: err(status) });
      const runs = createRunClient({ client: c, now: slow() });
      await runs.start();
      const r = await runs.finish(GOOD);
      expect(r.status).toBe('local');
      expect(runs.hasToken).toBe(keeps);
    }
  });

  it('a non-ok 200 body is treated as unsaved, a replay is reported as such', async () => {
    const c1 = fake({ [START]: OK_START, [FINISH]: { ok: false } });
    const r1 = createRunClient({ client: c1, now: slow() });
    await r1.start();
    expect((await r1.finish(GOOD)).status).toBe('local');
    const c2 = fake({ [START]: OK_START, [FINISH]: { ok: true, duplicate: true, xp: 0, bestScore: 10 } });
    const r2 = createRunClient({ client: c2, now: slow() });
    await r2.start();
    const out = await r2.finish(GOOD);
    expect(out.status).toBe('saved');
    expect(out.outcome.duplicate).toBe(true);
  });

  it('a start() without a token in the reply is a failure, and concurrent starts share one request', async () => {
    const c = fake({ [START]: { ok: true } });
    const runs = createRunClient({ client: c, now: slow() });
    const [a, b] = await Promise.all([runs.start(), runs.start()]);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(c.calls.length).toBe(1);
    expect(runs.hasToken).toBe(false);
  });

  it('skipStart makes no request and finish explains the sign-in reason', async () => {
    const c = fake({ [START]: OK_START, [FINISH]: { ok: true } });
    const runs = createRunClient({ client: c, now: slow() });
    expect(runs.skipStart()).toMatchObject({ ok: false, reason: 'signin' });
    expect(await runs.finish(GOOD)).toMatchObject({ status: 'local', reason: 'signin' });
    expect(c.calls.length).toBe(0);
  });

  it('finish waits for a start that is still in flight', async () => {
    const c = fake({ [START]: OK_START, [FINISH]: { ok: true, earned: 480 } });
    const runs = createRunClient({ client: c, now: slow() });
    const s = runs.start();
    const f = runs.finish(GOOD);
    await s;
    expect((await f).status).toBe('saved');
  });
});

describe('a /start that failed is tried again while the player drives', () => {
  it('retries offline / busy / 5xx in the background, then saves with the seconds the token has lived', async () => {
    const t = timers();
    const clk = hand();
    let n = 0;
    const c = fake({ [START]: () => (++n < 3 ? err(0, 'Offline') : OK_START), [FINISH]: { ok: true, earned: 480 } });
    const runs = createRunClient({ client: c, now: clk.now, schedule: t.schedule, cancel: t.cancel });
    expect(await runs.start()).toMatchObject({ ok: false, reason: 'offline' });
    expect(t.q.map((x) => x.ms)).toEqual([START_RETRY_MS[0]]);
    clk.tick(5);
    t.run(); // the first retry fires, still offline
    await new Promise((r) => setTimeout(r, 0));
    expect(runs.hasToken).toBe(false);
    expect(t.q).toHaveLength(1);
    expect(t.q[0].ms).toBe(START_RETRY_MS[1]);
    clk.tick(15);
    t.run(); // the second retry works
    await new Promise((r) => setTimeout(r, 0));
    expect(runs.hasToken).toBe(true);
    expect(t.q).toHaveLength(0);
    // the sitting has been going for 200 s, but the token only 50 s: that is all the server would accept
    clk.tick(50);
    const r = await runs.finish({ ...GOOD, seconds: 200 });
    expect(r.status).toBe('saved');
    expect(c.calls.at(-1).body.seconds).toBe(50);
  });

  it('gives up after the last delay and keeps explaining why nothing was sent', async () => {
    const t = timers();
    const c = fake({ [START]: err(503) });
    const runs = createRunClient({ client: c, now: slow(), schedule: t.schedule, cancel: t.cancel });
    await runs.start();
    for (let i = 0; i < START_RETRY_MS.length; i++) {
      expect(t.q).toHaveLength(1);
      t.run();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(t.q).toHaveLength(0);
    expect(c.calls.length).toBe(1 + START_RETRY_MS.length);
    expect(await runs.finish(GOOD)).toMatchObject({ status: 'local', reason: 'unavailable' });
  });

  it('does not retry what cannot work: not signed in, not switched on, rejected', async () => {
    for (const status of [401, 403, 404, 422]) {
      const t = timers();
      const runs = createRunClient({ client: fake({ [START]: err(status) }), now: slow(), schedule: t.schedule, cancel: t.cancel });
      await runs.start();
      expect(t.q, String(status)).toHaveLength(0);
    }
  });

  it('a new start() (the next sitting) resets the retry budget', async () => {
    const t = timers();
    const runs = createRunClient({ client: fake({ [START]: err(0) }), now: slow(), schedule: t.schedule, cancel: t.cancel });
    await runs.start();
    await runs.start();
    expect(t.q).toHaveLength(1);
    expect(t.q[0].ms).toBe(START_RETRY_MS[0]);
  });
});

describe('the token while a save is in flight', () => {
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
  };

  it('is detached at once, so KEEP DRIVING gets a fresh run for the next shift', async () => {
    const d = deferred();
    const c = { calls: [], post: async (path, body) => { c.calls.push({ path, body }); return path === START ? { ...OK_START, token: `tok${c.calls.length}` } : d.promise; } };
    const runs = createRunClient({ client: c, now: slow() });
    await runs.start();
    expect(runs.hasToken).toBe(true);
    const saving = runs.finish(GOOD);
    await new Promise((r) => setTimeout(r, 0));
    expect(runs.hasToken).toBe(false); // the old code still said true here, so the next shift was never started
    await runs.start(); // the player kept driving: a new sitting
    d.resolve({ ok: true, earned: 480 });
    expect((await saving).status).toBe('saved');
    expect(runs.hasToken).toBe(true); // the reply of the old save must not take the new token away
  });

  it('comes back when the save failed for a reason that may pass (Try again works)', async () => {
    let n = 0;
    const c = fake({ [START]: OK_START, [FINISH]: () => (++n === 1 ? err(0) : { ok: true, earned: 480 }) });
    const runs = createRunClient({ client: c, now: slow() });
    await runs.start();
    expect((await runs.finish(GOOD)).reason).toBe('offline');
    expect(runs.hasToken).toBe(true);
    expect((await runs.finish(GOOD)).status).toBe('saved');
    expect(runs.hasToken).toBe(false);
  });

  it('does not push the old token back over a new sitting\'s token', async () => {
    const d = deferred();
    const c = { calls: [], post: async (path, body) => { c.calls.push({ path, body }); return path === START ? { ...OK_START, token: `tok${c.calls.length}` } : d.promise; } };
    const runs = createRunClient({ client: c, now: slow() });
    await runs.start();
    const saving = runs.finish(GOOD);
    await new Promise((r) => setTimeout(r, 0));
    await runs.start();
    d.reject(err(0));
    expect((await saving).reason).toBe('offline');
    expect(runs.hasToken).toBe(true);
    let sent = null;
    c.post = async (path, body) => { sent = body; return { ok: true, earned: 1 }; };
    await runs.finish(GOOD);
    expect(sent.token).toBe('tok3');
  });

  it('a dead token (expired, someone else\'s) is never restored', async () => {
    for (const e of [err(401, 'x', RUN_EXPIRED), err(403)]) {
      const runs = createRunClient({ client: fake({ [START]: OK_START, [FINISH]: e }), now: slow() });
      await runs.start();
      expect((await runs.finish(GOOD)).reason).toBe('expired');
      expect(runs.hasToken).toBe(false);
    }
  });

  it('never reports more seconds than the token has lived, and calls a run that is too short for that too short', async () => {
    const clk = hand();
    const c = fake({ [START]: OK_START, [FINISH]: { ok: true } });
    const runs = createRunClient({ client: c, now: clk.now });
    await runs.start();
    clk.tick(10);
    expect(await runs.finish({ ...GOOD, seconds: 500 })).toMatchObject({ status: 'too-short', have: 10 });
    expect(c.calls.length).toBe(1);
    expect(runs.hasToken).toBe(true);
    clk.tick(80);
    await runs.finish({ ...GOOD, seconds: 500 });
    expect(c.calls.at(-1).body.seconds).toBe(90);
  });
});
