import { describe, expect, it } from 'vitest';
import {
  INITIAL_SELECTION, buildPowerView, expiryInfo, playAction, rivalReason, roundsLeft, selectionReducer, stepIndex, targetsFor,
} from './powerModel.js';
import { P, hand, sessionWith } from './powerFixtures.js';

describe('roundsLeft / expiryInfo', () => {
  it('exp is the last round a card can be played, this round included', () => {
    expect(roundsLeft(9, 7)).toBe(3);
    expect(roundsLeft(7, 7)).toBe(1);
    expect(roundsLeft(6, 7)).toBe(0);
    expect(roundsLeft(undefined, 7)).toBe(null);
    expect(roundsLeft(9, null)).toBe(null);
  });
  it('3 pips, honest text, last-round warning and the aria label', () => {
    expect(expiryInfo(3, 'Shield')).toMatchObject({ pips: [true, true, true], last: false, text: '3 rounds left', aria: 'Shield, 3 rounds left' });
    expect(expiryInfo(2, 'Shield')).toMatchObject({ pips: [true, true, false], aria: 'Shield, 2 rounds left' });
    expect(expiryInfo(1, 'Swap Tiles')).toMatchObject({ pips: [true, false, false], last: true, text: 'Last round', aria: 'Swap Tiles, last round' });
    expect(expiryInfo(4).pips).toEqual([true, true, true]); // a fresh card (drawn this round) still shows a full meter
    expect(expiryInfo(0).text).toBe('Expired');
    expect(expiryInfo(null).pips).toEqual([]);
  });
});

describe('buildPowerView', () => {
  it('is off when the rule is off (no options.power, cfg off)', () => {
    expect(buildPowerView(sessionWith({ cfgOn: false })).on).toBe(false);
    expect(buildPowerView({ me: 'me', view: { players: [] }, options: null }).on).toBe(false);
  });
  it('is on from options.power, or blank (null) while cfg says on', () => {
    expect(buildPowerView(sessionWith({ power: { canPlay: true, cards: [] } })).on).toBe(true);
    const blank = buildPowerView(sessionWith({ power: null }));
    expect(blank).toMatchObject({ on: true, blank: true, canPlay: false });
    expect(buildPowerView(sessionWith({ power: undefined, cfgOn: true })).on).toBe(true);
  });
  it('lists my hand with the engine ok / reason / targets and the expiry of each card', () => {
    const h = hand({ id: 'shield', exp: 9 }, { id: 'swap', exp: 7 });
    const s = sessionWith({
      hand: h,
      power: { canPlay: true, cards: [{ uid: 'c1', id: 'shield', exp: 9, ok: true }, { uid: 'c2', id: 'swap', exp: 7, ok: false, reason: 'No rival can swap right now', targets: [] }] },
    });
    const v = buildPowerView(s);
    expect(v.cards.map((c) => c.id)).toEqual(['shield', 'swap']);
    expect(v.cards[0]).toMatchObject({ ok: true, reason: '', left: 3, name: 'Shield', tone: 'blue' });
    expect(v.cards[1]).toMatchObject({ ok: false, reason: 'No rival can swap right now', left: 1 });
    expect(v.cards[1].expiry.last).toBe(true);
  });
  it('hidden placeholders and unknown ids are never listed', () => {
    const s = sessionWith({ hand: [{ hidden: true }, { uid: 'x', id: 'nope', exp: 9 }, { uid: 'ok', id: 'steal', exp: 9 }], power: { canPlay: true, cards: [] } });
    expect(buildPowerView(s).cards.map((c) => c.uid)).toEqual(['ok']);
  });
  it('explains why nothing can be played: the engine reason first, then a plain fallback', () => {
    const h = hand({ id: 'shield' });
    const notMine = buildPowerView(sessionWith({ hand: h, turn: 1, power: { canPlay: false, reason: 'Not your turn', cards: [{ uid: 'c1', id: 'shield', exp: 9, ok: false }] } }));
    expect(notMine.canPlay).toBe(false);
    expect(notMine.cards[0]).toMatchObject({ ok: false, reason: 'Not your turn' });
    const blank = buildPowerView(sessionWith({ hand: h, power: null }));
    expect(blank.cards[0].reason).toMatch(/wait for the moves to finish/i);
    expect(buildPowerView(sessionWith({ hand: h, turn: 1, power: null })).cards[0].reason).toBe('Not your turn');
  });
  it('played this turn: cards are dimmed with the cooldown reason', () => {
    const h = hand({ id: 'double' });
    const v = buildPowerView(sessionWith({ hand: h, played: true, power: { canPlay: false, reason: 'Already played a card this turn', cards: [{ uid: 'c1', id: 'double', exp: 9, ok: false }] } }));
    expect(v.played).toBe(true);
    expect(v.cards[0]).toMatchObject({ ok: false, reason: 'Already played a card this turn' });
    // somebody else's turn: powerPlayed is theirs, not mine
    expect(buildPowerView(sessionWith({ hand: h, played: true, turn: 1, power: { canPlay: false, reason: 'Not your turn', cards: [] } })).played).toBe(false);
  });
  it('falls back to options.power.cards when the state has no hand', () => {
    const v = buildPowerView(sessionWith({ hand: undefined, power: { canPlay: true, cards: [{ uid: 'u1', id: 'steal', exp: 9, ok: true }] } }));
    expect(v.cards.map((c) => c.uid)).toEqual(['u1']);
  });
});

describe('hand source and blanked options', () => {
  it('the hand comes from display player state; blanked options (null) never empty the tray', () => {
    const s = sessionWith({ hand: hand({ id: 'shield' }, { id: 'steal' }), power: null });
    const v = buildPowerView(s);
    expect(v.cards.map((c) => c.id)).toEqual(['shield', 'steal']);
    expect(v.cards.every((c) => !c.ok && c.reason === 'Wait for the moves to finish')).toBe(true);
  });
  it('display hand wins over the latest view (in step with the animated beats); the view is the fallback', () => {
    const s = sessionWith({ hand: hand({ id: 'shield' }), power: null });
    s.display = { ...s.view, players: s.view.players.map((p) => (p.id === 'me' ? { ...p, hand: hand({ id: 'double' }) } : p)) };
    expect(buildPowerView(s).cards.map((c) => c.id)).toEqual(['double']);
    const noDisplayHand = sessionWith({ hand: hand({ id: 'swap' }), power: null });
    noDisplayHand.display = { ...noDisplayHand.view, players: noDisplayHand.view.players.map((p) => ({ ...p, hand: undefined })) };
    expect(buildPowerView(noDisplayHand).cards.map((c) => c.id)).toEqual(['swap']);
  });
  it('not my turn while blanked says so', () => {
    expect(buildPowerView(sessionWith({ hand: hand({ id: 'shield' }), turn: 1, power: null })).cards[0].reason).toBe('Not your turn');
  });
});

describe('Swap Tiles targets', () => {
  const view = (extra) => buildPowerView(sessionWith({
    hand: hand({ id: 'swap' }),
    rivals: [P('rav', 'Ravi'), P('sana', 'Sana', { stuck: true }), P('arj', 'Arjun', { bankrupt: true })],
    power: { canPlay: true, cards: [{ uid: 'c1', id: 'swap', exp: 9, ok: true, targets: ['rav'] }] },
    ...extra,
  }));
  it('eligible first, the rest disabled with their reason', () => {
    const v = view();
    const t = targetsFor(v, v.cards[0]);
    expect(t.map((r) => [r.id, r.ok])).toEqual([['rav', true], ['sana', false], ['arj', false]]);
    expect(t[1].reason).toBe('Stuck in the Traffic Jam');
    expect(t[2].reason).toBe('Out of the game');
  });
  it('my own Traffic Jam is named when a healthy rival is not eligible', () => {
    expect(rivalReason(P('x', 'X'), { stuck: true })).toBe('You are stuck in the Traffic Jam');
    expect(rivalReason(P('x', 'X'), { stuck: false })).toBe('Cannot swap with them right now');
  });
});

describe('playAction', () => {
  const card = (id) => ({ uid: 'c1', id });
  it('Shield, Double Rent and Steal a Roll never carry a target key (the server rejects null / empty / undefined-as-null)', () => {
    for (const id of ['shield', 'double', 'steal']) {
      const a = playAction(card(id), 'rav'); // even if a target leaks in
      expect(a).toEqual({ type: 'PLAY_POWER', card: 'c1' });
      expect(Object.prototype.hasOwnProperty.call(a, 'target')).toBe(false);
      expect(JSON.parse(JSON.stringify(a))).not.toHaveProperty('target');
      expect(Object.prototype.hasOwnProperty.call(playAction(card(id)), 'target')).toBe(false);
    }
  });
  it('Swap Tiles sends the chosen rival id, and nothing when there is none', () => {
    expect(playAction(card('swap'), 'rav')).toEqual({ type: 'PLAY_POWER', card: 'c1', target: 'rav' });
    expect(Object.prototype.hasOwnProperty.call(playAction(card('swap'), null), 'target')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(playAction(card('swap'), ''), 'target')).toBe(false);
  });
});

describe('selectionReducer', () => {
  const run = (...actions) => actions.reduce(selectionReducer, INITIAL_SELECTION);
  it('select lifts a card, tapping it again (or another) toggles / switches', () => {
    expect(run({ type: 'select', uid: 'a' })).toMatchObject({ sel: 'a', step: 'detail' });
    expect(run({ type: 'select', uid: 'a' }, { type: 'select', uid: 'a' })).toEqual(INITIAL_SELECTION);
    expect(run({ type: 'select', uid: 'a' }, { type: 'select', uid: 'b' })).toMatchObject({ sel: 'b', step: 'detail' });
  });
  it('a plain card goes detail -> pending on Play; cancel returns to idle', () => {
    expect(run({ type: 'select', uid: 'a' }, { type: 'play', needsTarget: false }).step).toBe('pending');
    expect(run({ type: 'select', uid: 'a' }, { type: 'cancel' })).toEqual(INITIAL_SELECTION);
  });
  it('Swap Tiles: detail -> target -> confirm -> pending, with Back one step at a time', () => {
    const s1 = run({ type: 'select', uid: 's' }, { type: 'play', needsTarget: true });
    expect(s1.step).toBe('target');
    const s2 = selectionReducer(s1, { type: 'pick', id: 'rav' });
    expect(s2).toMatchObject({ step: 'confirm', target: 'rav' });
    expect(selectionReducer(s2, { type: 'back' })).toMatchObject({ step: 'target', target: null });
    expect(selectionReducer(selectionReducer(s2, { type: 'back' }), { type: 'back' }).step).toBe('detail');
    expect(selectionReducer(s2, { type: 'confirm' }).step).toBe('pending');
  });
  it('confirm needs a target; pick is ignored outside targeting', () => {
    expect(selectionReducer({ ...INITIAL_SELECTION, sel: 's', step: 'confirm', target: null }, { type: 'confirm' }).step).toBe('confirm');
    expect(run({ type: 'select', uid: 's' }, { type: 'pick', id: 'rav' }).step).toBe('detail');
  });
  it('while pending nothing can cancel or switch; the server answer resolves or fails (card returns, error shown)', () => {
    const p = run({ type: 'select', uid: 'a' }, { type: 'play', needsTarget: false });
    expect(selectionReducer(p, { type: 'cancel' })).toBe(p);
    expect(selectionReducer(p, { type: 'select', uid: 'b' })).toBe(p);
    expect(selectionReducer(p, { type: 'resolved' })).toEqual(INITIAL_SELECTION);
    const f = selectionReducer(p, { type: 'failed', message: 'Nope' });
    expect(f).toMatchObject({ sel: null, step: 'idle', error: 'Nope' });
    expect(selectionReducer(f, { type: 'clearError' }).error).toBe('');
  });
});

describe('stepIndex', () => {
  it('arrows wrap, Home / End jump, other keys are not navigation', () => {
    expect(stepIndex(0, 'ArrowRight', 2)).toBe(1);
    expect(stepIndex(1, 'ArrowRight', 2)).toBe(0);
    expect(stepIndex(0, 'ArrowLeft', 2)).toBe(1);
    expect(stepIndex(1, 'Home', 2)).toBe(0);
    expect(stepIndex(0, 'End', 2)).toBe(1);
    expect(stepIndex(0, 'Enter', 2)).toBe(-1);
    expect(stepIndex(0, 'ArrowRight', 0)).toBe(-1);
  });
});
