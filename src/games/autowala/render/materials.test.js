import { describe, expect, it } from 'vitest';
import { BoxGeometry, InstancedMesh, MeshBasicMaterial } from 'three';
import { BUILDING_LOOKS, LOOK_NAMES, buildingMaterial, createShared, setLookAttribute } from './materials.js';
import { groupByChunk, setChunkSize, CHUNK } from './chunks.js';

describe('building looks', () => {
  it('has every look the world and the landmarks ask for, with complete facade values', () => {
    for (const n of ['bazaar', 'town', 'villa', 'glass', 'hangar', 'cyber', 'hosp']) expect(LOOK_NAMES).toContain(n);
    for (const l of Object.values(BUILDING_LOOKS)) {
      expect(l.cell).toHaveLength(2);
      expect(l.cell.every((v) => v > 0)).toBe(true);
      expect(l.ground).toBeGreaterThan(0);
      expect(l.glass).toMatch(/^#[0-9a-f]{6}$/i);
      expect(l.roughness).toBeGreaterThan(0);
      expect(l.roughness).toBeLessThanOrEqual(1);
    }
  });

  it('gives each instance its own look index on a private copy of the geometry', () => {
    const geo = new BoxGeometry(1, 1, 1);
    const mesh = new InstancedMesh(geo, new MeshBasicMaterial(), 3);
    setLookAttribute(mesh, ['glass', 'bazaar', 'not-a-look']);
    expect(mesh.geometry).not.toBe(geo);
    expect(geo.getAttribute('aLook')).toBeUndefined();
    const a = mesh.geometry.getAttribute('aLook');
    expect(Array.from(a.array)).toEqual([LOOK_NAMES.indexOf('glass'), LOOK_NAMES.indexOf('bazaar'), 0]);
    expect(a.isInstancedBufferAttribute).toBe(true);
  });

  it('is ONE shared material (one program) per flavour and world: matte Lambert walls, Standard glass towers', () => {
    const shared = createShared();
    const a = buildingMaterial(shared);
    const g = buildingMaterial(shared, true);
    expect(buildingMaterial(shared)).toBe(a);
    expect(buildingMaterial(shared, true)).toBe(g);
    expect(a).not.toBe(g);
    expect(a.isMeshLambertMaterial).toBe(true);
    expect(g.isMeshStandardMaterial).toBe(true);
    expect(a.customProgramCacheKey()).toBe('bldg-uber-matte');
    expect(g.customProgramCacheKey()).toBe('bldg-uber-glassy');
    // only the glass looks ask for the PBR flavour
    expect(LOOK_NAMES.filter((n) => BUILDING_LOOKS[n].glassy).sort()).toEqual(['cyber', 'glass']);
  });
});

describe('chunk size', () => {
  it('is a setting: groups by the current tile size and never below 128 m', () => {
    const before = CHUNK;
    const items = [{ x: 10, z: 10 }, { x: 300, z: 10 }, { x: 600, z: 10 }];
    const at = (i) => [i.x, i.z];
    setChunkSize(256);
    expect(groupByChunk(items, at).size).toBe(3);
    setChunkSize(512);
    expect(groupByChunk(items, at).size).toBe(2);
    setChunkSize(10);
    expect(CHUNK).toBe(128);
    setChunkSize(before);
  });
});
