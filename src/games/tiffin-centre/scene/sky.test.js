import { describe, it, expect } from 'vitest';
import { createSky } from './sky.js';

describe('sky dome draw order', () => {
  it('is drawn after the other opaque geometry with the depth test on, so it only shades the pixels nothing covered', () => {
    const sky = createSky({ clouds: 1, stars: true });
    expect(sky.mesh.renderOrder).toBeGreaterThanOrEqual(100); // opaque renderOrders in the scene are small
    expect(sky.material.depthTest).toBe(true);
    expect(sky.material.depthWrite).toBe(false);
    expect(sky.mesh.frustumCulled).toBe(false);
    sky.dispose();
  });
  it('keeps the cloud / star defines in step with the tier', () => {
    const sky = createSky({ clouds: 0, stars: false });
    expect(sky.material.defines.CLOUD_OCT).toBe(0);
    expect(sky.material.defines.NO_STARS).toBe(1);
    sky.setTier(2, true);
    expect(sky.material.defines.CLOUD_OCT).toBe(5);
    expect(sky.material.defines.NO_STARS).toBeUndefined();
    sky.dispose();
  });
});
