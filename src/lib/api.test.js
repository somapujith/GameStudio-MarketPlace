// api.js with a stubbed fetch: same-origin requests are exactly what they always were; in cross-origin mode
// (VITE_API_ORIGIN) they go to the Worker's origin with a bearer token and without cookies.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const WORKER = 'https://gamestudio-marketplace.somapujith.workers.dev';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock;

async function load(origin) {
  vi.stubEnv('VITE_API_ORIGIN', origin);
  vi.resetModules();
  const [api, token] = await Promise.all([import('./api.js'), import('./token.js')]);
  return { ...api, ...token };
}

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonRes({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('same-origin mode (default)', () => {
  it('calls the relative path with same-origin credentials and never an Authorization header', async () => {
    const { api, setToken } = await load('');
    setToken('stale.token.value'); // ignored in this mode
    await api.get('/api/me');
    await api.post('/api/rooms', { maxPlayers: 4 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/me');
    expect(init.credentials).toBe('same-origin');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Accept: 'application/json' });
    const [url2, init2] = fetchMock.mock.calls[1];
    expect(url2).toBe('/api/rooms');
    expect(init2.credentials).toBe('same-origin');
    expect(init2.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' });
    expect(init2.body).toBe(JSON.stringify({ maxPlayers: 4 }));
  });

  it('does not store a token even if a response carries one', async () => {
    const { api, getToken } = await load('');
    fetchMock.mockResolvedValueOnce(jsonRes({ user: { id: 'u1' }, token: 'a.b.c' }));
    await api.post('/api/auth/guest', {});
    expect(getToken()).toBeNull();
  });

  it('a 401 behaves as before (ApiError 401)', async () => {
    const { api } = await load('');
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'Please sign in first.' }, 401));
    await expect(api.get('/api/rooms/mine')).rejects.toMatchObject({ name: 'ApiError', status: 401, message: 'Please sign in first.' });
  });
});

describe('cross-origin mode (VITE_API_ORIGIN set)', () => {
  it('uses absolute URLs on the API origin and omits credentials', async () => {
    const { api } = await load(WORKER);
    await api.get('/api/me');
    await api.get('/api/leaderboard?game=overall');
    expect(fetchMock.mock.calls[0][0]).toBe(`${WORKER}/api/me`);
    expect(fetchMock.mock.calls[0][1].credentials).toBe('omit');
    expect(fetchMock.mock.calls[1][0]).toBe(`${WORKER}/api/leaderboard?game=overall`);
  });

  it('sends no Authorization header until there is a token', async () => {
    const { api } = await load(WORKER);
    await api.get('/api/config');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('keeps the token from a sign-in response and sends it as a bearer on every later call', async () => {
    const { api, getToken } = await load(WORKER);
    fetchMock.mockResolvedValueOnce(jsonRes({ user: { id: 'u1' }, token: 'aaa.bbb.ccc' }));
    await api.post('/api/auth/guest', { name: 'Asha' });
    expect(getToken()).toBe('aaa.bbb.ccc');
    await api.get('/api/me');
    await api.post('/api/ws-ticket');
    await api.patch('/api/me', { name: 'B' });
    await api.del('/api/friends/x');
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect(call[1].headers.Authorization).toBe('Bearer aaa.bbb.ccc');
      expect(call[1].credentials).toBe('omit');
    }
    // the sign-in call itself carried no token (there was none yet) and was a plain JSON POST
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe(`${WORKER}/api/auth/guest`);
  });

  it('also keeps the token from the Google sign-in response, but not from other endpoints', async () => {
    const { api, getToken } = await load(WORKER);
    fetchMock.mockResolvedValueOnce(jsonRes({ user: { id: 'u1' }, token: 'from.me.endpoint' }));
    await api.get('/api/me');
    expect(getToken()).toBeNull();
    fetchMock.mockResolvedValueOnce(jsonRes({ user: { id: 'u1' }, token: 'g.o.o' }));
    await api.post('/api/auth/google', { credential: 'x' });
    expect(getToken()).toBe('g.o.o');
  });

  it('a 401 for a request that carried the token clears it (stale token)', async () => {
    const { api, getToken, setToken } = await load(WORKER);
    setToken('old.old.old');
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'Your session has expired. Please sign in again.' }, 401));
    await expect(api.get('/api/rooms/mine')).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
  });

  it('a 401 from a sign-in endpoint (e.g. a bad Google credential) does not drop an existing session', async () => {
    const { api, getToken, setToken } = await load(WORKER);
    setToken('keep.me.please');
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'Google sign-in could not be verified.' }, 401));
    await expect(api.post('/api/auth/google', { credential: 'x' })).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe('keep.me.please');
  });

  it('a late 401 for an old token does not clear a newer sign-in', async () => {
    const { api, getToken, setToken } = await load(WORKER);
    setToken('first.tok.en');
    fetchMock.mockImplementationOnce(async () => {
      setToken('second.tok.en'); // the user signed in again while the request was in flight
      return jsonRes({ error: 'expired' }, 401);
    });
    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe('second.tok.en');
  });

  it('keeps ApiError semantics: offline (fetch rejects) and non-JSON 2xx are status 0', async () => {
    const { api } = await load(WORKER);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 0, message: 'Offline' });
    fetchMock.mockResolvedValueOnce(new Response('<html></html>', { status: 200 }));
    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 0 });
  });

  it('named helpers go through the same routing (room, push key)', async () => {
    const { getRoom, getPushKey, setToken } = await load(WORKER);
    setToken('t.o.k');
    await getRoom('ABC234');
    await getPushKey();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${WORKER}/api/rooms/ABC234`, `${WORKER}/api/push/key`]);
    expect(fetchMock.mock.calls.every((c) => c[1].headers.Authorization === 'Bearer t.o.k')).toBe(true);
  });
});
