import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';

vi.mock('@/lib/auth.jsx', () => ({
  useAuth: () => ({ user: { id: 'me', isGuest: false, friendCode: 'HYD-AAAA', handle: 'me_x' }, subscribe: () => () => {} }),
  useUserEvents: () => {},
}));

import AddByCode from './AddByCode.jsx';
import AddFriendPanel from './AddFriendPanel.jsx';
import { checkHandle, requestFriendByHandle, requestFriendByCode } from '@/lib/api.js';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('api wrappers', () => {
  it('requestFriendByHandle posts { handle } without the leading @', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ ok: true, status: 'pending' }));
    vi.stubGlobal('fetch', fetchMock);
    await requestFriendByHandle('@Chai_Uncle');
    await requestFriendByHandle('plain_one');
    await requestFriendByCode('HYD-7K2Q');
    const body = (i) => JSON.parse(fetchMock.mock.calls[i][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/friends/request');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(body(0)).toEqual({ handle: 'Chai_Uncle' }); // the server lowercases
    expect(body(1)).toEqual({ handle: 'plain_one' });
    expect(body(2)).toEqual({ friendCode: 'HYD-7K2Q' });
  });

  it('checkHandle GETs handle-available with the value encoded', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ available: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await checkHandle('new_one')).toEqual({ available: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/me/handle-available?h=new_one');
    await checkHandle('a b&c');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/me/handle-available?h=a%20b%26c');
  });
});

describe('add by code / @username renders', () => {
  it('the field says it takes a code, a link or an @username', () => {
    const html = renderToString(h(AddByCode, { myCode: 'HYD-AAAA', embedded: true }));
    expect(html).toContain('Friend code, @username or link');
    expect(html).toContain('placeholder="HYD-7K2Q or @username"');
  });

  it('the search box asks for "Name or @username"', () => {
    const html = renderToString(h(AddFriendPanel, {}));
    expect(html).toContain('placeholder="Name or @username"');
    expect(html).toContain('Find by name or @username');
  });
});
