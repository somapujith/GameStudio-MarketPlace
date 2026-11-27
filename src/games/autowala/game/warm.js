// Shader warm-up. three.js builds a shader program per (material x lighting set x output target) the first time it is drawn, and the first
// draw BLOCKS: until the driver has linked the program (~100 ms on an integrated GPU, 150-250 programs in this city), and then while three.js
// reads the program's uniform and attribute locations (`program.getUniforms()`, a burst of GL queries per program).
// `renderer.compile` only starts the first part, and only for the state it is called in, so a warm-up must be told what the game will draw with:
//   - the OUTPUT TARGET: the game draws into the composer's render target (linear, no tone mapping); the canvas is a different program variant
//   - the LIGHT SET: the number of point / spot lights and whether the sun casts shadows are part of every lit program (a lamp pool that goes
//     on at dusk, the low tier without shadows are different variants; the workshop is NOT one: it borrows the street's lights) AND of every depth
//     program of the sun's shadow pass, which `renderer.compile` never builds: depthParts / depthStandIn below do
// This module compiles a given light set against a throw-away "warm scene" that holds clones of the lights (the real scene is never touched,
// so it can run while the game is playing), in small slices, waits for the driver (KHR_parallel_shader_compile) without blocking, and then
// reads every program's locations a few at a time, so the first draw finds everything ready.
import { BackSide, BufferGeometry, DoubleSide, FrontSide, Mesh, MeshDepthMaterial, PointLight, Scene, SpotLight, WebGLRenderTarget } from 'three';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Resolve after the browser has had a frame (the loading bar paints) and one more task. */
export const frameBreak = () =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });

/** A short pause in the middle of play: a timer, so a slow frame is not made slower. */
export const idleBreak = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const isRenderable = (o) => (o.isMesh || o.isPoints || o.isLine || o.isSprite) && !!o.material;

/**
 * What decides the program an object is drawn with, as a string: its material(s) (and their version, which changes when one is edited,
 * e.g. an environment map added) and the object kind: instanced, per-instance colours, vertex colours, receiving shadows...
 */
export function partKey(o) {
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const g = o.geometry;
  const a = g && g.attributes;
  const kind = o.isSprite ? 's' : o.isPoints ? 'p' : o.isLine ? 'l' : 'm';
  const sig = `${kind}${o.isInstancedMesh ? 1 : 0}${o.instanceColor ? 1 : 0}${o.receiveShadow ? 1 : 0}${a && a.color ? a.color.itemSize : 0}${a && a.tangent ? 1 : 0}${g && g.morphAttributes && g.morphAttributes.position ? 1 : 0}`;
  return `${mats.map((m) => `${m.id}.${m.version}${m.envMap ? 'e' : ''}`).join(',')}|${sig}`;
}

/**
 * One object per distinct program in `root`: the first mesh of every (material, object kind) combination. Two meshes with the same material
 * and the same instancing / vertex-colour / shadow flags use the same program, so compiling the second is wasted work. Lights are never parts
 * (the warm scene supplies them). Invisible objects count: they are drawn later.
 */
export function compileParts(root) {
  const seen = new Set();
  const out = [];
  root.traverse((o) => {
    if (!isRenderable(o)) return;
    const key = partKey(o);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(o);
  });
  return out;
}

// ---- the shadow pass. `renderer.compile` only builds the programs of the CAMERA pass; the sun's shadow pass draws every caster with a depth material
// (three's shared MeshDepthMaterial, or the object's `customDepthMaterial`) whose program key carries the SAME light counts as everything else, so a
// light set (the lamp pool at dusk) is also a set of depth programs: 5-7 of them, ~750 ms in one frame on an integrated GPU, at the first night frame.
// They are built here from stand-ins: a MeshDepthMaterial with what three's `getDepthMaterial` copies from the caster's material (side, map, alpha),
// drawn as "the caster" (a prototype-linked copy of the real object: same instancing / skinning / geometry, another material).

/** The side three.js draws a caster's depth with (WebGLShadowMap's `shadowSide`: the opposite face, against shadow acne). */
export function shadowSideOf(material) {
  if (material.shadowSide !== null && material.shadowSide !== undefined) return material.shadowSide;
  if (material.side === FrontSide) return BackSide;
  if (material.side === BackSide) return FrontSide;
  return DoubleSide;
}

/** The object's own part of a shadow program key: what `WebGLPrograms.getParameters` reads from the object (instancing, skinning, morphs). */
const objectSig = (o) => `${o.isInstancedMesh ? 1 : 0}${o.instanceColor ? 1 : 0}${o.isSkinnedMesh ? 1 : 0}${o.isBatchedMesh ? 1 : 0}${o.morphTexture ? 1 : 0}${o.geometry && o.geometry.morphAttributes && o.geometry.morphAttributes.position ? 1 : 0}`;

/** The material's part: what `getDepthMaterial` copies onto the shared depth material (side, alpha test and the maps it needs). */
const materialSig = (m) => `${shadowSideOf(m)}${m.alphaMap ? 1 : 0}${m.alphaTest > 0 || m.alphaToCoverage ? 1 : 0}${m.map ? 1 + ((m.map.channel | 0) || 0) : 0}${m.displacementMap && m.displacementScale !== 0 ? 1 : 0}`;

/**
 * One entry per distinct shadow-pass program in `root`: the casting meshes, by (depth material kind x instancing / skinning). Invisible casters count
 * (they are drawn later). `key` is stable across calls; a changed custom depth material (its version) is a new entry.
 */
export function depthParts(root) {
  const seen = new Set();
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.castShadow || !o.material) return;
    const custom = o.customDepthMaterial;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      const key = custom ? `c${custom.id}.${custom.version}|${objectSig(o)}` : `d${materialSig(m)}|${objectSig(o)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, object: o, material: m, custom: custom || null });
    }
  });
  return out;
}

/** A depth material equal to what three's shared one (`new MeshDepthMaterial()` in r187: no packing, the shadow map is a depth texture) is set to for a caster with `material`. */
export function depthStandIn(material) {
  const d = new MeshDepthMaterial();
  d.side = shadowSideOf(material);
  d.map = material.map;
  d.alphaMap = material.alphaMap;
  d.alphaTest = material.alphaToCoverage === true ? 0.5 : material.alphaTest;
  d.displacementMap = material.displacementMap;
  d.displacementScale = material.displacementScale;
  d.displacementBias = material.displacementBias;
  return d;
}

/** What decides which programs a lit material needs: point lights, spot lights and whether the sun casts a shadow. */
export function recipeKey(r) {
  return `p${r.points | 0}s${r.spots | 0}h${r.shadow ? 1 : 0}`;
}

/** The light set of a scene as it is right now (visible lights only, as three.js counts them). */
export function recipeOf(scene) {
  const r = { points: 0, spots: 0, shadow: false };
  scene.traverseVisible((o) => {
    if (o.isPointLight) r.points++;
    else if (o.isSpotLight) r.spots++;
    else if (o.isDirectionalLight && o.castShadow) r.shadow = true;
  });
  return r;
}

/**
 * A scene that holds only lights: every visible directional / hemisphere / ambient light of `real` cloned as it is (the sun's shadow flag
 * from the recipe), plus the recipe's point and spot lights (`points`, `spots` are totals; the real scene's own are not copied).
 * `bare`: no fog and no environment, which is what three's shadow pass draws with (it hands `renderBufferDirect` no scene, so the program key sees
 * an empty one: `fog` is a bit of every program key, even a depth material's, which ignores fog).
 */
export function buildWarmScene(real, recipe, { bare = false } = {}) {
  const warm = new Scene();
  warm.fog = bare ? null : real.fog;
  warm.environment = bare ? null : real.environment;
  let point = null;
  let spot = null;
  real.traverse((o) => {
    if (!o.isLight) return;
    if (o.isPointLight) {
      point = point || o;
      return;
    }
    if (o.isSpotLight) {
      spot = spot || o;
      return; // spot lights come from the recipe
    }
    if (!o.visible) return;
    const c = o.clone();
    if (o.isDirectionalLight) c.castShadow = !!recipe.shadow;
    warm.add(c);
  });
  for (let i = 0; i < (recipe.points | 0); i++) {
    const p = point ? point.clone() : new PointLight(0xffffff, 0, 30, 2);
    p.visible = true; // the real pool light may be off right now: the clone is the light set the recipe asks for
    warm.add(p);
  }
  for (let i = 0; i < (recipe.spots | 0); i++) {
    const s = spot ? spot.clone() : new SpotLight(0xffffff, 0);
    s.visible = true;
    s.castShadow = false;
    warm.add(s);
  }
  return warm;
}

/**
 * @param renderer  the WebGLRenderer
 * @param scene     the real scene
 * @param camera    the real camera
 * @param getTarget () => the render target the game draws into (the composer's), or null before it exists (a throw-away one is used)
 */
export function createWarmer({ renderer, scene, camera, getTarget = () => null, now = nowMs, shadowPass = true }) {
  let token = 0; // bumped by cancel(): every running warm stops at its next slice
  let dummy = null;
  const standIns = new Map(); // materialSig -> the depth material standing in for three's shared one
  /** The object `compile` is given for a shadow-pass program: the real caster (same instancing / skinning / geometry) drawn with its depth material. */
  const depthCaster = ({ object, material, custom }) => {
    let dm = custom;
    if (!dm) {
      const sig = materialSig(material);
      dm = standIns.get(sig);
      if (!dm) standIns.set(sig, (dm = depthStandIn(material)));
    }
    const shim = Object.create(object); // reads (geometry, instanceColor, skeleton...) fall through to the real object, which is never touched
    shim.material = dm;
    shim.children = [];
    return shim;
  };
  const variants = new Map(); // recipe key -> { parts: compiled part keys, materials, complete }
  let read = new WeakSet(); // programs whose locations were already read
  const stats = { variants: 0, parts: 0, programsRead: 0, compileMs: 0, readMs: 0, texturesUploaded: 0 };

  const target = () => {
    const t = getTarget();
    if (t) return t;
    dummy = dummy || new WebGLRenderTarget(2, 2);
    return dummy;
  };

  const isReady = (prog) => !prog || (prog.isReady ? prog.isReady() : true);

  /** Number of programs still being linked in the given material sets (and drop the finished ones). */
  const pending = (sets) => {
    let n = 0;
    for (const set of sets) {
      for (const m of set) {
        const p = renderer.properties.get(m);
        if (isReady(p && p.currentProgram)) set.delete(m);
        else n++;
      }
    }
    return n;
  };

  /**
   * Read the uniform / attribute locations of every linked program of these materials (what the first draw would otherwise do). Each of
   * these is a synchronous round trip to the GPU process, which first has to catch up with the frames already queued: the first read of a
   * batch pays that wait, the ones right behind it are cheap. So programs are read `batch` at a time with no frame in between.
   */
  async function readLocations(materials, { budgetMs, batch, pause, ready, mine }) {
    let slice = now();
    let inBatch = 0;
    for (const m of materials) {
      const props = renderer.properties.get(m);
      if (!props || !props.programs) continue;
      for (const prog of props.programs.values()) {
        if (read.has(prog) || !isReady(prog)) continue;
        while (!ready()) {
          await pause();
          if (mine !== token) return false;
          slice = now();
          inBatch = 0;
        }
        read.add(prog);
        const t = now();
        if (prog.getUniforms) prog.getUniforms();
        stats.programsRead++;
        stats.readMs += now() - t;
        if (++inBatch >= batch || now() - slice > budgetMs * 4) {
          await pause();
          if (mine !== token) return false;
          slice = now();
          inBatch = 0;
        }
      }
    }
    return true;
  }

  /**
   * Compile the light set `recipe` (null: the scene's own right now) for everything in the scene.
   * `budgetMs`: how long one slice may run before the page gets a break. `maxPending`: do not start more compiles while this many programs are
   * still linking (keeps the driver from flooding in the middle of a game). `pause`: how a break is taken.
   * Resolves 'done' | 'cached' | 'cancelled'.
   */
  async function warm(recipe = null, { budgetMs = 8, maxPending = Infinity, batch = 1e9, pause = frameBreak, ready = () => true } = {}) {
    const r = recipe || recipeOf(scene);
    const key = recipeKey(r);
    // incremental: what this light set has compiled already is remembered, so a second call (objects were added to the scene meanwhile)
    // compiles only the new parts, and a cancelled one carries on where it stopped
    const variant = variants.get(key) || { parts: new Set(), materials: new Set(), complete: false };
    variants.set(key, variant);
    // the camera pass's programs, then (where the sun casts shadows) the shadow pass's: `compile` object = the part itself, or a depth stand-in
    const jobs = compileParts(scene).filter((p) => !variant.parts.has(partKey(p))).map((p) => ({ id: partKey(p), object: p }));
    if (r.shadow && shadowPass) for (const d of depthParts(scene)) if (!variant.parts.has(`D:${d.key}`)) jobs.push({ id: `D:${d.key}`, object: depthCaster(d), depth: true });
    if (!jobs.length && variant.complete) return 'cached';
    const mine = token;
    const warmScene = buildWarmScene(scene, r);
    let depthScene = null; // the shadow pass's programs are keyed on an EMPTY scene (no fog): their own light-only scene
    const sets = [];
    const all = variant.materials;
    const t0 = now();
    let slice = t0;
    for (const job of jobs) {
      const part = job.object;
      if (mine !== token) return 'cancelled';
      // `ready()`: the game says whether now is a good moment (the last frame was not slow); `maxPending`: how many programs may be linking
      while (!ready() || (maxPending < Infinity && pending(sets) >= maxPending)) {
        await pause();
        if (mine !== token) return 'cancelled';
        slice = now();
      }
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target());
      try {
        if (job.depth && !depthScene) depthScene = buildWarmScene(scene, r, { bare: true });
        const set = renderer.compile(part, camera, job.depth ? depthScene : warmScene);
        for (const m of set) all.add(m);
        sets.push(set);
        variant.parts.add(job.id); // after the compile: it may bump a material's version
        stats.parts++;
      } finally {
        renderer.setRenderTarget(prev);
      }
      if (now() - slice > budgetMs) {
        await pause();
        slice = now();
      }
    }
    // the driver compiles in parallel: wait for the last of them without blocking
    while (pending(sets) > 0) {
      await pause();
      if (mine !== token) return 'cancelled';
    }
    stats.compileMs += now() - t0;
    if (!(await readLocations(all, { budgetMs, batch, pause, ready, mine }))) return 'cancelled';
    warmScene.traverse((o) => o.dispose?.());
    depthScene?.traverse((o) => o.dispose?.());
    if (!variant.complete) stats.variants++;
    variant.complete = true;
    return 'done';
  }

  let uploaded = new WeakSet();
  /**
   * Upload the scene's textures that are not on the GPU yet (shop signs, sky sprites, decals: anything not in the first view). A texture
   * first seen mid-game is uploaded in the frame that draws it, which for a big canvas texture is a few ms and for a street of shop signs
   * adds up to a hitch. One texture per slice.
   */
  async function warmTextures({ budgetMs = 3, pause = frameBreak, ready = () => true } = {}) {
    const mine = token;
    const list = new Set();
    const take = (t) => {
      if (t && t.isTexture && !t.isRenderTargetTexture && !t.isCubeTexture && !t.isData3DTexture && !t.isDataArrayTexture && t.image && !uploaded.has(t)) list.add(t);
    };
    scene.traverse((o) => {
      if (!isRenderable(o)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const k in m) take(m[k]);
        if (m.uniforms) for (const u of Object.values(m.uniforms)) take(u && u.value);
      }
    });
    for (const t of list) {
      while (!ready()) {
        await pause();
        if (mine !== token) return 'cancelled';
      }
      const a = now();
      uploaded.add(t);
      renderer.initTexture(t);
      stats.texturesUploaded++;
      if (now() - a > budgetMs) {
        await pause();
        if (mine !== token) return 'cancelled';
      }
    }
    return 'done';
  }

  /** Compile the materials the post-processing passes draw with (bloom, tone map...), which are not part of the scene. */
  async function warmMaterials(materials, { budgetMs = 8, pause = frameBreak } = {}) {
    const mine = token;
    const sets = [];
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target());
    try {
      for (const material of materials) sets.push(renderer.compile(materialProbe(material), camera, scene));
    } finally {
      renderer.setRenderTarget(prev);
    }
    while (pending(sets) > 0) {
      await pause();
      if (mine !== token) return 'cancelled';
    }
    return (await readLocations(materials, { budgetMs, batch: 1e9, pause, ready: () => true, mine })) ? 'done' : 'cancelled';
  }

  return {
    warm,
    warmMaterials,
    warmTextures,
    /** Can the driver compile in the background (KHR_parallel_shader_compile)? Without it a compile blocks, so only the loading screen should warm. */
    parallel: !!(renderer.extensions && renderer.extensions.has && renderer.extensions.has('KHR_parallel_shader_compile')),
    has: (recipe) => !!(variants.get(recipeKey(recipe)) || {}).complete,
    /** Stop everything that is running (a quality change or leaving the game). */
    cancel() {
      token++;
    },
    /** Forget what was compiled (the GPU context was lost and restored: every program and texture is gone). Stops what is running. */
    reset() {
      token++;
      variants.clear();
      for (const d of standIns.values()) d.dispose();
      standIns.clear();
      read = new WeakSet();
      uploaded = new WeakSet();
    },
    dispose() {
      token++;
      variants.clear();
      for (const d of standIns.values()) d.dispose();
      standIns.clear();
      if (dummy) dummy.dispose();
      dummy = null;
    },
    stats,
  };
}

/** A mesh to hand `renderer.compile` for a bare material (a post-processing pass draws a full-screen triangle with it). */
function materialProbe(material) {
  const m = new Mesh(new BufferGeometry(), material);
  m.frustumCulled = false;
  return m;
}

/** Every material a post-processing composer's passes will draw with (bloom blur / composite, tone map, copy). */
export function passMaterials(composer) {
  const found = new Set();
  const visit = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 3) return;
    if (v.isMaterial) {
      found.add(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    if (v.isObject3D || v.isWebGLRenderTarget || v.isTexture) return;
    for (const k of Object.keys(v)) visit(v[k], depth + 1);
  };
  for (const pass of composer?.passes || []) {
    if (pass.isRenderPass) continue; // draws the scene: covered by warm()
    visit(pass, 0);
    const quad = pass.fsQuad || pass._fsQuad;
    if (quad?.material) found.add(quad.material);
  }
  return [...found];
}
