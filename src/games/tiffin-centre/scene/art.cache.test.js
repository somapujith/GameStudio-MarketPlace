import { afterEach, describe, expect, it } from 'vitest';
import { makeArt, clearArtPixelCache, artPixelCacheBytes, PIXEL_CACHE_MAX_BYTES } from './art.js';
import { createTracker } from './tracker.js';

const quality = (texSize, normalMaps = true) => ({ texSize, normalMaps });

describe('art pixel cache (a second scene re-uses the baked pixels, never the Texture objects)', () => {
  afterEach(() => clearArtPixelCache());

  it('the second scene gets new Texture objects over the SAME pixel arrays, and disposing the first scene leaves them intact', () => {
    const tr1 = createTracker();
    const a1 = makeArt(tr1);
    a1.setQuality(quality(128));
    const s1 = a1.timber();
    expect(s1.map.isDataTexture).toBe(true);
    const bytes = artPixelCacheBytes();
    expect(bytes).toBeGreaterThan(0);

    const tr2 = createTracker();
    const a2 = makeArt(tr2);
    a2.setQuality(quality(128));
    const s2 = a2.timber();
    expect(s2).not.toBe(s1);
    expect(s2.map).not.toBe(s1.map); // each scene disposes its own GPU copies
    expect(s2.map.image.data).toBe(s1.map.image.data); // ... over one set of pixels: no second bake
    expect(s2.normalMap.image.data).toBe(s1.normalMap.image.data);
    expect(s2.ormMap.image.data).toBe(s1.ormMap.image.data);
    expect(artPixelCacheBytes()).toBe(bytes); // a hit adds nothing

    tr1.dispose();
    expect(s2.map.image.data.length).toBeGreaterThan(0);
    expect(s2.map.version).toBeGreaterThan(0); // flagged for upload
  });

  it('is keyed by the surface, the tier size and whether normals are baked', () => {
    const a = makeArt(createTracker());
    a.setQuality(quality(128));
    const small = a.timber();
    const b = makeArt(createTracker());
    b.setQuality(quality(256));
    const big = b.timber();
    expect(big.map.image.width).toBe(256);
    expect(big.map.image.data).not.toBe(small.map.image.data);
    const c = makeArt(createTracker());
    c.setQuality(quality(128, false));
    const flat = c.timber();
    expect(flat.normalMap).toBeNull();
    expect(flat.map.image.data).not.toBe(small.map.image.data);
    const d = makeArt(createTracker());
    d.setQuality(quality(128));
    expect(d.timber().map.image.data).toBe(small.map.image.data);
  });

  it('is capped, and can be emptied', () => {
    expect(PIXEL_CACHE_MAX_BYTES).toBeLessThanOrEqual(32 * 1024 * 1024);
    const a = makeArt(createTracker());
    a.setQuality(quality(128));
    a.steel();
    a.timber();
    expect(artPixelCacheBytes()).toBeGreaterThan(0);
    clearArtPixelCache();
    expect(artPixelCacheBytes()).toBe(0);
  });
});
