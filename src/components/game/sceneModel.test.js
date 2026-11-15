import { describe, expect, it } from 'vitest';
import { sceneOf } from './sceneModel.js';

const session = (patch = {}) => ({
  display: { phase: 'buy', turn: 0, players: [{ id: 'me', name: 'Asha', pos: 7 }], levels: [] },
  ...patch,
});

describe('city scene presentation', () => {
  it('uses displayed position rather than leaking a future server position', () => {
    expect(sceneOf(session({ view: { players: [{ id: 'me', pos: 31 }] } })).tile.id).toBe(7);
  });
  it('leaves cards and final results unobstructed', () => {
    expect(sceneOf(session({ card: { title: 'A card' } }))).toBeNull();
    expect(sceneOf(session({ result: { winner: 'me' } }))).toBeNull();
    expect(sceneOf()).toBeNull();
  });
  it('gives rolling priority over an old cash bubble', () => {
    expect(sceneOf(session({ rolling: true, busy: true, bubble: { type: 'cash' } })).kind).toBe('roll');
  });
  it('does not replay purchases when reconnecting with an old bubble', () => {
    expect(sceneOf(session({ busy: false, bubble: { id: 1, type: 'own', reason: 'buy' } })).kind).toBe('place');
  });
  it('distinguishes sales and liquidations from upgrades and purchases', () => {
    expect(sceneOf(session({ busy: true, bubble: { type: 'level', reason: 'sell' } })).kind).toBe('place');
    expect(sceneOf(session({ busy: true, bubble: { type: 'own', reason: 'liquidate' } })).kind).toBe('place');
    expect(sceneOf(session({ busy: true, bubble: { type: 'level', reason: 'upgrade' } })).kind).toBe('build');
    expect(sceneOf(session({ busy: true, bubble: { type: 'own', reason: 'buy' } })).kind).toBe('purchase');
  });
  it('uses the transaction player for money captions', () => {
    const s = sceneOf(session({ busy: true, bubble: { id: 2, type: 'cash' }, lastCash: { player: 'me', delta: -11000, reason: 'rent' } }));
    expect(s.detail).toBe('Asha −₹11,000');
    expect(s.positive).toBe(false);
    expect(s.label).toBe('Rent changes hands');
  });
  it('keeps travel identity stable across pawn steps', () => {
    const s = session({ busy: true, stageTile: 14, bubble: { type: 'ride', id: 3 } });
    s.display.players[0].motion = 'ride';
    const first = sceneOf(s);
    s.display.players[0].pos = 18;
    expect(sceneOf(s).key).toBe(first.key);
    expect(first.transport).toBe('metro');
  });
  it('reads city effects from the presenter display', () => {
    const s = session({ busy: true, bubble: { type: 'city_event' }, view: { event: { id: 'festival' } } });
    s.display.event = { id: 'monsoon', title: 'Monsoon', group: 'cyber' };
    expect(sceneOf(s).event).toBe('monsoon');
    expect(sceneOf(s).tile.group).toBe('cyber');
  });
  it('recognizes ordinary walking without presenting it as a train journey', () => {
    const s = session({ busy: true, stageTile: 14 });
    s.display.moving = 'me';
    expect(sceneOf(s)).toMatchObject({ kind: 'travel', transport: 'walk' });
  });
  it('gives each half of a payment its own animation identity', () => {
    const s = session({ busy: true, bubble: { id: 5, type: 'cash' }, lastCash: { id: 7, player: 'me', delta: -1000 } });
    const first = sceneOf(s).key;
    s.lastCash = { id: 8, player: 'me', delta: 1000 };
    expect(sceneOf(s).key).not.toBe(first);
  });
});
