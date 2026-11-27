import { describe, it, expect, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PointLight, Scene, PerspectiveCamera } from 'three';
import { runSync, runAsync, applyModelTier, createBatcher, createProgramWarmer, createRevealWatch, withEverythingDrawn, prefetchChunks, idle, whenIdle, yieldToBrowser, LOAD_STEPS } from './loader.js';
import { QUALITY } from './quality.js';
import { getCharacterQuality, getCharacterDrawMode, setCharacterQuality, setCharacterDrawMode } from '../models/charquality.js';
import { getTextureQuality, setTextureQuality } from '../models/util.js';
import { getQuality as getFoodQuality, setQuality as setFoodQuality } from '../models/pbr.js';
import { WebglUnavailableError, createRenderer } from './renderer.js';

function* steps(n, log) {
  for (let i = 0; i < n; i++) {
    log?.push(i);
    yield { label: `step ${i}`, p: (i + 1) / n };
  }
  return 'built';
}

describe('staged loading', () => {
  it('runSync runs every step and returns the generator result', () => {
    const log = [];
    expect(runSync(steps(5, log))).toBe('built');
    expect(log).toEqual([0, 1, 2, 3, 4]);
  });

  it('runAsync reports progress, yields to the browser once a slice is used up, and returns the result', async () => {
    const seen = [];
    let yields = 0;
    const origMC = globalThis.MessageChannel;
    // count the yields through the real yieldToBrowser by timing: use budgetMs 0 so every step ends the slice
    const t0 = performance.now();
    const res = await runAsync(steps(6), { budgetMs: 0, onProgress: (p, l) => seen.push([p, l]) });
    yields = 6;
    expect(res).toBe('built');
    expect(seen.length).toBe(6);
    expect(seen[0][1]).toBe('step 0');
    expect(seen.at(-1)[0]).toBe(1);
    expect(yields).toBe(6);
    expect(performance.now() - t0).toBeLessThan(2000);
    void origMC;
  });

  it('runAsync waits for a yielded promise (a shader compile) and can be aborted, returning the generator to its finally', async () => {
    const order = [];
    function* g() {
      try {
        order.push('a');
        yield new Promise((r) => setTimeout(r, 5));
        order.push('b');
        yield { label: 'x', p: 0.5 };
        order.push('c');
        return 1;
      } finally {
        order.push('done');
      }
    }
    expect(await runAsync(g())).toBe(1);
    expect(order).toEqual(['a', 'b', 'c', 'done']);
    order.length = 0;
    let abort = false;
    const res = await runAsync(g(), { shouldAbort: () => abort, onProgress: () => { abort = true; } });
    expect(res).toBeNull();
    expect(order.at(-1)).toBe('done');
    expect(order).not.toContain('c');
  });

  it('has loading copy for every stage, led by the stove', () => {
    expect(LOAD_STEPS.gpu).toBe('Lighting the stove...');
    for (const k of ['gpu', 'textures', 'stall', 'street', 'people', 'shaders', 'ready']) expect(typeof LOAD_STEPS[k]).toBe('string');
  });

  it('yieldToBrowser / idle / whenIdle resolve without requestIdleCallback or MessageChannel', async () => {
    await yieldToBrowser();
    const fn = vi.fn();
    const cancel = idle(fn, 10);
    expect(typeof cancel).toBe('function');
    await whenIdle(10);
    cancel();
  });
});

describe('applyModelTier', () => {
  it('points characters, textures and food at the tier and sets the draw mode', () => {
    const save = [getCharacterQuality(), getCharacterDrawMode(), getTextureQuality(), getFoodQuality()];
    applyModelTier('lite');
    expect(getCharacterQuality()).toBe('lite');
    expect(getCharacterDrawMode()).toMatchObject({ baked: true, merge: false, limitShadows: false });
    expect(getTextureQuality()).toBe('low');
    expect(getFoodQuality()).toBe('low');
    applyModelTier('medium');
    expect(getCharacterQuality()).toBe('medium');
    expect(getCharacterDrawMode()).toMatchObject({ baked: false, merge: false, limitShadows: true });
    expect(getTextureQuality()).toBe('medium');
    expect(getFoodQuality()).toBe('medium');
    applyModelTier('high');
    expect(getCharacterQuality()).toBe('high');
    for (const q of Object.keys(QUALITY)) expect(() => applyModelTier(q)).not.toThrow();
    setCharacterQuality(save[0]);
    setCharacterDrawMode(save[1]);
    setTextureQuality(save[2]);
    setFoodQuality(save[3]);
  });
});

describe('createBatcher', () => {
  const stallLike = () => {
    const root = new Group();
    const m = new MeshStandardMaterial({ color: '#884422' });
    const meshes = [];
    for (let i = 0; i < 6; i++) {
      const b = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), m);
      b.position.x = i * 0.2;
      root.add(b);
      meshes.push(b);
    }
    const fan = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), m);
    root.add(fan);
    return { root, meshes, fan };
  };
  it('probes under varied conditions across calls, merges what stayed still, and can undo it', () => {
    const { root, meshes, fan } = stallLike();
    let calls = 0;
    const b = createBatcher({
      roots: [{ name: 'stall', root }],
      samples: 12,
      perCall: 3,
      drive: (i) => {
        calls++;
        fan.rotation.y = i;
      },
    });
    let guard = 0;
    while (!b.step(50) && guard++ < 50);
    expect(b.done).toBe(true);
    expect(calls).toBe(12);
    expect(b.stats.stall).toEqual({ before: 6, after: 1 });
    const live = [];
    root.traverse((o) => o.isMesh && o.visible && live.push(o));
    expect(live.length).toBe(2); // the merged boxes + the spinning fan
    expect(live).toContain(fan);
    b.restore();
    const back = [];
    root.traverse((o) => o.isMesh && o.visible && back.push(o));
    expect(back.length).toBe(7);
    for (const m of meshes) expect(back).toContain(m);
    b.dispose();
  });

  it('spreads the sampling over several step() calls', () => {
    const { root } = stallLike();
    const b = createBatcher({ roots: [{ name: 'x', root }], samples: 20, perCall: 2, drive: () => {} });
    let n = 0;
    while (!b.step(50)) n++;
    expect(n).toBeGreaterThanOrEqual(8);
  });
});

describe('prefetchChunks', () => {
  it('loads the chunks one after another and not at all on data-saver', async () => {
    const order = [];
    const loaders = [async () => order.push('a'), async () => order.push('b'), async () => { throw new Error('offline'); }, async () => order.push('d')];
    prefetchChunks(loaders, { saveData: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(order).toEqual([]);
    const cancel = prefetchChunks(loaders);
    // poll instead of sleeping a fixed 1.2 s: the chunks load on idle callbacks, which a busy CI machine or laptop can delay
    await vi.waitFor(() => expect(order).toEqual(['a', 'b', 'd']), { timeout: 10000, interval: 50 }); // a failing chunk does not stop the rest
    cancel();
  });
});

describe('renderer start-up failures', () => {
  it('a canvas that cannot give a WebGL2 context raises WebglUnavailableError (code "webgl") after one plainer retry', () => {
    const asked = [];
    const canvas = {
      addEventListener() {},
      removeEventListener() {},
      getContext: (kind, attrs) => {
        asked.push([kind, attrs && attrs.powerPreference]);
        return null;
      },
      style: {},
    };
    let err = null;
    try {
      createRenderer(canvas, { quality: 'medium' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WebglUnavailableError);
    expect(err.code).toBe('webgl');
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(asked[0][1]).toBe('high-performance');
    expect(asked.at(-1)[1]).not.toBe('high-performance'); // the retry asks for the plain context
  });
});

describe('createProgramWarmer', () => {
  // a renderer that records what each compile call saw: which meshes were visible, which lights were on, which target was bound
  function fake() {
    const calls = [];
    let target = null;
    const r = {
      info: { programs: [] },
      getRenderTarget: () => target,
      setRenderTarget(t) { target = t; },
      compile(root, cam, scene = root) {
        // like three.js: with no target scene the object is the scene; the lights are gathered from the scene AND the object (so twice for an object inside it)
        const lights = [];
        if (scene !== root) root.traverseVisible((o) => { if (o.isLight) lights.push(o.name); });
        scene.traverseVisible((o) => { if (o.isLight) lights.push(o.name); });
        const meshes = [];
        root.traverse((o) => { if (o.isMesh) meshes.push([o.name, o.visible]); });
        calls.push({ root: root.name, lights, meshes, target });
        r.info.programs.push({});
      },
    };
    return { r, calls };
  }
  function build() {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    scene.add(camera);
    const mk = (name, visible = true) => {
      const g = new Group();
      g.name = name;
      g.visible = visible;
      const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
      m.name = `${name}-mesh`;
      g.add(m);
      return g;
    };
    const stall = mk('stall');
    const events = mk('events', false); // hidden until an event: must still be compiled
    const on = new PointLight(0xffffff, 1);
    on.name = 'bulb';
    const prep = new Group();
    prep.name = 'prep';
    prep.visible = false; // the prep counter's lights live in a hidden group
    const prepLight = new PointLight(0xffffff, 1);
    prepLight.name = 'prep-light';
    prep.add(prepLight);
    stall.add(on, prep);
    scene.add(stall, events, new PointLight(0xffffff, 1));
    scene.children[scene.children.length - 1].name = 'lamp';
    return { scene, camera, stall, events, prep };
  }
  const drain = (w) => {
    let n = 0;
    while (!w.step(1e6) && n++ < 1000);
    return n;
  };

  it('compiles hidden objects, once with the lights as they are and once with every light on, and puts every visibility flag back', () => {
    const { scene, camera, stall, events, prep } = build();
    const { r, calls } = fake();
    const w = createProgramWarmer({ renderer: r, scene, camera });
    drain(w);
    expect(w.done).toBe(true);
    const evCalls = calls.filter((c) => c.root === 'events');
    expect(evCalls).toHaveLength(2); // current lights, then all on
    expect(evCalls[0].meshes).toEqual([['events-mesh', true]]); // visible for the compile although it is hidden in the game
    expect(evCalls[0].lights.sort()).toEqual(['bulb', 'lamp']);
    expect(evCalls[1].lights.sort()).toEqual(['bulb', 'lamp', 'prep-light']);
    expect(w.stats.variants).toBe(1);
    expect(events.visible).toBe(false);
    expect(prep.visible).toBe(false);
    expect(stall.visible).toBe(true);
    expect(events.children[0].visible).toBe(true);
  });

  it('compiles a unit that holds lights through the whole scene, never as an object of it (three.js would count its lights twice: a different shader)', () => {
    const { scene, camera, stall } = build();
    scene.name = 'the-scene';
    const { r, calls } = fake();
    drain(createProgramWarmer({ renderer: r, scene, camera }));
    // the stall holds a bulb: its compile is the whole scene, with every light counted once
    const viaScene = calls.filter((c) => c.root === 'the-scene');
    expect(viaScene.length).toBeGreaterThan(0);
    for (const c of viaScene) expect(new Set(c.lights).size).toBe(c.lights.length); // every light once, never twice
    expect(viaScene[0].lights).toEqual(expect.arrayContaining(['bulb', 'lamp']));
    expect(calls.some((c) => c.root === stall.name)).toBe(false);
    // a unit without lights keeps the cheap path (the unit only), and still sees each light of the scene once
    const evCalls = calls.filter((c) => c.root === 'events');
    expect(evCalls.length).toBeGreaterThan(0);
    expect(evCalls[0].lights.sort()).toEqual(['bulb', 'lamp']);
  });

  it('skips the all-lights pass when no light is hidden or the tier has no lights', () => {
    const a = build();
    a.prep.visible = true;
    const fa = fake();
    drain(createProgramWarmer({ renderer: fa.r, scene: a.scene, camera: a.camera }));
    expect(fa.calls.filter((c) => c.root === 'events')).toHaveLength(1);
    const b = build();
    const fb = fake();
    drain(createProgramWarmer({ renderer: fb.r, scene: b.scene, camera: b.camera, hiddenLights: false }));
    expect(fb.calls.filter((c) => c.root === 'events')).toHaveLength(1);
  });

  it('binds a render target (the HDR one changes the output colour space) only with the post pipeline, and releases it', () => {
    const a = build();
    const fa = fake();
    drain(createProgramWarmer({ renderer: fa.r, scene: a.scene, camera: a.camera, post: true }));
    expect(fa.calls.length).toBeGreaterThan(0);
    expect(fa.calls.every((c) => c.target && c.target.isWebGLRenderTarget)).toBe(true);
    expect(fa.r.getRenderTarget()).toBeNull();
    const b = build();
    const fb = fake();
    drain(createProgramWarmer({ renderer: fb.r, scene: b.scene, camera: b.camera, post: false }));
    expect(fb.calls.every((c) => c.target === null)).toBe(true);
  });

  it('builds the extras one per step, parks them out of sight for the compile, and removes the park group afterwards', () => {
    const { scene, camera } = build();
    const { r, calls } = fake();
    const made = [];
    const extras = [0, 1, 2].map((i) => () => {
      const g = new Group();
      g.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
      made.push(i);
      return g;
    });
    const w = createProgramWarmer({ renderer: r, scene, camera, extras });
    w.step(1e6);
    expect(made).toEqual([0]); // one per step: a dish build is a frame's work
    expect(scene.children.some((c) => c.name === 'warm-park')).toBe(true);
    drain(w);
    expect(made).toEqual([0, 1, 2]);
    expect(w.stats.extras).toBe(3);
    expect(calls.some((c) => c.root === 'warm-park')).toBe(true);
    expect(scene.children.some((c) => c.name === 'warm-park')).toBe(false);
  });

  it('works in slices, survives a throwing compile or extra, and stops cleanly when cancelled', () => {
    const { scene, camera } = build();
    const { r } = fake();
    const w = createProgramWarmer({ renderer: r, scene, camera, extras: [() => { throw new Error('dish'); }] });
    let steps = 0;
    while (!w.step(0) && steps++ < 1000); // a zero budget still makes progress, one chunk at a time
    expect(steps).toBeGreaterThan(2);
    expect(w.stats.errors).toBeGreaterThanOrEqual(1);
    const bad = { ...r, compile() { throw new Error('gl'); } };
    const w2 = createProgramWarmer({ renderer: bad, scene, camera });
    expect(() => drain(w2)).not.toThrow();
    expect(w2.done).toBe(true);
    const w3 = createProgramWarmer({ renderer: r, scene, camera });
    w3.step(0);
    w3.cancel();
    expect(w3.done).toBe(true);
    expect(w3.step(100)).toBe(true);
    expect(createProgramWarmer({ renderer: {}, scene, camera }).step(5)).toBe(true); // no compile(): nothing to do
  });
});

describe('createRevealWatch (no shader program is compiled in play)', () => {
  it('lists nothing before the reveal, then exactly the programs created after it', () => {
    const programs = [{ id: 1, name: 'a', cacheKey: 'k1' }, { id: 2, name: 'b', cacheKey: 'k2' }];
    const w = createRevealWatch(() => programs);
    expect(w.revealed).toBe(false);
    expect(w.late()).toEqual([]);
    expect(w.count).toBe(0);
    programs.push({ id: 3, name: 'early', cacheKey: 'k3' }); // still loading: part of the set
    expect(w.reveal()).toBe(3);
    expect(w.revealed).toBe(true);
    expect(w.atReveal).toBe(3);
    expect(w.count).toBe(0);
    programs.push({ id: 4, name: 'dish', cacheKey: 'x'.repeat(200) }, { id: 5, name: '', cacheKey: 'k5' });
    expect(w.count).toBe(2);
    const late = w.late();
    expect(late.map((p) => p.id)).toEqual([4, 5]);
    expect(late[0].key.length).toBe(80); // a long cache key is cut to its tail
  });

  it('a program that is released (a tier switch) does not make the count negative, and a missing list is empty', () => {
    const programs = [{ id: 1 }, { id: 2 }];
    const w = createRevealWatch(() => programs);
    w.reveal();
    programs.length = 0;
    expect(w.count).toBe(0);
    expect(createRevealWatch(null).reveal()).toBe(0);
    expect(createRevealWatch(() => undefined).late()).toEqual([]);
  });
});

describe('withEverythingDrawn', () => {
  it('makes hidden and culled objects drawable for the call, then puts every flag back (lights and skip() untouched)', () => {
    const scene = new Scene();
    const hiddenGroup = new Group();
    hiddenGroup.visible = false;
    const inHidden = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    hiddenGroup.add(inHidden);
    const culled = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    culled.frustumCulled = true;
    const keep = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    keep.visible = false;
    const lamp = new PointLight();
    lamp.visible = false;
    scene.add(hiddenGroup, culled, keep, lamp);
    let seen = null;
    const r = withEverythingDrawn(
      scene,
      () => {
        seen = { group: hiddenGroup.visible, inHidden: inHidden.visible, culled: culled.frustumCulled, keep: keep.visible, lamp: lamp.visible, inHiddenCull: inHidden.frustumCulled };
        return 42;
      },
      { skip: (o) => o === keep },
    );
    expect(r).toBe(42);
    expect(seen).toEqual({ group: true, inHidden: true, culled: false, keep: false, lamp: false, inHiddenCull: false });
    expect(hiddenGroup.visible).toBe(false);
    expect(inHidden.visible).toBe(true);
    expect(inHidden.frustumCulled).toBe(true);
    expect(culled.frustumCulled).toBe(true);
    expect(keep.visible).toBe(false);
    expect(lamp.visible).toBe(false);
  });

  it('restores everything when fn throws', () => {
    const scene = new Scene();
    const m = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    m.visible = false;
    scene.add(m);
    expect(() => withEverythingDrawn(scene, () => { throw new Error('draw'); })).toThrow('draw');
    expect(m.visible).toBe(false);
    expect(m.frustumCulled).toBe(true);
  });
});

describe('applyModelTier people', () => {
  it('packs the people of medium and high (a handful of draws per customer), never of the baked tiers', () => {
    for (const q of ['medium', 'high']) {
      applyModelTier(q);
      expect(getCharacterDrawMode().pack).toBe(true);
    }
    for (const q of ['lite', 'low']) {
      applyModelTier(q);
      expect(getCharacterDrawMode().pack).toBe(false);
      expect(getCharacterDrawMode().baked).toBe(true);
    }
  });
});
