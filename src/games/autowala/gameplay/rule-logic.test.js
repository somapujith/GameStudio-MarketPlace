import { describe, expect, it } from 'vitest';
import { generateCity } from '../world/layout.js';
import {
  RULES, addHeat, createCooldowns, crossedEither, crossedLine, decayHeat, edgeLimit, initialCheckpoint, isWanted, limitAtPoint, payable,
  reduceCheckpoint, schoolZoneAt, speedFine,
} from './rule-logic.js';

const city = generateCity(1);

describe('speed limits', () => {
  it('fast roads 60, the rest 40, a school zone 20', () => {
    expect(edgeLimit({ w: 18, name: 'Outer Ring Road' })).toEqual({ limit: 60, zone: 'fast' });
    expect(edgeLimit({ w: 14, name: 'Necklace Road' })).toEqual({ limit: 60, zone: 'fast' });
    expect(edgeLimit({ w: 16, name: 'MG Road' })).toEqual({ limit: 60, zone: 'fast' });
    expect(edgeLimit({ w: 10, name: 'Moti Galli' })).toEqual({ limit: 40, zone: 'city' });
    const schools = [{ x: 100, z: 100, r: 50 }];
    expect(schoolZoneAt(schools, 120, 100)).toBe(schools[0]);
    expect(schoolZoneAt(schools, 200, 100)).toBe(null);
  });
  it('looks up the limit of the nearest real road, and a school zone overrides it', () => {
    const ring = city.edges.find((e) => e.name === 'Outer Ring Road');
    const a = city.nodes[ring.a];
    const out = { limit: 0, zone: '' };
    expect(limitAtPoint(city, [], a.x + ring.dx * 10, a.z + ring.dz * 10, out).limit).toBe(60);
    const small = city.edges.find((e) => e.w <= 10);
    const b = city.nodes[small.a];
    expect(limitAtPoint(city, [], b.x + small.dx * 4, b.z + small.dz * 4, out).limit).toBe(40);
    const sc = [{ x: b.x, z: b.z, r: 55 }];
    limitAtPoint(city, sc, b.x + 5, b.z, out);
    expect(out).toEqual({ limit: 20, zone: 'school' });
  });
});

describe('fines', () => {
  it('a speed camera charges nothing within the tolerance and more for more', () => {
    expect(speedFine(45, 40)).toBe(0);
    expect(speedFine(44, 40)).toBe(0);
    const a = speedFine(55, 40);
    const b = speedFine(75, 40);
    expect(a).toBeGreaterThanOrEqual(RULES.fine.speedBase);
    expect(b).toBeGreaterThan(a);
    expect(speedFine(300, 40)).toBe(RULES.fine.speedMax);
    expect(speedFine(30, 20)).toBeGreaterThan(0); // a school zone is strict in absolute terms too
  });
  it('is capped by the wallet and never negative', () => {
    expect(payable(250, 100)).toBe(100);
    expect(payable(250, 1000)).toBe(250);
    expect(payable(250, 0)).toBe(0);
    expect(payable(-5, 100)).toBe(0);
    expect(payable(250, undefined)).toBe(0);
  });
});

describe('cooldowns', () => {
  it('blocks the same site and any fine for a few seconds', () => {
    const cd = createCooldowns();
    expect(cd.ready('signal:1', 0)).toBe(true);
    cd.mark('signal:1', 10, 25, 6);
    expect(cd.ready('signal:1', 12)).toBe(false);
    expect(cd.ready('cam:2', 12)).toBe(false); // global
    expect(cd.ready('cam:2', 16.5)).toBe(true);
    expect(cd.ready('signal:1', 30)).toBe(false);
    expect(cd.ready('signal:1', 36)).toBe(true);
    cd.clear();
    expect(cd.ready('signal:1', 10)).toBe(true);
  });
});

describe('wanted heat', () => {
  it('rises with violations, decays, and the rage heat counts too', () => {
    let h = 0;
    expect(isWanted(h)).toBe(false);
    h = addHeat(h, RULES.heat.signal);
    expect(isWanted(h)).toBe(true);
    h = addHeat(h, 5);
    expect(h).toBe(1);
    h = decayHeat(h, 200);
    expect(h).toBe(0);
    expect(isWanted(0, 0.9)).toBe(true);
    expect(isWanted(0, undefined)).toBe(false);
    expect(isWanted(0, 0.1)).toBe(false);
  });
});

describe('line crossing', () => {
  it('needs a real crossing, on the road, going the right way', () => {
    expect(crossedLine(0.4, -0.1, 3, -1, 8)).toBe(true);
    expect(crossedLine(-0.4, -1, 3, -1, 8)).toBe(false); // already past
    expect(crossedLine(0.4, -0.1, 12, -1, 8)).toBe(false); // off the road
    expect(crossedLine(0.4, -0.1, 3, -1, 8, -0.8)).toBe(false); // the wrong way
    expect(crossedLine(30, -30, 3, -1, 8)).toBe(false); // a teleport
    expect(crossedEither(-0.3, 0.2, 2, 8)).toBe(true);
    expect(crossedEither(0.3, -0.2, 2, 8)).toBe(true);
    expect(crossedEither(0.3, 0.2, 2, 8)).toBe(false);
  });
});

describe('night checkpoint', () => {
  const step = (st, a) => reduceCheckpoint(st, { dt: 0.1, dist: 100, speed: 10, crossed: false, night: 1, wanted: false, busy: false, ...a });
  const run = (st, a, seconds) => {
    const fx = [];
    for (let t = 0; t < seconds; t += 0.1) {
      const r = step(st, a);
      st = r.state;
      fx.push(...r.effects.map((e) => e.type));
    }
    return { st, fx };
  };

  it('is not there in daylight', () => {
    const r = run(initialCheckpoint(), { dist: 5, speed: 0, night: 0 }, 5);
    expect(r.fx).toEqual([]);
  });
  it('shows a prompt on approach, checks a stopped car and lets a clean driver go', () => {
    let r = run(initialCheckpoint(), { dist: 30, speed: 8 }, 0.3);
    expect(r.fx).toEqual(['near']);
    r = run(r.st, { dist: 8, speed: 0.5 }, 6);
    expect(r.fx).toContain('checking');
    expect(r.fx).toContain('clear');
    expect(r.fx).not.toContain('fine-docs');
    expect(r.st.cool).toBeGreaterThan(60);
    // right after, the same checkpoint ignores the player
    expect(run(r.st, { dist: 3, speed: 0 }, 5).fx).toEqual([]);
  });
  it('fines a wanted driver who stops (documents check) and nobody else', () => {
    const r = run(initialCheckpoint(), { dist: 6, speed: 0, wanted: true }, 6);
    expect(r.fx.filter((x) => x === 'fine-docs')).toHaveLength(1);
  });
  it('running the checkpoint at speed is its own fine, once', () => {
    let r = run(initialCheckpoint(), { dist: 20, speed: 12 }, 0.2);
    r = run(r.st, { dist: 1, speed: 12, crossed: true }, 0.1);
    expect(r.fx).toEqual(['fine-ran']);
    expect(run(r.st, { dist: 1, speed: 12, crossed: true }, 1).fx).toEqual([]);
  });
  it('a slow pass does not count as running it', () => {
    const r = run(initialCheckpoint(), { dist: 4, speed: 4, crossed: true }, 0.2);
    expect(r.fx).not.toContain('fine-ran');
  });
  it('time stands still in a menu and a far player resets the prompt', () => {
    const r = run(initialCheckpoint(), { dist: 6, speed: 0, busy: true }, 5);
    expect(r.st.phase).toBe('idle');
    let q = run(initialCheckpoint(), { dist: 30, speed: 5 }, 0.2);
    q = run(q.st, { dist: 90, speed: 5 }, 0.2);
    expect(q.fx).toContain('far');
  });
});
