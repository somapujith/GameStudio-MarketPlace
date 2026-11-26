// Builds the real auto in node (a no-op canvas stub stands in for the DOM) and dresses it in every catalogue item: nothing may
// throw, previews must only touch what changed, and replaced parts must be disposed.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { DEFAULT_LOADOUT, OPTIONS, withPath } from '../gameplay/catalog.js';

function ctx2d() {
  let font = '12px x';
  const grad = { addColorStop() {} };
  const target = {
    measureText: (s) => ({ width: String(s).length * (parseFloat(font) || 12) * 0.55 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({}),
  };
  return new Proxy(target, {
    get: (t, k) => {
      if (k === 'font') return font;
      if (k in t) return t[k];
      return () => {};
    },
    set: (t, k, v) => {
      if (k === 'font') font = v;
      return true;
    },
  });
}

let build;
let custom;

beforeAll(async () => {
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d() }) };
  custom = await import('./customize.js');
  build = await import('./autoModel.js');
});
afterAll(() => {
  delete globalThis.document;
});

const countMeshes = (o) => {
  let n = 0;
  o.traverse((x) => { if (x.isMesh) n++; });
  return n;
};

describe('buildAuto', () => {
  it('builds the plain traffic auto and the full player rig with every handle', () => {
    const t = build.buildAuto({ color: '#2288ff', driver: false });
    expect(t.userData.paint.color.getHexString()).toBe('2288ff');
    expect(t.userData.detail).toBe(false);
    const p = build.buildAuto({ player: true });
    const ud = p.userData;
    for (const k of ['body', 'wheels', 'front', 'hlM', 'tailM', 'brakeM', 'headlight', 'driver', 'pax', 'paint', 'roofGroup', 'upperGroup', 'windowGroup',
      'cover', 'rearWin', 'flaps', 'mudguard', 'stripes', 'swish', 'underglow', 'plates', 'badge', 'bannerM', 'bumperMount', 'rearMount', 'roofMount',
      'dashAnchor', 'garlandAnchor', 'tailLampM', 'canopyGeometry', 'glass']) expect(ud[k], k).toBeTruthy();
    expect(ud.wheels).toHaveLength(2); // the front wheel, and both rear wheels as one spinning pair
    expect(ud.wheelParts).toHaveLength(2);
    expect(ud.tailM).not.toBe(ud.tailLampM); // the game writes tailM every frame; the visible lamps are separate
    expect(t.userData.tailM).toBe(t.userData.tailLampM); // traffic keeps the original contract
  });
  it('a bad colour string leaves the paint alone instead of warning', () => {
    const a = build.buildAuto({ color: 'bonalu-red', player: true });
    expect(a.userData.paint.color.getHexString()).toBe('ffc400');
  });
});

describe('applyLoadout', () => {
  it('is a no-op the second time, and safe on junk', () => {
    const a = build.buildAuto({ player: true });
    expect(custom.applyLoadout(a, DEFAULT_LOADOUT)).toEqual([]);
    for (const junk of [null, undefined, 3, 'x', {}, { paint: 5 }, { decals: { stripe: {} } }]) expect(() => custom.applyLoadout(a, junk)).not.toThrow();
    expect(custom.applyLoadout(null, DEFAULT_LOADOUT)).toEqual([]);
    expect(custom.applyLoadout({ userData: {} }, DEFAULT_LOADOUT)).toEqual([]);
  });

  it('every catalogue option applies without throwing, and only that field is reported', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = build.buildAuto({ player: true });
    for (const [path, list] of Object.entries(OPTIONS)) {
      for (const item of list) {
        const l = withPath(DEFAULT_LOADOUT, path, item.id);
        expect(() => custom.applyLoadout(a, l)).not.toThrow();
      }
    }
    for (const l of [
      withPath(DEFAULT_LOADOUT, 'rear.ladder', true), withPath(DEFAULT_LOADOUT, 'rear.antenna', true), withPath(DEFAULT_LOADOUT, 'rear.sideGuards', true),
      withPath(DEFAULT_LOADOUT, 'interior.garland', true), withPath(DEFAULT_LOADOUT, 'decals.rearWindow', 'DUBAI WHITE HOUSE'),
      withPath(DEFAULT_LOADOUT, 'decals.badge', 'MJ'), withPath(DEFAULT_LOADOUT, 'plate.text', 'KA01 AB1234'), DEFAULT_LOADOUT,
    ]) custom.applyLoadout(a, l);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('a preview rebuilds only what changed', () => {
    const a = build.buildAuto({ player: true });
    custom.applyLoadout(a, DEFAULT_LOADOUT, { force: true });
    const plateMap = a.userData.plateRearM.map;
    expect(plateMap).toBeTruthy();
    expect(custom.applyLoadout(a, withPath(DEFAULT_LOADOUT, 'paint.body', 'bonalu-red'))).toEqual(['paint.body']);
    expect(a.userData.plateRearM.map).toBe(plateMap); // the plate texture was not rebuilt
    expect(custom.applyLoadout(a, withPath(withPath(DEFAULT_LOADOUT, 'paint.body', 'bonalu-red'), 'plate.style', 'film'))).toEqual(['plate.style']);
    expect(a.userData.plateRearM.map).not.toBe(plateMap);
    expect(a.userData.plateRearM.emissiveIntensity).toBeGreaterThan(0);
  });

  it('maps colour and finish onto the paint material', () => {
    const a = build.buildAuto({ player: true });
    custom.applyLoadout(a, { ...DEFAULT_LOADOUT, paint: { body: 'neon-pink', roof: 'white', finish: 'pearl' } });
    const p = a.userData.paint;
    expect(p.color.getHexString()).toBe('ff3d9a');
    expect(p.iridescence).toBeGreaterThan(0);
    expect(p.sheen).toBe(1);
    expect(a.userData.roofM.color.getHexString()).toBe('eeeae0');
    custom.applyLoadout(a, { ...DEFAULT_LOADOUT, paint: { body: 'neon-pink', roof: 'white', finish: 'matte' } });
    expect(p.iridescence).toBe(0);
    expect(p.roughness).toBeGreaterThan(0.8);
    custom.applyLoadout(a, { ...DEFAULT_LOADOUT, paint: { body: 'neon-pink', roof: 'white', finish: 'chrome' } });
    expect(p.metalness).toBe(1);
  });

  it('the high canopy raises the roof, stretches the posts, and drops back', () => {
    const a = build.buildAuto({ player: true });
    const top = (mesh) => {
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox.max.y;
    };
    const roofMesh = a.userData.body.children.find((o) => o.isMesh && o.material === a.userData.roofM);
    const flatTop = top(roofMesh);
    const glassScale = a.userData.glass.scale.y;
    custom.applyLoadout(a, withPath(DEFAULT_LOADOUT, 'roofStyle', 'high-canopy'));
    expect(a.userData.roofGroup.position.y).toBeGreaterThan(0.2);
    expect(a.userData.upperGroup.scale.y).toBeGreaterThan(1.2);
    expect(a.userData.glass.scale.y).toBeGreaterThan(glassScale);
    // the merged roof / posts are the lifted bake now: same mesh, taller geometry
    expect(top(roofMesh)).toBeGreaterThan(flatTop + 0.25);
    custom.applyLoadout(a, DEFAULT_LOADOUT);
    expect(a.userData.roofGroup.position.y).toBe(0);
    expect(a.userData.upperGroup.scale.y).toBe(1);
    expect(top(roofMesh)).toBeCloseTo(flatTop, 6);
    expect(a.userData.glass.scale.y).toBe(glassScale);
  });

  it('props mount, animate and unmount cleanly', () => {
    const a = build.buildAuto({ player: true });
    const base = countMeshes(a);
    const env = { t: 1, dt: 0.016, speed: 12, hornTime: 0.2, jolt: 0.3, night: 0.6, braking: true };
    for (const id of ['flag', 'garland', 'speaker', 'led-bar', 'dome-lights']) {
      custom.applyLoadout(a, withPath(DEFAULT_LOADOUT, 'roofStyle', id));
      expect(countMeshes(a), id).toBeGreaterThan(base);
      expect(() => custom.updateCustomization(a, env)).not.toThrow();
    }
    custom.applyLoadout(a, DEFAULT_LOADOUT);
    expect(countMeshes(a)).toBe(base);
    for (const id of ['cricketer', 'hanuman', 'ganesh', 'cow', 'dancer', 'lucky-cat']) {
      custom.applyLoadout(a, withPath(DEFAULT_LOADOUT, 'decals.dash', id));
      expect(a.userData.dashAnchor.children.length, id).toBe(1);
      custom.updateCustomization(a, env);
    }
    custom.applyLoadout(a, DEFAULT_LOADOUT);
    expect(a.userData.dashAnchor.children.length).toBe(0);
    expect(countMeshes(a)).toBe(base);
  });

  it('rear parts mount and unmount; the rainbow cover and underglow animate', () => {
    const a = build.buildAuto({ player: true });
    const base = countMeshes(a);
    const full = { ...DEFAULT_LOADOUT, rear: { cover: 'led-rainbow', bumper: 'spiked', flaps: 'peacock', ladder: true, antenna: true, sideGuards: true }, lights: { head: 'cyan', under: 'rainbow', tail: 'cyan' } };
    custom.applyLoadout(a, full);
    expect(countMeshes(a)).toBeGreaterThan(base);
    expect(a.userData.underglow.group.visible).toBe(true);
    const c0 = a.userData.cover.face.material.color.getHex();
    custom.updateCustomization(a, { t: 0, dt: 0.016, speed: 0, hornTime: 0, jolt: 0, night: 1, braking: false });
    const u0 = a.userData.underglow.tubeM.color.getHex();
    custom.updateCustomization(a, { t: 3, dt: 0.016, speed: 0, hornTime: 0, jolt: 0, night: 1, braking: false });
    expect(a.userData.underglow.tubeM.color.getHex()).not.toBe(u0);
    expect(a.userData.cover.face.material.color.getHex()).not.toBe(c0);
    custom.applyLoadout(a, DEFAULT_LOADOUT);
    expect(a.userData.underglow.group.visible).toBe(false);
    expect(a.userData.cover.face.material).toBe(a.userData.cover.faceM);
    expect(countMeshes(a)).toBe(base); // the stock bumper replaces the spiked one, the rest is gone
    custom.disposeCustomization(a);
  });

  it('the side stripes and the swish are ONE mesh each, wound so every face points out, and shown / hidden together', () => {
    const a = build.buildAuto({ player: true });
    for (const pair of [a.userData.stripes, a.userData.swish]) {
      expect(pair.left).toBe(pair.right);
      const g = pair.left.geometry;
      expect(g.attributes.position.count).toBe(12); // two planes, two triangles each
      const P = g.attributes.position;
      const N = g.attributes.normal;
      for (let t = 0; t < 12; t += 3) {
        const [p0, p1, p2] = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(P, t + k));
        const face = p1.clone().sub(p0).cross(p2.clone().sub(p0)).normalize();
        const n = new Vector3().fromBufferAttribute(N, t);
        expect(face.dot(n)).toBeGreaterThan(0.99); // winding agrees with the normal (a mirrored plane that kept its old winding would be culled)
        const cx = (p0.x + p1.x + p2.x) / 3;
        expect(Math.sign(n.x)).toBe(Math.sign(cx)); // right plane faces +x, left plane faces -x
      }
    }
    custom.applyLoadout(a, withPath(DEFAULT_LOADOUT, 'decals.stripe', 'flame'));
    expect(a.userData.stripes.left.visible).toBe(true);
    custom.applyLoadout(a, withPath(DEFAULT_LOADOUT, 'decals.stripe', 'rainbow-swish'));
    expect(a.userData.stripes.left.visible).toBe(false);
    expect(a.userData.swish.left.visible).toBe(true);
    custom.applyLoadout(a, DEFAULT_LOADOUT);
    expect(a.userData.swish.left.visible).toBe(false);
  });

  it('bolt-on parts never cast shadows (each caster is a shadow-pass draw call)', () => {
    const a = build.buildAuto({ player: true });
    custom.applyLoadout(a, { ...DEFAULT_LOADOUT, rear: { cover: 'led-rainbow', bumper: 'spiked', flaps: 'peacock', ladder: true, antenna: true, sideGuards: true }, roofStyle: 'dome-lights', decals: { ...DEFAULT_LOADOUT.decals, dash: 'ganesh' }, interior: { seats: 'leopard', garland: true } });
    let props = 0;
    for (const mount of [a.userData.rearMount, a.userData.bumperMount, a.userData.roofMount, a.userData.dashAnchor, a.userData.garlandAnchor]) {
      mount.traverse((o) => {
        if (o.isMesh) {
          props++;
          expect(o.castShadow).toBe(false);
        }
      });
    }
    expect(props).toBeGreaterThan(10);
  });

  it('the tail lamps follow the loadout colour and brighten on the brake', () => {
    const a = build.buildAuto({ player: true });
    custom.applyLoadout(a, withPath(DEFAULT_LOADOUT, 'lights.tail', 'cyan'));
    custom.updateCustomization(a, { t: 0, dt: 0.016, speed: 0, hornTime: 0, jolt: 0, night: 0, braking: false });
    const idle = a.userData.tailLampM.color.b;
    custom.updateCustomization(a, { t: 0, dt: 0.016, speed: 0, hornTime: 0, jolt: 0, night: 0, braking: true });
    expect(a.userData.tailLampM.color.b).toBeGreaterThan(idle);
    expect(a.userData.tailLampM.color.b).toBeGreaterThan(a.userData.tailLampM.color.r);
  });

  it('traffic autos accept colour changes too', () => {
    const t = build.buildAuto({ color: '#2288ff', driver: false });
    expect(() => custom.applyLoadout(t, withPath(DEFAULT_LOADOUT, 'paint.body', 'pista-green'))).not.toThrow();
    expect(t.userData.paint.color.getHexString()).toBe('93c572');
  });
});
