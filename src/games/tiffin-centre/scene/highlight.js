// The tutorial pulse: a glowing ring on the floor / counter plus a bobbing arrow over the target. `set(target)` then
// `update(dt, t, resolve)` where resolve(target, base, top) fills two Vector3s and returns the ring radius (0 = not found).
import { ConeGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, AdditiveBlending, Vector3, DoubleSide } from 'three';

export function createHighlight({ scene, art, tr }) {
  const root = new Group();
  root.visible = false;
  scene.add(root);
  const ringM = tr.track(new MeshBasicMaterial({ map: art.ring(), color: 0xffc83d, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide, fog: false }));
  const ring = new Mesh(tr.track(new PlaneGeometry(1, 1)), ringM);
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 14;
  const ring2 = new Mesh(ring.geometry, ringM);
  ring2.rotation.x = -Math.PI / 2;
  ring2.renderOrder = 14;
  const arrowM = tr.track(new MeshBasicMaterial({ color: 0xffc83d, depthTest: false, fog: false }));
  const arrow = new Mesh(tr.track(new ConeGeometry(0.16, 0.34, 4)), arrowM);
  arrow.rotation.x = Math.PI; // tip down
  arrow.renderOrder = 15;
  root.add(ring, ring2, arrow);
  let target = null;
  const base = new Vector3();
  const top = new Vector3();

  return {
    set(t) {
      target = t || null;
      root.visible = !!target;
    },
    update(dt, t, resolve, reduced) {
      if (!target) return;
      const r = resolve(target, base, top);
      if (!r) {
        root.visible = false;
        return;
      }
      root.visible = true;
      const pulse = reduced ? 0.5 : (Math.sin(t * 5) + 1) / 2;
      const p2 = reduced ? 0.5 : (t * 1.2) % 1;
      ring.position.copy(base);
      ring.position.y += 0.03;
      ring.scale.setScalar(r * 2 * (1 + 0.12 * pulse));
      ringM.opacity = 0.55 + 0.4 * pulse;
      ring2.position.copy(ring.position);
      ring2.scale.setScalar(r * 2 * (0.9 + 0.7 * p2));
      arrow.position.set(top.x, top.y + 0.35 + (reduced ? 0 : Math.sin(t * 5) * 0.1), top.z);
      arrow.rotation.y = reduced ? 0 : t * 2.4;
    },
    dispose() {
      scene.remove(root);
    },
  };
}
