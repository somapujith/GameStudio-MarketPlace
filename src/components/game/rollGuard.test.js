// The die never rolls by itself: the client-side guard that sits behind every ROLL dispatch (button, Space / Enter, die tap,
// shake, decision card). Pure state machine with an injected clock.
import { beforeEach, describe, expect, it } from 'vitest';
import { ROLL_GUARD_MS, ROLL_REPEAT_MS, guardAction, noteRollOffer, resetRollGuard, rollAllowed, specOffersRoll } from './rollGuard.js';
import { buildActionSpec, shortcutAction } from './ActionBar.jsx';

const ROLL = { type: 'ROLL' };

beforeEach(() => resetRollGuard());

describe('rollGuard', () => {
  it('only ever holds back ROLL', () => {
    noteRollOffer(true, 1000);
    for (const type of ['END_TURN', 'BUY', 'SKIP_BUY', 'RIDE', 'PAY_TRAFFIC', 'USE_CHAI', 'BID']) expect(guardAction({ type }, 1001)).toBe(true);
    expect(guardAction(null, 1001)).toBe(true);
  });

  it('a Roll that has just appeared cannot be pressed yet (ghost click / double tap / the tail of an End turn tap)', () => {
    noteRollOffer(false, 0); // "End turn" or "Buy" was on screen
    noteRollOffer(true, 1000); // ... and the primary slot turns into Roll under the finger
    expect(guardAction(ROLL, 1000 + 50)).toBe(false);
    expect(guardAction(ROLL, 1000 + ROLL_GUARD_MS - 1)).toBe(false);
    expect(guardAction(ROLL, 1000 + ROLL_GUARD_MS)).toBe(true); // a deliberate press a moment later goes through
  });

  it('re-rendering the same offer does not re-arm the guard', () => {
    noteRollOffer(true, 1000);
    noteRollOffer(true, 1400);
    noteRollOffer(true, 1600);
    expect(guardAction(ROLL, 1000 + ROLL_GUARD_MS)).toBe(true);
  });

  it('Roll again after a six is a new offer: guarded again, and never right behind the roll that was just sent', () => {
    noteRollOffer(true, 0);
    expect(guardAction(ROLL, 600)).toBe(true); // the first roll
    noteRollOffer(false, 700); // busy: the die is tumbling and the pawn is moving
    expect(guardAction(ROLL, 900)).toBe(false); // a second tap on the same button: no
    noteRollOffer(true, 4000); // "Roll again" appears
    expect(guardAction(ROLL, 4100)).toBe(false);
    expect(guardAction(ROLL, 4000 + ROLL_GUARD_MS)).toBe(true);
  });

  it('two ROLLs in a row are never both sent: the second waits ROLL_REPEAT_MS', () => {
    noteRollOffer(true, 0);
    expect(guardAction(ROLL, 1000)).toBe(true);
    expect(guardAction(ROLL, 1000 + ROLL_REPEAT_MS - 1)).toBe(false);
    expect(rollAllowed(1000 + ROLL_REPEAT_MS)).toBe(true);
  });

  it('nothing offered and never armed: the guard does not get in the way of a first ever press', () => {
    expect(rollAllowed(0)).toBe(true);
  });

  it('specOffersRoll sees the Roll button and Traffic Jam wait-it-out, nothing else', () => {
    expect(specOffersRoll({ primary: { action: ROLL }, secondaries: [] })).toBe(true);
    expect(specOffersRoll({ primary: { action: { type: 'USE_CHAI' } }, secondaries: [{ action: ROLL }] })).toBe(true);
    expect(specOffersRoll({ primary: { action: { type: 'END_TURN' } }, secondaries: [] })).toBe(false);
    expect(specOffersRoll({ primary: null, secondaries: [] })).toBe(false);
    expect(specOffersRoll(null)).toBe(false);
  });

  it('the real spec of a roll turn offers a ROLL; an end-turn spec does not', () => {
    const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const view = { players, turn: 0, phase: 'roll', pending: null, cfg: {} };
    expect(specOffersRoll(buildActionSpec({ view, me: 'a', options: { roll: true } }))).toBe(true);
    expect(specOffersRoll(buildActionSpec({ view: { ...view, phase: 'manage' }, me: 'a', options: { endTurn: true } }))).toBe(false);
    expect(specOffersRoll(buildActionSpec({ view, me: 'b', options: {} }))).toBe(false);
  });
});

describe('Space / Enter shortcut: never from a dialog, a text field, a repeat or a modified key', () => {
  const rollSpec = () => buildActionSpec({
    view: { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], turn: 0, phase: 'roll', pending: null, cfg: {} },
    me: 'a',
    options: { roll: true },
  });
  const ev = (o = {}) => ({ key: ' ', target: { tagName: 'BODY' }, ...o });

  it('fires the Roll on a plain Space / Enter on the page', () => {
    expect(shortcutAction(rollSpec(), ev())).toEqual({ type: 'ROLL' });
    expect(shortcutAction(rollSpec(), ev({ key: 'Enter' }))).toEqual({ type: 'ROLL' });
  });

  it('ignores key repeat, IME composition, modifiers, text fields, buttons, an open sheet / dialog', () => {
    const spec = rollSpec();
    expect(shortcutAction(spec, ev({ repeat: true }))).toBeNull();
    expect(shortcutAction(spec, ev({ isComposing: true }))).toBeNull();
    expect(shortcutAction(spec, ev({ shiftKey: true }))).toBeNull();
    expect(shortcutAction(spec, ev({ ctrlKey: true }))).toBeNull();
    expect(shortcutAction(spec, ev({ target: { tagName: 'INPUT' } }))).toBeNull(); // the chat box
    expect(shortcutAction(spec, ev({ target: { tagName: 'TEXTAREA' } }))).toBeNull();
    expect(shortcutAction(spec, ev({ target: { tagName: 'DIV', isContentEditable: true } }))).toBeNull();
    expect(shortcutAction(spec, ev({ target: { tagName: 'BUTTON' } }))).toBeNull(); // the browser clicks it itself
    expect(shortcutAction(spec, ev(), true)).toBeNull(); // a sheet / dialog is open
  });
});
