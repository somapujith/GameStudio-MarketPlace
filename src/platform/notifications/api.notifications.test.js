// api.js additions for docs/ADMIN.md: errors carry the body's `code` (and the body), a suspended account is announced
// to `onSuspended` listeners, and the notification / announcement wrappers send the contract's requests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock;
async function load() {
  vi.stubEnv('VITE_API_ORIGIN', '');
  vi.resetModules();
  return import('@/lib/api.js');
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

describe('ApiError code and body', () => {
  it('a banned 403 carries status, message, code and the body; listeners hear about it', async () => {
    const { api, onSuspended, isSuspendedError } = await load();
    const heard = vi.fn();
    const off = onSuspended(heard);
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'Your account has been suspended.', code: 'banned', reason: 'Cheating' }, 403));
    const err = await api.get('/api/me').catch((e) => e);
    expect(err).toMatchObject({ name: 'ApiError', status: 403, message: 'Your account has been suspended.', code: 'banned', data: { reason: 'Cheating' } });
    expect(isSuspendedError(err)).toBe(true);
    expect(heard).toHaveBeenCalledWith({ reason: 'Cheating', message: 'Your account has been suspended.', path: '/api/me' });
    off();
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'Your account has been suspended.', code: 'banned', reason: 'x' }, 403));
    await api.post('/api/shop/buy', {}).catch(() => {});
    expect(heard).toHaveBeenCalledTimes(1);
  });
  it('other errors are unchanged: no code, no listener call', async () => {
    const { api, onSuspended, isSuspendedError, ApiError } = await load();
    const heard = vi.fn();
    onSuspended(heard);
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'Not allowed' }, 403));
    const err = await api.get('/api/admin/me').catch((e) => e);
    expect(err).toMatchObject({ status: 403, message: 'Not allowed', code: null, data: { error: 'Not allowed' } });
    expect(isSuspendedError(err)).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 404 }));
    expect(await api.get('/api/x').catch((e) => e)).toMatchObject({ status: 404, message: 'Not found', code: null, data: null });
    expect(heard).not.toHaveBeenCalled();
    // the old two-argument constructor still works
    expect(new ApiError(0, 'Offline')).toMatchObject({ status: 0, message: 'Offline', code: null, data: null });
  });
  it('a throwing listener does not change the error the caller gets', async () => {
    const { api, onSuspended } = await load();
    onSuspended(() => {
      throw new Error('boom');
    });
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'Your account has been suspended.', code: 'banned' }, 403));
    await expect(api.get('/api/me')).rejects.toMatchObject({ code: 'banned' });
  });
});

describe('notification and announcement wrappers', () => {
  it('send the contract requests', async () => {
    const { getNotifications, markNotificationsRead, getAnnouncements } = await load();
    await getNotifications();
    await markNotificationsRead(['a', 'b', 'a', '', 3]);
    await markNotificationsRead('all');
    await markNotificationsRead({ all: true });
    await getAnnouncements();
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.body]);
    expect(calls).toEqual([
      ['/api/notifications', 'GET', undefined],
      ['/api/notifications/read', 'POST', JSON.stringify({ ids: ['a', 'b'] })],
      ['/api/notifications/read', 'POST', JSON.stringify({ all: true })],
      ['/api/notifications/read', 'POST', JSON.stringify({ all: true })],
      ['/api/announcements', 'GET', undefined],
    ]);
  });
});
