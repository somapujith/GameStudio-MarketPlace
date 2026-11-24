// The tutorial pulse, first person: a glowing ring BILLBOARDED round the target (it faces the eye, so it reads from any head turn) plus a
// bobbing arrow above it. Depth testing is off: it shows through counters, steam and people. `set(target)` then
// `update(dt, t, resolve, reduced, view)` where resolve(target, centre, top) fills two Vector3s and returns the ring radius in metres
// (0 = not found) and view = { camera, pxPerM(depth) } keeps the ring at least ~MIN_RING_PX across so it never vanishes in the distance.
import { ConeGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, AdditiveBlending, Vector3, DoubleSide } from 'three';

export const MIN_RING_PX = 56;
export const ARROW_PX = 40;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createHighlight({ scene, art, tr }) {
  const root = new Group();
  root.visible = false;
  scene.add(root);
  const ringM = tr.track(new MeshBasicMaterial({ map: art.ring(), color: 0xffc83d, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide, fog: false }));
  const ringG = tr.track(new PlaneGeometry(1, 1));
  const ring = new Mesh(ringG, ringM);
  ring.renderOrder = 14;
  const ring2 = new Mesh(ringG, ringM);
  ring2.renderOrder = 14;
  const arrowM = tr.track(new MeshBasicMaterial({ color: 0xffc83d, depthTest: false, fog: false }));
  const arrow = new Mesh(tr.track(new ConeGeometry(0.14, 0.3, 4)), arrowM);
  arrow.rotation.x = Math.PI; // tip down
  arrow.renderOrder = 15;
  const arrowPivot = new Group();
  arrowPivot.add(arrow);
  root.add(ring, ring2, arrowPivot);
  let target = null;
  const centre = new Vector3();
  const top = new Vector3();

  return {
    set(t) {
      target = t || null;
      root.visible = !!target;
    },
    get active() {
      return !!target;
    },
    update(dt, t, resolve, reduced, view) {
      if (!target) return;
      const r0 = resolve(target, centre, top);
      if (!r0) {
        root.visible = false;
        return;
      }
      root.visible = true;
      let r = r0;
      let k = 0.3; // arrow scale: a small arrow when nothing is known about the view
      if (view?.camera) {
        // first person: the ring is between MIN_RING_PX and ~40% of the short side wide on screen, the arrow is always ~40 px tall
        const cam = view.camera;
        const depth = Math.max(0.2, cam.position.distanceTo(centre));
        const ppm = Math.max(1, view.pxPerM(depth));
        const minR = MIN_RING_PX / 2 / ppm;
        const maxR = (view.minDim() * 0.2) / ppm;
        r = Math.max(minR, Math.min(r, maxR));
        const dTop = Math.max(0.2, cam.position.distanceTo(top));
        k = clamp(ARROW_PX / (0.3 * Math.max(1, view.pxPerM(dTop))), 0.08, 3);
        ring.quaternion.copy(cam.quaternion);
        ring2.quaternion.copy(cam.quaternion);
      }
      const pulse = reduced ? 0.5 : (Math.sin(t * 5) + 1) / 2;
      const p2 = reduced ? 0.5 : (t * 1.2) % 1;
      ring.position.copy(centre);
      ring.scale.setScalar(r * 2 * (1 + 0.12 * pulse));
      ringM.opacity = 0.55 + 0.4 * pulse;
      ring2.position.copy(centre);
      ring2.scale.setScalar(r * 2 * (0.9 + 0.7 * p2));
      arrowPivot.position.set(top.x, top.y + 0.6 * k + (reduced ? 0 : Math.sin(t * 5) * 0.2 * k), top.z);
      arrowPivot.scale.setScalar(k);
      arrow.rotation.y = reduced ? 0 : t * 2.4;
    },
    dispose() {
      scene.remove(root);
    },
  };
}
