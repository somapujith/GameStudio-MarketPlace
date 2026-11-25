// OWNER: workshop agent. Mama's Garage: a neon ring on the road in front of the garage; press E near it and the auto glides onto a
// turntable, the camera orbits it and the menu (ui/Workshop.jsx) sells parts. Pricing and fitting live in workshop/shop.js,
// the 3D set in workshop/showroom.js, the camera in workshop/orbit.js, the menu structure in workshop/menuModel.js.
//
// Events emitted: workshop:enter {}, workshop:buy {path, value, price}, workshop:upgrade {key, level, price, upgrades},
// workshop:leave {}, plus the core `loadout {loadout, preview}` (previews while browsing, the real loadout after a buy / on leaving).
// ctx.workshop = { isOpen, phase, open(), close(), quote(), buy(), preview(), clearPreview(), stats(), camera, spot }
import { buy as shopBuy, previewLoadout, quote as shopQuote, statBars } from './workshop/shop.js';
import { createOrbit } from './workshop/orbit.js';
import { createEntryRing, createSet } from './workshop/showroom.js';

const PAVEMENT = 0.2; // the raised slab the bay stands on (world/roads.js)
const ENTER_RADIUS = 9;
const ENTER_MAX_SPEED = 4;
const GLIDE = 1.2; // seconds to drive into / out of the bay
const TAU = Math.PI * 2;
const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const smooth = (t) => t * t * (3 - 2 * t);
const clone = (o) => JSON.parse(JSON.stringify(o));

export function installWorkshop(ctx) {
  const { scene, world, vehicle, v, input, state } = ctx;
  const garage = world.city?.poiById?.garage;
  const noop = { isOpen: false, phase: 'closed', open: () => false, close() {}, preview() {}, clearPreview() {}, quote: () => null, buy: () => ({ ok: false, reason: 'No garage' }), stats: () => [], camera: null, spot: null };
  if (!garage) {
    ctx.workshop = noop;
    return;
  }

  const front = garage.front;
  const edge = world.city.edges?.[front.edge];
  const roadHeading = edge ? Math.atan2(edge.dx, edge.dz) : 0;
  const heightAt = world.heightAt || (() => 0);

  // the display spot: on the pavement between the road and the garage, clear of walls; the road front if nothing fits
  const spot = (() => {
    const dx = garage.x - front.x;
    const dz = garage.z - front.z;
    const len = Math.hypot(dx, dz) || 1;
    for (const d of [8, 9.5, 7, 11, 6.5, 12.5]) {
      const x = front.x + (dx / len) * d;
      const z = front.z + (dz / len) * d;
      if (!world.colliders?.inside?.(x, z, 3.1)) return { x, z };
    }
    return { x: front.x, z: front.z };
  })();

  const ring = createEntryRing(scene, front.x, heightAt(front.x, front.z), front.z);

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let phase = 'closed'; // closed | entering | open | leaving
  let t = 0;
  let from = null;
  let to = null;
  let facing = roadHeading;
  let orbit = null;
  let set = null;
  let cooldown = 0;
  let lastPreview = '';
  let ownsCamera = null;

  const real = () => ctx.profile.data.loadout;
  const nearest = (h) => (Math.abs(wrap(h - roadHeading)) <= Math.PI / 2 ? roadHeading : roadHeading + Math.PI);

  const emitReal = () => {
    lastPreview = '';
    ctx.emit('loadout', { loadout: clone(real()), preview: false });
  };

  function open() {
    if (phase !== 'closed' || state.menu) return false;
    phase = 'entering';
    t = 0;
    facing = nearest(v.heading);
    from = { x: v.x, z: v.z, h: v.heading };
    to = { x: spot.x, z: spot.z, h: facing };
    ctx.openMenu('workshop');
    orbit = createOrbit({ anchor: v, colliders: world.colliders, groundAt: heightAt, reducedMotion: reduced });
    orbit.begin(ctx.camera); // start from the chase camera's spot, then glide to the first preset
    orbit.setView('front34');
    ownsCamera = (camera, dt) => orbit?.update(camera, dt);
    state.cameraOverride = ownsCamera;
    set = createSet(scene, spot.x, heightAt(spot.x, spot.z) + PAVEMENT, spot.z, facing);
    ctx.setPrompt('workshop', null);
    ctx.emit('workshop:enter', {});
    return true;
  }

  function close() {
    if (phase !== 'open' && phase !== 'entering') return;
    emitReal(); // drop any un-bought preview
    phase = 'leaving';
    t = 0;
    from = { x: v.x, z: v.z, h: v.heading };
    to = { x: front.x, z: front.z, h: facing };
    orbit?.setView('chase');
  }

  function finishLeave() {
    phase = 'closed';
    if (state.cameraOverride === ownsCamera) state.cameraOverride = null;
    orbit?.release(ctx.camera);
    orbit = null;
    ownsCamera = null;
    set?.dispose();
    set = null;
    vehicle.teleport(front.x, front.z, facing);
    ctx.closeMenu();
    ctx.emit('workshop:leave', {});
    cooldown = 1;
  }

  // the bay is on the pavement slab: ride up the kerb on the way in, down again on the way out
  const lift = (k) => { v.y = heightAt(v.x, v.z) + PAVEMENT * k; };

  const glide = (dt) => {
    t += dt;
    const k = smooth(Math.min(1, t / GLIDE));
    const px = v.x;
    const pz = v.z;
    const x = from.x + (to.x - from.x) * k;
    const z = from.z + (to.z - from.z) * k;
    const h = from.h + wrap(to.h - from.h) * k;
    vehicle.teleport(x, z, h);
    v.wheelSpin += Math.hypot(x - px, z - pz) / 0.34; // the wheels roll as it drives in
    lift(phase === 'leaving' ? 1 - k : k);
    return t >= GLIDE;
  };

  const system = {
    update(dt) {
      cooldown = Math.max(0, cooldown - dt);
      ring.update(ctx.clock.time);
      if (phase === 'closed') {
        const near = !state.menu && !state.paused && cooldown === 0 && Math.hypot(v.x - front.x, v.z - front.z) < ENTER_RADIUS && v.speed < ENTER_MAX_SPEED && !v.airborne;
        if (near) {
          const riding = ctx.fares?.trip?.status === 'riding';
          if (riding) {
            ctx.setPrompt('workshop', "Finish this fare before Mama's Garage", '!');
          } else {
            ctx.setPrompt('workshop', "Press E to enter Mama's Garage", 'E');
            if (input.pressed('interact')) open();
          }
        } else {
          ctx.setPrompt('workshop', null);
        }
        return;
      }
      // the menu owns the keyboard: swallow the one-shots it would otherwise leave for the driving code
      input.pressed('interact');
      input.pressed('pause');
      set?.update(ctx.clock.time, dt);
      if (phase === 'entering') {
        if (glide(dt)) phase = 'open';
      } else if (phase === 'leaving') {
        if (glide(dt)) finishLeave();
      } else {
        vehicle.teleport(to.x, to.z, to.h);
        lift(1);
      }
    },
    dispose() {
      ctx.setPrompt('workshop', null);
      if (state.cameraOverride === ownsCamera) state.cameraOverride = null;
      if (phase !== 'closed') {
        orbit?.release(ctx.camera);
        if (state.menu === 'workshop') state.menu = null;
      }
      set?.dispose();
      ring.dispose();
    },
  };
  ctx.addSystem(system);

  ctx.addSnapshot(() => ({ workshopPhase: phase }));

  ctx.workshop = {
    get isOpen() {
      return phase !== 'closed';
    },
    get phase() {
      return phase;
    },
    spot,
    open,
    close,
    quote: (path, value) => shopQuote(ctx.profile.data, ctx.profile.data.loadout, path, value),
    buy: (path, value) => {
      if (phase !== 'open') return { ok: false, reason: 'The garage is not open', code: 'closed' };
      const res = shopBuy(ctx, path, value);
      if (res.ok) lastPreview = '';
      return res;
    },
    /** Show a part on the auto without charging (the customisation agent listens for `loadout { preview: true }`). */
    preview(path, value) {
      if (phase !== 'open') return;
      const lo = previewLoadout(real(), path, value);
      const key = JSON.stringify(lo);
      if (key === lastPreview) return;
      lastPreview = key;
      ctx.emit('loadout', { loadout: lo, preview: true });
    },
    /** Back to the saved look. */
    clearPreview() {
      if (lastPreview) emitReal();
    },
    /** Stat bars for the performance panel (`key`: the part being looked at, to show before/after). */
    stats: (key = null, upgrades = ctx.profile.data.upgrades) => statBars(upgrades, key, (env) => vehicle.params(env)),
    camera: {
      setView: (name) => orbit?.setView(name),
      drag: (dx, dy) => orbit?.drag(dx, dy),
      zoom: (amount) => orbit?.zoom(amount),
      poke: () => orbit?.poke(),
      setInput: (x, y, z) => orbit?.setInput(x, y, z),
      setShift: (x, y) => orbit?.setShift(x, y),
    },
  };
}
