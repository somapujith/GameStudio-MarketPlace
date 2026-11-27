// The uber material of the player's auto: the slot table, the uniform packing, the slot merge and the shader patch.
import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color, Float32BufferAttribute, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, ShaderLib } from 'three';
import { ATLAS_UV } from './auto-atlas.js';
import { SLOT, SLOT_COUNT, UBER_GROUPS, UBER_SLOTS, bindSlot, createUberDepthMaterial, createUberMaterial, createUberState, mergeSlots, packSlot, patchUberShader, syncUber } from './auto-uber.js';

const at = (arr, i) => Array.from(arr.slice(i * 4, i * 4 + 4)).map((x) => +x.toFixed(4));

describe('slot table', () => {
  it('names are unique, every merged group only names known slots, and only the roof casts and receives', () => {
    expect(new Set(UBER_SLOTS.map((s) => s.name)).size).toBe(SLOT_COUNT);
    for (const names of Object.values(UBER_GROUPS)) for (const n of names) expect(SLOT[n], n).toBeTypeOf('number');
    expect(UBER_SLOTS.filter((s) => s.cast).map((s) => s.name)).toEqual(['roof']);
    expect(UBER_SLOTS.filter((s) => s.recv).map((s) => s.name)).toEqual(['roof']);
    expect(UBER_SLOTS.filter((s) => s.unlit).map((s) => s.name).sort()).toEqual(['brake', 'hlLamp', 'tailLens', 'tailRef']);
    for (const s of UBER_SLOTS) if (s.cell) expect(ATLAS_UV[s.cell], s.name).toBeTruthy();
  });
});

describe('packSlot / syncUber', () => {
  it('copies a lit material: colour, emissive x intensity, roughness, metalness, env strength, visibility, shadow receiving', () => {
    const st = createUberState();
    const m = new MeshStandardMaterial({ color: new Color(0.5, 0.25, 1), emissive: new Color(1, 0.5, 0), emissiveIntensity: 2, roughness: 0.3, metalness: 0.7 });
    m.envMapIntensity = 0.125;
    packSlot(st, SLOT.roof, m, true);
    expect(at(st.a, SLOT.roof)).toEqual([0.5, 0.25, 1, 1]);
    expect(at(st.b, SLOT.roof)).toEqual([2, 1, 0, 0.125]);
    expect(at(st.c, SLOT.roof)).toEqual([0.3, 0.7, 1, 0]);
    packSlot(st, SLOT.chrome, m, false);
    expect(st.a[SLOT.chrome * 4 + 3]).toBe(0); // hidden
    expect(st.c[SLOT.chrome * 4 + 2]).toBe(0); // the chrome never received shadows
  });

  it('copies a lamp (MeshBasicMaterial) as an unlit colour', () => {
    const st = createUberState();
    const lamp = new MeshBasicMaterial({ color: new Color(2.4, 0.2, 0.15) });
    packSlot(st, SLOT.brake, lamp, true);
    expect(at(st.a, SLOT.brake)).toEqual([0, 0, 0, 1]);
    expect(at(st.b, SLOT.brake)).toEqual([2.4, 0.2, 0.15, 0]);
    expect(st.c[SLOT.brake * 4 + 3]).toBe(1);
  });

  it('syncs every binding by reference, honouring the visibility handles', () => {
    const st = createUberState();
    const seatM = new MeshStandardMaterial({ color: 0xff0000 });
    const stand = { visible: false }; // the textured stand-in mesh of a patterned seat
    const emblem = { visible: true };
    bindSlot(st, 'seat', seatM, stand, true);
    bindSlot(st, 'emblem', seatM, emblem);
    syncUber(st);
    expect(st.a[SLOT.seat * 4 + 3]).toBe(1);
    expect(st.a[SLOT.emblem * 4 + 3]).toBe(1);
    stand.visible = true;
    emblem.visible = false;
    seatM.color.setRGB(0, 1, 0);
    syncUber(st);
    expect(st.a[SLOT.seat * 4 + 3]).toBe(0); // the stand-in draws it now
    expect(st.a[SLOT.emblem * 4 + 3]).toBe(0);
    expect(at(st.a, SLOT.seat).slice(0, 3)).toEqual([0, 1, 0]);
  });
});

describe('mergeSlots', () => {
  it('tags each vertex with its slot, gives every vertex a colour and moves the uvs into the slot cell (or the white cell)', () => {
    const geos = { chrome: new BoxGeometry(1, 1, 1).toNonIndexed(), plates: new PlaneGeometry(1, 1).toNonIndexed(), matte: new BoxGeometry(1, 1, 1).toNonIndexed() };
    const n = geos.matte.attributes.position.count;
    geos.matte.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(0.2), 3));
    const g = mergeSlots(geos, ['chrome', 'matte', 'plates', 'missing-slot-is-skipped']);
    const slot = g.attributes.aSlot.array;
    const nc = geos.chrome.attributes.position.count;
    expect(g.attributes.position.count).toBe(nc + n + 6);
    expect(slot[0]).toBe(SLOT.chrome);
    expect(slot[nc]).toBe(SLOT.matte);
    expect(slot[nc + n]).toBe(SLOT.plates);
    const col = g.attributes.color.array;
    expect(col[0]).toBe(1); // chrome had no colour: white
    expect(col[nc * 3]).toBeCloseTo(0.2); // matte keeps its own
    const uv = g.attributes.uv.array;
    const w = ATLAS_UV.white;
    expect(uv[0]).toBeCloseTo((w.u0 + w.u1) / 2);
    const p = ATLAS_UV.plate;
    for (let i = (nc + n) * 2; i < uv.length; i += 2) {
      expect(uv[i]).toBeGreaterThanOrEqual(p.u0 - 1e-6);
      expect(uv[i]).toBeLessThanOrEqual(p.u1 + 1e-6);
      expect(uv[i + 1]).toBeGreaterThanOrEqual(p.v0 - 1e-6);
      expect(uv[i + 1]).toBeLessThanOrEqual(p.v1 + 1e-6);
    }
    // the source geometries are untouched (they are shared: the traffic auto and the stand-ins draw them)
    expect(geos.chrome.attributes.aSlot).toBeUndefined();
  });
});

describe('shader patch', () => {
  const standard = () => ({ uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader });

  it('reads colour / emissive / roughness / metalness / env strength / shadow receiving / unlit / visibility per slot', () => {
    const st = createUberState();
    const sh = standard();
    patchUberShader(sh, st);
    expect(sh.uniforms.uberA.value).toBe(st.a);
    expect(sh.vertexShader).toContain(`uniform vec4 uberA[ ${SLOT_COUNT} ]`);
    expect(sh.vertexShader).toContain('vColor.rgb *= uberA[ uberI ].rgb');
    expect(sh.vertexShader).toMatch(/project_vertex>\s*if \( uberA\[ uberI \]\.a < 0\.5 \)/);
    const f = sh.fragmentShader;
    expect(f).toContain('float roughnessFactor = vUberC.x;');
    expect(f).toContain('float metalnessFactor = vUberC.y;');
    expect(f).toContain('#define receiveShadow ( vUberC.z > 0.5 )');
    expect(f).toContain('outgoingLight = vUberB.rgb');
    expect(f).toContain('totalEmissiveRadiance = vUberB.rgb * uberTexel.rgb');
    expect(f).not.toContain('#include <envmap_physical_pars_fragment>');
    expect(f).toContain('vUberB.a'); // the env strength, per slot
    expect(f).not.toMatch(/\* envMapIntensity;/);
  });

  it('fails loudly when three renames a chunk it relies on', () => {
    const sh = standard();
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '');
    expect(() => patchUberShader(sh, createUberState())).toThrow(/roughnessmap_fragment/);
  });

  it('the materials share one program key and the uniform arrays; the depth material keeps only the casting slots', () => {
    const st = createUberState();
    const a = createUberMaterial(st);
    const b = createUberMaterial(st, { transparent: true, alphaTest: 0.05 });
    expect(a.vertexColors).toBe(true);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    const d = createUberDepthMaterial();
    const sh = { uniforms: {}, vertexShader: ShaderLib.depth.vertexShader, fragmentShader: ShaderLib.depth.fragmentShader };
    d.onBeforeCompile(sh);
    expect(sh.vertexShader).toContain('uberCast');
    expect(Array.from(sh.uniforms.uberCast.value)).toEqual(UBER_SLOTS.map((s) => (s.cast ? 1 : 0)));
  });
});
