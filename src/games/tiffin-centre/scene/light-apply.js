// Applies a lighting snapshot (lighting.js) to the three.js scene: fog, the sun / moon key light with a tight-fit shadow frustum, the hemisphere
// bounce, the sky-driven image-based light (PMREM, refreshed as the hour moves), exposure, and the sky + post-processing looks.
// Allocation-free per frame.
import { Color, DirectionalLight, FogExp2, HemisphereLight, PCFShadowMap, SRGBColorSpace, Vector3 } from 'three';
import { QUALITY } from './quality.js';
import { attachmentsOf } from './renderer.js';

const srgb = (c, rgb, k = 1) => c.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k, SRGBColorSpace);
const fogColor = new Color();

export function createLightApplier({ scene, renderer, quality }) {
  const gfx = attachmentsOf(renderer);
  scene.background = null; // the sky dome paints the background
  scene.fog = new FogExp2(0xffffff, 0.005);
  const hemi = new HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);
  const sun = new DirectionalLight(0xffffff, 3);
  sun.position.set(0, 20, 10);
  sun.target.position.set(0, 0.6, -1.2);
  // tight fit around the stall, the customers and the near footpath; the street beyond does not cast
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  const dir = new Vector3();
  let cfg = QUALITY[quality];
  let shadowSize = 0;

  const applyQuality = (q) => {
    cfg = QUALITY[q];
    const s = cfg.shadow;
    sun.castShadow = s > 0;
    if (s > 0 && shadowSize !== s) {
      shadowSize = s;
      sun.shadow.mapSize.set(s, s);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.shadow.radius = cfg.shadowRadius || 1;
    renderer.shadowMap.type = PCFShadowMap;
    gfx?.sky.markEnvDirty();
  };
  applyQuality(quality);

  return {
    sun,
    hemi,
    applyQuality,
    apply(L) {
      const sky = gfx?.sky;
      srgb(fogColor, L.fog);
      scene.fog.color.copy(fogColor);
      scene.fog.density = L.fd;
      renderer.setClearColor(fogColor, 1);
      srgb(hemi.color, L.hs);
      srgb(hemi.groundColor, L.hg);
      hemi.intensity = L.hi;
      srgb(sun.color, L.sun);
      sun.intensity = L.si;
      sun.shadow.intensity = L.shadow;
      dir.set(L.sunDir[0], L.sunDir[1], L.sunDir[2]);
      sun.position.copy(sun.target.position).addScaledVector(dir, 38);
      if (sky) {
        sky.setLook(L, gfx.time);
        scene.environment = sky.updateEnv(renderer, L.hour, cfg.envInterval, cfg.envSize);
      }
      scene.environmentIntensity = L.env * 0.9;
      renderer.toneMappingExposure = L.exposure;
      gfx?.post.setLook(L, L.exposure, cfg);
    },
    dispose() {
      scene.remove(hemi, sun, sun.target);
      sun.shadow.map?.dispose();
      scene.environment = null;
      scene.fog = null;
    },
  };
}
