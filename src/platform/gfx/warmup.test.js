import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry, BufferAttribute, DataTexture, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, RGBAFormat, Scene, ShaderMaterial, UnsignedByteType, PerspectiveCamera,
} from 'three';
import { collectWarmupWork, formatCensus, materialCensus, maskBits, programCensus, warmRender, warmShaders } from './warmup.js';

const tex = () => {
  const t = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
};
const box = () => new BoxGeometry(1, 1, 1);

function sceneOf(n = 30) {
  const s = new Scene();
  const shared = new MeshStandardMaterial({ color: 0xff0000 });
  const mapped = new MeshStandardMaterial({ map: tex(), normalMap: tex() });
  for (let i = 0; i < n; i++) s.add(new Mesh(box(), i % 3 === 0 ? mapped : shared)); // two materials on many meshes
  s.add(new Mesh(box(), new MeshBasicMaterial({ color: 0x00ff00 })));
  s.add(new InstancedMesh(box(), shared, 4)); // same material, different program (instancing)
  return s;
}
const fakeRenderer = (opts = {}) => ({
  compile: vi.fn(),
  compileAsync: opts.sync ? undefined : vi.fn(() => Promise.resolve()),
  initTexture: vi.fn(),
  autoClear: true,
  getRenderTarget: () => null,
  setRenderTarget: vi.fn(),
  render: vi.fn(),
  ...opts.extra,
});

describe('collectWarmupWork', () => {
  it('one representative per (material, object-feature) combination, not per mesh', () => {
    const { reps, textures } = collectWarmupWork(sceneOf(30));
    // shared standard, mapped standard, basic, instanced(shared) = 4 distinct programs' worth
    expect(reps).toHaveLength(4);
    expect(textures).toHaveLength(2);
  });
  it('distinguishes geometry features that change the program (vertex colours, uv1)', () => {
    const s = new Scene();
    const m = new MeshStandardMaterial();
    const g1 = box();
    const g2 = box();
    g2.setAttribute('color', new BufferAttribute(new Float32Array(g2.attributes.position.count * 3), 3));
    s.add(new Mesh(g1, m), new Mesh(g2, m), new Mesh(box(), m));
    expect(collectWarmupWork(s).reps).toHaveLength(2);
  });
  it('multi-material meshes and the include() filter', () => {
    const s = new Scene();
    s.add(new Mesh(box(), [new MeshBasicMaterial(), new MeshStandardMaterial()]));
    s.add(new Mesh(box(), new MeshBasicMaterial()));
    expect(collectWarmupWork(s).reps).toHaveLength(2);
    expect(collectWarmupWork(s, { include: (o) => !Array.isArray(o.material) }).reps).toHaveLength(1);
  });
  it('picks up textures in ShaderMaterial uniforms, skips render-target textures', () => {
    const s = new Scene();
    const t = tex();
    const rtTex = tex();
    rtTex.isRenderTargetTexture = true;
    s.add(new Mesh(box(), new ShaderMaterial({ uniforms: { tA: { value: t }, tB: { value: rtTex }, x: { value: 1 } } })));
    expect(collectWarmupWork(s).textures).toEqual([t]);
  });
});

describe('warmShaders', () => {
  it('compiles each representative via compileAsync with the scene as lighting context and uploads textures, under a per-frame budget', async () => {
    const s = sceneOf(30);
    const r = fakeRenderer();
    let clock = 0;
    const frames = [];
    let frameCount = 0;
    // each job costs 1.5 ms of main thread (set up BEFORE the job starts: it runs its first slice synchronously)
    r.compileAsync.mockImplementation(() => { clock += 1.5; return Promise.resolve(); });
    r.initTexture.mockImplementation(() => { clock += 1.5; });
    const job = warmShaders(r, s, new PerspectiveCamera(), {
      budgetMs: 4,
      now: () => clock,
      nextFrame: async () => { frames.push(frameCount); frameCount++; clock += 16; },
    });
    const res = await job.promise;
    expect(res.compiled).toBe(4);
    expect(res.textures).toBe(2);
    expect(r.compileAsync).toHaveBeenCalledTimes(4);
    expect(r.compileAsync.mock.calls[0][2]).toBe(s);
    expect(r.initTexture).toHaveBeenCalledTimes(2);
    expect(res.cancelled).toBe(false);
    expect(job.progress).toBe(1);
    // 6 jobs x 1.5 ms with a 4 ms budget: 3 per slice (the check is after each job) -> 2 frame yields at most
    expect(frameCount).toBeLessThanOrEqual(5); // 2 slices + the 2 settle frames after the programs report ready
    expect(frameCount).toBeGreaterThanOrEqual(3);
  });
  it('slices big scenes: never more than budget+1 job per frame', async () => {
    const s = new Scene();
    for (let i = 0; i < 40; i++) s.add(new Mesh(box(), new MeshStandardMaterial({ color: i })));
    const r = fakeRenderer();
    let clock = 0;
    const perFrame = [];
    let count = 0;
    r.compileAsync.mockImplementation(() => { clock += 1; count++; return Promise.resolve(); });
    const job = warmShaders(r, s, new PerspectiveCamera(), {
      budgetMs: 3, textures: false, now: () => clock,
      nextFrame: async () => { perFrame.push(count); count = 0; clock += 16; },
    });
    await job.promise;
    expect(Math.max(...perFrame)).toBeLessThanOrEqual(4);
    expect(perFrame.length).toBeGreaterThanOrEqual(10);
  });
  it('reports progress per job', async () => {
    const seen = [];
    const job = warmShaders(fakeRenderer(), sceneOf(6), new PerspectiveCamera(), { nextFrame: async () => {}, onProgress: (p) => seen.push(p) });
    await job.promise;
    expect(seen.at(-1)).toMatchObject({ done: 6, total: 6 });
    expect(seen.some((p) => p.phase === 'programs')).toBe(true);
    expect(seen.some((p) => p.phase === 'textures')).toBe(true);
  });
  it('falls back to renderer.compile() when compileAsync does not exist', async () => {
    const r = fakeRenderer({ sync: true });
    const job = warmShaders(r, sceneOf(6), new PerspectiveCamera(), { nextFrame: async () => {} });
    const res = await job.promise;
    expect(r.compile).toHaveBeenCalledTimes(4);
    expect(res.compiled).toBe(4);
  });
  it('cancel() stops after the current slice and resolves', async () => {
    const s = new Scene();
    for (let i = 0; i < 30; i++) s.add(new Mesh(box(), new MeshStandardMaterial({ color: i })));
    const r = fakeRenderer();
    let job;
    let frames = 0;
    job = warmShaders(r, s, new PerspectiveCamera(), { budgetMs: 0, textures: false, nextFrame: async () => { frames++; if (frames === 3) job.cancel(); } });
    const res = await job.promise;
    expect(res.cancelled).toBe(true);
    expect(res.compiled).toBeLessThan(30);
    expect(res.compiled).toBeGreaterThanOrEqual(3);
  });
  it('a throwing compile is recorded, never thrown, and the rest still run', async () => {
    const r = fakeRenderer();
    let n = 0;
    r.compileAsync.mockImplementation(() => { if (n++ === 1) throw new Error('shader error'); return Promise.resolve(); });
    const res = await warmShaders(r, sceneOf(6), new PerspectiveCamera(), { nextFrame: async () => {} }).promise;
    expect(res.errors.join(' ')).toMatch(/shader error/);
    expect(res.compiled).toBe(3);
  });
  it('a rejected compileAsync promise is also swallowed into errors', async () => {
    const r = fakeRenderer();
    r.compileAsync.mockImplementation(() => Promise.reject(new Error('link failed')));
    const res = await warmShaders(r, sceneOf(3), new PerspectiveCamera(), { nextFrame: async () => {}, textures: false }).promise;
    expect(res.errors).toContain('link failed');
  });
  it('settleFrames: after the programs report ready the promise waits that many frames (default 2; 0 = none)', async () => {
    const run = async (settle) => {
      let frames = 0;
      const job = warmShaders(fakeRenderer(), sceneOf(3), new PerspectiveCamera(), { nextFrame: async () => { frames++; }, textures: false, budgetMs: 1e9, ...(settle === undefined ? {} : { settleFrames: settle }) });
      await job.promise;
      return frames;
    };
    expect(await run(0)).toBe(0);
    expect(await run(3)).toBe(3);
    expect(await run()).toBe(2);
  });
  it('an empty scene resolves immediately', async () => {
    const res = await warmShaders(fakeRenderer(), new Scene(), new PerspectiveCamera(), { nextFrame: async () => {} }).promise;
    expect(res).toMatchObject({ compiled: 0, textures: 0 });
  });
});

describe('warmRender', () => {
  it('renders once with frustum culling off and restores culling, target and autoClear', () => {
    const s = sceneOf(5);
    const meshes = [];
    s.traverse((o) => o.isMesh && meshes.push(o));
    const r = fakeRenderer();
    let culledDuring = null;
    r.render = vi.fn(() => { culledDuring = meshes.every((m) => m.frustumCulled === false); });
    const rtDispose = vi.fn();
    warmRender(r, s, new PerspectiveCamera(), { makeTarget: () => ({ dispose: rtDispose }) });
    expect(culledDuring).toBe(true);
    expect(meshes.every((m) => m.frustumCulled === true)).toBe(true);
    expect(r.setRenderTarget).toHaveBeenLastCalledWith(null);
    expect(rtDispose).toHaveBeenCalled();
  });
  it('restores state even when the render throws', () => {
    const s = sceneOf(2);
    const r = fakeRenderer();
    r.render = () => { throw new Error('lost'); };
    expect(() => warmRender(r, s, new PerspectiveCamera())).toThrow('lost');
    const m = s.children.find((c) => c.isMesh);
    expect(m.frustumCulled).toBe(true);
  });
});

// ---- census: programs shaped like three r187's WebGLProgram cache keys
function key({ shader = 'MeshStandardMaterial', dir = 1, point = 0, mapUv = 0, mask = 0, tone = 0, custom = '' } = {}) {
  const t = Array(53).fill(0);
  t[0] = 'highp';
  t[1] = 'srgb';
  t[6] = mapUv;
  t[35] = dir; // numDirLights is the 36th parameter push
  t[36] = point;
  t[49] = tone;
  return [shader, ...t, mask, 0, 'srgb', custom].join();
}
const prog = (id, name, cacheKey, usedTimes = 3) => ({ id, name, cacheKey, usedTimes });

describe('programCensus', () => {
  const programs = [
    prog(1, 'MeshStandardMaterial', key({ dir: 1 })),
    prog(2, 'MeshStandardMaterial', key({ dir: 2 })), // differs from #1 by the directional light count
    prog(3, 'MeshStandardMaterial', key({ dir: 1, mapUv: 'uv' })),
    prog(4, 'MeshStandardMaterial', key({ dir: 1, mask: 1 << 10 })), // vertexColors
    prog(5, 'MeshStandardMaterial', key({ dir: 3, point: 2, tone: 4, mapUv: 'uv', mask: 1 << 10 })), // far from the others
    prog(6, 'MeshBasicMaterial', key({ shader: 'MeshBasicMaterial' }), 1),
    prog(7, 'ShaderMaterial', 'a,b,c', 1),
    prog(8, 'ShaderMaterial', 'a,b,d', 1),
  ];
  const c = programCensus(programs);
  it('counts and groups by shader name', () => {
    expect(c.total).toBe(8);
    expect(c.byName).toEqual({ MeshStandardMaterial: 5, MeshBasicMaterial: 1, ShaderMaterial: 2 });
    expect(c.groups[0]).toMatchObject({ name: 'MeshStandardMaterial', count: 5 });
  });
  it('names the key tokens that vary within a group (light counts, uv channels, vertex colours)', () => {
    const std = c.groups.find((g) => g.name === 'MeshStandardMaterial');
    const labels = std.varying.map((v) => v.label);
    expect(labels).toContain('numDirLights');
    expect(labels).toContain('mapUv');
    expect(labels).toContain('featureMask');
    expect(std.varying.find((v) => v.label === 'featureMask').values.join(' ')).toMatch(/vertexColors/);
    expect(std.varying.find((v) => v.label === 'numDirLights').distinct).toBe(3);
  });
  it('flags near-duplicates: programs that differ by <= 2 tokens, with the differing tokens named', () => {
    const d = c.nearDuplicates.find((x) => x.a === 1 && x.b === 2);
    expect(d).toBeTruthy();
    expect(d.diff).toEqual([{ label: 'numDirLights', a: '1', b: '2' }]);
    expect(c.nearDuplicates.find((x) => x.a === 1 && x.b === 5)).toBeUndefined(); // 5 differs in many tokens
    expect(c.nearDuplicates.some((x) => x.name === 'ShaderMaterial')).toBe(true);
  });
  it('counts programs used by a single material', () => expect(c.rarelyUsed).toBe(3));
  it('reads renderer.info.programs', () => {
    expect(programCensus({ info: { programs } }).total).toBe(8);
    expect(programCensus({}).total).toBe(0);
    expect(programCensus(null).total).toBe(0);
  });
  it('formatCensus is a readable report', () => {
    const text = formatCensus(c);
    expect(text).toMatch(/^8 programs/);
    expect(text).toMatch(/numDirLights/);
    expect(text).toMatch(/near-duplicates/);
  });
  it('maskBits names the feature bits', () => {
    expect(maskBits((1 << 10) | 1)).toEqual(['instancing', 'vertexColors']);
    expect(maskBits(0)).toEqual([]);
  });
  it('handles 400 programs quickly', () => {
    const many = Array.from({ length: 400 }, (_, i) => prog(i, 'MeshStandardMaterial', key({ dir: i % 5, point: i % 7, mapUv: i % 3 })));
    const t0 = Date.now();
    const r = programCensus(many);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.nearDuplicates.length).toBeGreaterThan(0);
    expect(r.nearDuplicates.length).toBeLessThanOrEqual(60);
  });
});

describe('materialCensus', () => {
  it('estimates the program variants from the scene graph and finds shareable duplicates', () => {
    const s = new Scene();
    const t = tex();
    for (let i = 0; i < 6; i++) s.add(new Mesh(box(), new MeshStandardMaterial({ color: 0xaa5500, roughness: 0.7 }))); // six identical materials
    s.add(new Mesh(box(), new MeshStandardMaterial({ color: 0x00aa00, map: t })));
    s.add(new Mesh(box(), new MeshBasicMaterial({ color: 0x0000ff })));
    s.add(new InstancedMesh(box(), new MeshStandardMaterial({ color: 0x123456 }), 2));
    const c = materialCensus(s);
    expect(c.materials).toBe(9);
    expect(c.byType.MeshStandardMaterial).toBe(8);
    expect(c.estimatedPrograms).toBe(4); // plain standard, standard+map, basic, instanced standard
    expect(c.shareableDuplicates[0]).toMatchObject({ type: 'MeshStandardMaterial', count: 6 });
    expect(c.shareableCount).toBe(5);
    expect(c.split.MeshStandardMaterial.sort()).toEqual(['(plain)', 'instanced', 'map']);
  });
  it('an empty scene', () => expect(materialCensus(new Scene())).toMatchObject({ materials: 0, estimatedPrograms: 0 }));
});
