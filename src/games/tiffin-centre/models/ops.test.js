// Models of the operations layer (docs/TIFFIN_CENTRE_PLAN.md section 3b): burners, pan condition and tending on the station props, the prep counter's devices,
// flawed and broken dishes, the LPG gauge, batter buckets with a level, the inspector and the delivery rider, and the marks over customers' heads.
import { describe, it, expect } from 'vitest';
import { Box3, Vector3 } from 'three';
import { buildDish, QUALITIES, buildStationProp, buildStreetProp, countTriangles, disposeObject } from './index.js';
import { buildInspector, buildDeliveryBoy, officialSpec, OFFICIAL_MOODS, OFFICIAL_ROLES } from './inspector.js';
import { buildParcelBag, buildRegularStar } from './marks.js';
import { buildPrepSet, assignDevices, DEVICE_OF, ITEM_COLOR, PREP_DEVICES } from './cookware-prep.js';
import { buildTendProp, buildWaterGauge } from './cookware-tend.js';
import { beatOf } from './stations.js';
import { INGREDIENTS, STATION_KINDS } from '../../../../shared/tiffin-centre/catalog.js';

const meshes = (root, pred) => {
  const out = [];
  root.traverse((o) => {
    if (o.isMesh && pred(o)) out.push(o);
  });
  return out;
};
const isFlame = (o) => o.isMesh && o.material?.uniforms?.uPower !== undefined; // flame shader materials
const sizeOf = (o) => new Box3().setFromObject(o).getSize(new Vector3());

describe('burners, pan condition and tending on the station props', () => {
  it('every kind of station accepts setBurner / setPower / setHeat / playTend without throwing, at any value', () => {
    for (const kind of ['tawa', 'steamer', 'kadai', 'chai', 'prep']) {
      const p = buildStationProp(kind);
      for (const on of [true, false, true]) {
        p.setBurner(on, on ? 1 : 0);
        p.setPower(on);
        p.update(0.016, 1);
      }
      p.setBurner(true, 0.4);
      p.setHeat({ glow: 0.9, hot: 1, gunk: 1, water: 0.1, dry: true, stuck: true, torn: true });
      p.setHeat({});
      p.setHeat(null);
      for (const tk of ['wipe', 'skim', 'water', 'nonsense']) {
        p.playTend(tk, 0.5);
        p.playTend(tk, 1);
        p.playTend(tk, NaN);
      }
      p.dispose();
      p.setBurner(false); // safe after dispose
    }
  });

  it('a dead burner kills every flame and the steam of the dishes; a lit one brings them back, shorter on a low cylinder', () => {
    for (const kind of ['tawa', 'kadai', 'chai', 'prep']) {
      const p = buildStationProp(kind);
      if (kind === 'prep') p.setSlot(1, { st: 'cooking', item: 'sambar', progress: 0.5 });
      p.setBurner(true, 1);
      const lit = meshes(p.group, isFlame).filter((m) => m.visible);
      expect(lit.length, kind).toBeGreaterThan(0);
      for (const m of lit) expect(m.material.uniforms.uPower.value).toBe(1);
      p.setBurner(false);
      expect(meshes(p.group, isFlame).filter((m) => m.visible), kind).toHaveLength(0);
      const steaming = [];
      p.group.traverse((o) => {
        if (o.isPoints && o.visible) steaming.push(o);
      });
      expect(steaming, kind + ' steam').toHaveLength(0);
      p.setBurner(true, 0.5);
      for (const m of meshes(p.group, isFlame).filter((x) => x.visible)) expect(m.material.uniforms.uPower.value).toBeCloseTo(0.5, 9);
      p.dispose();
    }
  });

  it('the steamer stops with the power as well as with the gas, and a dry one makes no steam; its sight gauge follows the water', () => {
    const p = buildStationProp('steamer');
    p.setSlot(0, { st: 'cooking', dish: 'idly', progress: 0.5 });
    const steam = () => {
      let n = 0;
      p.group.traverse((o) => {
        if (o.isPoints && o.visible) n++;
      });
      return n;
    };
    expect(steam()).toBeGreaterThan(0);
    p.setPower(false);
    expect(steam()).toBe(0);
    p.setPower(true);
    expect(steam()).toBeGreaterThan(0);
    p.setHeat({ water: 0, dry: true });
    expect(steam()).toBe(0);
    p.setHeat({ water: 1, dry: false });
    expect(steam()).toBeGreaterThan(0);
    p.setBurner(false);
    expect(steam()).toBe(0);
    p.dispose();
  });

  it('the tawa shows its heat and burnt-on crust through the iron\'s shader uniforms', () => {
    const p = buildStationProp('tawa');
    const uniforms = () => {
      let u = null;
      p.group.traverse((o) => {
        if (o.isMesh && o.material?.userData?.tcUniforms?.uGunk) u = o.material.userData.tcUniforms;
      });
      return u;
    };
    const u = uniforms();
    expect(u).toBeTruthy();
    expect(u.uGunk.value).toBe(0);
    expect(u.uHot.value).toBe(0);
    p.setHeat({ glow: 0.95, hot: 1, gunk: 1 });
    expect(u.uGunk.value).toBe(1);
    expect(u.uHot.value).toBe(1);
    expect(u.uHeat.value).toBeGreaterThan(1);
    p.setHeat({ glow: 0.3, hot: 0, gunk: 0 });
    expect(u.uGunk.value).toBe(0);
    expect(u.uHeat.value).toBeLessThan(1);
    p.dispose();
  });

  it('the tend implements appear for their beat and hide when it ends: the pad over the iron, the skimmer over the oil, the jug over the pots', () => {
    for (const [kind, station] of [['wipe', 'tawa'], ['skim', 'kadai'], ['water', 'steamer']]) {
      const p = buildStationProp(station);
      const tends = [];
      p.group.traverse((o) => {
        if (o.name === `tend-${kind}`) tends.push(o);
      });
      expect(tends, kind).toHaveLength(1);
      expect(tends[0].visible).toBe(false);
      p.playTend(kind, 0.4);
      expect(tends[0].visible).toBe(true);
      const y0 = tends[0].userData.pad.position.y;
      p.playTend(kind, 0.6);
      expect(Number.isFinite(tends[0].userData.pad.position.y)).toBe(true);
      expect(y0).toBeGreaterThan(0.8); // over the counter, not at the floor
      p.playTend(kind, 1);
      expect(tends[0].visible).toBe(false);
      // the wrong beat for the station is ignored
      const other = buildStationProp(station === 'tawa' ? 'kadai' : 'tawa');
      other.playTend(kind, 0.5);
      other.dispose();
      p.dispose();
    }
    const gauge = buildWaterGauge();
    gauge.set(1);
    gauge.set(0);
    gauge.dispose();
    const prop = buildTendProp('wipe', { y: 1, z: 0 });
    prop.play(0.5);
    expect(prop.active).toBe(true);
    prop.hide();
    expect(prop.active).toBe(false);
    prop.dispose();
  });

  it('the hands\' action names map to the beats the slot models know (so the stall moves with the hands)', () => {
    expect(beatOf('tawa-pour')).toBe('pour');
    expect(beatOf('tawa-spread')).toBe('spread');
    expect(beatOf('tawa-oil')).toBe('oil');
    expect(beatOf('tawa-take')).toBe('take');
    expect(beatOf('tawa-fill')).toBe('fill');
    expect(beatOf('steamer')).toBe('lid');
    expect(beatOf('kadai')).toBe('skim');
    expect(beatOf('chai-pour')).toBe('pour');
    expect(beatOf('pour')).toBe('pour'); // already a beat name
  });
});

describe('flawed and broken dishes', () => {
  it('a torn or stuck dosa on the tawa is pale, with tears or crumbs; a clean one has neither; they go when the dosa is taken', () => {
    const p = buildStationProp('tawa');
    const flawMeshes = () => meshes(p.group, (o) => o.material?.color && o.material.type === 'MeshBasicMaterial' && o.geometry?.type === 'PlaneGeometry' && o.visible);
    const base = flawMeshes().length; // (the label plate is a plain plane too)
    p.setSlot(0, { st: 'ready', dish: 'dosa', progress: 1, burnFrac: 0 });
    expect(flawMeshes()).toHaveLength(base);
    p.setSlot(0, { st: 'ready', dish: 'dosa', progress: 1, burnFrac: 0, flaw: 'torn' });
    const torn = flawMeshes().length - base;
    expect(torn).toBeGreaterThanOrEqual(5); // tears + crumbs
    p.setSlot(0, { st: 'ready', dish: 'dosa', progress: 1, burnFrac: 0, flaw: 'stuck' });
    const stuck = flawMeshes().length - base;
    expect(stuck).toBeGreaterThan(0);
    expect(stuck).toBeLessThan(torn);
    p.setSlot(0, { st: 'empty' });
    expect(flawMeshes()).toHaveLength(base);
    // while it is still cooking the batter has not split yet
    p.setSlot(0, { st: 'cooking', dish: 'dosa', progress: 0.5, burnFrac: 0, flaw: 'torn' });
    expect(flawMeshes()).toHaveLength(base);
    p.dispose();
  });

  it('broken is a dish quality: every dish builds, in budget, torn about but sitting on its plate', () => {
    expect(QUALITIES).toContain('broken');
    for (const id of ['dosa', 'masala_dosa', 'podi_dosa', 'set_dosa', 'pesarattu', 'idly', 'poori', 'vada', 'mysore_bonda', 'mirchi_bajji', 'irani_chai', 'filter_coffee', 'osmania']) {
      const good = buildDish(id, 'good');
      const broken = buildDish(id, 'broken');
      expect(broken.userData.q).toBe('broken');
      expect(good.userData.q).toBe('good');
      expect(countTriangles(broken)).toBeLessThan(2600);
      const b = new Box3().setFromObject(broken);
      expect(b.min.y, id).toBeGreaterThan(-0.011);
      expect(countTriangles(broken), id).toBeGreaterThanOrEqual(countTriangles(good) - 1); // crumbs only add
      disposeObject(good);
      disposeObject(broken);
    }
    // an unknown quality is still a good dish
    expect(buildDish('dosa', 'nonsense').userData.q).toBe('good');
  });

  it('a broken dish is not a copy of the ok one: its food parts are displaced', () => {
    const a = buildDish('masala_dosa', 'ok');
    const b = buildDish('masala_dosa', 'broken');
    const pos = (g) => g.children.map((m) => Array.from(m.geometry.attributes.position.array.slice(0, 30)).join(','));
    expect(pos(b).join('|')).not.toBe(pos(a).join('|'));
    disposeObject(a);
    disposeObject(b);
  });
});

describe('the prep counter\'s devices', () => {
  it('every ingredient the engine can prep has a device and a colour', () => {
    for (const id of Object.keys(INGREDIENTS)) {
      expect(PREP_DEVICES, id).toContain(DEVICE_OF[id]);
      expect(ITEM_COLOR[id], id).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(STATION_KINDS.prep.slots).toBe(2);
  });

  it('a job uses the device of its item, and two jobs never share one', () => {
    expect(assignDevices(['batter_dosa', 'sambar'])).toEqual(['grinder', 'vessel']);
    expect(assignDevices(['coconut_chutney', null])[0]).toBe('stone');
    expect(assignDevices([null, 'poori_dough'])[1]).toBe('tray');
    for (const a of Object.keys(DEVICE_OF)) {
      for (const b of Object.keys(DEVICE_OF)) {
        const d = assignDevices([a, b]);
        expect(d[0]).not.toBe(d[1]);
        expect(PREP_DEVICES).toContain(d[0]);
        expect(PREP_DEVICES).toContain(d[1]);
        expect(d[0]).toBe(DEVICE_OF[a]); // the first job always gets its own
      }
    }
    expect(assignDevices([null, null])).toHaveLength(2);
  });

  it('the slot anchor follows the device: chutney is ground on the stone, sambar boils in the vessel, batter is ground in the grinder', () => {
    const set = buildPrepSet();
    const at = (i) => set.anchors[i].clone();
    set.setSlot(0, { st: 'cooking', item: 'batter_dosa', progress: 0.3 });
    set.setSlot(1, { st: 'cooking', item: 'sambar', progress: 0.3 });
    const grinder = at(0);
    const vessel = at(1);
    expect(grinder.x).toBeLessThan(vessel.x - 0.4);
    set.setSlot(0, { st: 'cooking', item: 'coconut_chutney', progress: 0.3 });
    const stone = at(0);
    expect(Math.abs(stone.x)).toBeLessThan(0.1);
    expect(stone.y).toBeLessThan(grinder.y); // the stone is low, the grinder tall
    // two sambars: the second goes to another device (it cannot share the vessel)
    set.setSlot(0, { st: 'cooking', item: 'sambar', progress: 0.3 });
    set.setSlot(1, { st: 'cooking', item: 'sambar', progress: 0.3 });
    expect(set.devices[0]).toBe('vessel');
    expect(set.devices[1]).not.toBe('vessel');
    set.dispose();
  });

  it('the grinder turns only while a batter job runs AND the power is on; a power cut stops it, a gas cut puts the flame out', () => {
    const set = buildPrepSet();
    expect(set.spinning).toBe(false);
    set.setSlot(0, { st: 'cooking', item: 'batter_idly', progress: 0.5 });
    expect(set.spinning).toBe(true);
    const stone = (() => {
      let m = null;
      set.group.traverse((o) => {
        if (o.isMesh && Math.abs(o.position.y - (0.82 + 0.19)) < 1e-6) m = o;
      });
      return m;
    })();
    expect(stone).toBeTruthy();
    const a0 = stone.rotation.y;
    set.update(0.1, 1);
    expect(stone.rotation.y).toBeGreaterThan(a0);
    set.setPower(false);
    expect(set.spinning).toBe(false);
    const a1 = stone.rotation.y;
    set.update(0.1, 1.1);
    expect(stone.rotation.y).toBe(a1);
    set.setPower(true);
    set.setSlot(0, { st: 'ready', item: 'batter_idly', progress: 1 });
    expect(set.spinning).toBe(false);
    // the vessel's flame follows the gas
    set.setSlot(1, { st: 'cooking', item: 'tea_decoction_milk', progress: 0.2 });
    const flames = () => meshes(set.group, isFlame).filter((m) => m.visible).length;
    expect(flames()).toBe(1);
    set.setBurner(false);
    expect(flames()).toBe(0);
    set.setBurner(true, 0.6);
    expect(flames()).toBe(1);
    set.dispose();
  });

  it('a ready job glows: its ring and portion bowls show in the item\'s colour, and go when it is collected', () => {
    const set = buildPrepSet();
    const glow = () => {
      let rings = 0;
      let bowls = 0;
      set.group.traverse((o) => {
        if (o.isMesh && o.visible && o.material?.blending === 2 && o.material.transparent && o.material.opacity > 0.02) rings++;
        if (o.isGroup && o.visible && o.children.length === 3 && o.children.every((c) => c.isMesh)) bowls++;
      });
      return { rings, bowls };
    };
    set.setSlot(0, { st: 'cooking', item: 'batter_dosa', progress: 0.5 });
    set.update(0.1, 1);
    expect(glow().bowls).toBe(0);
    set.setSlot(0, { st: 'ready', item: 'batter_dosa', progress: 1 });
    set.update(0.1, 1.2);
    expect(glow().bowls).toBe(1);
    expect(glow().rings).toBeGreaterThanOrEqual(1);
    set.setSlot(0, { st: 'empty' });
    set.update(0.1, 1.3);
    expect(glow().bowls).toBe(0);
    set.dispose();
  });

  it('the prop keeps its station-local footprint on the counter (1.3 m wide, under 0.7 m tall above the counter top)', () => {
    const p = buildStationProp('prep');
    const s = sizeOf(p.group);
    expect(s.x).toBeLessThan(1.5);
    expect(s.y).toBeLessThan(1.6);
    expect(p.slotAnchors).toHaveLength(2);
    p.dispose();
  });
});

describe('the cylinder and the batter buckets', () => {
  it('the LPG cylinder has a gauge and a leak flame: setLevel moves the needle, setLow shows the flame', () => {
    const lpg = buildStreetProp('lpg');
    expect(typeof lpg.setLevel).toBe('function');
    expect(typeof lpg.setLow).toBe('function');
    const needle = [];
    lpg.group.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters.width < 0.005) needle.push(o);
    });
    expect(needle).toHaveLength(1);
    lpg.setLevel(1);
    const full = needle[0].rotation.z;
    lpg.setLevel(0);
    const empty = needle[0].rotation.z;
    expect(empty).toBeGreaterThan(full); // swings from right (full) to left (empty)
    lpg.setLevel(-3);
    expect(needle[0].rotation.z).toBeCloseTo(empty, 9);
    lpg.setLevel(9);
    expect(needle[0].rotation.z).toBeCloseTo(full, 9);
    const flame = [];
    lpg.group.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'ConeGeometry') flame.push(o);
    });
    expect(flame).toHaveLength(1);
    expect(flame[0].visible).toBe(false);
    lpg.setLow(true);
    for (let i = 0; i < 20; i++) lpg.update(0.05, i * 0.05);
    lpg.setLow(false);
    expect(flame[0].visible).toBe(false);
    lpg.dispose();
    // one shared geometry bundle: building another is cheap and independent
    const a = buildStreetProp('lpg');
    const b = buildStreetProp('lpg');
    a.setLevel(0);
    b.setLevel(1);
    const nz = (x) => {
      let z = null;
      x.group.traverse((o) => {
        if (o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters.width < 0.005) z = o.rotation.z;
      });
      return z;
    };
    expect(nz(a)).not.toBe(nz(b));
    a.dispose();
    b.dispose();
  });

  it('a live batter bucket has a level that rises with the fill and a tint that turns sour; the plain ones are unchanged', () => {
    const b = buildStreetProp('batter-bucket', { dyn: true });
    expect(typeof b.setFill).toBe('function');
    const surf = [];
    b.group.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'CircleGeometry' && o.parent === b.group) surf.push(o);
    });
    expect(surf).toHaveLength(1);
    b.setFill(0, 0);
    expect(surf[0].visible).toBe(false);
    b.setFill(1, 0);
    expect(surf[0].visible).toBe(true);
    const top = surf[0].position.y;
    b.setFill(0.5, 0);
    expect(surf[0].position.y).toBeLessThan(top);
    expect(surf[0].position.y).toBeGreaterThan(0.05);
    const fresh = surf[0].material.color.clone();
    b.setFill(0.5, 1);
    const sour = surf[0].material.color;
    expect(sour.getHex()).not.toBe(fresh.getHex());
    expect(sour.b).toBeLessThan(fresh.b); // yellows
    // radius follows the bucket's taper: wider at the top
    b.setFill(1, 0);
    const rTop = surf[0].scale.x;
    b.setFill(0.2, 0);
    expect(surf[0].scale.x).toBeLessThan(rTop);
    b.dispose();
    expect(buildStreetProp('batter-bucket').setFill).toBeUndefined();
    expect(buildStreetProp('batter-bucket', { open: true }).setFill).toBeUndefined();
  });
});

describe('the inspector, the delivery rider and the marks over customers', () => {
  it('officials are deterministic men: an older man in a half-sleeve shirt with a lanyard; a young rider in a red tee and cap', () => {
    const a = officialSpec('inspector', 3);
    const b = officialSpec('inspector', 3);
    expect(JSON.stringify(a.outfit)).toBe(JSON.stringify(b.outfit));
    expect(a.params.gender).toBe('m');
    expect(a.outfit.top.kind).toBe('shirt');
    expect(a.outfit.extras.some((e) => e.id === 'lanyard')).toBe(true);
    const r = officialSpec('delivery', 3);
    expect(r.params.gender).toBe('m');
    expect(r.params.age).toBeLessThan(a.params.age);
    expect(r.outfit.top.color).toMatch(/#d3281c/i);
    expect(r.hair.headwear).toBe('cap');
    expect(OFFICIAL_ROLES).toEqual(['inspector', 'delivery']);
    expect(OFFICIAL_MOODS).toContain('walkaway');
  });

  it('builds with the customer API, stands about 1.7 m tall facing the cook, holds a clipboard (inspector) or a red bag (rider), and disposes', () => {
    for (const [make, prop] of [[buildInspector, 'clipboard'], [buildDeliveryBoy, 'delivery-bag']]) {
      const m = make(5);
      for (const k of ['group', 'setMood', 'setPatience', 'setExpression', 'setSpeaking', 'lookAt', 'update', 'dispose']) expect(m[k], k).toBeDefined();
      const s = sizeOf(m.group);
      expect(s.y).toBeGreaterThan(1.5);
      expect(s.y).toBeLessThan(2.0);
      let found = null;
      m.group.traverse((o) => {
        if (o.name === prop) found = o;
      });
      expect(found, prop).toBeTruthy();
      for (const mood of OFFICIAL_MOODS) {
        m.setMood(mood);
        expect(m.mood).toBe(mood);
        for (let i = 0; i < 4; i++) m.update(0.05, i * 0.05);
      }
      m.setMood('nonsense');
      expect(m.mood).toBe('waiting');
      m.setPatience(0.3);
      m.setSpeaking(800, 0.8);
      m.lookAt(new Vector3(0, 1.5, 3));
      m.update(0.05, 1);
      m.lookAt(null);
      expect(countTriangles(m.group)).toBeGreaterThan(1000);
      m.dispose();
    }
  });

  it('different seeds give different people; the same seed the same one', () => {
    const sig = (seed) => {
      const m = buildInspector(seed);
      const v = m.group.children[0].children[0];
      const out = `${sizeOf(m.group).y.toFixed(3)}|${countTriangles(m.group)}`;
      void v;
      m.dispose();
      return out;
    };
    expect(sig(1)).toBe(sig(1));
    const sigs = new Set([1, 2, 3, 4, 5, 6].map(sig));
    expect(sigs.size).toBeGreaterThan(1);
  });

  it('the parcel bag hangs along -y from the grip; the regular star is gold, flat on the z axis, and turns and bobs', () => {
    const bag = buildParcelBag(3);
    const s = sizeOf(bag.group);
    expect(s.y).toBeGreaterThan(0.2);
    expect(s.y).toBeLessThan(0.4);
    const b = new Box3().setFromObject(bag.group);
    expect(b.max.y).toBeGreaterThan(-0.02); // the handles are at the grip
    expect(b.min.y).toBeLessThan(-0.25);
    bag.update(0.016, 1);
    bag.dispose();
    const star = buildRegularStar();
    expect(star.group.name).toBe('regular-star');
    const ss = sizeOf(star.group);
    expect(ss.x).toBeGreaterThan(0.1);
    expect(ss.x).toBeLessThan(0.3);
    star.group.position.set(0, 2.1, 0);
    const bob = star.group.children[0];
    const ys = [];
    for (let i = 0; i < 40; i++) {
      star.update(0.05, i * 0.05);
      ys.push(bob.position.y);
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.01);
    expect(Math.max(...ys)).toBeLessThan(0.05);
    expect(star.group.position.y).toBe(2.1); // the owner's placement is never overwritten
    star.dispose();
  });
});
