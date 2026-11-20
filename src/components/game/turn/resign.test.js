// Resign: who may, the words, and the flow's next step (the engine itself is not under test here).
import { describe, expect, it } from 'vitest';
import { RESIGN_CONFIRM, RESIGN_KEEP, RESIGN_TEXT, RESIGN_TITLE, RESIGN_TRIES, canResign, leaveDialog, resignStatus, resignStep, watchingLine } from './resign.js';

const players = (meExtra = {}) => [{ id: 'me', name: 'Nithin', bankrupt: false, ...meExtra }, { id: 'rav', name: 'Ravi', bankrupt: false }];
const sess = (extra = {}, meExtra = {}) => ({ me: 'me', view: { phase: 'roll', players: players(meExtra) }, options: {}, ...extra });

describe('resignStatus / canResign', () => {
  it('lets you resign at any moment of a running game, even while the table animates and the options are blank', () => {
    expect(resignStatus(sess())).toBe('playing');
    expect(canResign(sess({ busy: true, options: {} }))).toBe(true);
    for (const phase of ['roll', 'buy', 'manage', 'auction', 'debt']) expect(canResign({ ...sess(), view: { phase, players: players() } })).toBe(true);
  });

  it('hides it once you are out, when the game is over, or when you only watch', () => {
    expect(resignStatus(sess({}, { bankrupt: true }))).toBe('out');
    expect(canResign(sess({}, { bankrupt: true }))).toBe(false);
    expect(resignStatus(sess({ view: { phase: 'over', players: players() } }))).toBe('over');
    expect(resignStatus(sess({ result: { winner: 'rav' } }))).toBe('over');
    expect(canResign(sess({ view: { phase: 'over', players: players() } }))).toBe(false);
    expect(resignStatus(sess({ me: 'nobody' }))).toBe('spectator');
    expect(canResign({ me: 'me', view: null })).toBe(false);
    expect(canResign(undefined)).toBe(false);
  });

  it('compares ids as strings (numeric ids from the server)', () => {
    expect(resignStatus({ me: '7', view: { phase: 'roll', players: [{ id: 7, bankrupt: false }] } })).toBe('playing');
  });
});

describe('words', () => {
  it('asks plainly and keeps the wording of the request', () => {
    expect(RESIGN_TITLE).toBe('Resign from this game?');
    expect(RESIGN_TEXT).toContain('the bank takes ALL your cash and your districts go back to the bank');
    expect(RESIGN_TEXT).toContain("You can't rejoin");
    expect(RESIGN_CONFIRM).toBe('Resign');
    expect(RESIGN_KEEP).toBe('Keep playing');
  });

  it('the back button says that leaving a running game is resigning (the room resigns the leaver)', () => {
    const playing = leaveDialog('playing');
    expect(playing.text).toMatch(/counts as resigning/);
    expect(playing.text).toMatch(/Resign in the menu/);
    expect(playing.confirm).toBe('Leave and resign');
    expect(leaveDialog('out').title).toBe('Leave the table?');
    expect(leaveDialog('out').text).toMatch(/already out/);
    expect(leaveDialog('over').confirm).toBe('Leave');
    expect(leaveDialog('spectator').cancel).toBe('Stay');
  });

  it('says what you are doing after you are out', () => {
    expect(watchingLine({}, true)).toBe('You resigned – watching');
    expect(watchingLine({ resigned: true })).toBe('You resigned – watching');
    expect(watchingLine({})).toBe('You are out – watching');
  });
});

describe('resignStep', () => {
  const base = { pending: true, status: 'playing', busy: false, canSend: true, tries: 0 };

  it('does nothing until you confirmed', () => {
    expect(resignStep({ ...base, pending: false })).toBe('idle');
  });

  it('waits while the table animates (dispatch would be ignored), then sends', () => {
    expect(resignStep({ ...base, busy: true })).toBe('wait');
    expect(resignStep({ ...base, canSend: false })).toBe('wait');
    expect(resignStep(base)).toBe('send');
  });

  it('retries a few times, then gives up', () => {
    expect(resignStep({ ...base, tries: RESIGN_TRIES - 1 })).toBe('send');
    expect(resignStep({ ...base, tries: RESIGN_TRIES })).toBe('give_up');
  });

  it('is done as soon as you are out or the game is over', () => {
    expect(resignStep({ ...base, status: 'out' })).toBe('done');
    expect(resignStep({ ...base, status: 'over' })).toBe('done');
  });
});
