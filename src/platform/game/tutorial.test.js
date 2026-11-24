import { describe, expect, it } from 'vitest';
import { roomsLocked, tutorialDone, tutorialKey, tutorialRequired } from './tutorial.js';

const hybrid = { id: 'cook-off', tutorial: { requiredForRooms: true } };
const plain = { id: 'ludo' };
const store = (data = {}) => ({ getItem: (k) => (k in data ? data[k] : null) });
const throwing = { getItem: () => { throw new Error('denied'); } };

describe('tutorialRequired', () => {
  it('is true only for tutorial.requiredForRooms === true', () => {
    expect(tutorialRequired(hybrid)).toBe(true);
    expect(tutorialRequired(plain)).toBe(false);
    expect(tutorialRequired({ id: 'x', tutorial: {} })).toBe(false);
    expect(tutorialRequired({ id: 'x', tutorial: { requiredForRooms: 'yes' } })).toBe(false);
    expect(tutorialRequired(null)).toBe(false);
    expect(tutorialRequired(undefined)).toBe(false);
  });
});

describe('tutorialDone', () => {
  it('the local key is jalebi.tutorial.v1.<id>', () => {
    expect(tutorialKey('cook-off')).toBe('jalebi.tutorial.v1.cook-off');
  });
  it('is done when the server flag is true', () => {
    const user = { gameStats: { 'cook-off': { tutorialDone: true } } };
    expect(tutorialDone(user, hybrid, store())).toBe(true);
  });
  it('is done when the local mirror is "1"', () => {
    expect(tutorialDone(null, hybrid, store({ 'jalebi.tutorial.v1.cook-off': '1' }))).toBe(true);
    expect(tutorialDone({}, hybrid, store({ 'jalebi.tutorial.v1.cook-off': '0' }))).toBe(false);
    expect(tutorialDone({}, hybrid, store({ 'jalebi.tutorial.v1.other': '1' }))).toBe(false);
  });
  it('a truthy but non-true server value does not count', () => {
    expect(tutorialDone({ gameStats: { 'cook-off': { tutorialDone: 1 } } }, hybrid, store())).toBe(false);
    expect(tutorialDone({ gameStats: { 'cook-off': { games: 3 } } }, hybrid, store())).toBe(false);
  });
  it('survives no user, no storage, a throwing storage and a missing game', () => {
    expect(tutorialDone(null, hybrid, null)).toBe(false);
    expect(tutorialDone(undefined, hybrid, undefined)).toBe(false); // node: no localStorage
    expect(tutorialDone(null, hybrid, throwing)).toBe(false);
    expect(tutorialDone(null, hybrid, {})).toBe(false);
    expect(tutorialDone({}, null, store())).toBe(false);
    expect(tutorialDone({ gameStats: { 'cook-off': { tutorialDone: true } } }, hybrid, throwing)).toBe(true);
  });
  it('the default storage is the global localStorage when there is one', () => {
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: store({ 'jalebi.tutorial.v1.cook-off': '1' }), configurable: true });
    try {
      expect(tutorialDone(null, hybrid)).toBe(true);
    } finally {
      if (had) Object.defineProperty(globalThis, 'localStorage', had);
      else delete globalThis.localStorage;
    }
  });
});

describe('roomsLocked', () => {
  it('locks a required game until the tutorial is done', () => {
    expect(roomsLocked(null, hybrid, store())).toBe(true);
    expect(roomsLocked({ gameStats: {} }, hybrid, store())).toBe(true);
    expect(roomsLocked({ gameStats: { 'cook-off': { tutorialDone: true } } }, hybrid, store())).toBe(false);
    expect(roomsLocked(null, hybrid, store({ 'jalebi.tutorial.v1.cook-off': '1' }))).toBe(false);
  });
  it('never locks a game that does not require a tutorial', () => {
    expect(roomsLocked(null, plain, store())).toBe(false);
    expect(roomsLocked(null, null, store())).toBe(false);
  });
});

describe('the title-page nav of a hybrid game (solo screen + rooms)', () => {
  const base = { id: 'cook-off', status: 'live', solo: true, stats: [{ key: 'wins', label: 'Wins' }], loaders: { onlineGame() {}, soloGame() {} } };
  it('is a room game: Live now and one Leaderboard (no duplicate), unless locked', async () => {
    const { sectionList } = await import('./detailModel.js');
    expect(sectionList(base, { live: true }).map((s) => s.id)).toEqual(['gd-live', 'gd-board', 'gd-details']);
    expect(sectionList(base, { live: true, locked: true }).map((s) => s.id)).toEqual(['gd-board', 'gd-details']);
  });
  it('a pure solo game is unchanged', async () => {
    const { sectionList } = await import('./detailModel.js');
    expect(sectionList({ ...base, loaders: { soloGame() {} } }, { live: true }).map((s) => s.id)).toEqual(['gd-board', 'gd-details']);
  });
});
