// Applies a lighting snapshot (lighting.js) to the three.js scene: background, fog, sun / moon (with shadows), hemisphere light,
// image-based light intensity and exposure. Allocation-free per frame.
import { Color, DirectionalLight, FogExp2, HemisphereLight, PMREMGenerator, PCFShadowMap, SRGBColorSpace, Vector3 } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY } from './quality.js';

const srgb = (c, rgb, k = 1) => c.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k, SRGBColorSpace);

export function createLightApplier({ scene, renderer, quality }) {
  const bg = new Color();
  scene.background = bg;
  scene.fog = new FogExp2(0xffffff, 0.008);
  const hemi = new HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);
  const sun = new DirectionalLight(0xffffff, 3);
  sun.position.set(0, 20, 10);
  sun.target.position.set(0, 0, -0.8);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);

  // a procedural room as the environment map: gives the steel and brass something to reflect, no external assets
  let pmrem = null;
  let envTex = null;
  try {
    pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    envTex = pmrem.fromScene(room, 0.04).texture;
    scene.environment = envTex;
    room.traverse((o) => {
      o.geometry?.dispose?.();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      ms.forEach((m) => m.dispose?.());
    });
  } catch {
    scene.environment = null;
  }

  const dir = new Vector3();
  const applyQuality = (q) => {
    const s = QUALITY[q].shadow;
    sun.castShadow = s > 0;
    if (s > 0 && sun.shadow.mapSize.x !== s) {
      sun.shadow.mapSize.set(s, s);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    renderer.shadowMap.type = PCFShadowMap;
  };
  applyQuality(quality);

  return {
    sun,
    hemi,
    applyQuality,
    apply(L) {
      srgb(bg, L.mid, 0.8).lerp(srgb(dirColor, L.hor), 0.4);
      scene.fog.color.copy(srgb(fogColor, L.fog));
      scene.fog.density = L.fd;
      srgb(hemi.color, L.hs);
      srgb(hemi.groundColor, L.hg);
      hemi.intensity = L.hi;
      srgb(sun.color, L.sun);
      sun.intensity = L.si;
      dir.set(L.sunDir[0], L.sunDir[1], L.sunDir[2]);
      sun.position.copy(sun.target.position).addScaledVector(dir, 30);
      scene.environmentIntensity = L.env * 0.55;
      renderer.toneMappingExposure = L.exposure;
    },
    dispose() {
      scene.remove(hemi, sun, sun.target);
      sun.shadow.map?.dispose();
      envTex?.dispose();
      pmrem?.dispose();
      scene.environment = null;
    },
  };
}
const dirColor = new Color();
const fogColor = new Color();
