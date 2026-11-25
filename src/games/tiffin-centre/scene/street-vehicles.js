// Traffic and passers-by for the street: auto-rickshaws, scooters with riders, hatchbacks, a city bus, bicycles, pedestrians. Each type is ONE
// merged, vertex-coloured geometry (parts painted white take the per-instance tint) split in a body and an emissive "lights" part, drawn instanced:
// the whole road costs about a dozen draw calls. Vehicles face +x (front = +x), origin on the ground in the middle of the wheelbase.
import { BoxGeometry, CapsuleGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, Matrix4, Quaternion, Euler, Vector3 } from 'three';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();

export function createVehicleKit(k) {
  /** a primitive transformed into place and painted: add(list, geometry, colour, [x,y,z], [rx,ry,rz], [sx,sy,sz]) */
  const place = (list, g, hex, pos, rot = [0, 0, 0], scl = [1, 1, 1]) => {
    _e.set(rot[0], rot[1], rot[2], 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(new Vector3(pos[0], pos[1], pos[2]), _q, new Vector3(scl[0], scl[1], scl[2]));
    g.applyMatrix4(_m);
    k.paint(g, hex);
    const uv = g.attributes.uv;
    const tintable = hex.toLowerCase() === '#ffffff' ? 1 : 0;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, tintable, 0);
    list.push(g);
  };
  const box = (l, w, h, d, hex, pos, rot, scl) => place(l, new BoxGeometry(w, h, d), hex, pos, rot, scl);
  const cyl = (l, rt, rb, h, seg, hex, pos, rot, scl) => place(l, new CylinderGeometry(rt, rb, h, seg), hex, pos, rot, scl);
  const sph = (l, r, hex, pos, scl, ws = 10, hs = 8) => place(l, new SphereGeometry(r, ws, hs), hex, pos, [0, 0, 0], scl);
  const cap = (l, r, len, hex, pos, rot, scl) => place(l, new CapsuleGeometry(r, len, 3, 8), hex, pos, rot, scl);
  const wheel = (l, r, w, x, y, z) => {
    cyl(l, r, r, w, 14, '#141414', [x, y, z], [Math.PI / 2, 0, 0]);
    cyl(l, r * 0.55, r * 0.55, w + 0.01, 10, '#9aa0a4', [x, y, z], [Math.PI / 2, 0, 0]);
  };
  const SKIN = ['#b98660', '#a8744e', '#8a5a3a', '#c4966c'];
  const finish = (body, lights) => ({ body: body.length ? k.merge(body) : null, lights: lights.length ? k.merge(lights) : null });

  const make = {
    /** three-wheeler: black lower body, white (tinted) cabin and canopy, driver in khaki */
    auto() {
      const b = [];
      const l = [];
      box(b, 1.2, 0.5, 1.28, '#1c1c1e', [-0.5, 0.66, 0]); // rear body / engine bay
      box(b, 0.7, 0.45, 1.22, '#1c1c1e', [0.35, 0.58, 0]); // floor
      sph(b, 0.52, '#ffffff', [0.78, 0.92, 0], [0.9, 1.0, 1.0]); // rounded nose
      box(b, 0.5, 0.78, 1.0, '#ffffff', [0.62, 1.0, 0]);
      box(b, 0.03, 0.52, 0.94, '#27323a', [0.97, 1.3, 0], [0, 0, -0.35]); // windscreen
      box(b, 0.04, 0.5, 0.04, '#303034', [0.82, 1.45, 0.46]);
      box(b, 0.04, 0.5, 0.04, '#303034', [0.82, 1.45, -0.46]);
      for (const z of [0.62, -0.62]) {
        box(b, 0.05, 1.0, 0.05, '#303034', [-0.95, 1.2, z]);
        box(b, 0.05, 1.0, 0.05, '#303034', [0.2, 1.2, z * 0.95]);
      }
      box(b, 2.3, 0.06, 1.46, '#ffffff', [-0.25, 1.76, 0], [0, 0, 0.02]); // canopy
      box(b, 2.3, 0.04, 1.5, '#1c1c1e', [-0.25, 1.73, 0]);
      box(b, 0.5, 0.42, 1.0, '#3a2a22', [-0.55, 0.98, 0]); // seat
      box(b, 0.1, 0.55, 1.0, '#3a2a22', [-0.86, 1.2, 0]);
      cyl(b, 0.04, 0.04, 0.5, 6, '#9aa0a4', [0.7, 1.15, 0], [0, 0, 0]);
      box(b, 0.05, 0.05, 0.6, '#303034', [0.62, 1.2, 0]); // handlebar
      cap(b, 0.14, 0.34, '#b8a276', [0.4, 1.08, 0.18]); // driver torso (khaki)
      sph(b, 0.115, SKIN[0], [0.4, 1.5, 0.18]);
      box(b, 0.7, 0.05, 0.3, '#ffffff', [0.9, 0.52, 0]); // front mudguard
      box(b, 0.5, 0.05, 0.3, '#1c1c1e', [-0.78, 0.55, 0.72]);
      box(b, 0.5, 0.05, 0.3, '#1c1c1e', [-0.78, 0.55, -0.72]);
      box(b, 0.04, 0.12, 0.14, '#303030', [0.82, 1.5, 0.6]);
      wheel(b, 0.26, 0.12, 0.92, 0.26, 0);
      wheel(b, 0.26, 0.14, -0.78, 0.26, 0.72);
      wheel(b, 0.26, 0.14, -0.78, 0.26, -0.72);
      box(l, 0.1, 0.12, 0.22, '#fff2c0', [1.2, 0.82, 0.0]);
      box(l, 0.06, 0.08, 0.14, '#ff2a14', [-1.1, 0.88, 0.5]);
      box(l, 0.06, 0.08, 0.14, '#ff2a14', [-1.1, 0.88, -0.5]);
      return finish(b, l);
    },
    /** scooter / motorbike with a rider (and sometimes the lunch bag): white parts take the tint */
    bike(rider = true) {
      const b = [];
      const l = [];
      box(b, 0.95, 0.28, 0.3, '#ffffff', [0, 0.52, 0], [0, 0, 0.0]);
      box(b, 0.5, 0.1, 0.28, '#1b1b1d', [-0.22, 0.75, 0]);
      box(b, 0.34, 0.42, 0.34, '#ffffff', [0.45, 0.72, 0], [0, 0, -0.2]);
      box(b, 0.05, 0.62, 0.05, '#8a8c90', [0.58, 0.55, 0.08], [0, 0, -0.34]);
      box(b, 0.05, 0.62, 0.05, '#8a8c90', [0.58, 0.55, -0.08], [0, 0, -0.34]);
      box(b, 0.06, 0.06, 0.62, '#2a2a2e', [0.5, 1.0, 0]);
      wheel(b, 0.25, 0.1, 0.66, 0.25, 0);
      wheel(b, 0.25, 0.12, -0.6, 0.25, 0);
      box(b, 0.3, 0.3, 0.3, '#ffffff', [-0.45, 0.45, 0]); // rear body
      if (rider) {
      cap(b, 0.155, 0.38, '#ffffff', [-0.12, 1.12, 0], [0, 0, 0.12]); // rider torso
      cap(b, 0.13, 0.3, '#2a2a34', [0.18, 0.78, 0.13], [0, 0, 1.0]); // thigh
      cap(b, 0.13, 0.3, '#2a2a34', [0.18, 0.78, -0.13], [0, 0, 1.0]);
      sph(b, 0.14, SKIN[1], [-0.06, 1.55, 0]);
      sph(b, 0.15, '#1a1a1c', [-0.06, 1.6, 0], [1, 0.8, 1]); // helmet
      cap(b, 0.07, 0.4, '#ffffff', [0.18, 1.1, 0.2], [0.5, 0, -1.0]); // arm
      cap(b, 0.07, 0.4, '#ffffff', [0.18, 1.1, -0.2], [-0.5, 0, -1.0]);
      }
      box(l, 0.08, 0.1, 0.14, '#fff2c0', [0.74, 0.98, 0]);
      box(l, 0.05, 0.07, 0.12, '#ff2a14', [-0.62, 0.68, 0]);
      return finish(b, l);
    },
    car() {
      const b = [];
      const l = [];
      box(b, 3.7, 0.5, 1.6, '#ffffff', [0, 0.58, 0]);
      box(b, 3.6, 0.1, 1.56, '#1b1b1d', [0, 0.32, 0]);
      cyl(b, 0.5, 0.82, 0.52, 4, '#27323a', [-0.2, 1.1, 0], [0, Math.PI / 4, 0], [1.55, 1, 1.3]);
      cyl(b, 0.46, 0.78, 0.06, 4, '#ffffff', [-0.2, 1.38, 0], [0, Math.PI / 4, 0], [1.55, 1, 1.3]);
      box(b, 0.5, 0.06, 1.54, '#ffffff', [1.3, 0.86, 0], [0, 0, -0.1]);
      for (const [x, z] of [[1.15, 0.78], [1.15, -0.78], [-1.15, 0.78], [-1.15, -0.78]]) wheel(b, 0.3, 0.2, x, 0.3, z);
      box(l, 0.06, 0.12, 0.3, '#fff2c0', [1.86, 0.66, 0.55]);
      box(l, 0.06, 0.12, 0.3, '#fff2c0', [1.86, 0.66, -0.55]);
      box(l, 0.06, 0.1, 0.34, '#ff2a14', [-1.86, 0.7, 0.58]);
      box(l, 0.06, 0.1, 0.34, '#ff2a14', [-1.86, 0.7, -0.58]);
      return finish(b, l);
    },
    bus() {
      const b = [];
      const l = [];
      box(b, 9.6, 1.0, 2.5, '#ffffff', [0, 0.98, 0]); // lower body, tinted
      box(b, 9.64, 0.12, 2.54, '#e8e6dc', [0, 1.52, 0]); // beltline stripe
      box(b, 9.56, 0.95, 2.46, '#1e282e', [0, 2.05, 0]); // glass band
      for (let i = -4; i <= 4; i++) box(b, 0.1, 0.96, 2.52, '#ffffff', [i * 1.1, 2.05, 0]); // window pillars, tinted
      box(b, 9.6, 0.22, 2.5, '#ffffff', [0, 2.64, 0]); // roof
      box(b, 9.3, 0.1, 2.2, '#cfcdc2', [0, 2.79, 0]);
      box(b, 0.9, 0.14, 0.9, '#9a9890', [-1.5, 2.9, 0]);
      box(b, 0.9, 0.14, 0.9, '#9a9890', [1.8, 2.9, 0]);
      box(b, 9.7, 0.3, 2.56, '#202224', [0, 0.38, 0]); // skirt
      box(b, 0.06, 1.15, 2.3, '#1e282e', [4.83, 1.95, 0], [0, 0, -0.08]); // windscreen
      box(b, 0.06, 0.75, 2.3, '#ffffff', [4.84, 0.95, 0]); // front panel
      box(b, 0.12, 0.28, 2.4, '#202224', [4.86, 0.42, 0]); // bumper
      box(b, 0.05, 0.4, 1.2, '#2a2420', [4.87, 0.9, 0]); // grille
      box(b, 0.12, 0.08, 0.3, '#303030', [4.8, 2.1, 1.3]); // mirrors
      box(b, 0.12, 0.08, 0.3, '#303030', [4.8, 2.1, -1.3]);
      box(b, 0.06, 0.2, 1.4, '#e8e6dc', [4.84, 2.92, 0]);
      box(b, 0.05, 0.55, 0.05, '#555', [-4.85, 1.2, 1.0]); // rear ladder
      box(b, 0.05, 0.55, 0.05, '#555', [-4.85, 1.2, -1.0]);
      for (const [x, z] of [[3.3, 1.2], [3.3, -1.2], [-3.0, 1.2], [-3.0, -1.2], [-3.9, 1.2], [-3.9, -1.2]]) {
        cyl(b, 0.68, 0.68, 0.06, 16, '#0e0e0e', [x, 0.62, z * 1.03], [Math.PI / 2, 0, 0]); // wheel arch
        wheel(b, 0.52, 0.3, x, 0.52, z);
        cyl(b, 0.2, 0.2, 0.34, 8, '#6a6e72', [x, 0.52, z], [Math.PI / 2, 0, 0]);
      }
      box(l, 0.06, 0.16, 0.36, '#fff2c0', [4.88, 0.72, 0.95]);
      box(l, 0.06, 0.16, 0.36, '#fff2c0', [4.88, 0.72, -0.95]);
      box(l, 0.06, 0.16, 0.3, '#ff2a14', [-4.84, 0.82, 0.98]);
      box(l, 0.06, 0.16, 0.3, '#ff2a14', [-4.84, 0.82, -0.98]);
      box(l, 0.05, 0.22, 1.3, '#ffb040', [4.86, 2.92, 0]); // lit route board
      for (let i = -3; i <= 3; i++) box(l, 0.02, 0.5, 0.75, '#c8d8e0', [i * 1.22 + 0.2, 2.1, 1.245]); // faint interior light in the windows
      return finish(b, l);
    },
    bicycle() {
      const b = [];
      const l = [];
      for (const x of [0.5, -0.5]) {
        place(b, new TorusGeometry(0.34, 0.02, 5, 16), '#141414', [x, 0.36, 0], [0, 0, 0], [1, 1, 1]);
      }
      box(b, 1.0, 0.03, 0.03, '#2a3a5a', [0.0, 0.62, 0], [0, 0, 0.0]);
      box(b, 0.03, 0.5, 0.03, '#2a3a5a', [0.25, 0.62, 0], [0, 0, 0.3]);
      box(b, 0.03, 0.55, 0.03, '#2a3a5a', [-0.15, 0.62, 0], [0, 0, -0.3]);
      box(b, 0.04, 0.04, 0.5, '#444', [0.5, 0.98, 0]);
      cap(b, 0.14, 0.35, '#ffffff', [-0.1, 1.2, 0], [0, 0, 0.45]);
      sph(b, 0.12, SKIN[2], [0.03, 1.6, 0]);
      cap(b, 0.1, 0.32, '#e8e4d8', [0.1, 0.85, 0.1], [0, 0, 0.9]);
      cap(b, 0.1, 0.32, '#e8e4d8', [0.1, 0.85, -0.1], [0, 0, -0.5]);
      box(l, 0.05, 0.05, 0.05, '#ff2a14', [-0.6, 0.62, 0]);
      return finish(b, l);
    },
    /** one pedestrian is built from three instanced parts: upper body (tint), left leg, right leg (pivot at the hip) */
    walkerTorso() {
      const b = [];
      place(b, new CylinderGeometry(0.2, 0.15, 0.56, 10), '#ffffff', [0, 1.2, 0], [0, 0, 0], [1, 1, 0.72]); // shirt
      cap(b, 0.075, 0.3, '#ffffff', [0, 1.46, 0], [0, 0, Math.PI / 2], [1, 1, 1.0]); // shoulders
      cyl(b, 0.15, 0.17, 0.18, 10, '#26262c', [0, 0.9, 0], [0, 0, 0], [1, 1, 0.75]); // hips
      cyl(b, 0.05, 0.06, 0.08, 8, SKIN[0], [0, 1.52, 0]);
      sph(b, 0.108, SKIN[0], [0, 1.64, 0], [0.92, 1.1, 1.0]);
      sph(b, 0.112, '#1a1612', [0, 1.675, -0.012], [0.95, 0.8, 1.0]);
      cap(b, 0.05, 0.3, '#ffffff', [0.0, 1.27, 0.235], [0, 0, 0.05]);
      cap(b, 0.05, 0.3, '#ffffff', [0.0, 1.27, -0.235], [0, 0, -0.05]);
      cap(b, 0.04, 0.2, SKIN[0], [0.02, 1.02, 0.245], [0, 0, 0.05]);
      cap(b, 0.04, 0.2, SKIN[0], [-0.02, 1.02, -0.245], [0, 0, -0.05]);
      return finish(b, []);
    },
    walkerLeg() {
      const b = [];
      cap(b, 0.075, 0.62, '#ffffff', [0, -0.4, 0]);
      cyl(b, 0.065, 0.07, 0.07, 8, '#202020', [0.04, -0.82, 0]);
      return finish(b, []);
    },
  };
  return make;
}
