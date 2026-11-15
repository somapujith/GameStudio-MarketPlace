// ReconnectingSocket in cross-origin mode: a fresh ticket is fetched before EVERY (re)connect and put in the URL.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReconnectingSocket } from './socket.js';

class FakeWS {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    FakeWS.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '', wasClean: false });
  }
}
const last = () => FakeWS.instances[FakeWS.instances.length - 1];
const LOC = { protocol: 'https:', host: 'app.vercel.test' };

// Let promise callbacks run without advancing the fake clock.
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('ReconnectingSocket with tickets (cross-origin mode)', () => {
  beforeEach(() => {
    FakeWS.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = (fetchTicket, opts = {}) =>
    new ReconnectingSocket('/ws/room/ABC234', { WebSocketImpl: FakeWS, rnd: () => 1, location: LOC, useTicket: true, fetchTicket, ...opts });

  it('fetches a ticket, then opens the socket with ?ticket= (URL-encoded)', async () => {
    const fetchTicket = vi.fn(async () => 'tic.ket+/=');
    const s = make(fetchTicket);
    vi.advanceTimersByTime(0);
    expect(FakeWS.instances).toHaveLength(0); // not before the ticket arrives
    await flush();
    expect(fetchTicket).toHaveBeenCalledTimes(1);
    expect(last().url).toBe('wss://app.vercel.test/ws/room/ABC234?ticket=tic.ket%2B%2F%3D');
    last().open();
    expect(s.status).toBe('open');
    s.close();
  });

  it('asks for a NEW ticket on every reconnect and never reuses an old one', async () => {
    let n = 0;
    const fetchTicket = vi.fn(async () => `ticket-${(n += 1)}`);
    const s = make(fetchTicket);
    vi.advanceTimersByTime(0);
    await flush();
    last().open();
    expect(last().url).toContain('ticket=ticket-1');
    last().drop(1006);
    expect(s.status).toBe('reconnecting');
    vi.advanceTimersByTime(10000);
    await flush();
    expect(fetchTicket).toHaveBeenCalledTimes(2);
    expect(last().url).toContain('ticket=ticket-2');
    last().drop(1006);
    vi.advanceTimersByTime(10000);
    await flush();
    expect(last().url).toContain('ticket=ticket-3');
    expect(new Set(FakeWS.instances.map((w) => w.url)).size).toBe(3);
    s.close();
  });

  it('a signed-out user (ticket 401) gets the same terminal outcome as the server close code 4001', async () => {
    const err = Object.assign(new Error('Please sign in first'), { status: 401 });
    const s = make(vi.fn(async () => Promise.reject(err)));
    const status = [];
    const closes = [];
    s.on('status', (st, info) => status.push([st, info]));
    s.on('close', (c) => closes.push(c));
    vi.advanceTimersByTime(0);
    await flush();
    expect(FakeWS.instances).toHaveLength(0);
    expect(status.at(-1)[0]).toBe('closed');
    expect(status.at(-1)[1]).toMatchObject({ reason: 'fatal_close', code: 4001 });
    expect(closes[0].code).toBe(4001);
    vi.advanceTimersByTime(60000);
    await flush();
    expect(FakeWS.instances).toHaveLength(0); // no retry
  });

  it('a network failure while fetching the ticket backs off and tries again with a fresh request', async () => {
    const offline = Object.assign(new Error('Offline'), { status: 0 });
    const fetchTicket = vi.fn().mockRejectedValueOnce(offline).mockResolvedValueOnce('second-try');
    const s = make(fetchTicket);
    vi.advanceTimersByTime(0);
    await flush();
    expect(s.status).toBe('reconnecting');
    expect(FakeWS.instances).toHaveLength(0);
    vi.advanceTimersByTime(10000);
    await flush();
    expect(fetchTicket).toHaveBeenCalledTimes(2);
    expect(last().url).toContain('ticket=second-try');
    s.close();
  });

  it('an empty ticket answer counts as a failure (retry), not a connect without credentials', async () => {
    const fetchTicket = vi.fn().mockResolvedValueOnce('').mockResolvedValueOnce('ok-ticket');
    const s = make(fetchTicket);
    vi.advanceTimersByTime(0);
    await flush();
    expect(FakeWS.instances).toHaveLength(0);
    vi.advanceTimersByTime(10000);
    await flush();
    expect(last().url).toContain('ticket=ok-ticket');
    s.close();
  });

  it('closing while the ticket request is in flight never opens a socket', async () => {
    let resolve;
    const s = make(() => new Promise((r) => (resolve = r)));
    vi.advanceTimersByTime(0);
    s.close();
    resolve('late-ticket');
    await flush();
    expect(FakeWS.instances).toHaveLength(0);
  });

  it('a second connect() during the ticket request does not start a second attempt', async () => {
    const fetchTicket = vi.fn(async () => 'only-one');
    const s = make(fetchTicket);
    vi.advanceTimersByTime(0);
    s.connect();
    vi.advanceTimersByTime(0);
    await flush();
    expect(fetchTicket).toHaveBeenCalledTimes(1);
    expect(FakeWS.instances).toHaveLength(1);
    s.close();
  });

  it('same-origin mode never asks for a ticket and keeps the plain URL', () => {
    const fetchTicket = vi.fn();
    const s = new ReconnectingSocket('/ws/room/ABC234', { WebSocketImpl: FakeWS, location: LOC, useTicket: false, fetchTicket });
    vi.advanceTimersByTime(0);
    expect(fetchTicket).not.toHaveBeenCalled();
    expect(last().url).toBe('wss://app.vercel.test/ws/room/ABC234');
    s.close();
  });

  it('defaults to no ticket when VITE_API_ORIGIN is unset (the build used by the tests)', () => {
    const fetchTicket = vi.fn();
    const s = new ReconnectingSocket('/ws/user', { WebSocketImpl: FakeWS, location: LOC, fetchTicket });
    expect(s.opts.useTicket).toBe(false);
    s.close();
  });
});
