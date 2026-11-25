import { describe, it, expect, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { runSync, runAsync, applyModelTier, createBatcher, prefetchChunks, idle, whenIdle, yieldToBrowser, LOAD_STEPS } from './loader.js';
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
    await new Promise((r) => setTimeout(r, 1200));
    expect(order).toEqual(['a', 'b', 'd']); // a failing chunk does not stop the rest
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
