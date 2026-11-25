import { describe, it, expect } from 'vitest';
import {
  buildFinishPayload, checkRunLength, normalizeOutcome, describeRunError, createRunClient, wholeNumber,
  MAX_FIELD, MAX_SECONDS, MIN_SECONDS, FIELDS,
} from './runApi.js';

const err = (status, message = 'x') => Object.assign(new Error(message), { status });
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
    const runs = createRunClient({ client: c });
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
    const runs = createRunClient({ client: c });
    await runs.start();
    const r = await runs.finish({ ...GOOD, seconds: 12 });
    expect(r).toEqual({ status: 'too-short', need: MIN_SECONDS - 12, have: 12 });
    expect(c.calls.length).toBe(1);
    expect(runs.hasToken).toBe(true);
  });

  it('start failures never throw and explain themselves at finish time', async () => {
    const c = fake({ [START]: err(401), [FINISH]: { ok: true } });
    const runs = createRunClient({ client: c });
    expect(await runs.start()).toMatchObject({ ok: false, reason: 'signin' });
    const r = await runs.finish(GOOD);
    expect(r).toMatchObject({ status: 'local', reason: 'signin' });
    expect(c.calls.length).toBe(1); // nothing was sent without a token
  });

  it('network failure on finish is local-only and the token survives for a retry', async () => {
    let n = 0;
    const c = fake({ [START]: OK_START, [FINISH]: () => (++n === 1 ? err(0, 'Offline') : { ok: true, earned: 480, bestScore: 480, xp: 5 }) });
    const runs = createRunClient({ client: c });
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
      const runs = createRunClient({ client: c });
      await runs.start();
      const r = await runs.finish(GOOD);
      expect(r.status).toBe('local');
      expect(runs.hasToken).toBe(keeps);
    }
  });

  it('a non-ok 200 body is treated as unsaved, a replay is reported as such', async () => {
    const c1 = fake({ [START]: OK_START, [FINISH]: { ok: false } });
    const r1 = createRunClient({ client: c1 });
    await r1.start();
    expect((await r1.finish(GOOD)).status).toBe('local');
    const c2 = fake({ [START]: OK_START, [FINISH]: { ok: true, duplicate: true, xp: 0, bestScore: 10 } });
    const r2 = createRunClient({ client: c2 });
    await r2.start();
    const out = await r2.finish(GOOD);
    expect(out.status).toBe('saved');
    expect(out.outcome.duplicate).toBe(true);
  });

  it('a start() without a token in the reply is a failure, and concurrent starts share one request', async () => {
    const c = fake({ [START]: { ok: true } });
    const runs = createRunClient({ client: c });
    const [a, b] = await Promise.all([runs.start(), runs.start()]);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(c.calls.length).toBe(1);
    expect(runs.hasToken).toBe(false);
  });

  it('skipStart makes no request and finish explains the sign-in reason', async () => {
    const c = fake({ [START]: OK_START, [FINISH]: { ok: true } });
    const runs = createRunClient({ client: c });
    expect(runs.skipStart()).toMatchObject({ ok: false, reason: 'signin' });
    expect(await runs.finish(GOOD)).toMatchObject({ status: 'local', reason: 'signin' });
    expect(c.calls.length).toBe(0);
  });

  it('finish waits for a start that is still in flight', async () => {
    const c = fake({ [START]: OK_START, [FINISH]: { ok: true, earned: 480 } });
    const runs = createRunClient({ client: c });
    const s = runs.start();
    const f = runs.finish(GOOD);
    await s;
    expect((await f).status).toBe('saved');
  });
});
