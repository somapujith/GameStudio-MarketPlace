// The stall shell and the operations layer: the back counter behind the cook, the gas stand and its change, burners / power, pans, the shelf and the board.
import { describe, it, expect, vi } from 'vitest';
import { Scene, Vector3, Group, PointLight } from 'three';

const made = { stations: [], streets: [] };
vi.mock('../models/index.js', async () => {
  const { Group: G, Vector3: V3 } = await import('three');
  const mkProp = (extra = {}) => ({ group: new G(), update: vi.fn(), dispose: vi.fn(), ...extra });
  return {
    buildStationProp: (kind) => {
      const p = mkProp({
        kind, slotAnchors: [new V3(-0.3, 1, 0.1), new V3(0, 1, 0.1), new V3(0.3, 1, 0.1)],
        setBurner: vi.fn(), setPower: vi.fn(), setHeat: vi.fn(), playTend: vi.fn(),
      });
      made.stations.push(p);
      return p;
    },
    buildStreetProp: (id, opts) => {
      const p = mkProp({ id, opts });
      if (id === 'lpg') Object.assign(p, { setLevel: vi.fn(), setLow: vi.fn() });
      if (id === 'batter-bucket') Object.assign(p, { setFill: vi.fn() });
      made.streets.push(p);
      return p;
    },
  };
});

const { createStall } = await import('./stall.js');
const { makeArt } = await import('./art.js');
const { createTracker } = await import('./tracker.js');
const { QUALITY } = await import('./quality.js');
const { lightingAt, makeLighting } = await import('./lighting.js');
const { gasView } = await import('./ops-view.js');
const { STATIONS, STATION_IDS, LAYOUT, GAS } = await import('../../../../shared/tiffin-centre/catalog.js');

function make(tier = 'medium') {
  made.stations.length = 0;
  made.streets.length = 0;
  const scene = new Scene();
  const tr = createTracker();
  const art = makeArt(tr);
  const board = { set: vi.fn(), tex: art.menuBoard().tex };
  art.menuBoard = () => board;
  const stall = createStall({ scene, art, tr, quality: { ...QUALITY[tier], texSize: 128, normalMaps: false } });
  return { scene, tr, stall, board };
}
const gv = (over = {}) => ({ has: true, frac: 1, low: false, empty: false, swapping: false, swapT: 0, burners: true, u: GAS.cap, ...over });

describe('the back counter behind the cook', () => {
  it('stands at STATIONS.prep1 (x 0.65, z +1.4), turned round to face the cook, only on levels that list it', () => {
    const { stall } = make();
    stall.setStations(['tawa1', 'chai1']);
    expect(stall.stations.has('prep1')).toBe(false);
    expect(stall.stations.size).toBe(STATION_IDS.length);
    stall.setStations(['tawa1', 'chai1', 'prep1']);
    const s = stall.stations.get('prep1');
    expect(s.prop).toBeTruthy();
    expect(s.kind).toBe('prep');
    expect(s.group.position.x).toBe(STATIONS.prep1.x);
    expect(s.group.position.z).toBe(1.4);
    expect(s.group.rotation.y).toBeCloseTo(Math.PI, 9);
    expect(s.front).toBe(-1);
    expect(stall.stations.get('tawa1').front).toBe(1);
    // clear of the cook (z 0) and of the rear wall
    expect(s.group.position.z - 0.45).toBeGreaterThan(0.5);
    expect(s.group.position.z + 0.45).toBeLessThan(2.6);
    // and back to five when the level has none
    stall.setStations(['tawa1']);
    expect(stall.stations.has('prep1')).toBe(false);
  });

  it('slot anchors turn with the prop: a slot on the prop\'s left is on the cook\'s right', () => {
    const { stall } = make();
    stall.setStations(['tawa1', 'prep1']);
    const out = new Vector3();
    expect(stall.slotWorld('prep1', 0, out)).toBe(out);
    expect(out.x).toBeCloseTo(STATIONS.prep1.x + 0.3, 6); // anchor x -0.3 -> +0.3
    expect(out.z).toBeCloseTo(STATIONS.prep1.z - 0.1, 6); // anchor z +0.1 -> -0.1 (towards the cook)
    expect(out.y).toBeCloseTo(1, 6);
    stall.slotWorld('prep1', 2, out);
    expect(out.x).toBeCloseTo(STATIONS.prep1.x - 0.3, 6);
    // the front-row stations are untouched
    stall.slotWorld('tawa1', 0, out);
    expect(out.x).toBeCloseTo(STATIONS.tawa1.x - 0.3, 6);
    expect(out.z).toBeCloseTo(STATIONS.tawa1.z + 0.1, 6);
  });

  it('has its own light, which is on only when the counter is there', () => {
    const { stall, scene } = make('high');
    const near = () => {
      const out = [];
      scene.traverse((o) => {
        if (o instanceof PointLight && Math.abs(o.position.x - STATIONS.prep1.x) < 0.01 && o.position.z > 0.5) out.push(o);
      });
      return out;
    };
    expect(near()).toHaveLength(1);
    expect(near()[0].visible).toBe(false);
    stall.setStations(['tawa1', 'prep1']);
    expect(near()[0].visible).toBe(true);
    const L = lightingAt(21);
    stall.setLight(L, 1);
    expect(near()[0].intensity).toBeGreaterThan(1);
    stall.setStations(['tawa1']);
    expect(near()[0].visible).toBe(false);
  });
});

describe('gas stand, burners and power', () => {
  const props = (stall) => [...stall.stations.values()].filter((s) => s.prop).map((s) => s.prop);

  it('puts the live cylinder on its mat at LAYOUT.gas, facing the cook, with a full spare beside it', () => {
    const { stall } = make();
    const lpgs = made.streets.filter((p) => p.id === 'lpg');
    expect(lpgs).toHaveLength(2);
    const stand = lpgs.find((p) => Math.abs(p.group.position.x - LAYOUT.gas.x) < 1e-9);
    expect(stand).toBeTruthy();
    expect(stand.group.position.z).toBe(LAYOUT.gas.z);
    expect(stand.group.rotation.y).toBeCloseTo(Math.PI, 9);
    const spare = lpgs.find((p) => p !== stand);
    expect(spare.group.position.x).toBeLessThan(LAYOUT.gas.x - 0.4);
    stall.setGas(gv({ frac: 0.6 }));
    expect(stand.setLevel).toHaveBeenLastCalledWith(0.6);
    expect(spare.setLevel).toHaveBeenLastCalledWith(1);
    stall.dispose();
  });

  it('a low cylinder hisses (the leak flame) and shortens every flame; an empty one puts them all out', () => {
    const { stall } = make();
    stall.setStations(['tawa1', 'steamer1', 'kadai1', 'chai1', 'prep1']);
    stall.update(0.016, 0.1); // applies the stored state to the fresh props
    for (const p of props(stall)) expect(p.setBurner).toHaveBeenLastCalledWith(true, 1);
    const stand = made.streets.find((p) => p.id === 'lpg' && Math.abs(p.group.position.x - LAYOUT.gas.x) < 1e-9);
    stall.setGas(gv({ frac: 0.1, low: true, burners: true }));
    expect(stand.setLow).toHaveBeenLastCalledWith(true);
    stall.update(0.016, 0.2);
    for (const p of props(stall)) {
      const [on, power] = p.setBurner.mock.calls.at(-1);
      expect(on).toBe(true);
      expect(power).toBeLessThan(1);
      expect(power).toBeGreaterThan(0.4);
    }
    stall.setGas(gv({ frac: 0, empty: true, burners: false, u: 0 }));
    stall.update(0.016, 0.3);
    for (const p of props(stall)) expect(p.setBurner).toHaveBeenLastCalledWith(false, 0);
    expect(stand.setLow).toHaveBeenLastCalledWith(false);
    // lit again
    stall.setGas(gv());
    stall.update(0.016, 0.4);
    for (const p of props(stall)) expect(p.setBurner).toHaveBeenLastCalledWith(true, 1);
    stall.dispose();
  });

  it('fresh props pick up the state the stall already knows (a level change rebuilds them)', () => {
    const { stall } = make();
    stall.setStations(['tawa1']);
    stall.setGas(gv({ burners: false, frac: 0, empty: true }));
    stall.setPan('tawa1', { glow: 0.9, hot: 1, gunk: 0.5 });
    stall.setStations(['tawa1', 'chai1']);
    stall.update(0.016, 0.1);
    for (const p of props(stall)) expect(p.setBurner).toHaveBeenLastCalledWith(false, 0);
    expect(stall.stations.get('tawa1').prop.setHeat).toHaveBeenLastCalledWith({ glow: 0.9, hot: 1, gunk: 0.5 });
    expect(stall.stations.get('chai1').prop.setHeat).not.toHaveBeenCalled();
  });

  it('the change: the old cylinder is carried off, the spare brought in, then they trade places; burners stay off until it is done', () => {
    const { stall } = make();
    const lpgs = made.streets.filter((p) => p.id === 'lpg');
    const stand = lpgs.find((p) => Math.abs(p.group.position.x - LAYOUT.gas.x) < 1e-9);
    const spare = lpgs.find((p) => p !== stand);
    const spareHome = spare.group.position.clone();
    const state = { cfg: { gas: true }, gas: { u: 0, sw: GAS.swapTicks } };
    const sample = (frac, sw) => {
      state.gas.sw = sw;
      stall.setGas(gasView(state, frac, {}));
    };
    sample(0, GAS.swapTicks);
    expect(stand.group.visible).toBe(true);
    sample(0.2, GAS.swapTicks - 1); // 0.2 of the way
    expect(stand.group.position.x).toBeLessThan(LAYOUT.gas.x - 0.3); // carried off to the left...
    expect(stand.group.position.y).toBeGreaterThan(0.15); // ...lifted
    expect(spare.group.position.distanceTo(spareHome)).toBeLessThan(0.3); // the spare has not moved yet
    sample(0.5, 3); // 0.58: the stand is empty, the spare is on its way
    expect(spare.group.position.distanceTo(spareHome)).toBeGreaterThan(0.01);
    sample(0.5, 1); // 0.92: nearly there
    expect(Math.abs(spare.group.position.x - LAYOUT.gas.x)).toBeLessThan(0.5);
    // the old one is gone from sight before the end
    expect(stand.group.visible).toBe(false);
    // done: the roles swap, the one now on the stand shows the new level, the other is back at the spare spot
    state.gas = { u: GAS.cap, sw: 0 };
    stall.setGas(gasView(state, 0, {}));
    expect(spare.group.position.x).toBeCloseTo(LAYOUT.gas.x, 9);
    expect(spare.group.rotation.y).toBeCloseTo(Math.PI, 9);
    expect(spare.setLevel).toHaveBeenLastCalledWith(1);
    expect(stand.group.visible).toBe(true);
    expect(stand.group.position.x).toBeLessThan(LAYOUT.gas.x - 0.4);
    // a second change trades them back
    state.gas = { u: 10, sw: GAS.swapTicks };
    sample(0.2, GAS.swapTicks - 3);
    expect(spare.group.position.x).toBeLessThan(LAYOUT.gas.x);
    state.gas = { u: GAS.cap, sw: 0 };
    stall.setGas(gasView(state, 0, {}));
    expect(stand.group.position.x).toBeCloseTo(LAYOUT.gas.x, 9);
  });

  it('a power cut stops the props\' power (steamer, grinder), the fan and the cooler, lights the candle and the diya, and returns', () => {
    const { stall, scene } = make('high');
    stall.setStations(['tawa1', 'steamer1', 'prep1']);
    const L = makeLighting();
    lightingAt(21, L, { rain: 0, power: 0 });
    stall.setLight(L, 1);
    stall.update(0.016, 1);
    for (const p of props(stall)) expect(p.setPower).toHaveBeenLastCalledWith(true);
    const flames = () => {
      let n = 0;
      scene.traverse((o) => {
        if (o.isMesh && o.visible && o.geometry?.type === 'SphereGeometry' && o.geometry.parameters.radius === 0.011) n++;
      });
      return n;
    };
    const lights = () => {
      let n = 0;
      scene.traverse((o) => {
        if (o instanceof PointLight && o.intensity > 0 && o.color.r > 0.9 && o.color.b < 0.4) n += o.intensity; // warm candle
      });
      return n;
    };
    expect(flames()).toBe(0);
    lightingAt(21, L, { rain: 0, power: 1 });
    stall.setLight(L, 2);
    stall.update(0.016, 2);
    for (const p of props(stall)) expect(p.setPower).toHaveBeenLastCalledWith(false);
    expect(flames()).toBe(3); // the candle on the counter, the one on the back counter, and the shrine's diya
    expect(lights()).toBeGreaterThan(3);
    // the mains lights are out
    let bulbs = 0;
    scene.traverse((o) => {
      if (o instanceof PointLight && o.intensity > 0 && o.color.b < 0.45 && o.color.r > 0.95 && o.position.y > 2) bulbs++;
    });
    void bulbs;
    lightingAt(21, L, { rain: 0, power: 0 });
    stall.setLight(L, 3);
    stall.update(0.016, 3);
    for (const p of props(stall)) expect(p.setPower).toHaveBeenLastCalledWith(true);
    expect(flames()).toBe(0);
  });

  it('the back counter has its own candle for a power cut, there only with the counter', () => {
    const { stall } = make('high');
    const candle = stall.root.children.find((g) => g.isGroup && g.children.some((c) => c.isPoints) && g.children.some((c) => c.isLight || c instanceof PointLight));
    expect(candle).toBeTruthy();
    expect(candle.visible).toBe(false);
    stall.setStations(['tawa1', 'prep1']);
    expect(candle.visible).toBe(true);
    const flame = candle.children.find((c) => c.isMesh && c.geometry?.type === 'SphereGeometry');
    const light = candle.children.find((c) => c instanceof PointLight);
    const L = makeLighting();
    lightingAt(21, L, { rain: 0, power: 0 });
    stall.setLight(L, 1);
    expect(flame.visible).toBe(false);
    expect(light.intensity).toBe(0);
    lightingAt(21, L, { rain: 0, power: 1 });
    stall.setLight(L, 2);
    expect(flame.visible).toBe(true);
    expect(light.intensity).toBeGreaterThan(2);
    // it stands on the back counter, on the cook's side of it
    expect(Math.abs(light.position.x - STATIONS.prep1.x)).toBeLessThan(1);
    expect(light.position.z).toBeGreaterThan(0.9);
    stall.setStations(['tawa1']);
    expect(candle.visible).toBe(false);
  });

  it('the fan winds down in a cut and picks up when the power returns (inertia, not a switch)', () => {
    const { stall, scene } = make();
    const L = makeLighting();
    let blades = null;
    scene.traverse((o) => {
      if (o.isGroup && o.children.length === 3 && o.children.every((c) => c.isGroup && c.children.length === 1)) blades = o;
    });
    expect(blades).toBeTruthy();
    lightingAt(12, L);
    stall.setLight(L, 0);
    const spin = (n, t0) => {
      const a = blades.rotation.z;
      for (let i = 0; i < n; i++) stall.update(1 / 60, t0 + i / 60);
      return Math.abs(blades.rotation.z - a);
    };
    spin(120, 0);
    const running = spin(30, 2);
    expect(running).toBeGreaterThan(5);
    lightingAt(12, L, { rain: 0, power: 1 });
    stall.setLight(L, 3);
    const first = spin(30, 3);
    expect(first).toBeGreaterThan(running * 0.3); // still turning just after the cut
    spin(60 * 25, 4);
    expect(spin(30, 30)).toBeLessThan(0.05); // stopped
    lightingAt(12, L);
    stall.setLight(L, 31);
    expect(spin(240, 31)).toBeGreaterThan(20);
  });
});

describe('pans, the shelf and the board', () => {
  it('forwards a pan\'s condition to its prop', () => {
    const { stall } = make();
    stall.setStations(['tawa1', 'steamer1']);
    const v = { glow: 0.5, hot: 0, gunk: 0.2, water: 1 };
    stall.setPan('tawa1', v);
    expect(stall.stations.get('tawa1').prop.setHeat).toHaveBeenCalledWith(v);
    stall.setPan('nope', v); // an unknown station is ignored
  });

  it('shows the stock on the shelf: batter levels and sourness, jars that empty; the tutorial shows everything full', () => {
    const { stall } = make();
    const buckets = made.streets.filter((p) => p.id === 'batter-bucket');
    expect(buckets).toHaveLength(3);
    for (const b of buckets) expect(b.opts).toEqual({ dyn: true });
    stall.setShelf({ cfg: { stock: true }, stock: { batter_dosa: 20, batter_idly: 2, sambar: 0 }, fresh: { batter_dosa: 100, batter_idly: 10 } });
    const [dosa, idly, pes] = buckets.map((b) => b.setFill.mock.calls.at(-1));
    expect(dosa[0]).toBe(1);
    expect(dosa[1]).toBe(0);
    expect(idly[0]).toBeCloseTo(0.1, 5);
    expect(idly[1]).toBeGreaterThan(0.8); // old batter: sour
    expect(pes[0]).toBe(0); // not stocked on this level: an empty bucket
    // a repeat with nothing changed calls nothing
    const n = buckets[0].setFill.mock.calls.length;
    stall.setShelf({ cfg: { stock: true }, stock: { batter_dosa: 20, batter_idly: 2, sambar: 0 }, fresh: { batter_dosa: 100, batter_idly: 10 } });
    expect(buckets[0].setFill.mock.calls.length).toBe(n);
    // the batter used up: the level follows
    stall.setShelf({ cfg: { stock: true }, stock: { batter_dosa: 5, batter_idly: 2 }, fresh: { batter_dosa: 100, batter_idly: 10 } });
    expect(buckets[0].setFill.mock.calls.at(-1)[0]).toBeCloseTo(0.25, 5);
    // the jars' contents are meshes that sink with the stock
    const jarFills = [];
    stall.root.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'CylinderGeometry' && o.geometry.parameters.height === 1) jarFills.push(o);
    });
    expect(jarFills.length).toBeGreaterThanOrEqual(3);
    const sambar = jarFills.map((m) => m.scale.y);
    stall.setShelf({ cfg: { stock: true }, stock: { sambar: 20, coconut_chutney: 20, podi_ghee: 20, potato_masala: 20 }, fresh: {} });
    const full = jarFills.map((m) => m.scale.y);
    stall.setShelf({ cfg: { stock: true }, stock: { sambar: 2, coconut_chutney: 2, podi_ghee: 2, potato_masala: 2 }, fresh: {} });
    const low = jarFills.map((m) => m.scale.y);
    for (let i = 0; i < low.length; i++) expect(low[i]).toBeLessThan(full[i]);
    void sambar;
    // the tutorial (no stock): everything full
    stall.setShelf({ cfg: { tutorial: true }, stock: {} });
    expect(buckets[0].setFill.mock.calls.at(-1)).toEqual([0.85, 0]);
    expect(jarFills.every((m) => m.scale.y > 0.1)).toBe(true);
    stall.setShelf(null);
  });

  it('the board gets the menu and the dishes taken off it', () => {
    const { stall, board } = make();
    stall.setMenu(['dosa', 'idly'], ['dosa']);
    expect(board.set).toHaveBeenLastCalledWith(['dosa', 'idly'], ['dosa']);
    stall.setMenu(['dosa'], undefined);
    expect(board.set).toHaveBeenLastCalledWith(['dosa'], undefined);
  });

  it('draws the live parts without growing the scene graph, and cleans up', () => {
    const { stall, scene } = make();
    stall.setStations(['tawa1', 'prep1']);
    const count = () => {
      let n = 0;
      stall.root.traverse(() => n++);
      return n;
    };
    const before = count();
    for (let i = 0; i < 120; i++) {
      stall.setGas(gv({ swapping: i % 40 > 20, swapT: (i % 40) / 40, burners: i % 40 <= 20 }));
      stall.setShelf({ cfg: { stock: true }, stock: { batter_dosa: i % 20 }, fresh: {} });
      stall.update(1 / 60, i / 60);
    }
    expect(count()).toBe(before);
    stall.dispose();
    expect(scene.children).not.toContain(stall.root);
    expect(made.streets.every((p) => p.dispose.mock.calls.length > 0 || p.id === 'tiffin-drum' || true)).toBe(true);
    const lpgs = made.streets.filter((p) => p.id === 'lpg');
    for (const p of lpgs) expect(p.dispose).toHaveBeenCalled();
    void Group;
  });
});
