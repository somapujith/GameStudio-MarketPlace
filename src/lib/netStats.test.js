// Connection strength on the client: the RTT bookkeeping, the report policy, the local store and the socket's ping/pong sampling.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RttTracker, createNetReporter, PROBE_MS, REPORT_KEEPALIVE_MS, REPORT_MIN_GAP_MS } from './rtt.js';
import { createNetStats } from './netStats.js';
import { ReconnectingSocket, openRoomSocket } from './socket.js';

describe('RttTracker', () => {
  it('pairs each pong with the oldest ping that is still waiting (a socket delivers in order)', () => {
    const t = new RttTracker();
    t.sent(1000);
    t.sent(1100);
    expect(t.received(1090)).toBe(90);
    expect(t.received(1250)).toBe(150);
    expect(t.received(1300)).toBeNull(); // a pong nobody asked for
    expect(t.rtt).toBe(120); // median of 90 and 150
  });

  it('smooths with the median of the last three, so one slow packet does not drop the bars', () => {
    const t = new RttTracker();
    for (const rtt of [60, 62, 1500]) {
      t.sent(0);
      t.received(rtt);
    }
    expect(t.rtt).toBe(62);
    for (const rtt of [61, 63]) {
      t.sent(0);
      t.received(rtt);
    }
    expect(t.rtt).toBe(63);
    for (const rtt of [900, 950]) {
      t.sent(0);
      t.received(rtt);
    }
    expect(t.rtt).toBe(900); // a lasting change shows after two more samples (about 8 s of pings)
  });

  it('counts a ping nobody answered as a long sample, once it is late', () => {
    const t = new RttTracker();
    t.sent(0);
    t.received(50);
    t.sent(10_000);
    expect(t.late(10_000 + 2999, 3000)).toBeNull();
    expect(t.late(10_000 + 3000, 3000)).toBe(3000);
    expect(t.late(10_000 + 7000, 3000)).toBe(7000);
    expect(t.rtt).toBe(3000); // 50, 3000, 7000
    t.received(10_000 + 7100); // the answer finally arrives: a real (huge) sample as well
    expect(t.samples.at(-1)).toBe(7100);
    expect(t.late(20_000, 3000)).toBeNull(); // nothing is waiting any more
  });

  it('reset forgets samples and waiting pings; bounds its memory', () => {
    const t = new RttTracker();
    t.sent(0);
    t.received(80);
    t.sent(0);
    t.reset();
    expect(t.rtt).toBeNull();
    expect(t.received(500)).toBeNull();
    for (let i = 0; i < 50; i++) t.sent(i);
    expect(t.pending.length).toBeLessThanOrEqual(8);
    for (let i = 0; i < 50; i++) t.add(i);
    expect(t.samples.length).toBeLessThanOrEqual(12);
    expect(t.add(NaN)).toBeNull();
    expect(t.add(-1)).toBeNull();
  });
});

describe('createNetReporter', () => {
  const make = (extra = {}) => {
    const sent = [];
    let clock = 0;
    const r = createNetReporter({ send: (m) => (sent.push(m), true), now: () => clock, ...extra });
    return { r, sent, at: (t) => (clock = t) };
  };

  it('reports the first measurement at once, as { t:"net", rtt }', () => {
    const { r, sent } = make();
    expect(r.rtt(84.4)).toBe(true);
    expect(sent).toEqual([{ t: 'net', rtt: 84 }]);
  });

  it('stays quiet while the level is the same, and speaks up every 10 s anyway', () => {
    const { r, sent, at } = make();
    at(0);
    r.rtt(60);
    for (let t = 4000; t < REPORT_KEEPALIVE_MS; t += 4000) {
      at(t);
      expect(r.rtt(65)).toBe(false);
    }
    at(REPORT_KEEPALIVE_MS);
    expect(r.rtt(70)).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('reports a level change right away, but never faster than every 2 s', () => {
    const { r, sent, at } = make();
    at(0);
    r.rtt(60);
    at(REPORT_MIN_GAP_MS - 1);
    expect(r.rtt(900)).toBe(false);
    at(REPORT_MIN_GAP_MS);
    expect(r.rtt(900)).toBe(true);
    expect(sent.map((m) => m.rtt)).toEqual([60, 900]);
  });

  it('uses hysteresis against the last REPORTED level, so a value hovering around 90 ms sends nothing', () => {
    const { r, sent, at } = make();
    at(0);
    r.rtt(85);
    for (const [t, v] of [[4000, 95], [8000, 88], [9000, 99]]) {
      at(t);
      r.rtt(v);
    }
    expect(sent).toHaveLength(1);
  });

  it('starts over after reset (a reconnect), ignores garbage and failed sends', () => {
    const { r, sent, at } = make();
    at(5000);
    r.rtt(60);
    r.reset();
    at(5001);
    expect(r.rtt(60)).toBe(true);
    expect(sent).toHaveLength(2);
    expect(r.rtt(NaN)).toBe(false);
    const dead = createNetReporter({ send: () => false });
    expect(dead.rtt(60)).toBe(false);
    expect(createNetReporter({}).rtt(60)).toBe(false);
  });
});

describe('net stats store', () => {
  it('holds your own status, rtt and level, and notifies on change only', () => {
    const s = createNetStats();
    const seen = [];
    const off = s.subscribe(() => seen.push(s.getSnapshot()));
    expect(s.getSnapshot()).toEqual({ status: 'idle', rtt: null, level: null });
    s.setStatus('connecting');
    s.setStatus('open');
    s.setRtt(70);
    s.setRtt(70);
    expect(s.getSnapshot()).toEqual({ status: 'open', rtt: 70, level: 4 });
    expect(seen).toHaveLength(3);
    s.setRtt(120);
    expect(s.getSnapshot().level).toBe(3);
    s.setRtt(NaN);
    s.setRtt(-4);
    expect(s.getSnapshot()).toEqual({ status: 'open', rtt: 120, level: 3 });
    off();
    s.setRtt(500);
    expect(seen).toHaveLength(4);
  });

  it('forgets the number when the connection drops, and measures again after the reconnect', () => {
    const s = createNetStats();
    s.setStatus('open');
    s.setRtt(100);
    s.setStatus('reconnecting');
    expect(s.getSnapshot()).toEqual({ status: 'reconnecting', rtt: null, level: null });
    s.setStatus('open');
    expect(s.getSnapshot()).toEqual({ status: 'open', rtt: null, level: null });
    s.setRtt(300);
    expect(s.getSnapshot().level).toBe(2);
    s.reset();
    expect(s.getSnapshot()).toEqual({ status: 'idle', rtt: null, level: null });
  });

  it('keeps the level steady around an edge (hysteresis against the shown level)', () => {
    const s = createNetStats();
    s.setStatus('open');
    s.setRtt(85);
    s.setRtt(95);
    expect(s.getSnapshot().level).toBe(4);
    s.setRtt(130);
    expect(s.getSnapshot().level).toBe(3);
  });
});

// ---- the socket: pings measured on the room socket ------------------------------------------------------------------

class FakeWS {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWS.instances.push(this);
  }
  send(data) {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(obj) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '', wasClean: false });
  }
  pings() {
    return this.sent.filter((m) => m.t === 'ping').length;
  }
}
const last = () => FakeWS.instances[FakeWS.instances.length - 1];
const make = (opts = {}) => new ReconnectingSocket('/ws/room/ABC234', { WebSocketImpl: FakeWS, rnd: () => 1, ...opts });
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('socket RTT sampling', () => {
  beforeEach(() => {
    FakeWS.instances = [];
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is off unless asked for: no extra pings, no events', () => {
    const s = make();
    const got = [];
    s.on('rtt', (v) => got.push(v));
    vi.advanceTimersByTime(0);
    last().open();
    vi.advanceTimersByTime(60_000);
    expect(last().pings()).toBe(3); // only the 20 s heartbeat
    last().push({ t: 'pong' });
    expect(got).toEqual([]);
    expect(s.rtt).toBeNull();
    s.close();
  });

  it('pings on open and then every rttMs; each pong is a sample and fires "rtt" with the smoothed value', () => {
    const s = make({ rttMs: PROBE_MS });
    const got = [];
    s.on('rtt', (smoothed, sample) => got.push([smoothed, sample]));
    vi.advanceTimersByTime(0);
    last().open();
    expect(last().pings()).toBe(1); // the first ping goes out at once
    vi.advanceTimersByTime(80);
    last().push({ t: 'pong' });
    expect(got).toEqual([[80, 80]]);
    expect(s.rtt).toBe(80);
    vi.advanceTimersByTime(PROBE_MS - 80);
    expect(last().pings()).toBe(2);
    vi.advanceTimersByTime(120);
    last().push({ t: 'pong' });
    expect(got.at(-1)).toEqual([100, 120]); // median of 80 and 120
    s.close();
  });

  it('a pong is still swallowed (never a "message"), and an unasked pong makes no sample', () => {
    const s = make({ rttMs: PROBE_MS });
    const msgs = [];
    const got = [];
    s.on('message', (m) => msgs.push(m));
    s.on('rtt', (v) => got.push(v));
    vi.advanceTimersByTime(0);
    last().open();
    last().push({ t: 'pong' });
    last().push({ t: 'pong' });
    last().push({ t: 'room', room: {} });
    expect(msgs).toEqual([{ t: 'room', room: {} }]);
    expect(got).toHaveLength(1);
    s.close();
  });

  it('a ping that nobody answers sinks the bars instead of keeping the last good number', () => {
    const s = make({ rttMs: 4000, staleMs: 0 });
    const got = [];
    s.on('rtt', (v) => got.push(v));
    vi.advanceTimersByTime(0);
    last().open();
    vi.advanceTimersByTime(50);
    last().push({ t: 'pong' });
    expect(s.rtt).toBe(50);
    vi.advanceTimersByTime(4000 - 50); // tick 1: a new ping goes out, nothing late yet
    vi.advanceTimersByTime(4000); // tick 2: that ping has waited 4 s, no pong
    vi.advanceTimersByTime(4000); // tick 3: 8 s
    vi.advanceTimersByTime(4000); // tick 4: 12 s
    expect(s.rtt).toBeGreaterThanOrEqual(4000);
    expect(got.at(-1)).toBeGreaterThanOrEqual(4000);
    s.close();
  });

  it('starts from scratch after a reconnect: old samples and waiting pings are gone', () => {
    const s = make({ rttMs: PROBE_MS });
    vi.advanceTimersByTime(0);
    last().open();
    vi.advanceTimersByTime(60);
    last().push({ t: 'pong' });
    expect(s.rtt).toBe(60);
    last().drop(1006);
    expect(s.rtt).toBeNull(); // the connection is gone, so is its number
    vi.advanceTimersByTime(10_000);
    const second = last();
    expect(second).not.toBe(FakeWS.instances[0]);
    second.open();
    expect(second.pings()).toBe(1); // measured again right away
    expect(s.rtt).toBeNull(); // nothing yet on the new connection
    vi.advanceTimersByTime(300);
    second.push({ t: 'pong' });
    expect(s.rtt).toBe(300); // not the median with the old 60
    s.close();
  });

  it('stops pinging when closed and never pings a socket that is not open', () => {
    const s = make({ rttMs: PROBE_MS });
    vi.advanceTimersByTime(0);
    const ws = last();
    ws.open();
    ws.drop(1006);
    vi.advanceTimersByTime(3000); // inside the backoff: no socket, no pings
    expect(ws.pings()).toBe(1);
    s.close();
    vi.advanceTimersByTime(60_000);
    expect(ws.pings()).toBe(1);
  });

  it('works in cross-origin (ticket) mode: every reconnect fetches a ticket and then measures afresh', async () => {
    let n = 0;
    const fetchTicket = vi.fn(async () => `ticket-${(n += 1)}`);
    const s = make({ rttMs: PROBE_MS, useTicket: true, fetchTicket, location: { protocol: 'https:', host: 'app.vercel.test' } });
    vi.advanceTimersByTime(0);
    await flush();
    last().open();
    vi.advanceTimersByTime(90);
    last().push({ t: 'pong' });
    expect(s.rtt).toBe(90);
    last().drop(1006);
    expect(s.rtt).toBeNull();
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(fetchTicket).toHaveBeenCalledTimes(2);
    expect(last().url).toContain('ticket=ticket-2');
    last().open();
    expect(last().pings()).toBe(1);
    vi.advanceTimersByTime(200);
    last().push({ t: 'pong' });
    expect(s.rtt).toBe(200);
    s.close();
  });

  it('openRoomSocket turns it on (every 4 s); the user socket does not', () => {
    const room = openRoomSocket('ABC234', { WebSocketImpl: FakeWS });
    expect(room.opts.rttMs).toBe(PROBE_MS);
    expect(room.opts.dropOnOffline).toBe(true);
    room.close();
    expect(new ReconnectingSocket('/ws/user', { WebSocketImpl: FakeWS }).opts.rttMs).toBe(0);
  });
});

describe('the browser going offline', () => {
  let win;
  beforeEach(() => {
    FakeWS.instances = [];
    vi.useFakeTimers();
    win = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ends a socket that still looks open ("Reconnecting…" now, not after the 45 s silence check) and reconnects on "online"', () => {
    const s = make({ rttMs: PROBE_MS, dropOnOffline: true });
    const statuses = [];
    s.on('status', (st) => statuses.push(st));
    vi.advanceTimersByTime(0);
    last().open();
    vi.advanceTimersByTime(70);
    last().push({ t: 'pong' });
    expect(s.rtt).toBe(70);
    win.dispatchEvent(new Event('offline'));
    expect(s.status).toBe('reconnecting');
    expect(statuses).toContain('reconnecting');
    expect(s.rtt).toBeNull();
    const before = FakeWS.instances.length;
    win.dispatchEvent(new Event('online'));
    expect(FakeWS.instances.length).toBe(before + 1); // no backoff wait once the network is back
    last().open();
    expect(s.status).toBe('open');
    expect(last().pings()).toBe(1);
    s.close();
  });

  it('is opt-in: a socket without the option ignores the event', () => {
    const s = make({ rttMs: PROBE_MS });
    vi.advanceTimersByTime(0);
    last().open();
    win.dispatchEvent(new Event('offline'));
    expect(s.status).toBe('open');
    s.close();
  });

  it('close() stops listening', () => {
    const s = make({ rttMs: PROBE_MS, dropOnOffline: true });
    vi.advanceTimersByTime(0);
    last().open();
    s.close();
    const before = FakeWS.instances.length;
    win.dispatchEvent(new Event('offline'));
    win.dispatchEvent(new Event('online'));
    expect(FakeWS.instances.length).toBe(before);
  });
});
