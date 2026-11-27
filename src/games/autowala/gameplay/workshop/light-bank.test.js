import { describe, expect, it } from 'vitest';
import { Group, Object3D, PointLight, Scene, SpotLight, Vector3 } from 'three';
import { borrowLights } from './light-bank.js';
import { createSet } from './showroom.js';

/** The auto as the game builds it: a body group with the headlight (and its target) as children. */
function autoWithHeadlight() {
  const auto = new Group();
  auto.position.set(10, 0, -4);
  auto.rotation.y = 0.8;
  const body = new Group();
  auto.add(body);
  const headlight = new SpotLight(0xfff0c0, 0, 46, 0.62, 0.6, 1.2);
  headlight.position.set(0, 1.0, 1.3);
  headlight.target.position.set(0, 0.4, 14);
  body.add(headlight, headlight.target);
  auto.userData = { body, headlight };
  return { auto, body, headlight };
}

function fakeProps() {
  const lights = [0, 1, 2].map(() => new PointLight(0xffb35c, 0, 30, 2));
  const log = [];
  return {
    lights,
    log,
    lend: (n) => { log.push(['lend', n]); return lights.slice(0, n); },
    unlend: () => { log.push(['unlend']); },
  };
}

const worldPos = (o) => o.getWorldPosition(new Vector3());

describe('borrowLights', () => {
  it('has nothing to lend without a headlight or a pool that can lend', () => {
    const scene = new Scene();
    expect(borrowLights({ scene, auto: new Group(), props: fakeProps() })).toBeNull();
    expect(borrowLights({ scene, auto: autoWithHeadlight().auto, props: {} })).toBeNull();
    const small = fakeProps();
    small.lend = () => [new PointLight()]; // a pool with fewer than two lights
    expect(borrowLights({ scene, auto: autoWithHeadlight().auto, props: small })).toBeNull();
  });

  it('lends two pool lights and the headlight, keeps the headlight where it was in the world, and gives everything back', () => {
    const scene = new Scene();
    const { auto, body, headlight } = autoWithHeadlight();
    scene.add(auto);
    scene.updateMatrixWorld(true);
    const before = worldPos(headlight);
    const targetBefore = worldPos(headlight.target);
    const props = fakeProps();
    const bank = borrowLights({ scene, auto, props });
    expect(props.log).toEqual([['lend', 2]]);
    expect(bank.key).toBe(headlight);
    expect([bank.pink, bank.cyan]).toEqual(props.lights.slice(0, 2));
    // out of the auto's frame, into the scene, same place
    expect(headlight.parent).toBe(scene);
    expect(headlight.target.parent).toBe(scene);
    scene.updateMatrixWorld(true);
    expect(worldPos(headlight).distanceTo(before)).toBeLessThan(1e-6);
    expect(worldPos(headlight.target).distanceTo(targetBefore)).toBeLessThan(1e-6);
    expect(auto.userData.headlightLent).toBe(true);

    // the borrower retunes it ...
    headlight.intensity = 120;
    headlight.distance = 34;
    headlight.color.setHex(0x123456);
    headlight.position.set(1, 2, 3);
    bank.release();
    bank.release(); // harmless twice
    // ... and it is the auto's headlight again, exactly as built
    expect(headlight.parent).toBe(body);
    expect(headlight.target.parent).toBe(body);
    expect(headlight.position.toArray()).toEqual([0, 1.0, 1.3]);
    expect(headlight.target.position.toArray()).toEqual([0, 0.4, 14]);
    expect([headlight.distance, headlight.angle, headlight.penumbra, headlight.decay]).toEqual([46, 0.62, 0.6, 1.2]);
    expect(headlight.color.getHex()).toBe(0xfff0c0);
    expect(headlight.quaternion.w).toBe(1);
    expect(auto.userData.headlightLent).toBe(false);
    expect(props.log).toEqual([['lend', 2], ['unlend']]);
    scene.updateMatrixWorld(true);
    expect(worldPos(headlight).distanceTo(before)).toBeLessThan(1e-6); // back on the auto: where it was
  });
});

describe('createSet with borrowed lights', () => {
  const lightsOf = (g) => {
    const found = { spot: null, points: [] };
    g.traverse((o) => { if (o.isSpotLight) found.spot = o; else if (o.isPointLight) found.points.push(o); });
    return found;
  };

  it('puts the three lights where the set\'s own lights would be, with the same colour, strength and reach', () => {
    const own = new Scene();
    const ownSet = createSet(own, 20, 0.2, -30, 0.7);
    own.updateMatrixWorld(true);
    const ownLights = lightsOf(ownSet.group);
    expect(ownLights.points).toHaveLength(2);

    const scene = new Scene();
    const { auto } = autoWithHeadlight();
    scene.add(auto);
    const props = fakeProps();
    const bank = borrowLights({ scene, auto, props });
    const set = createSet(scene, 20, 0.2, -30, 0.7, bank);
    scene.updateMatrixWorld(true);
    // the set itself holds no light: they are the street's
    expect(lightsOf(set.group)).toEqual({ spot: null, points: [] });
    const key = bank.key;
    expect(worldPos(key).distanceTo(worldPos(ownLights.spot))).toBeLessThan(1e-6);
    expect(worldPos(key.target).distanceTo(worldPos(ownLights.spot.target))).toBeLessThan(1e-6);
    expect([key.intensity, key.distance, key.angle, key.penumbra, key.decay, key.color.getHex()]).toEqual([ownLights.spot.intensity, ownLights.spot.distance, ownLights.spot.angle, ownLights.spot.penumbra, ownLights.spot.decay, ownLights.spot.color.getHex()]);
    for (const [mine, theirs] of [[bank.pink, ownLights.points[0]], [bank.cyan, ownLights.points[1]]]) {
      expect(worldPos(mine).distanceTo(worldPos(theirs))).toBeLessThan(1e-6);
      expect([mine.intensity, mine.distance, mine.decay, mine.color.getHex()]).toEqual([theirs.intensity, theirs.distance, theirs.decay, theirs.color.getHex()]);
    }
    // leaving the showroom hands the lights back
    set.dispose();
    expect(props.log.at(-1)).toEqual(['unlend']);
    expect(auto.userData.headlightLent).toBe(false);
    expect(scene.children).not.toContain(set.group);
    ownSet.dispose();
  });

  it('adds its own three lights without a bank (the old behaviour: an auto with no headlight)', () => {
    const scene = new Scene();
    const set = createSet(scene, 0, 0, 0, 0, null);
    const l = lightsOf(set.group);
    expect(l.spot).toBeTruthy();
    expect(l.points).toHaveLength(2);
    expect(l.spot.target).toBeInstanceOf(Object3D);
    set.dispose();
  });
});
