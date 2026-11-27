import { describe, expect, it } from 'vitest';
import { BoxGeometry, DirectionalLight, Group, HemisphereLight, InstancedMesh, Mesh, MeshStandardMaterial, PointLight, Scene, SpotLight, Texture } from 'three';
import { buildWarmScene, compileParts, createWarmer, passMaterials, recipeKey, recipeOf } from './warm.js';
import { lightSet } from './light-sets.js';

const geo = new BoxGeometry(1, 1, 1);

/** A scene shaped like the game's: sun + hemi + a pool of lamp lights + the auto's headlight, groups of meshes that share materials. */
function city({ lamps = 4, lampsOn = 0 } = {}) {
  const scene = new Scene();
  const sun = new DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  scene.add(sun, new HemisphereLight());
  for (let i = 0; i < lamps; i++) {
    const l = new PointLight(0xffb35c, 0, 30, 2);
    l.visible = i < lampsOn;
    scene.add(l);
  }
  const wall = new MeshStandardMaterial();
  const buildings = new Group();
  for (let i = 0; i < 60; i++) buildings.add(new Mesh(geo, wall)); // 60 meshes, ONE program
  scene.add(buildings);
  const props = new Group();
  for (let i = 0; i < 5; i++) props.add(new Mesh(geo, new MeshStandardMaterial())); // 5 materials
  scene.add(props);
  const auto = new Group();
  auto.add(new Mesh(geo, wall), new Mesh(geo, new MeshStandardMaterial()));
  const head = new SpotLight(0xfff0c0, 0, 46);
  auto.add(head);
  scene.add(auto);
  const hidden = new Mesh(geo, new MeshStandardMaterial());
  hidden.visible = false;
  scene.add(hidden);
  return scene;
}

describe('recipeOf / recipeKey', () => {
  it('counts the visible lights the way three.js does, and the sun shadow', () => {
    expect(recipeOf(city({ lamps: 4, lampsOn: 0 }))).toEqual({ points: 0, spots: 1, shadow: true });
    expect(recipeOf(city({ lamps: 4, lampsOn: 3 }))).toEqual({ points: 3, spots: 1, shadow: true });
    const noShadow = city();
    noShadow.children[0].castShadow = false;
    expect(recipeOf(noShadow).shadow).toBe(false);
  });
  it('gives distinct keys to distinct light sets', () => {
    const keys = new Set([recipeKey({ points: 0, spots: 1, shadow: true }), recipeKey({ points: 5, spots: 1, shadow: true }), recipeKey({ points: 5, spots: 2, shadow: true }), recipeKey({ points: 5, spots: 1, shadow: false })]);
    expect(keys.size).toBe(4);
  });
});

describe('lightSet', () => {
  it('matches what the scene reports in each state of the game', () => {
    expect(lightSet('medium')).toEqual({ points: 0, spots: 1, shadow: true });
    expect(lightSet('medium', { night: true })).toEqual({ points: 3, spots: 1, shadow: true }); // POOL_LIGHTS.medium
    expect(lightSet('low', { night: true })).toEqual({ points: 2, spots: 1, shadow: false });
    expect(lightSet('high', { night: true, workshop: true })).toEqual({ points: 10, spots: 2, shadow: true });
    expect(lightSet('high', { workshop: true, baseSpots: 3 }).spots).toBe(4);
  });
});

describe('compileParts', () => {
  it('returns one object per distinct program: shared materials once, lights never, invisible objects included', () => {
    const scene = city();
    const parts = compileParts(scene);
    expect(parts.some((p) => p.isLight)).toBe(false);
    // wall (60 + 1 meshes) = 1, five prop materials = 5, the auto's own = 1, the hidden mesh = 1
    expect(parts).toHaveLength(8);
    expect(parts.some((p) => !p.visible)).toBe(true);
  });
  it('treats instanced meshes, vertex colours and receiving shadows as different programs of the same material', () => {
    const scene = new Scene();
    const m = new MeshStandardMaterial();
    const plain = new Mesh(geo, m);
    const inst = new InstancedMesh(geo, m, 4);
    const tinted = new InstancedMesh(geo, m, 4);
    tinted.setColorAt(0, { r: 1, g: 1, b: 1, toArray: (a, o) => { a[o] = a[o + 1] = a[o + 2] = 1; } });
    const receiving = new Mesh(geo, m);
    receiving.receiveShadow = true;
    scene.add(plain, new Mesh(geo, m), inst, tinted, receiving);
    expect(compileParts(scene)).toHaveLength(4);
  });
});

describe('buildWarmScene', () => {
  it('holds the recipe\'s lights, not the real scene\'s lamp pool, and leaves the real scene alone', () => {
    const real = city({ lamps: 8, lampsOn: 0 });
    const before = real.children.length;
    const warm = buildWarmScene(real, { points: 5, spots: 2, shadow: false });
    expect(recipeOf(warm)).toEqual({ points: 5, spots: 2, shadow: false });
    let dir = 0;
    let hemi = 0;
    warm.traverse((o) => { if (o.isDirectionalLight) dir++; if (o.isHemisphereLight) hemi++; });
    expect(dir).toBe(1);
    expect(hemi).toBe(1);
    expect(warm.fog).toBe(real.fog);
    expect(real.children.length).toBe(before);
    expect(recipeOf(real).points).toBe(0);
  });
  it('can build a set with no real point light to copy', () => {
    const real = new Scene();
    real.add(new DirectionalLight());
    expect(recipeOf(buildWarmScene(real, { points: 3, spots: 1, shadow: true }))).toEqual({ points: 3, spots: 1, shadow: true });
  });
});

/** A fake renderer that records what is compiled, under which target, and for how many "frames" each program takes to link. */
function fakeRenderer({ linkFrames = 0 } = {}) {
  const calls = [];
  const props = new Map();
  let target = null;
  let tick = 0;
  const introspected = [];
  return {
    calls,
    introspected,
    getRenderTarget: () => target,
    setRenderTarget: (t) => { target = t; },
    compile(part, camera, warmScene) {
      calls.push({ part, target, lights: recipeOf(warmScene) });
      const set = new Set();
      part.traverse((o) => {
        if (!o.isMesh) return;
        set.add(o.material);
        const prog = { isReady: () => tick >= linkFrames, getUniforms: () => { introspected.push(prog); } };
        props.set(o.material, { currentProgram: prog, programs: new Map([['k', prog]]) });
      });
      return set;
    },
    properties: { get: (m) => props.get(m) },
    advance: () => { tick++; },
  };
}

describe('createWarmer', () => {
  it('compiles every part against the recipe\'s light set, into a render target, and restores the target', async () => {
    const scene = city();
    const r = fakeRenderer();
    const w = createWarmer({ renderer: r, scene, camera: {}, getTarget: () => ({ id: 'composer' }) });
    const res = await w.warm({ points: 5, spots: 1, shadow: true }, { budgetMs: 1e9, pause: async () => {} });
    expect(res).toBe('done');
    expect(r.calls.length).toBe(compileParts(scene).length);
    expect(r.calls.every((c) => c.target && c.target.id === 'composer' && c.lights.points === 5)).toBe(true);
    expect(r.getRenderTarget()).toBe(null);
    expect(w.has({ points: 5, spots: 1, shadow: true })).toBe(true);
    // a second request for the same light set does nothing
    expect(await w.warm({ points: 5, spots: 1, shadow: true })).toBe('cached');
    expect(r.calls.length).toBe(compileParts(scene).length);
  });

  it('is incremental: objects added to the scene later are compiled by the next call, nothing is compiled twice', async () => {
    const scene = city();
    const r = fakeRenderer();
    const w = createWarmer({ renderer: r, scene, camera: {} });
    const set = { points: 0, spots: 1, shadow: true };
    await w.warm(set, { pause: async () => {} });
    const first = r.calls.length;
    expect(await w.warm(set)).toBe('cached');
    // a system installs more meshes while the game loads
    const extra = new MeshStandardMaterial();
    scene.add(new Mesh(geo, extra), new Mesh(geo, extra));
    expect(await w.warm(set, { pause: async () => {} })).toBe('done');
    expect(r.calls.length).toBe(first + 1); // two meshes, one material: one part
    // an edited material (an environment map added) is a new program: it is compiled again
    scene.children[scene.children.length - 1].material.envMap = {};
    scene.children[scene.children.length - 1].material.version++;
    await w.warm(set, { pause: async () => {} });
    expect(r.calls.length).toBe(first + 2);
    w.dispose();
  });

  it('forgets everything after a lost GPU context (reset): the next warm compiles it all again', async () => {
    const scene = city();
    const r = fakeRenderer();
    const w = createWarmer({ renderer: r, scene, camera: {} });
    const set = { points: 0, spots: 1, shadow: true };
    await w.warm(set, { pause: async () => {} });
    const once = r.calls.length;
    w.reset();
    expect(w.has(set)).toBe(false);
    expect(await w.warm(set, { pause: async () => {} })).toBe('done');
    expect(r.calls.length).toBe(once * 2);
    w.dispose();
  });

  it('reads every program\'s locations once, after it is linked, so the first draw does not', async () => {
    const scene = city();
    const r = fakeRenderer({ linkFrames: 2 });
    const w = createWarmer({ renderer: r, scene, camera: {} });
    await w.warm({ points: 0, spots: 1, shadow: true }, { budgetMs: 1e9, pause: async () => { r.advance(); } });
    expect(r.introspected.length).toBe(compileParts(scene).length);
    expect(new Set(r.introspected).size).toBe(r.introspected.length); // never twice
    expect(w.stats.programsRead).toBe(r.introspected.length);
    // a later light set re-uses the same programs in the fake: nothing is read again
    await w.warm({ points: 3, spots: 1, shadow: true }, { budgetMs: 1e9, pause: async () => {} });
    expect(w.stats.variants).toBe(2);
    w.dispose();
  });

  it('reads programs in batches (one round trip to the GPU pays for the whole batch) and waits while the game says it is busy', async () => {
    const scene = city();
    const r = fakeRenderer();
    const w = createWarmer({ renderer: r, scene, camera: {} });
    let busy = 3; // the game reports "busy" for the first three polls
    const order = [];
    const origCompile = r.compile;
    r.compile = (...a) => { order.push('compile'); return origCompile(...a); };
    let pauses = 0;
    await w.warm({ points: 0, spots: 1, shadow: true }, {
      budgetMs: 1e9,
      batch: 3,
      ready: () => (busy > 0 ? (busy--, false) : true),
      pause: async () => { pauses++; },
    });
    const parts = compileParts(scene).length;
    expect(r.introspected.length).toBe(parts);
    // 3 pauses while busy before the first compile, then one pause per full batch of reads (8 programs: 2 full batches)
    expect(pauses).toBeGreaterThanOrEqual(3 + Math.floor(parts / 3));
    expect(order.length).toBe(parts);
    w.dispose();
  });

  it('warms the scene\'s own light set when no recipe is given', async () => {
    const scene = city({ lamps: 4, lampsOn: 4 });
    const r = fakeRenderer();
    const w = createWarmer({ renderer: r, scene, camera: {}, getTarget: () => null });
    await w.warm(null, { budgetMs: 1e9, pause: async () => {} });
    expect(r.calls[0].lights.points).toBe(4);
    expect(r.calls[0].target).toBeTruthy(); // a throw-away render target stands in until the composer exists
    w.dispose();
  });

  it('takes a break when a slice runs over its budget', async () => {
    const scene = city();
    const r = fakeRenderer();
    let t = 0;
    const w = createWarmer({ renderer: r, scene, camera: {}, now: () => (t += 5) });
    let pauses = 0;
    await w.warm({ points: 0, spots: 1, shadow: true }, { budgetMs: 8, pause: async () => { pauses++; } });
    expect(pauses).toBeGreaterThan(5);
    w.dispose();
  });

  it('does not start more compiles while too many programs are still linking', async () => {
    const scene = city();
    const r = fakeRenderer({ linkFrames: 3 });
    const w = createWarmer({ renderer: r, scene, camera: {} });
    let pauses = 0;
    await w.warm({ points: 0, spots: 1, shadow: true }, {
      budgetMs: 1e9,
      maxPending: 2,
      pause: async () => { pauses++; r.advance(); },
    });
    // programs only become ready after 3 pauses: the warm had to wait for them before it could finish
    expect(pauses).toBeGreaterThanOrEqual(3);
    expect(w.has({ points: 0, spots: 1, shadow: true })).toBe(true);
    w.dispose();
  });

  it('stops at the next slice when cancelled and does not mark the set as warm', async () => {
    const scene = city();
    const r = fakeRenderer();
    const w = createWarmer({ renderer: r, scene, camera: {}, now: (() => { let t = 0; return () => (t += 10); })() });
    let n = 0;
    const res = await w.warm({ points: 2, spots: 1, shadow: true }, {
      budgetMs: 5,
      pause: async () => { if (++n === 2) w.cancel(); },
    });
    expect(res).toBe('cancelled');
    expect(w.has({ points: 2, spots: 1, shadow: true })).toBe(false);
    expect(r.calls.length).toBeLessThan(compileParts(scene).length);
    w.dispose();
  });
});

describe('warmTextures', () => {
  it('uploads every texture of the scene once, one per slice, and skips render targets and cube maps', async () => {
    const scene = new Scene();
    const img = { width: 4, height: 4 };
    const a = new Texture(img);
    const b = new Texture(img);
    const shared = new Texture(img);
    const m1 = new MeshStandardMaterial({ map: a, emissiveMap: shared });
    const m2 = new MeshStandardMaterial({ map: shared });
    const sky = { uniforms: { uMap: { value: b }, uTime: { value: 3 } }, isMaterial: true };
    scene.add(new Mesh(geo, m1), new Mesh(geo, m2), new Mesh(geo, sky));
    const rt = new Texture(img);
    rt.isRenderTargetTexture = true;
    scene.add(new Mesh(geo, new MeshStandardMaterial({ map: rt })));
    const noImage = new Texture();
    scene.add(new Mesh(geo, new MeshStandardMaterial({ map: noImage })));
    const uploaded = [];
    const w = createWarmer({ renderer: { ...fakeRenderer(), initTexture: (t) => uploaded.push(t) }, scene, camera: {} });
    let pauses = 0;
    const res = await w.warmTextures({ budgetMs: 0, pause: async () => { pauses++; } });
    expect(res).toBe('done');
    expect(new Set(uploaded)).toEqual(new Set([a, b, shared]));
    expect(uploaded).toHaveLength(3);
    expect(pauses).toBeGreaterThanOrEqual(3);
    // a second call has nothing left to do
    await w.warmTextures({ pause: async () => {} });
    expect(uploaded).toHaveLength(3);
    expect(w.stats.texturesUploaded).toBe(3);
  });
});

describe('passMaterials', () => {
  it('finds the materials of the post-processing passes but not the scene pass', () => {
    const a = new MeshStandardMaterial();
    const b = new MeshStandardMaterial();
    const c = new MeshStandardMaterial();
    const composer = {
      passes: [
        { isRenderPass: true, scene: city(), material: new MeshStandardMaterial() },
        { highPass: { material: a }, blurs: [{ x: b }], renderTarget: { isWebGLRenderTarget: true, texture: {} } },
        { fsQuad: { material: c } },
      ],
    };
    const found = passMaterials(composer);
    expect(new Set(found)).toEqual(new Set([a, b, c]));
    expect(passMaterials(null)).toEqual([]);
  });
});
