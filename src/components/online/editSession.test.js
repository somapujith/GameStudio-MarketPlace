// The host's editing session: optimistic draft, debounced sends, the server's echo as truth, a refusal with its reason.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditSession, ERROR_WINDOW, SETTLE } from './editSession.js';
import { SETTINGS_SCHEMA } from '@/games/hyderabad-tycoon/settings.js';
import { resolveSettings } from './settings.js';

const STOCK = resolveSettings(SETTINGS_SCHEMA, { mode: 'standard' });

function setup() {
  const sent = [];
  const session = createEditSession({ send: (m) => sent.push(m) });
  const seen = [];
  session.subscribe(() => seen.push(session.getState()));
  const edit = (patch, delay = 0, key = null, server = STOCK) => session.commit({ schema: SETTINGS_SCHEMA, server, patch, delay, key });
  return { sent, session, seen, edit };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('editSession: an edit shows at once and goes out as the full settings', () => {
  it('delay 0: the draft is the new value and one full message is sent immediately', () => {
    const { sent, session, edit } = setup();
    edit({ turnSeconds: 90 });
    expect(session.getState().draft.turnSeconds).toBe(90);
    expect(sent).toHaveLength(1);
    expect(sent[0].t).toBe('settings');
    expect(sent[0].settings).toEqual({ ...STOCK, turnSeconds: 90 }); // every rule, only the edited one differs
    expect(session.current(STOCK).turnSeconds).toBe(90);
  });

  it('without a draft the server settings are what is current', () => {
    const { session } = setup();
    expect(session.current(STOCK)).toBe(STOCK);
    expect(session.getState()).toEqual({ draft: null, inline: null });
  });
});

describe('editSession: debounce', () => {
  it('a slider drag is one message with the last value, sent once it rests; the draft follows every tick', () => {
    const { sent, session, edit } = setup();
    for (const v of [100000, 150000, 200000, 250000]) {
      edit({ passStart: v }, 250);
      expect(session.getState().draft.passStart).toBe(v); // the thumb and the value never lag
      vi.advanceTimersByTime(100);
    }
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(250);
    expect(sent).toHaveLength(1);
    expect(sent[0].settings.passStart).toBe(250000);
  });

  it('letting go (fire) sends right away and cancels the wait; a second fire is a no-op', () => {
    const { sent, session, edit } = setup();
    edit({ passStart: 300000 }, 250);
    session.fire();
    expect(sent).toHaveLength(1);
    session.fire();
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);
  });

  it('rapid -/+ taps chain from the draft, not from the stale server value, and go out as one message', () => {
    const { sent, session, edit } = setup();
    edit({ tradeSeconds: 50 }, 450);
    edit({ tradeSeconds: 55 }, 450, null, STOCK);
    edit({ chaiCap: 2 }, 450, null, STOCK); // another rule edited in the same burst keeps the earlier edits
    vi.advanceTimersByTime(449);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].settings).toMatchObject({ tradeSeconds: 55, chaiCap: 2 });
  });
});

describe('editSession: the server is the truth', () => {
  it('the draft stays until every message we sent is answered, then the server settings show', () => {
    const { sent, session, edit } = setup();
    edit({ turnSeconds: 90 });
    edit({ turnSeconds: 120 });
    expect(sent).toHaveLength(2);
    session.echo(); // the answer to the first
    expect(session.getState().draft).not.toBeNull(); // no flicker back to an older value
    expect(session.getState().draft.turnSeconds).toBe(120);
    session.echo();
    expect(session.getState().draft).toBeNull();
  });

  it('an echo while a drag or a tap burst is still waiting does not drop the newer draft', () => {
    const { sent, session, edit } = setup();
    edit({ turnSeconds: 90 });
    edit({ turnSeconds: 95 }, 450);
    session.echo();
    expect(session.getState().draft.turnSeconds).toBe(95);
    vi.advanceTimersByTime(450);
    expect(sent.map((m) => m.settings.turnSeconds)).toEqual([90, 95]);
  });

  it('a server that never answers: the draft falls back to the server settings after the settle time', () => {
    const { session, edit } = setup();
    edit({ turnSeconds: 90 });
    vi.advanceTimersByTime(SETTLE - 1);
    expect(session.getState().draft).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(session.getState().draft).toBeNull();
    expect(session.current(STOCK)).toBe(STOCK);
  });

  it('an echo nobody asked for (another tab, the first payload) changes nothing', () => {
    const { session, seen } = setup();
    session.echo();
    session.echo();
    expect(session.getState()).toEqual({ draft: null, inline: null });
    expect(seen).toHaveLength(0); // no re-render for nothing
  });
});

describe('editSession: a refused edit', () => {
  it('rolls back to the server settings and says why next to the field that was touched', () => {
    const { session, edit } = setup();
    edit({ turnSeconds: 90 }, 0, 'turnSeconds');
    vi.advanceTimersByTime(300);
    session.reject('Decision timer must be a whole number from 15 to 180 seconds in steps of 5.');
    expect(session.getState().draft).toBeNull();
    expect(session.getState().inline).toEqual({ text: 'Decision timer must be a whole number from 15 to 180 seconds in steps of 5.', key: 'turnSeconds' });
    expect(session.current(STOCK)).toBe(STOCK);
  });

  it('the next edit clears the message; a later echo cannot revive it', () => {
    const { session, edit } = setup();
    edit({ turnSeconds: 90 });
    session.reject('nope');
    expect(session.getState().inline).not.toBeNull();
    edit({ turnSeconds: 60 });
    expect(session.getState().inline).toBeNull();
    session.dismissError();
    expect(session.getState().inline).toBeNull();
  });

  it('a refusal cancels a message still waiting for its debounce: nothing is sent after it', () => {
    const { sent, session, edit } = setup();
    edit({ turnSeconds: 90 }, 0);
    edit({ turnSeconds: 95 }, 450);
    session.reject('Only the host can change settings.');
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(1);
    expect(session.getState().draft).toBeNull();
  });

  it('an error that cannot be the answer to an edit (nothing unanswered, or long ago) is not pinned to a field', () => {
    const a = setup();
    a.session.reject('Not enough players.');
    expect(a.session.getState().inline).toBeNull();

    const b = setup();
    b.edit({ turnSeconds: 90 });
    b.session.echo(); // answered
    b.session.reject('Not enough players.');
    expect(b.session.getState().inline).toBeNull();

    const c = setup();
    c.edit({ turnSeconds: 90 });
    vi.advanceTimersByTime(ERROR_WINDOW + 1); // settle already gave up on it
    c.session.reject('Something else');
    expect(c.session.getState().inline).toBeNull();
  });

  it('no message, no inline text: an empty error only rolls back', () => {
    const { session, edit } = setup();
    edit({ turnSeconds: 90 });
    session.reject('');
    expect(session.getState().draft).toBeNull();
    expect(session.getState().inline).toBeNull();
  });
});

describe('editSession: housekeeping', () => {
  it('uses the first patched key as the field to blame when none is named', () => {
    const { session, edit } = setup();
    edit({ snatchMs: 7000, snatches: 2 });
    session.reject('bad');
    expect(session.getState().inline.key).toBe('snatchMs');
  });

  it('dispose cancels everything waiting: no message goes out after the panel is gone', () => {
    const { sent, session, edit } = setup();
    edit({ turnSeconds: 90 }, 450);
    session.dispose();
    vi.advanceTimersByTime(SETTLE * 2);
    expect(sent).toHaveLength(0);
  });

  it('subscribers are told about every change and can leave', () => {
    const { session, edit, seen } = setup();
    edit({ turnSeconds: 90 });
    const n = seen.length;
    expect(n).toBeGreaterThan(0);
    const stop = session.subscribe(() => {});
    stop();
    session.echo();
    expect(seen.length).toBeGreaterThan(n); // the draft was dropped: one more notification
  });
});
