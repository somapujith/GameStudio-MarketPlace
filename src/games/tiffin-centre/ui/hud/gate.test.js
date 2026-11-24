import { describe, it, expect } from 'vitest';
import {
  GATE_TEXT, chitUrgency, eventNotice, gateDecision, isActionAllowed, patienceWarnings, pendingTarget, ticketModel, tokenOf, tokenText, walkToFor,
} from './hudLogic.js';
import { mkCustomer, mkState } from './testState.js';

describe('tokens', () => {
  it('every customer holds their id as a token, on the ticket model, in notices and in place names', () => {
    const c = mkCustomer({ id: 7, name: 'Padma' });
    expect(tokenOf(c)).toBe(7);
    expect(tokenText(c)).toBe('Token 7');
    expect(ticketModel(c, mkState(), []).token).toBe(7);
    const s = mkState({ customers: [c] });
    expect(eventNotice({ type: 'customer-angry', customer: 7 }, s, 'me').text).toContain('Token 7 (Padma)');
    expect(patienceWarnings(s, { ...s, customers: [{ ...c, patience: 3 }] })[0].text).toContain('Token 7');
  });
});

describe('the tutorial gate', () => {
  it('no allowed list means everything; false or [] means nothing', () => {
    for (const a of [undefined, null, true]) expect(isActionAllowed(a, { type: 'serve' })).toBe(true);
    expect(isActionAllowed(false, { type: 'serve' })).toBe(false);
    expect(isActionAllowed([], { type: 'cook' })).toBe(false);
  });

  it('accepts arrays, sets, objects, aliases, wildcards and functions', () => {
    expect(isActionAllowed(['cook', 'take'], { type: 'take' })).toBe(true);
    expect(isActionAllowed(['cook', 'take'], { type: 'serve' })).toBe(false);
    expect(isActionAllowed(new Set(['walk']), { type: 'move' })).toBe(true);
    expect(isActionAllowed({ serve: true, cook: false }, { type: 'serve' })).toBe(true);
    expect(isActionAllowed({ serve: true, cook: false }, { type: 'cook' })).toBe(false);
    expect(isActionAllowed(['*'], { type: 'discard' })).toBe(true);
    expect(isActionAllowed((a) => a.type === 'collect', { type: 'collect' })).toBe(true);
    expect(isActionAllowed(() => { throw new Error('x'); }, { type: 'collect' })).toBe(true);
    expect(isActionAllowed(['cook'], 'cook')).toBe(true);
  });

  it('lets a decision through, refuses it with "not yet", or turns a refused tap into a walk when walking is allowed', () => {
    const s = mkState({ customers: [mkCustomer({ id: 4, spot: 2 })] });
    const sheet = { type: 'sheet', station: 'tawa1', slot: 0 };
    expect(GATE_TEXT).toBe('Chotu says: not yet!');
    expect(gateDecision(sheet, { kind: 'station', id: 'tawa1' }, ['cook'], s)).toEqual({ go: sheet });
    expect(gateDecision(sheet, { kind: 'station', id: 'tawa1' }, ['serve'], s)).toEqual({ blocked: true });
    expect(gateDecision(sheet, { kind: 'station', id: 'tawa1' }, ['move'], s)).toEqual({ walk: 'tawa1' });
    const serve = { type: 'dispatch', action: { type: 'serve', customer: 4, hand: 0 } };
    expect(gateDecision(serve, { kind: 'customer', id: 4 }, ['walk'], s)).toEqual({ walk: 'spot:2' });
    expect(gateDecision({ type: 'hint', text: 'Hands full' }, null, [], s)).toEqual({ go: { type: 'hint', text: 'Hands full' } });
    expect(gateDecision(null, null, [], s)).toEqual({ go: null });
  });

  it('knows where a tap walks to and what a queued action is about', () => {
    const s = mkState({ customers: [mkCustomer({ id: 4, spot: 2 })] });
    expect(walkToFor({ kind: 'slot', station: 'chai1', slot: 1 }, s)).toBe('chai1');
    expect(walkToFor({ kind: 'bin' }, s)).toBe('bin');
    expect(walkToFor({ kind: 'customer', id: 99 }, s)).toBeNull();
    expect(pendingTarget({ type: 'cook', station: 'tawa1', slot: 2, dish: 'dosa' })).toMatchObject({ kind: 'slot', station: 'tawa1', slot: 2 });
    expect(pendingTarget({ type: 'collect', customer: 4 })).toEqual({ kind: 'customer', id: 4 });
    expect(pendingTarget({ type: 'discard', hand: 0 })).toEqual({ kind: 'bin' });
    expect(pendingTarget({ type: 'move', to: 'bin' })).toBeNull();
  });
});

describe('edge chip urgency', () => {
  it('follows the patience ring colour and flashes while a paying customer is about to leave', () => {
    const s = mkState();
    expect(chitUrgency(mkCustomer({ patience: 36, patienceMax: 40 }), s)).toMatchObject({ tone: 'ok', flash: false });
    expect(chitUrgency(mkCustomer({ patience: 18, patienceMax: 40 }), s).tone).toBe('warn');
    expect(chitUrgency(mkCustomer({ patience: 3, patienceMax: 40 }), s).tone).toBe('crit');
    expect(chitUrgency(mkCustomer({ st: 'paying', payLeft: 8 }), s)).toMatchObject({ tone: 'ok', flash: false });
    expect(chitUrgency(mkCustomer({ st: 'paying', payLeft: 2 }), s)).toMatchObject({ tone: 'crit', flash: true });
  });
});
