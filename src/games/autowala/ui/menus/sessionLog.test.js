import { describe, it, expect } from 'vitest';
import { createSessionLog, MAX_HISTORY } from './sessionLog.js';

function fakeGame() {
  const ls = new Set();
  return { on: (fn) => { ls.add(fn); return () => ls.delete(fn); }, emit: (type, d = {}) => ls.forEach((l) => l({ type, ...d })), ls };
}

describe('createSessionLog', () => {
  it('keeps the newest drop-offs first and caps the list', () => {
    const g = fakeGame();
    const { log } = createSessionLog(g);
    for (let i = 0; i < MAX_HISTORY + 3; i++) g.emit('fare:dropoff', { trip: { name: `P${i}`, dest: { name: 'Charminar' } }, fare: 100 + i, tip: 5, rating: 4 });
    expect(log.history.length).toBe(MAX_HISTORY);
    expect(log.history[0]).toMatchObject({ name: `P${MAX_HISTORY + 2}`, dest: 'Charminar', fare: 100 + MAX_HISTORY + 2, tip: 5, rating: 4 });
  });
  it('counts misses, abandons, fines and escapes', () => {
    const g = fakeGame();
    const { log } = createSessionLog(g);
    g.emit('fare:missed', {});
    g.emit('fare:missed', {});
    g.emit('fare:abandon', {});
    g.emit('rage:caught', { fine: 250 });
    g.emit('rage:caught', { fine: 'junk' });
    g.emit('rage:escaped', {});
    g.emit('traffic:hit', {});
    g.emit('workshop:buy', {});
    g.emit('honk', {});
    expect(log).toMatchObject({ missed: 2, abandoned: 1, fines: 2, finesTotal: 250, escapes: 1, hits: 1, workshopBuys: 1 });
  });
  it('tolerates a drop-off without a trip and unsubscribes', () => {
    const g = fakeGame();
    const s = createSessionLog(g);
    g.emit('fare:dropoff', { fare: 'x', rating: 99 });
    expect(s.log.history[0]).toMatchObject({ name: 'Passenger', fare: 0, rating: 5 });
    s.dispose();
    expect(g.ls.size).toBe(0);
  });
});
